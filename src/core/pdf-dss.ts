/**
 * pdfnative — Document Security Store (PAdES B-LT, v1.7.0)
 * =========================================================
 * LTV enablement per ISO 32000-2 §12.8.4: collect the validation material
 * for every signature (certificates, OCSP responses, CRLs) and embed it in
 * a `/DSS` dictionary — with per-signature `/VRI` entries keyed by the
 * uppercase-hex SHA-1 of each signature's full `/Contents` value — via a
 * non-destructive incremental update.
 *
 * Split by design:
 * - {@link collectValidationInfo} (async) walks the signatures, builds the
 *   certificate chains, and asks the injected {@link RevocationProvider}
 *   for OCSP/CRL data. Pure data out — no PDF mutation, no network in
 *   the engine (the provider is the caller's transport).
 * - {@link embedValidationInfo} (sync, offline) writes pre-collected
 *   {@link LtvData} into the PDF — deterministic and replayable.
 * - {@link addValidationInfo} is the one-call convenience.
 */

import { sha1 } from '../crypto/sha.js';
import { parseCmsSignedData } from '../crypto/cms-utils.js';
import { parseCertificate, isSelfSigned, verifyCertSignature, type X509Certificate } from '../crypto/x509.js';
import { buildOcspRequest, parseOcspResponse, ocspResponseMatchesCertificate, type OcspResponse } from '../crypto/ocsp.js';
import { parseCrl, type ParsedCrl } from '../crypto/crl.js';
import { getRevocationProvider, type RevocationProvider } from '../crypto/revocation-provider.js';
import { openPdf } from '../parser/pdf-reader.js';
import { createModifier } from '../parser/pdf-modifier.js';
import { isDict, isRef, isArray, type PdfDict, type PdfValue, type PdfRef } from '../parser/pdf-object-parser.js';
import { listSignatures } from './pdf-sig-utils.js';

/** Transport-free validation material, serializable and replayable. */
export interface LtvData {
    /** Deduplicated certificate DERs (signers, chains, TSA, responders). */
    readonly certificates: readonly Uint8Array[];
    /** Full OCSPResponse DERs. */
    readonly ocspResponses: readonly Uint8Array[];
    /** Full CertificateList (CRL) DERs. */
    readonly crls: readonly Uint8Array[];
    /**
     * Per-signature /VRI mapping: `key` is the uppercase-hex SHA-1 of the
     * signature's full /Contents value; the arrays hold indexes into the
     * three collections above.
     */
    readonly vri: readonly {
        readonly key: string;
        readonly certs: readonly number[];
        readonly ocsps: readonly number[];
        readonly crls: readonly number[];
    }[];
}

/** Options for {@link collectValidationInfo} / {@link addValidationInfo}. */
export interface CollectLtvOptions {
    /** Per-call transport; falls back to the global `setRevocationProvider`. */
    readonly revocationProvider?: RevocationProvider;
    /**
     * Out-of-band chain completion: extra certificate DERs (e.g. missing
     * intermediates fetched from AIA caIssuers by the caller).
     */
    readonly extraCertificates?: readonly Uint8Array[];
    /** Prefer OCSP over CRL when both are available. Default `true`. */
    readonly preferOcsp?: boolean;
}

/** id-aa-signatureTimeStampToken — 1.2.840.113549.1.9.16.2.14 (OID content bytes). */
const TS_ATTR_OID_HEX = '2a864886f70d010910020e';

const toHex = (bytes: Uint8Array): string => {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
};

/** Uppercase-hex SHA-1 of the full /Contents value — the /VRI key. */
export function vriKeyForContents(contents: Uint8Array): string {
    return toHex(sha1(contents)).toUpperCase();
}

