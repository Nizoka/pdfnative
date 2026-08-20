/**
 * pdfnative — CMS SignedData Builder (RFC 5652)
 * ==============================================
 * Builds CMS/PKCS#7 SignedData structures for PDF digital signatures.
 * Supports detached signatures (PDF ByteRange-based hashing).
 * Handles RSA PKCS#1 v1.5 (SHA-256/384/512) and ECDSA P-256 signature
 * algorithms, and the PAdES baseline profile (ETSI EN 319 142-1 B-B) via
 * the ESS signing-certificate-v2 signed attribute (RFC 5035).
 */

import {
    derSequence, derSet, derSetOf, derOid, derNull, derOctetString, derInteger,
    derContextExplicit, derUtcTime, derWrap,
    concatUint8Arrays,
} from './asn1.js';
import { sha256, sha384, sha512 } from './sha.js';
import { rsaSignHash, type RsaPrivateKey, type RsaDigest } from './rsa.js';
import { ecdsaSignHash, encodeDerSignature, type EcPrivateKey } from './ecdsa.js';
import type { X509Certificate } from './x509.js';
import { getCryptoProvider, type CryptoProvider } from './crypto-provider.js';

// ── OID Constants ────────────────────────────────────────────────────

const OID_SIGNED_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
const OID_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
const OID_SHA256 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const OID_SHA384 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02]);
const OID_SHA512 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03]);
const OID_SHA256_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
const OID_SHA384_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0c]);
const OID_SHA512_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d]);
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const OID_CONTENT_TYPE = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03]);
const OID_MESSAGE_DIGEST = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
const OID_SIGNING_TIME = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x05]);
// id-aa-signingCertificateV2 — 1.2.840.113549.1.9.16.2.47 (RFC 5035)
const OID_SIGNING_CERTIFICATE_V2 = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x02, 0x2f]);

// ── Types ────────────────────────────────────────────────────────────

export type SignatureAlgorithm = 'rsa-sha256' | 'ecdsa-sha256' | 'rsa-sha384' | 'rsa-sha512';

/**
 * Message-digest algorithm used across the CMS structure (digestAlgorithms
 * set, message-digest attribute, SignerInfo digestAlgorithm, certHash).
 * @since 1.7.0
 */
export type CmsDigestAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * CMS profile:
 *  - `'pkcs7'` (default) — classic adbe.pkcs7.detached signed attributes:
 *    content-type, message-digest, signing-time.
 *  - `'pades'` — PAdES baseline (ETSI EN 319 142-1 B-B): adds the ESS
 *    signing-certificate-v2 signed attribute (RFC 5035) and OMITS
 *    signing-time (the PDF /M entry carries the claimed signing time).
 * @since 1.7.0
 */
export type CmsProfile = 'pkcs7' | 'pades';

interface CmsDigestSpec {
    readonly length: number;
    readonly label: string;
    readonly oid: Uint8Array;
    readonly hash: (input: Uint8Array) => Uint8Array;
}

const CMS_DIGESTS: Record<CmsDigestAlgorithm, CmsDigestSpec> = {
    sha256: { length: 32, label: 'SHA-256', oid: OID_SHA256, hash: sha256 },
    sha384: { length: 48, label: 'SHA-384', oid: OID_SHA384, hash: sha384 },
    sha512: { length: 64, label: 'SHA-512', oid: OID_SHA512, hash: sha512 },
};

/** Digest implied by the signature algorithm suffix. */
function algorithmDigest(algorithm: SignatureAlgorithm): CmsDigestAlgorithm {
    if (algorithm === 'rsa-sha384') return 'sha384';
    if (algorithm === 'rsa-sha512') return 'sha512';
    return 'sha256';
}

/**
 * Resolve the effective digest: defaults to the digest implied by
 * `algorithm` ('sha256' for the pre-1.7.0 algorithms); an explicit
 * `digestAlgorithm` that contradicts the signature algorithm suffix throws
 * so the digestAlgorithms set, messageDigest attribute and
 * signatureAlgorithm can never drift apart.
 */
