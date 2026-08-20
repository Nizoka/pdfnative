/**
 * pdfnative — PDF Digital Signature Support
 * ==========================================
 * ISO 32000-1 §12.8 compliant PDF signing.
 *
 * Flow:
 *   1. Build PDF with sig placeholder (/Contents <00...00>, /ByteRange [0 ... ])
 *   2. Compute SHA-256 hash of ByteRange segments (before + after placeholder)
 *   3. Build CMS SignedData using that hash
 *   4. Hex-encode CMS and replace /Contents placeholder
 *   5. Return final signed PDF bytes
 *
 * The signed PDF is a valid PKCS#7 detached signature that Adobe Reader,
 * Foxit, and other PDF validators can verify.
 */

import { sha256, sha384, sha512 } from '../crypto/sha.js';
import { buildCmsSignedData, estimateCmsSize } from '../crypto/cms.js';
import type { CmsSignOptions, SignatureAlgorithm, CmsDigestAlgorithm, CmsProfile } from '../crypto/cms.js';
import type { CryptoProvider } from '../crypto/crypto-provider.js';
import type { RsaPrivateKey } from '../crypto/rsa.js';
import type { EcPrivateKey } from '../crypto/ecdsa.js';
import type { X509Certificate } from '../crypto/x509.js';
import { listUnsignedSigFields } from './pdf-sig-utils.js';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Metadata-only subset of {@link PdfSignOptions} used by
 * {@link buildSigDict} and {@link addSignaturePlaceholder}. None of
 * these fields require key material — they just go into the `/Sig`
 * dictionary as descriptive entries.
 */
export interface SigDictMetadata {
    /** Signing time (defaults to current time). */
    readonly signingTime?: Date;
    /** Signer display name (for /Name field). */
    readonly name?: string;
    /** Signing reason (for /Reason field). */
    readonly reason?: string;
    /** Signing location (for /Location field). */
    readonly location?: string;
    /** Contact info (for /ContactInfo field). */
    readonly contactInfo?: string;
    /**
     * `/SubFilter` of the signature dictionary. `'ETSI.CAdES.detached'`
     * declares a PAdES (ETSI EN 319 142) signature — pair it with
     * `profile: 'pades'` on {@link PdfSignOptions} so the CMS carries the
     * matching ESS signing-certificate-v2 attribute.
     * Default `'adbe.pkcs7.detached'` (unchanged legacy behaviour).
     * @since 1.7.0
     */
    readonly subFilter?: 'adbe.pkcs7.detached' | 'ETSI.CAdES.detached';
}

export interface PdfSignOptions extends SigDictMetadata {
    /** Signer's X.509 certificate (DER-parsed). */
    readonly signerCert: X509Certificate;
    /** Optional certificate chain (intermediate CAs). */
    readonly certChain?: readonly X509Certificate[];
    /** RSA private key (for 'rsa-sha256'). */
    readonly rsaKey?: RsaPrivateKey;
    /** ECDSA private key (for 'ecdsa-sha256'). */
    readonly ecKey?: EcPrivateKey;
    /** Algorithm to use. Default: 'rsa-sha256'. */
    readonly algorithm?: SignatureAlgorithm;
    /**
     * Optional native signature provider (e.g. `node:crypto` / Web Crypto). When
     * set — or when a global provider is installed via {@link setCryptoProvider}
     * — the constant-time native signer replaces pdfnative's pure-JS RSA/ECDSA
     * math, and `rsaKey` / `ecKey` become optional. A per-call provider takes
     * precedence over the global one.
     * @since 1.4.0
     */
    readonly provider?: CryptoProvider;
    /**
     * When the document carries SEVERAL unsigned signature placeholders
     * (created with `allowMultiple`), selects which one to sign by its
     * AcroForm field name. With a single placeholder — the only case prior
     * to v1.7.0 — the option is unnecessary and behaviour is unchanged.
     * @since 1.7.0
     */
    readonly fieldName?: string;
    /**
     * Message digest for the ByteRange hash and the whole CMS structure.
     * Defaults to the digest implied by `algorithm` (`'sha256'` for the
     * legacy algorithms — unchanged behaviour). @since 1.7.0
     */
    readonly digestAlgorithm?: CmsDigestAlgorithm;
    /**
     * CMS profile: `'pkcs7'` (default, legacy attribute set) or `'pades'`
     * (ETSI EN 319 142-1 B-B: ESS signing-certificate-v2, no CMS
     * signing-time). Pair `'pades'` with `subFilter: 'ETSI.CAdES.detached'`.
     * @since 1.7.0
     */
    readonly profile?: CmsProfile;
}

