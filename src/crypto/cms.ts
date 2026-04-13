/**
 * pdfnative — CMS SignedData Builder (RFC 5652)
 * ==============================================
 * Builds CMS/PKCS#7 SignedData structures for PDF digital signatures.
 * Supports detached signatures (PDF ByteRange-based hashing).
 * Handles RSA PKCS#1 v1.5 and ECDSA P-256 signature algorithms.
 */

import {
    derSequence, derSet, derOid, derNull, derOctetString, derInteger,
    derContextExplicit, derUtcTime, derWrap,
    concatUint8Arrays,
} from './asn1.js';
import { sha256 } from './sha.js';
import { rsaSignHash, type RsaPrivateKey } from './rsa.js';
import { ecdsaSignHash, encodeDerSignature, type EcPrivateKey } from './ecdsa.js';
import type { X509Certificate } from './x509.js';

// ── OID Constants ────────────────────────────────────────────────────

const OID_SIGNED_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const OID_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
const OID_SHA256 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const OID_SHA256_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const OID_CONTENT_TYPE = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03]);
const OID_MESSAGE_DIGEST = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
const OID_SIGNING_TIME = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x05]);

// ── Types ────────────────────────────────────────────────────────────

export type SignatureAlgorithm = 'rsa-sha256' | 'ecdsa-sha256';

export interface CmsSignOptions {
    /** Hash of the PDF ByteRange data (SHA-256, 32 bytes). */
    readonly dataHash: Uint8Array;
    /** Signer certificate (X.509 DER). */
    readonly signerCert: X509Certificate;
    /** Certificate chain (optional — includes intermediate CAs). */
    readonly certChain?: readonly X509Certificate[];
    /** RSA private key (for rsa-sha256). */
    readonly rsaKey?: RsaPrivateKey;
    /** ECDSA private key (for ecdsa-sha256). */
    readonly ecKey?: EcPrivateKey;
    /** Signing time (defaults to now). */
    readonly signingTime?: Date;
    /** Signature algorithm. */
    readonly algorithm: SignatureAlgorithm;
}

// ── Builder ──────────────────────────────────────────────────────────

/**
 * Build a CMS SignedData structure for a PDF detached signature.
 *
 * @param options - Signing parameters.
 * @returns DER-encoded ContentInfo containing SignedData.
 */
export function buildCmsSignedData(options: CmsSignOptions): Uint8Array {
    const { dataHash, signerCert, certChain } = options;

    if (dataHash.length !== 32) throw new Error('Expected 32-byte SHA-256 hash');

    // ── DigestAlgorithms SET ─────────────────────────────────────
    const digestAlgId = derSequence(derOid(OID_SHA256), derNull());
    const digestAlgorithms = derSet(digestAlgId);

    // ── EncapsulatedContentInfo (detached — no eContent) ─────────
    const encapContentInfo = derSequence(derOid(OID_DATA));

    // ── Certificates [0] IMPLICIT ────────────────────────────────
    const allCerts: Uint8Array[] = [signerCert.raw];
    if (certChain) {
        for (const cert of certChain) allCerts.push(cert.raw);
    }
    const certsContent = concatUint8Arrays(...allCerts);
    // [0] IMPLICIT SET OF — must use constructed tag 0xa0 (not primitive 0x80)
    const certificates = derWrap(0xa0, certsContent);

    // ── SignerInfo ────────────────────────────────────────────────
    const signerInfo = buildSignerInfo(options);

    // ── SignedData SEQUENCE ───────────────────────────────────────
    const signedData = derSequence(
        derInteger(1n),          // version
        digestAlgorithms,
        encapContentInfo,
        certificates,
        derSet(signerInfo),      // signerInfos
    );

    // ── ContentInfo wrapper ──────────────────────────────────────
    return derSequence(
        derOid(OID_SIGNED_DATA),
        derContextExplicit(0, signedData),
    );
}

function buildSignerInfo(options: CmsSignOptions): Uint8Array {
    const { dataHash, signerCert, algorithm, signingTime } = options;
    const now = signingTime ?? new Date();

    // ── IssuerAndSerialNumber ────────────────────────────────────
    const issuerAndSerial = derSequence(
        // Re-encode issuer Name from certificate (raw DER)
        signerCert.issuer.raw,
        derInteger(signerCert.serialNumber),
    );

    // ── DigestAlgorithm ──────────────────────────────────────────
    const digestAlg = derSequence(derOid(OID_SHA256), derNull());

    // ── Signed Attributes ────────────────────────────────────────
    // 1. content-type → id-data
    const attrContentType = derSequence(
        derOid(OID_CONTENT_TYPE),
        derSet(derOid(OID_DATA)),
    );

    // 2. message-digest → hash of ByteRange data
    const attrMessageDigest = derSequence(
        derOid(OID_MESSAGE_DIGEST),
        derSet(derOctetString(dataHash)),
    );

    // 3. signing-time
    const attrSigningTime = derSequence(
        derOid(OID_SIGNING_TIME),
        derSet(derUtcTime(now)),
    );

    // Build signed attrs as SET for DER encoding
    const signedAttrsContent = concatUint8Arrays(attrContentType, attrMessageDigest, attrSigningTime);
    // [0] IMPLICIT SET OF — must use constructed tag 0xa0 (not primitive 0x80)
    const signedAttrsImplicit = derWrap(0xa0, signedAttrsContent);

    // For signature computation, re-encode as explicit SET (tag 0x31)
    const signedAttrsForSig = derSet(attrContentType, attrMessageDigest, attrSigningTime);

    // Hash the SET-encoded signed attributes — this is what gets signed
    const attrsHash = sha256(signedAttrsForSig);

    // ── Signature Algorithm + Signature Value ────────────────────
    let sigAlgId: Uint8Array;
    let signatureValue: Uint8Array;

    if (algorithm === 'rsa-sha256') {
        if (!options.rsaKey) throw new Error('RSA private key required for rsa-sha256');
        sigAlgId = derSequence(derOid(OID_SHA256_RSA), derNull());
        signatureValue = rsaSignHash(attrsHash, options.rsaKey);
    } else if (algorithm === 'ecdsa-sha256') {
        if (!options.ecKey) throw new Error('ECDSA private key required for ecdsa-sha256');
        sigAlgId = derSequence(derOid(OID_ECDSA_SHA256));
        const { r, s } = ecdsaSignHash(attrsHash, options.ecKey);
        signatureValue = encodeDerSignature(r, s);
    } else {
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }

    // ── SignerInfo SEQUENCE ───────────────────────────────────────
    return derSequence(
        derInteger(1n),          // version
        issuerAndSerial,
        digestAlg,
        signedAttrsImplicit,     // [0] IMPLICIT signed attributes
        sigAlgId,
        derOctetString(signatureValue),
    );
}

/**
 * Estimate the DER-encoded size of a CMS SignedData for allocation.
 * Used to pre-allocate the /Contents placeholder in the PDF.
 *
 * @param certSizes - Array of certificate DER sizes.
 * @param algorithm - Signature algorithm.
 * @returns Estimated byte size (includes safety margin).
 */
export function estimateCmsSize(certSizes: readonly number[], algorithm: SignatureAlgorithm): number {
    let base = 256; // Fixed overhead (OIDs, attributes, framing)
    for (const sz of certSizes) base += sz;

    if (algorithm === 'rsa-sha256') {
        base += 512; // RSA-4096 signature = 512 bytes (max common size)
    } else {
        base += 72; // ECDSA DER-encoded signature (max ~72 bytes)
    }

    // Round up with safety margin
    return Math.ceil(base * 1.5);
}