/** Minimal TLV reader: returns [contentStart, contentEnd, totalEnd] or null. */
function readTlv(bytes: Uint8Array, offset: number): readonly [number, number, number] | null {
    if (offset + 2 > bytes.length) return null;
    let len = bytes[offset + 1];
    let contentStart = offset + 2;
    if (len & 0x80) {
        const n = len & 0x7f;
        if (n === 0 || n > 4 || contentStart + n > bytes.length) return null;
        len = 0;
        for (let i = 0; i < n; i++) len = (len << 8) | bytes[offset + 2 + i];
        contentStart = offset + 2 + n;
    }
    const contentEnd = contentStart + len;
    if (contentEnd > bytes.length) return null;
    return [contentStart, contentEnd, contentEnd];
}

/** Extract embedded TimeStampToken DERs from a CMS's unsigned attributes. */
function extractTimestampTokens(unsignedAttrs: readonly Uint8Array[]): Uint8Array[] {
    const tokens: Uint8Array[] = [];
    for (const attr of unsignedAttrs) {
        // Attribute ::= SEQUENCE { attrType OID, attrValues SET OF ANY }.
        if (attr[0] !== 0x30) continue;
        const seq = readTlv(attr, 0);
        if (!seq) continue;
        const [seqStart] = seq;
        if (attr[seqStart] !== 0x06) continue;
        const oid = readTlv(attr, seqStart);
        if (!oid) continue;
        const [oidStart, oidEnd, oidTotal] = oid;
        if (toHex(attr.subarray(oidStart, oidEnd)) !== TS_ATTR_OID_HEX) continue;
        if (attr[oidTotal] !== 0x31) continue;
        const set = readTlv(attr, oidTotal);
        if (!set) continue;
        const [setStart] = set;
        const value = readTlv(attr, setStart);
        if (!value) continue;
        tokens.push(attr.subarray(setStart, value[2]));
    }
    return tokens;
}

interface ChainCert {
    readonly der: Uint8Array;
    readonly cert: X509Certificate;
}

/**
 * Collect validation material for every signed signature in the document.
 * Walks each CMS (and embedded timestamp tokens), deduplicates the
 * certificate pool, and requests OCSP (preferred) or CRL data through the
 * injected provider for every certificate that advertises a source and is
 * neither self-signed nor marked `id-pkix-ocsp-nocheck`.
 *
 * @since 1.7.0
 */