// ── Constants ────────────────────────────────────────────────────────

/** Default /Contents placeholder size in bytes (hex = 2× this). */
const DEFAULT_CONTENTS_SIZE = 16384;

/** Placeholder marker text for ByteRange. */
const BYTERANGE_PLACEHOLDER = '/ByteRange [0 0000000000 0000000000 0000000000]';

/** Hex digits for encoding. */
const HEX_CHARS = '0123456789abcdef';

// ── Signature Placeholder Builder ────────────────────────────────────

/**
 * Build a /Sig signature dictionary string for embedding in a PDF.
 * The /Contents and /ByteRange fields use placeholders that will be
 * replaced after the final PDF bytes are computed.
 *
 * @param options - Signing options (name, reason, etc.).
 * @param contentsSize - Size of /Contents hex string in bytes.
 * @returns The /Sig dictionary string and the contentsHexLen.
 */
export function buildSigDict(options: SigDictMetadata, contentsSize: number = DEFAULT_CONTENTS_SIZE): string {
    const hexLen = contentsSize * 2;
    const parts: string[] = [
        '<< /Type /Sig',
        '/Filter /Adobe.PPKLite',
        `/SubFilter /${options.subFilter ?? 'adbe.pkcs7.detached'}`,
        `/Contents <${'0'.repeat(hexLen)}>`,
        BYTERANGE_PLACEHOLDER,
    ];

    if (options.name) parts.push(`/Name (${escapePdfString(options.name)})`);
    if (options.reason) parts.push(`/Reason (${escapePdfString(options.reason)})`);
    if (options.location) parts.push(`/Location (${escapePdfString(options.location)})`);
    if (options.contactInfo) parts.push(`/ContactInfo (${escapePdfString(options.contactInfo)})`);

    const sigTime = options.signingTime ?? new Date();
    parts.push(`/M (D:${formatPdfDate(sigTime)})`);
    parts.push('>>');

    return parts.join('\n');
}

/**
 * Build a `/DocTimeStamp` dictionary string (ISO 32000-2 §12.8.5) with the
 * same byte-patchable /Contents + /ByteRange placeholders as
 * {@link buildSigDict}. Deliberately carries no `/M`, `/Name` or `/Reason`
 * — the RFC 3161 token's genTime is the document's time assertion.
 *
 * @since 1.7.0
 */
export function buildDocTimeStampDict(contentsSize: number = DEFAULT_CONTENTS_SIZE): string {
    const hexLen = contentsSize * 2;
    return [
        '<< /Type /DocTimeStamp',
        '/Filter /Adobe.PPKLite',
        '/SubFilter /ETSI.RFC3161',
        `/Contents <${'0'.repeat(hexLen)}>`,
        BYTERANGE_PLACEHOLDER,
        '>>',
    ].join('\n');
}

/**
 * One unsigned signature placeholder inside the PDF bytes: the ByteRange
 * placeholder position and the `/Contents` hex span (delimiters excluded).
 * @internal
 */
export interface SignaturePlaceholderLocation {
    readonly brPos: number;
    readonly hexStart: number;
    readonly hexEnd: number;
}

/**
 * Locate every UNSIGNED signature placeholder. Anchors on the exact
 * `BYTERANGE_PLACEHOLDER` literal — it exists only in placeholders (signed
 * dictionaries carry real offsets), so already-signed signatures are never
 * touched. The `/Contents <00…>` span is found relative to its ByteRange
 * (buildSigDict emits /Contents first), which keeps multi-signature
 * documents unambiguous. @internal
 */
