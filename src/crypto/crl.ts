/**
 * pdfnative — CRL Parser (RFC 5280 §5)
 * =====================================
 * Parses X.509 CertificateList DER for LTV revocation data collection
 * (PAdES B-LT — /DSS /CRLs streams). Pure structure codec — fetching a CRL
 * over HTTP lives in user land via the {@link RevocationProvider}
 * interface (src/ never touches the network). Signature verification of
 * the CRL is the caller's responsibility.
 */

import {
    derDecode, derRawBytes, asn1Integer, asn1Time,
    ASN1_SEQUENCE, ASN1_INTEGER, ASN1_UTC_TIME, ASN1_GENERALIZED_TIME,
} from './asn1.js';

// ── Types ────────────────────────────────────────────────────────────

/** One revokedCertificates entry. @since 1.7.0 */
export interface CrlRevokedEntry {
    readonly serialNumber: bigint;
    readonly revocationDate: Date;
}

/** Parsed CertificateList (RFC 5280 §5.1). @since 1.7.0 */
export interface ParsedCrl {
    /** Raw DER of the issuer Name. */
    readonly issuerRaw: Uint8Array;
    readonly thisUpdate: Date;
    readonly nextUpdate?: Date;
    /** Revoked entries in stored order (may be empty). */
    readonly revoked: readonly CrlRevokedEntry[];
    /** The complete CertificateList DER (what /DSS /CRLs streams store). */
    readonly raw: Uint8Array;
}

// ── Parser ───────────────────────────────────────────────────────────

/**
 * Parse a DER-encoded CertificateList (RFC 5280 §5.1):
 *
 * ```
 * CertificateList ::= SEQUENCE {
 *   tbsCertList        TBSCertList,
 *   signatureAlgorithm AlgorithmIdentifier,
 *   signatureValue     BIT STRING }
 * TBSCertList ::= SEQUENCE {
 *   version             INTEGER OPTIONAL,
 *   signature           AlgorithmIdentifier,
 *   issuer              Name,
 *   thisUpdate          Time,
 *   nextUpdate          Time OPTIONAL,
 *   revokedCertificates SEQUENCE OF SEQUENCE {
 *     userCertificate  CertificateSerialNumber,
 *     revocationDate   Time, … } OPTIONAL,
 *   crlExtensions       [0] EXPLICIT OPTIONAL }
 * ```
 *
 * @since 1.7.0
 */
export function parseCrl(der: Uint8Array): ParsedCrl {
    const root = derDecode(der);
    if (root.tag !== ASN1_SEQUENCE || root.children.length < 3) {
        throw new Error('CRL: not a CertificateList SEQUENCE');
    }
    const tbs = root.children[0];
    if (tbs.tag !== ASN1_SEQUENCE || tbs.children.length < 3) {
        throw new Error('CRL: malformed TBSCertList');
    }

    let idx = 0;
    if (tbs.children[idx].tag === ASN1_INTEGER) idx++;  // version (v2)
    idx++;                                              // signature AlgorithmIdentifier

    const issuerNode = tbs.children[idx];
    if (issuerNode === undefined || issuerNode.tag !== ASN1_SEQUENCE) {
        throw new Error('CRL: missing issuer Name');
    }
    const issuerRaw = derRawBytes(der, issuerNode);
    idx++;

    const thisUpdateNode = tbs.children[idx];
    if (thisUpdateNode === undefined || !isTimeTag(thisUpdateNode.tag)) {
        throw new Error('CRL: missing thisUpdate');
    }
    const thisUpdate = asn1Time(thisUpdateNode);
    idx++;

    let nextUpdate: Date | undefined;
    if (idx < tbs.children.length && isTimeTag(tbs.children[idx].tag)) {
        nextUpdate = asn1Time(tbs.children[idx]);
        idx++;
    }

    const revoked: CrlRevokedEntry[] = [];
    if (idx < tbs.children.length && tbs.children[idx].tag === ASN1_SEQUENCE) {
        for (const entry of tbs.children[idx].children) {
            if (entry.tag !== ASN1_SEQUENCE || entry.children.length < 2) continue;
            if (entry.children[0].tag !== ASN1_INTEGER || !isTimeTag(entry.children[1].tag)) continue;
            revoked.push({
                serialNumber: asn1Integer(entry.children[0]),
                revocationDate: asn1Time(entry.children[1]),
            });
        }
    }

    return { issuerRaw, thisUpdate, nextUpdate, revoked, raw: der };
}

/**
 * Check whether a serial number appears in a CRL's revokedCertificates
 * list.
 *
 * @since 1.7.0
 */
export function isSerialRevoked(crl: ParsedCrl, serial: bigint): boolean {
    return crl.revoked.some((entry) => entry.serialNumber === serial);
}

// ── Internal helpers ─────────────────────────────────────────────────

/** Time ::= CHOICE { utcTime UTCTime, generalTime GeneralizedTime }. */
function isTimeTag(tag: number): boolean {
    return tag === ASN1_UTC_TIME || tag === ASN1_GENERALIZED_TIME;
}