export async function collectValidationInfo(
    pdfBytes: Uint8Array,
    options: CollectLtvOptions = {},
): Promise<LtvData> {
    const provider = options.revocationProvider ?? getRevocationProvider();
    const preferOcsp = options.preferOcsp ?? true;

    const certPool = new Map<string, ChainCert>(); // key: der hex
    const certIndex = new Map<string, number>();
    const certificates: Uint8Array[] = [];
    const ocspResponses: Uint8Array[] = [];
    const crls: Uint8Array[] = [];
    const vri: { key: string; certs: number[]; ocsps: number[]; crls: number[] }[] = [];

    const internCert = (der: Uint8Array): number => {
        const key = toHex(der);
        let idx = certIndex.get(key);
        if (idx === undefined) {
            idx = certificates.length;
            certificates.push(der);
            certIndex.set(key, idx);
            try {
                certPool.set(key, { der, cert: parseCertificate(der) });
            } catch {
                // Unparseable cert still ships in /Certs — validators decide.
            }
        }
        return idx;
    };

    // Out-of-band chain completion: shipped in /Certs AND referenced from
    // every /VRI entry — a validator reads a signature's chain from its VRI
    // (an intermediate listed only in /Certs went unseen before 1.9.0).
    const extraIdx = (options.extraCertificates ?? []).map(internCert);

    const signatures = listSignatures(pdfBytes).filter(s => !s.isPlaceholder);
    if (signatures.length === 0) {
        throw new Error('collectValidationInfo: the document has no signed signature to enable LTV for');
    }

    // Revocation cache so shared chain certificates are fetched once.
    const ocspCache = new Map<string, number>();
    const crlCache = new Map<string, number>();

    for (const sig of signatures) {
        const entry = { key: vriKeyForContents(sig.contents), certs: [] as number[], ocsps: [] as number[], crls: [] as number[] };
        vri.push(entry);

        const cmsDers = certificatesOfSignature(sig.contents, `collectValidationInfo: signature ${entry.key.slice(0, 8)}…`);
        for (const der of cmsDers) entry.certs.push(internCert(der));
        for (const idx of extraIdx) if (!entry.certs.includes(idx)) entry.certs.push(idx);

        // Chain + revocation per certificate in this signature's pool.
        for (const idx of [...entry.certs]) {
            const pooled = certPool.get(toHex(certificates[idx]));
            if (!pooled) continue;
            const { cert } = pooled;
            if (isSelfSigned(cert) || cert.hasOcspNoCheck) continue;
            const issuer = findIssuer(cert, certPool);

            const fetchOcsp = provider?.fetchOcsp;
            const fetchCrl = provider?.fetchCrl;
            const ocspUrl = cert.ocspUrls?.[0];
            const crlUrl = cert.crlUrls?.[0];
            const certKey = toHex(cert.raw);

            if (fetchOcsp && issuer && ocspUrl !== undefined && (preferOcsp || !fetchCrl || crlUrl === undefined)) {
                let oIdx = ocspCache.get(certKey);
                if (oIdx === undefined) {
                    const request = buildOcspRequest(cert, issuer);
                    const response = await fetchOcsp(ocspUrl, request);
                    oIdx = ocspResponses.length;
                    ocspResponses.push(response);
                    ocspCache.set(certKey, oIdx);
                }
                if (!entry.ocsps.includes(oIdx)) entry.ocsps.push(oIdx);
            } else if (fetchCrl && crlUrl !== undefined) {
                let cIdx = crlCache.get(certKey);
                if (cIdx === undefined) {
                    const crl = await fetchCrl(crlUrl);
                    cIdx = crls.length;
                    crls.push(crl);
                    crlCache.set(certKey, cIdx);
                }
                if (!entry.crls.includes(cIdx)) entry.crls.push(cIdx);
            }
        }
    }

    return { certificates, ocspResponses, crls, vri };
}

function findIssuer(cert: X509Certificate, pool: Map<string, ChainCert>): X509Certificate | null {
    for (const { cert: candidate } of pool.values()) {
        if (candidate === cert) continue;
        if (toHex(candidate.subject.raw) === toHex(cert.issuer.raw)) return candidate;
    }
    return null;
}

/**
 * The issuer of `cert` in the pool, by name AND signature: when several
 * pool certificates carry the issuer's subject Name (two PKIs with the same
 * naming, a renewed CA), the one whose key verifies the certificate wins;
 * a name-only match is the fallback when no candidate verifies (unsupported
 * signature algorithm).
 */
function findVerifiedIssuer(cert: X509Certificate, pool: Map<string, ChainCert>): X509Certificate | null {
    const issuerName = toHex(cert.issuer.raw);
    let byName: X509Certificate | null = null;
    for (const { cert: candidate } of pool.values()) {
        if (candidate === cert || toHex(candidate.subject.raw) !== issuerName) continue;
        let verified = false;
        try { verified = verifyCertSignature(cert, candidate); } catch { verified = false; }
        if (verified) return candidate;
        byName ??= candidate;
    }
    return byName;
}

/**
 * The certificate DERs a signature carries: those of its CMS SignedData plus
 * those of every RFC 3161 token in its unsigned attributes. The zero padding
 * after the DER blob is tolerated by the CMS parser, so `/Contents` is
 * passed as-is.
 */