export function findUnsignedPlaceholders(pdfString: string): SignaturePlaceholderLocation[] {
    const locs: SignaturePlaceholderLocation[] = [];
    let idx = pdfString.indexOf(BYTERANGE_PLACEHOLDER);
    while (idx !== -1) {
        const contentsStart = pdfString.lastIndexOf('/Contents <', idx);
        if (contentsStart === -1) throw new Error('Malformed /Contents placeholder');
        const hexStart = pdfString.indexOf('<', contentsStart) + 1;
        const hexEnd = pdfString.indexOf('>', hexStart);
        if (hexEnd === -1) throw new Error('Malformed /Contents placeholder');
        locs.push({ brPos: idx, hexStart, hexEnd });
        idx = pdfString.indexOf(BYTERANGE_PLACEHOLDER, idx + BYTERANGE_PLACEHOLDER.length);
    }
    return locs;
}

/**
 * Write the real /ByteRange for a placeholder and return the digest
 * segments' geometry. ByteRange excludes the `<`/`>` hex delimiters —
 * standard convention (iText, PDFBox, Adobe). @internal
 */
export function applyByteRange(
    mutableBytes: Uint8Array,
    loc: SignaturePlaceholderLocation,
): { beforeLen: number; afterStart: number } {
    const beforeLen = loc.hexStart - 1;
    const afterStart = loc.hexEnd + 1;
    const afterLen = mutableBytes.length - afterStart;
    const actualByteRange = `/ByteRange [0 ${padNum(beforeLen)} ${padNum(afterStart)} ${padNum(afterLen)}]`;
    writeStringAt(mutableBytes, loc.brPos, actualByteRange, BYTERANGE_PLACEHOLDER.length);
    return { beforeLen, afterStart };
}

/** Concatenate the two ByteRange segments for digesting. @internal */
export function byteRangeInput(
    mutableBytes: Uint8Array, beforeLen: number, afterStart: number,
): Uint8Array {
    const segment1 = mutableBytes.subarray(0, beforeLen);
    const segment2 = mutableBytes.subarray(afterStart);
    const hashInput = new Uint8Array(segment1.length + segment2.length);
    hashInput.set(segment1, 0);
    hashInput.set(segment2, segment1.length);
    return hashInput;
}

/**
 * Hex-encode a DER blob into a placeholder's /Contents span (zero-padded).
 * Throws when the blob exceeds the reserved space. @internal
 */
export function embedContentsHex(
    mutableBytes: Uint8Array, loc: SignaturePlaceholderLocation, der: Uint8Array,
): void {
    const hexLen = loc.hexEnd - loc.hexStart;
    if (der.length * 2 > hexLen) {
        throw new Error(`CMS signature (${der.length * 2} hex chars) exceeds /Contents placeholder (${hexLen} hex chars)`);
    }
    const paddedHex = uint8ToHex(der) + '0'.repeat(hexLen - der.length * 2);
    for (let i = 0; i < paddedHex.length; i++) {
        mutableBytes[loc.hexStart + i] = paddedHex.charCodeAt(i);
    }
}

/**
 * Select the placeholder to sign. A single placeholder needs no selector;
 * several require `fieldName`, resolved through the AcroForm to the /Sig
 * object's byte offset. @internal
 */
export function selectPlaceholder(
    pdfBytes: Uint8Array,
    locs: SignaturePlaceholderLocation[],
    fieldName: string | undefined,
): SignaturePlaceholderLocation {
    if (locs.length === 1) return locs[0];
    const fields = listUnsignedSigFields(pdfBytes);
    if (!fieldName) {
        const names = fields.map(f => JSON.stringify(f.fieldName)).join(', ');
        throw new Error(
            `signPdfBytes: ${locs.length} unsigned signature placeholders present — ` +
            `pass options.fieldName to select one (unsigned fields: ${names})`,
        );
    }
    const match = fields.find(f => f.fieldName === fieldName);
    if (!match) {
        const names = fields.map(f => JSON.stringify(f.fieldName)).join(', ');
        throw new Error(
            `signPdfBytes: no unsigned signature field named ${JSON.stringify(fieldName)} ` +
            `(unsigned fields: ${names})`,
        );
    }
    // The placeholder belonging to the field is the first one at or after
    // the /Sig object's byte offset.
    let best: SignaturePlaceholderLocation | null = null;
    for (const loc of locs) {
        if (loc.hexStart >= match.objOffset && (best === null || loc.hexStart < best.hexStart)) {
            best = loc;
        }
    }
    if (!best) throw new Error(`signPdfBytes: cannot locate the placeholder for field ${JSON.stringify(fieldName)}`);
    return best;
}