function resolveDigest(options: CmsSignOptions): CmsDigestAlgorithm {
    const implied = algorithmDigest(options.algorithm);
    const digest = options.digestAlgorithm ?? implied;
    if (digest !== implied) {
        throw new Error(`digestAlgorithm '${digest}' conflicts with algorithm '${options.algorithm}' (expected '${implied}')`);
    }
    return digest;
}

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
    /**
     * Optional native signer. When supplied (or when a global provider is set
     * via {@link setCryptoProvider}), the signature value is produced by the
     * provider instead of the pure-JS RSA/ECDSA primitives, and `rsaKey` /
     * `ecKey` are not required.
     * @since 1.4.0
     */
    readonly provider?: CryptoProvider;
    /**
     * Message-digest algorithm. Defaults to the digest implied by
     * `algorithm` (i.e. 'sha256' for `rsa-sha256`/`ecdsa-sha256` — the
     * pre-1.7.0 behaviour). `dataHash` must be 32/48/64 bytes accordingly.
     * A value conflicting with the `algorithm` suffix throws.
     * @since 1.7.0
     */
    readonly digestAlgorithm?: CmsDigestAlgorithm;
    /**
     * Signed-attribute profile — `'pkcs7'` (default, classic
     * adbe.pkcs7.detached) or `'pades'` (ETSI EN 319 142-1 B-B).
     * See {@link CmsProfile}.
     * @since 1.7.0
     */
    readonly profile?: CmsProfile;
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

    const digest = resolveDigest(options);
    const spec = CMS_DIGESTS[digest];
    if (dataHash.length !== spec.length) {
        throw new Error(`Expected ${spec.length}-byte ${spec.label} hash`);
    }

    // ── DigestAlgorithms SET ─────────────────────────────────────
    const digestAlgId = derSequence(derOid(spec.oid), derNull());
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
    const signerInfo = buildSignerInfo(options, digest);

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