function certificatesOfSignature(contents: Uint8Array, who: string): Uint8Array[] {
    const out: Uint8Array[] = [];
    try {
        const cms = parseCmsSignedData(contents);
        for (const c of cms.certificates) out.push(c);
        for (const token of extractTimestampTokens(cms.unsignedAttrs)) {
            try {
                for (const c of parseCmsSignedData(token).certificates) out.push(c);
            } catch { /* malformed token — covered by the outer certs */ }
        }
    } catch {
        throw new Error(`${who} does not parse as CMS SignedData`);
    }
    return out;
}

/** Validation material collected out of band — three flat lists of DER. @since 1.9.0 */
export interface LtvMaterial {
    /** Certificate DERs: chains, TSA and OCSP responder certificates. */
    readonly certificates?: readonly Uint8Array[];
    /** Full OCSPResponse DERs. */
    readonly ocspResponses?: readonly Uint8Array[];
    /** Full CertificateList (CRL) DERs. */
    readonly crls?: readonly Uint8Array[];
}

/** Options for {@link composeLtvData}. @since 1.9.0 */
export interface ComposeLtvOptions {
    /**
     * How the material is attributed to the document's signatures:
     *
     * - `'all'` (default) — every item is referenced from every `/VRI`
     *   entry, the Adobe-tolerant superset: nothing a validator might need
     *   is left out of a signature's entry.
     * - `'chain'` — each `/VRI` entry references only what validates that
     *   signature: the certificates of its CMS and timestamp tokens plus
     *   the issuers reachable from them in the material, the OCSP responses
     *   whose CertID names one of those certificates, and the CRLs issued
     *   by one of their issuers. Material that matches no signature still
     *   ships in `/DSS` `/Certs`, `/OCSPs` and `/CRLs`.
     */
    readonly match?: 'all' | 'chain';
}

/**
 * Compose the {@link LtvData} that {@link embedValidationInfo} expects from
 * flat lists of certificates, OCSP responses and CRLs collected out of band —
 * an air-gapped pipeline, a corporate PKI export, a cached validator run (#90).
 * Synchronous and offline: no provider is consulted. Replaces the glue every
 * caller had to write: `listSignatures()`, drop the placeholders,
 * `vriKeyForContents()` per signature, then reference the items.
 *
 * ```ts
 * const data = composeLtvData(signedPdf, { certificates, ocspResponses, crls }, { match: 'chain' });
 * const ltv = embedValidationInfo(signedPdf, data);
 * ```
 *
 * @param pdfBytes - A PDF with at least one signed signature field.
 * @param material - The flat lists; each may be empty or absent.
 * @param options - `match: 'all'` (default) or `'chain'`.
 * @returns LtvData whose `vri[]` has one entry per signed signature.
 * @throws Error when the document has no signed signature or the material is empty.
 * @since 1.9.0
 */
