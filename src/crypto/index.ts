/**
 * pdfnative — Crypto Module Index
 * =================================
 * Re-exports all cryptographic primitives for PDF digital signatures.
 */

// ── SHA-2 Hashing ────────────────────────────────────────────────────
export { sha256, sha384, sha512, hmacSha256 } from './sha.js';

// ── ASN.1 DER Codec ─────────────────────────────────────────────────
export type { Asn1Node } from './asn1.js';
export {
    ASN1_BOOLEAN, ASN1_INTEGER, ASN1_BIT_STRING, ASN1_OCTET_STRING,
    ASN1_NULL, ASN1_OID, ASN1_UTF8_STRING, ASN1_PRINTABLE_STRING,
    ASN1_IA5_STRING, ASN1_UTC_TIME, ASN1_GENERALIZED_TIME,
    ASN1_SEQUENCE, ASN1_SET,
    ASN1_CONTEXT_0, ASN1_CONTEXT_1, ASN1_CONTEXT_2, ASN1_CONTEXT_3,
    ASN1_IMPLICIT_0,
    derDecode, derDecodeAll,
    derWrap, derSequence, derSet, derInteger, derOid, derNull,
    derOctetString, derBitString, derUtf8String, derPrintableString,
    derUtcTime, derContextExplicit, derContextImplicit, derEncodeLength,
    asn1Integer, asn1OidBytes, asn1String, oidEquals, derRawBytes,
    concatUint8Arrays,
} from './asn1.js';

// ── RSA PKCS#1 v1.5 ─────────────────────────────────────────────────
export type { RsaPublicKey, RsaPrivateKey } from './rsa.js';
export {
    modPow, modInverse, bytesToBigInt, bigIntToBytes,
    rsaSign, rsaSignHash, rsaVerify, rsaVerifyHash,
    parseRsaPrivateKey, parseRsaPublicKey, initRsaAsn1,
} from './rsa.js';

// ── ECDSA P-256 ──────────────────────────────────────────────────────
export type { EcPoint, EcPublicKey, EcPrivateKey } from './ecdsa.js';
export {
    ecPublicKeyFromPrivate, ecdsaSign, ecdsaSignHash,
    ecdsaVerify, ecdsaVerifyHash,
    encodeEcPublicKey, decodeEcPublicKey,
    encodeDerSignature, decodeDerSignature, initEcdsaAsn1,
} from './ecdsa.js';

// ── X.509 Certificate Parser ────────────────────────────────────────
export type { X509Name, X509Certificate } from './x509.js';
export {
    parseCertificate, verifyCertSignature, isSelfSigned,
    certRsaPublicKey, certEcPublicKey,
} from './x509.js';

// ── CMS/PKCS#7 SignedData ───────────────────────────────────────────
export type { SignatureAlgorithm, CmsSignOptions } from './cms.js';
export { buildCmsSignedData, estimateCmsSize } from './cms.js';

/**
 * Initialize all crypto module cross-dependencies.
 * Must be called once before using key parsing or DER signature encoding.
 */
export async function initCrypto(): Promise<void> {
    const asn1 = await import('./asn1.js');
    const { initRsaAsn1 } = await import('./rsa.js');
    const { initEcdsaAsn1 } = await import('./ecdsa.js');
    initRsaAsn1(asn1);
    initEcdsaAsn1(asn1);
}