function buildSignerInfo(options: CmsSignOptions, digest: CmsDigestAlgorithm): Uint8Array {
    const { dataHash, signerCert, algorithm, signingTime } = options;
    const profile = options.profile ?? 'pkcs7';
    const spec = CMS_DIGESTS[digest];

    // ── IssuerAndSerialNumber ────────────────────────────────────
    const issuerAndSerial = derSequence(
        // Re-encode issuer Name from certificate (raw DER)
        signerCert.issuer.raw,
        derInteger(signerCert.serialNumber),
    );

    // ── DigestAlgorithm ──────────────────────────────────────────
    const digestAlg = derSequence(derOid(spec.oid), derNull());

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

    const attrs: Uint8Array[] = [attrContentType, attrMessageDigest];
    if (profile === 'pades') {
        // PAdES B-B (ETSI EN 319 142-1 §6.3): the ESS signing-certificate-v2
        // attribute binds the signer certificate into the signed bytes;
        // signing-time is OMITTED — the claimed time lives in the PDF /M entry.
        attrs.push(buildSigningCertificateV2(signerCert, digest));
    } else {
        // 3. signing-time (classic adbe.pkcs7.detached profile)
        attrs.push(derSequence(
            derOid(OID_SIGNING_TIME),
            derSet(derUtcTime(signingTime ?? new Date())),
        ));
    }

    // SignedAttributes is a SET OF, so DER (X.690 §11.6) requires the
    // attribute encodings in ascending lexicographic byte order. Pre-1.7.0
    // the attributes were emitted in declaration order (content-type,
    // message-digest, signing-time) — invalid DER that most validators
    // tolerated; derSetOf() fixes the ordering (byte-exact test expectations
    // were updated accordingly).
    const signedAttrsForSig = derSetOf(...attrs);

    // [0] IMPLICIT SET OF — same content, constructed context tag 0xa0
    // instead of 0x31. Rewriting only the tag byte guarantees the embedded
    // attributes are bit-identical to the bytes that were signed.
    const signedAttrsImplicit = new Uint8Array(signedAttrsForSig);
    signedAttrsImplicit[0] = 0xa0;

    // ── Signature Algorithm + Signature Value ────────────────────
    // A native provider (per-call or global) replaces the pure-JS BigInt math
    // with a constant-time, hardware-backed signer. It receives the DER-encoded
    // signed attributes and hashes them internally; the pure-JS fallback hashes
    // here and signs the digest.
    const provider = options.provider ?? getCryptoProvider();
    let sigAlgId: Uint8Array;
    let signatureValue: Uint8Array;

    if (algorithm === 'rsa-sha256' || algorithm === 'rsa-sha384' || algorithm === 'rsa-sha512') {
        const rsaOid = algorithm === 'rsa-sha256' ? OID_SHA256_RSA
            : algorithm === 'rsa-sha384' ? OID_SHA384_RSA : OID_SHA512_RSA;
        sigAlgId = derSequence(derOid(rsaOid), derNull());
        if (provider) {
            signatureValue = provider.sign(signedAttrsForSig, algorithm);
        } else {
            if (!options.rsaKey) throw new Error(`RSA private key (or a crypto provider) required for ${algorithm}`);
            const rsaDigest: RsaDigest = digest;
            signatureValue = rsaSignHash(spec.hash(signedAttrsForSig), options.rsaKey, rsaDigest);
        }
    } else if (algorithm === 'ecdsa-sha256') {
        sigAlgId = derSequence(derOid(OID_ECDSA_SHA256));
        if (provider) {
            signatureValue = provider.sign(signedAttrsForSig, algorithm);
        } else {
            if (!options.ecKey) throw new Error('ECDSA private key (or a crypto provider) required for ecdsa-sha256');
            const { r, s } = ecdsaSignHash(sha256(signedAttrsForSig), options.ecKey);
            signatureValue = encodeDerSignature(r, s);
        }
    } else {
        throw new Error(`Unsupported algorithm: ${algorithm as string}`);
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
 * Build the ESS signing-certificate-v2 signed attribute (RFC 5035):
 *
 * ```
 * SigningCertificateV2 ::= SEQUENCE {
 *   certs SEQUENCE OF ESSCertIDv2 }
 * ESSCertIDv2 ::= SEQUENCE {
 *   hashAlgorithm AlgorithmIdentifier DEFAULT {algorithm id-sha256},
 *   certHash      OCTET STRING,
 *   issuerSerial  IssuerSerial OPTIONAL }
 * ```
 *
 * `certHash` is the chosen digest over the complete signer-certificate DER.
 * Per DER, the hashAlgorithm field is omitted when it equals the DEFAULT
 * (SHA-256); for SHA-384/512 it is encoded with absent parameters
 * (RFC 5754 §2). IssuerSerial is included so validators can match the
 * certificate without hashing every chain element.
 */
function buildSigningCertificateV2(signerCert: X509Certificate, digest: CmsDigestAlgorithm): Uint8Array {
    const spec = CMS_DIGESTS[digest];
    const certHash = spec.hash(signerCert.raw);

    // IssuerSerial ::= SEQUENCE { issuer GeneralNames, serialNumber INTEGER }
    // GeneralNames ::= SEQUENCE OF GeneralName; directoryName is [4] EXPLICIT Name.
    const issuerSerial = derSequence(
        derSequence(derContextExplicit(4, signerCert.issuer.raw)),
        derInteger(signerCert.serialNumber),
    );

    const essCertIdParts: Uint8Array[] = [];
    if (digest !== 'sha256') {
        essCertIdParts.push(derSequence(derOid(spec.oid)));
    }
    essCertIdParts.push(derOctetString(certHash), issuerSerial);

    const signingCertificateV2 = derSequence(derSequence(derSequence(...essCertIdParts)));

    return derSequence(
        derOid(OID_SIGNING_CERTIFICATE_V2),
        derSetOf(signingCertificateV2),
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

    if (algorithm === 'ecdsa-sha256') {
        base += 72; // ECDSA DER-encoded signature (max ~72 bytes)
    } else {
        base += 512; // RSA-4096 signature = 512 bytes (max common size)
    }

    // Round up with safety margin
    return Math.ceil(base * 1.5);
}