export function composeLtvData(pdfBytes: Uint8Array, material: LtvMaterial, options: ComposeLtvOptions = {}): LtvData {
    const match = options.match ?? 'all';
    const given = {
        certificates: material.certificates ?? [],
        ocspResponses: material.ocspResponses ?? [],
        crls: material.crls ?? [],
    };
    if (given.certificates.length + given.ocspResponses.length + given.crls.length === 0) {
        throw new Error('composeLtvData: no material — pass at least one certificate, OCSP response or CRL');
    }
    const signatures = listSignatures(pdfBytes).filter(s => !s.isPlaceholder);
    if (signatures.length === 0) {
        throw new Error('composeLtvData: the document has no signed signature to enable LTV for');
    }

    const certPool = new Map<string, ChainCert>();
    const certIndex = new Map<string, number>();
    const certificates: Uint8Array[] = [];
    const internCert = (der: Uint8Array): number => {
        const key = toHex(der);
        let idx = certIndex.get(key);
        if (idx === undefined) {
            idx = certificates.length;
            certificates.push(der);
            certIndex.set(key, idx);
            try {
                certPool.set(key, { der, cert: parseCertificate(der) });
            } catch {
                // Unparseable cert still ships in /Certs — validators decide.
            }
        }
        return idx;
    };
    const dedup = (list: readonly Uint8Array[]): Uint8Array[] => {
        const seen = new Set<string>();
        const out: Uint8Array[] = [];
        for (const der of list) {
            const key = toHex(der);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(der);
        }
        return out;
    };

    for (const der of given.certificates) internCert(der);
    const ocspResponses = dedup(given.ocspResponses);
    const crls = dedup(given.crls);
    const parsedOcsps: (OcspResponse | null)[] = ocspResponses.map(der => { try { return parseOcspResponse(der); } catch { return null; } });
    const parsedCrls: (ParsedCrl | null)[] = crls.map(der => { try { return parseCrl(der); } catch { return null; } });

    const vri: { key: string; certs: number[]; ocsps: number[]; crls: number[] }[] = [];
    for (const sig of signatures) {
        const key = vriKeyForContents(sig.contents);
        const sigCerts = certificatesOfSignature(sig.contents, `composeLtvData: signature ${key.slice(0, 8)}…`).map(internCert);
        const entry = { key, certs: [...new Set(sigCerts)], ocsps: [] as number[], crls: [] as number[] };
        vri.push(entry);

        if (match === 'all') {
            for (let i = 0; i < certificates.length; i++) if (!entry.certs.includes(i)) entry.certs.push(i);
            entry.ocsps = ocspResponses.map((_, i) => i);
            entry.crls = crls.map((_, i) => i);
            continue;
        }

        // Chain closure: the signature's own certificates plus every issuer
        // reachable from them in the pool (CMS certificates included).
        const closure: X509Certificate[] = [];
        const queue = entry.certs.map(i => certPool.get(toHex(certificates[i]))?.cert).filter((c): c is X509Certificate => c !== undefined);
        const seen = new Set<string>();
        while (queue.length > 0) {
            const cert = queue.shift() as X509Certificate;
            const k = toHex(cert.raw);
            if (seen.has(k)) continue;
            seen.add(k);
            closure.push(cert);
            const idx = certIndex.get(k);
            if (idx !== undefined && !entry.certs.includes(idx)) entry.certs.push(idx);
            if (isSelfSigned(cert)) continue;
            const issuer = findVerifiedIssuer(cert, certPool);
            if (issuer !== null) queue.push(issuer);
        }
        for (const cert of closure) {
            const issuer = isSelfSigned(cert) ? cert : findVerifiedIssuer(cert, certPool);
            if (issuer === null) continue;
            parsedOcsps.forEach((resp, i) => {
                if (resp !== null && !entry.ocsps.includes(i) && ocspResponseMatchesCertificate(resp, cert, issuer)) entry.ocsps.push(i);
            });
            const issuerName = toHex(cert.issuer.raw);
            parsedCrls.forEach((crl, i) => {
                if (crl !== null && !entry.crls.includes(i) && toHex(crl.issuerRaw) === issuerName) entry.crls.push(i);
            });
        }
    }

    // All material ships, referenced or not: /DSS arrays are document-wide.
    return { certificates, ocspResponses, crls, vri };
}

/**
 * Embed pre-collected {@link LtvData} as a `/DSS` dictionary via
 * incremental update. Synchronous and offline. An existing `/DSS`
 * (foreign or from a previous pass) is merged: its stream references are
 * preserved and the new material is appended; existing /VRI keys are kept.
 *
 * @since 1.7.0
 */