/**
 * Sign a PDF that contains a signature placeholder.
 *
 * The PDF must contain at least one unsigned `/Contents <00...00>` +
 * `/ByteRange [0 ...]` placeholder pair inside a /Sig dictionary. With
 * several unsigned placeholders (multi-signature flows), select one via
 * `options.fieldName`. Already-signed signatures are never modified.
 *
 * @param pdfBytes - Complete PDF bytes with placeholders.
 * @param options - Signing options with key material.
 * @returns Signed PDF bytes with CMS embedded.
 */
export function signPdfBytes(pdfBytes: Uint8Array, options: PdfSignOptions): Uint8Array {
    const algorithm = options.algorithm ?? 'rsa-sha256';
    const pdfString = uint8ToLatin1(pdfBytes);

    // ── 1. Locate the unsigned placeholder(s) ────────────────────
    const locs = findUnsignedPlaceholders(pdfString);
    if (locs.length === 0) {
        if (pdfString.indexOf('/Contents <') === -1) throw new Error('No /Contents placeholder found in PDF');
        throw new Error('No /ByteRange placeholder found in PDF');
    }
    const loc = selectPlaceholder(pdfBytes, locs, options.fieldName);

    // ── 2. Update /ByteRange with actual offsets ─────────────────
    const mutableBytes = new Uint8Array(pdfBytes);
    const { beforeLen, afterStart } = applyByteRange(mutableBytes, loc);

    // ── 3. Hash the ByteRange segments ───────────────────────────
    const digestAlgorithm = options.digestAlgorithm
        ?? (algorithm.endsWith('sha384') ? 'sha384' : algorithm.endsWith('sha512') ? 'sha512' : 'sha256');
    const digestFn = digestAlgorithm === 'sha384' ? sha384 : digestAlgorithm === 'sha512' ? sha512 : sha256;
    const dataHash = digestFn(byteRangeInput(mutableBytes, beforeLen, afterStart));

    // ── 4. Build CMS SignedData ──────────────────────────────────
    const cmsOptions: CmsSignOptions = {
        dataHash,
        signerCert: options.signerCert,
        certChain: options.certChain,
        rsaKey: options.rsaKey,
        ecKey: options.ecKey,
        algorithm,
        digestAlgorithm,
        profile: options.profile,
        signingTime: options.signingTime,
        provider: options.provider,
    };
    const cms = buildCmsSignedData(cmsOptions);

    // ── 5. Hex-encode CMS and write into /Contents ───────────────
    embedContentsHex(mutableBytes, loc, cms);

    return mutableBytes;
}

/**
 * Estimate the allocation size needed for /Contents placeholder.
 *
 * @param certSizes - DER sizes of all certificates.
 * @param algorithm - Signature algorithm.
 * @param options - `timestamp: true` reserves room for an RFC 3161
 *   signature timestamp token in the CMS unsigned attributes (~8 KiB,
 *   covering the TSA's own certificate chain). @since 1.7.0
 * @returns Number of bytes to allocate (half the hex char count).
 */
export function estimateContentsSize(
    certSizes: readonly number[],
    algorithm: SignatureAlgorithm = 'rsa-sha256',
    options?: { readonly timestamp?: boolean },
): number {
    const base = Math.max(DEFAULT_CONTENTS_SIZE, estimateCmsSize(certSizes, algorithm));
    return options?.timestamp ? base + 8192 : base;
}

// ── Helpers ──────────────────────────────────────────────────────────

function escapePdfString(s: string): string {
    return s.replace(/[\\()]/g, c => '\\' + c);
}

function formatPdfDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const sec = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}${m}${day}${h}${min}${sec}Z`;
}

function padNum(n: number): string {
    return String(n).padStart(10, '0');
}

function uint8ToLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

function uint8ToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += HEX_CHARS[bytes[i] >> 4] + HEX_CHARS[bytes[i] & 0x0f];
    }
    return hex;
}

function writeStringAt(buf: Uint8Array, offset: number, str: string, maxLen: number): void {
    for (let i = 0; i < str.length && i < maxLen; i++) {
        buf[offset + i] = str.charCodeAt(i);
    }
    // Pad remaining space with spaces to maintain byte alignment
    for (let i = str.length; i < maxLen; i++) {
        buf[offset + i] = 0x20; // space
    }
}
