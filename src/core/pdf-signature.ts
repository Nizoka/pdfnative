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

import { sha256 } from '../crypto/sha.js';
import { buildCmsSignedData, estimateCmsSize } from '../crypto/cms.js';
import type { CmsSignOptions, SignatureAlgorithm } from '../crypto/cms.js';
import type { RsaPrivateKey } from '../crypto/rsa.js';
import type { EcPrivateKey } from '../crypto/ecdsa.js';
import type { X509Certificate } from '../crypto/x509.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PdfSignOptions {
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
export function buildSigDict(options: PdfSignOptions, contentsSize: number = DEFAULT_CONTENTS_SIZE): string {
    const hexLen = contentsSize * 2;
    const parts: string[] = [
        '<< /Type /Sig',
        '/Filter /Adobe.PPKLite',
        '/SubFilter /adbe.pkcs7.detached',
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
 * Sign a PDF that contains a signature placeholder.
 *
 * The PDF must contain exactly one `/Contents <00...00>` placeholder
 * and one `/ByteRange [0 ...]` placeholder inside a /Sig dictionary.
 *
 * @param pdfBytes - Complete PDF bytes with placeholders.
 * @param options - Signing options with key material.
 * @returns Signed PDF bytes with CMS embedded.
 */
export function signPdfBytes(pdfBytes: Uint8Array, options: PdfSignOptions): Uint8Array {
    const algorithm = options.algorithm ?? 'rsa-sha256';
    const pdfString = uint8ToLatin1(pdfBytes);

    // ── 1. Locate /Contents <hex> placeholder ────────────────────
    const contentsStart = pdfString.indexOf('/Contents <');
    if (contentsStart === -1) throw new Error('No /Contents placeholder found in PDF');

    // Find the hex content boundaries
    const hexStart = pdfString.indexOf('<', contentsStart) + 1;
    const hexEnd = pdfString.indexOf('>', hexStart);
    if (hexEnd === -1) throw new Error('Malformed /Contents placeholder');
    const hexLen = hexEnd - hexStart;

    // ── 2. Update /ByteRange with actual offsets ─────────────────
    const byteRangeStr = BYTERANGE_PLACEHOLDER;
    const brPos = pdfString.indexOf(byteRangeStr);
    if (brPos === -1) throw new Error('No /ByteRange placeholder found in PDF');

    // ByteRange: [before_start before_len after_start after_len]
    // Exclude the entire hex string value including '<' and '>' delimiters.
    // Standard convention (iText, pdfbox, Adobe): '<' and '>' are NOT hashed.
    const beforeLen = hexStart - 1;  // 0 to byte before '<' (excludes '<' delimiter)
    const afterStart = hexEnd + 1;   // byte after '>' to end (excludes '>' delimiter)
    const afterLen = pdfBytes.length - afterStart;

    // Format the actual ByteRange value
    const actualByteRange = `/ByteRange [0 ${padNum(beforeLen)} ${padNum(afterStart)} ${padNum(afterLen)}]`;

    // Replace the ByteRange placeholder
    const mutableBytes = new Uint8Array(pdfBytes);
    writeStringAt(mutableBytes, brPos, actualByteRange, byteRangeStr.length);

    // ── 3. Hash the ByteRange segments ───────────────────────────
    const segment1 = mutableBytes.subarray(0, beforeLen);
    const segment2 = mutableBytes.subarray(afterStart);
    const hashInput = new Uint8Array(segment1.length + segment2.length);
    hashInput.set(segment1, 0);
    hashInput.set(segment2, segment1.length);
    const dataHash = sha256(hashInput);

    // ── 4. Build CMS SignedData ──────────────────────────────────
    const cmsOptions: CmsSignOptions = {
        dataHash,
        signerCert: options.signerCert,
        certChain: options.certChain,
        rsaKey: options.rsaKey,
        ecKey: options.ecKey,
        algorithm,
        signingTime: options.signingTime,
    };
    const cms = buildCmsSignedData(cmsOptions);

    // ── 5. Hex-encode CMS and write into /Contents ───────────────
    if (cms.length * 2 > hexLen) {
        throw new Error(`CMS signature (${cms.length * 2} hex chars) exceeds /Contents placeholder (${hexLen} hex chars)`);
    }

    const hexStr = uint8ToHex(cms);
    // Pad with zeros to fill the placeholder
    const paddedHex = hexStr + '0'.repeat(hexLen - hexStr.length);

    // Write hex into the PDF
    for (let i = 0; i < paddedHex.length; i++) {
        mutableBytes[hexStart + i] = paddedHex.charCodeAt(i);
    }

    return mutableBytes;
}

/**
 * Estimate the allocation size needed for /Contents placeholder.
 *
 * @param certSizes - DER sizes of all certificates.
 * @param algorithm - Signature algorithm.
 * @returns Number of bytes to allocate (half the hex char count).
 */
export function estimateContentsSize(certSizes: readonly number[], algorithm: SignatureAlgorithm = 'rsa-sha256'): number {
    return Math.max(DEFAULT_CONTENTS_SIZE, estimateCmsSize(certSizes, algorithm));
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