export function embedValidationInfo(pdfBytes: Uint8Array, data: LtvData): Uint8Array {
    if (data.certificates.length === 0 && data.ocspResponses.length === 0 && data.crls.length === 0) {
        throw new Error('embedValidationInfo: LtvData is empty — nothing to embed');
    }
    const reader = openPdf(pdfBytes);
    const modifier = createModifier(reader);
    const catalog = reader.getCatalog();

    const mkStream = (bytes: Uint8Array): PdfRef => {
        const dict: PdfDict = new Map<string, PdfValue>();
        const num = modifier.addObject({ type: 'stream', dict, data: bytes });
        return { type: 'ref', num, gen: 0 };
    };

    const certRefs = data.certificates.map(mkStream);
    const ocspRefs = data.ocspResponses.map(mkStream);
    const crlRefs = data.crls.map(mkStream);

    // Merge an existing /DSS: keep its arrays' refs and VRI entries.
    let existingCerts: PdfValue[] = [];
    let existingOcsps: PdfValue[] = [];
    let existingCrls: PdfValue[] = [];
    const mergedVri = new Map<string, PdfValue>();
    const dssVal = catalog.get('DSS');
    const existingDss = isRef(dssVal) ? reader.getObject(dssVal.num) : dssVal;
    if (existingDss && isDict(existingDss)) {
        const arr = (key: string): PdfValue[] => {
            const v = existingDss.get(key);
            const resolved = isRef(v) ? reader.getObject(v.num) : v;
            return resolved && isArray(resolved) ? [...resolved] : [];
        };
        existingCerts = arr('Certs');
        existingOcsps = arr('OCSPs');
        existingCrls = arr('CRLs');
        const vriVal = existingDss.get('VRI');
        const vriDict = isRef(vriVal) ? reader.getObject(vriVal.num) : vriVal;
        if (vriDict && isDict(vriDict)) {
            for (const [k, v] of vriDict) mergedVri.set(k, v);
        }
    }

    for (const entry of data.vri) {
        const vriEntry: PdfDict = new Map<string, PdfValue>();
        if (entry.certs.length) vriEntry.set('Cert', entry.certs.map(i => certRefs[i]));
        if (entry.ocsps.length) vriEntry.set('OCSP', entry.ocsps.map(i => ocspRefs[i]));
        if (entry.crls.length) vriEntry.set('CRL', entry.crls.map(i => crlRefs[i]));
        // A pre-existing VRI entry for the same signature is kept — the
        // earlier material is still valid; ours complements the arrays.
        if (!mergedVri.has(entry.key)) mergedVri.set(entry.key, vriEntry);
    }

    const dss: PdfDict = new Map<string, PdfValue>();
    const allCerts = [...existingCerts, ...certRefs];
    const allOcsps = [...existingOcsps, ...ocspRefs];
    const allCrls = [...existingCrls, ...crlRefs];
    if (allCerts.length) dss.set('Certs', allCerts);
    if (allOcsps.length) dss.set('OCSPs', allOcsps);
    if (allCrls.length) dss.set('CRLs', allCrls);
    if (mergedVri.size) {
        const vriDict: PdfDict = new Map<string, PdfValue>();
        for (const [k, v] of mergedVri) vriDict.set(k, v);
        dss.set('VRI', vriDict);
    }
    const dssNum = modifier.addObject(dss);

    // Re-issue the catalog: clone-and-set preserves /OutputIntents,
    // /Metadata, /AcroForm, /StructTreeRoot, … untouched.
    const newCatalog: PdfDict = new Map(catalog);
    newCatalog.set('DSS', { type: 'ref', num: dssNum, gen: 0 });
    const rootRef = reader.trailer.get('Root');
    if (!isRef(rootRef)) throw new Error('embedValidationInfo: trailer /Root is not an indirect reference');
    modifier.setObject(rootRef.num, newCatalog);

    return modifier.save();
}

/**
 * Convenience: {@link collectValidationInfo} + {@link embedValidationInfo}.
 * Requires a {@link RevocationProvider} (per call or global) when any
 * certificate advertises an OCSP/CRL source.
 *
 * @since 1.7.0
 */
export async function addValidationInfo(
    pdfBytes: Uint8Array,
    options: CollectLtvOptions = {},
): Promise<Uint8Array> {
    const data = await collectValidationInfo(pdfBytes, options);
    return embedValidationInfo(pdfBytes, data);
}
