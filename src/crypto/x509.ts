/**
 * pdfnative — X.509 Certificate Parser
 * =====================================
 * Parses X.509 v3 certificates (RFC 5280) from DER-encoded bytes.
 * Extracts issuer/subject, public key, validity, extensions.
 * Verifies certificate signatures (RSA + ECDSA).
 */

import {
    derDecode, asn1Integer, asn1OidBytes, asn1String, oidEquals,
    ASN1_SEQUENCE, ASN1_SET, ASN1_OID, ASN1_UTC_TIME, ASN1_GENERALIZED_TIME,
    ASN1_CONTEXT_0, ASN1_CONTEXT_3,
    type Asn1Node,
} from './asn1.js';
import { rsaVerifyHash, type RsaPublicKey } from './rsa.js';
import { ecdsaVerifyHash, decodeEcPublicKey, type EcPublicKey } from './ecdsa.js';
import { sha256, sha384, sha512 } from './sha.js';

// ── Known OIDs ───────────────────────────────────────────────────────

const OID_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
const OID_SHA256_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
const OID_SHA384_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0c]);
const OID_SHA512_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d]);
const OID_EC_PUBKEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_ECDSA_SHA256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]);
const OID_ECDSA_SHA384 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03]);

// X.500 attribute OIDs
const OID_CN = new Uint8Array([0x55, 0x04, 0x03]);   // Common Name
const OID_C  = new Uint8Array([0x55, 0x04, 0x06]);   // Country
const OID_O  = new Uint8Array([0x55, 0x04, 0x0a]);   // Organization
const OID_OU = new Uint8Array([0x55, 0x04, 0x0b]);   // Organizational Unit

// Extension OIDs
const OID_BASIC_CONSTRAINTS = new Uint8Array([0x55, 0x1d, 0x13]);
const OID_KEY_USAGE = new Uint8Array([0x55, 0x1d, 0x0f]);

// ── Types ────────────────────────────────────────────────────────────

export interface X509Name {
    readonly cn?: string;   // Common Name
    readonly c?: string;    // Country
    readonly o?: string;    // Organization
    readonly ou?: string;   // Organizational Unit
    readonly raw: Uint8Array;  // Raw DER bytes for CMS IssuerAndSerialNumber
}

export interface X509Certificate {
    readonly version: number;
    readonly serialNumber: bigint;
    readonly signatureAlgorithm: Uint8Array;  // OID bytes
    readonly issuer: X509Name;
    readonly subject: X509Name;
    readonly notBefore: Date;
    readonly notAfter: Date;
    readonly publicKeyAlgorithm: Uint8Array;  // OID bytes
    readonly publicKeyBytes: Uint8Array;      // Raw key bytes (RSA or EC)
    readonly isCA: boolean;
    readonly keyUsage: number;  // bit mask
    readonly tbsCertificateBytes: Uint8Array;  // raw DER of tbsCertificate (for verification)
    readonly signatureBytes: Uint8Array;       // raw signature value
    readonly raw: Uint8Array;                  // complete certificate DER
}

// ── Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a DER-encoded X.509 certificate.
 */
export function parseCertificate(der: Uint8Array): X509Certificate {
    const root = derDecode(der);
    if (root.children.length < 3) throw new Error('Invalid certificate structure');

    const tbs = root.children[0];
    const sigAlg = root.children[1];
    const sigVal = root.children[2];

    // Extract tbsCertificate raw bytes for signature verification
    const tbsBytes = der.subarray(tbs.offset, tbs.offset + tbs.totalLength);

    // Parse TBS fields
    let idx = 0;

    // version [0] EXPLICIT INTEGER DEFAULT v1
    let version = 1;
    if (tbs.children[idx].tag === ASN1_CONTEXT_0) {
        version = Number(asn1Integer(tbs.children[idx].children[0])) + 1;
        idx++;
    }

    // serialNumber
    const serialNumber = asn1Integer(tbs.children[idx++]);

    // signature algorithm (skip — we use outer sigAlg)
    idx++;

    // issuer
    const issuerNode = tbs.children[idx++];
    const issuer = parseName(issuerNode, der);

    // validity
    const validity = tbs.children[idx++];
    const notBefore = parseTime(validity.children[0]);
    const notAfter = parseTime(validity.children[1]);

    // subject
    const subjectNode = tbs.children[idx++];
    const subject = parseName(subjectNode, der);

    // subjectPublicKeyInfo
    const spki = tbs.children[idx++];
    const pubKeyAlg = asn1OidBytes(spki.children[0].children[0]);
    const pubKeyBitString = spki.children[1];
    // BIT STRING: first byte is unused bits count
    const publicKeyBytes = pubKeyBitString.value.subarray(1);

    // Extensions [3]
    let isCA = false;
    let keyUsage = 0;
    if (idx < tbs.children.length && tbs.children[idx].tag === ASN1_CONTEXT_3) {
        const extsSeq = tbs.children[idx].children[0];
        for (const ext of extsSeq.children) {
            const oid = asn1OidBytes(ext.children[0]);
            // Skip critical boolean if present
            const valueIdx = ext.children.length === 3 ? 2 : 1;
            const extValue = ext.children[valueIdx].value;

            if (oidEquals(oid, OID_BASIC_CONSTRAINTS)) {
                const bc = derDecode(extValue);
                if (bc.children.length > 0 && bc.children[0].tag === 0x01) {
                    isCA = bc.children[0].value[0] !== 0;
                }
            } else if (oidEquals(oid, OID_KEY_USAGE)) {
                const ku = derDecode(extValue);
                if (ku.value.length >= 2) {
                    keyUsage = ku.value[1]; // First byte is unused bits
                }
            }
        }
    }

    // Outer signature algorithm
    const sigAlgOid = asn1OidBytes(sigAlg.children[0]);

    // Signature value (BIT STRING, skip unused bits byte)
    const signatureBytes = sigVal.value.subarray(1);

    return {
        version,
        serialNumber,
        signatureAlgorithm: sigAlgOid,
        issuer,
        subject,
        notBefore,
        notAfter,
        publicKeyAlgorithm: pubKeyAlg,
        publicKeyBytes,
        isCA,
        keyUsage,
        tbsCertificateBytes: tbsBytes,
        signatureBytes,
        raw: der,
    };
}

function parseName(node: Asn1Node, fullDer: Uint8Array): X509Name {
    let cn: string | undefined;
    let c: string | undefined;
    let o: string | undefined;
    let ou: string | undefined;

    for (const rdn of node.children) {
        if (rdn.tag !== ASN1_SET) continue;
        for (const atv of rdn.children) {
            if (atv.tag !== ASN1_SEQUENCE || atv.children.length < 2) continue;
            const oid = atv.children[0];
            if (oid.tag !== ASN1_OID) continue;

            const val = asn1String(atv.children[1]);
            const oidBytes = oid.value;

            if (oidEquals(oidBytes, OID_CN)) cn = val;
            else if (oidEquals(oidBytes, OID_C)) c = val;
            else if (oidEquals(oidBytes, OID_O)) o = val;
            else if (oidEquals(oidBytes, OID_OU)) ou = val;
        }
    }

    return {
        cn, c, o, ou,
        raw: fullDer.subarray(node.offset, node.offset + node.totalLength),
    };
}

function parseTime(node: Asn1Node): Date {
    const str = new TextDecoder().decode(node.value);
    if (node.tag === ASN1_UTC_TIME) {
        // YYMMDDHHmmssZ
        const yy = parseInt(str.substring(0, 2), 10);
        const year = yy >= 50 ? 1900 + yy : 2000 + yy;
        return new Date(Date.UTC(
            year,
            parseInt(str.substring(2, 4), 10) - 1,
            parseInt(str.substring(4, 6), 10),
            parseInt(str.substring(6, 8), 10),
            parseInt(str.substring(8, 10), 10),
            parseInt(str.substring(10, 12), 10),
        ));
    }
    if (node.tag === ASN1_GENERALIZED_TIME) {
        // YYYYMMDDHHmmssZ
        return new Date(Date.UTC(
            parseInt(str.substring(0, 4), 10),
            parseInt(str.substring(4, 6), 10) - 1,
            parseInt(str.substring(6, 8), 10),
            parseInt(str.substring(8, 10), 10),
            parseInt(str.substring(10, 12), 10),
            parseInt(str.substring(12, 14), 10),
        ));
    }
    throw new Error(`Unexpected time tag: 0x${node.tag.toString(16)}`);
}

// ── Verification ─────────────────────────────────────────────────────

/**
 * Verify a certificate's signature using the issuer's public key.
 *
 * @param cert - Certificate to verify.
 * @param issuerCert - Issuer certificate (whose public key signed `cert`).
 * @returns true if the signature is valid.
 */
export function verifyCertSignature(cert: X509Certificate, issuerCert: X509Certificate): boolean {
    // Determine hash algorithm from signature OID
    const tbs = cert.tbsCertificateBytes;

    if (oidEquals(cert.signatureAlgorithm, OID_SHA256_RSA)) {
        const hash = sha256(tbs);
        const pubKey = extractRsaPublicKey(issuerCert.publicKeyBytes);
        return rsaVerifyHash(hash, cert.signatureBytes, pubKey);
    }
    if (oidEquals(cert.signatureAlgorithm, OID_SHA384_RSA)) {
        const hash = sha384(tbs);
        // SHA-384 + RSA not implemented (would need rsaVerifyHash for SHA-384)
        void hash;
        return false;
    }
    if (oidEquals(cert.signatureAlgorithm, OID_SHA512_RSA)) {
        const hash = sha512(tbs);
        void hash;
        return false;
    }
    if (oidEquals(cert.signatureAlgorithm, OID_ECDSA_SHA256)) {
        const hash = sha256(tbs);
        const pubKey = decodeEcPublicKey(issuerCert.publicKeyBytes);
        const { r, s } = decodeDerEcdsaSig(cert.signatureBytes);
        return ecdsaVerifyHash(hash, r, s, pubKey);
    }
    if (oidEquals(cert.signatureAlgorithm, OID_ECDSA_SHA384)) {
        const hash = sha384(tbs);
        void hash;
        return false;
    }

    return false; // Unknown algorithm
}

function extractRsaPublicKey(keyBytes: Uint8Array): RsaPublicKey {
    const inner = derDecode(keyBytes);
    return {
        n: asn1Integer(inner.children[0]),
        e: asn1Integer(inner.children[1]),
    };
}

function decodeDerEcdsaSig(sig: Uint8Array): { r: bigint; s: bigint } {
    const seq = derDecode(sig);
    return {
        r: asn1Integer(seq.children[0]),
        s: asn1Integer(seq.children[1]),
    };
}

/**
 * Check if a certificate is self-signed.
 */
export function isSelfSigned(cert: X509Certificate): boolean {
    // Compare issuer and subject raw DER
    if (cert.issuer.raw.length !== cert.subject.raw.length) return false;
    for (let i = 0; i < cert.issuer.raw.length; i++) {
        if (cert.issuer.raw[i] !== cert.subject.raw[i]) return false;
    }
    return true;
}

/**
 * Extract the RSA public key from a certificate.
 */
export function certRsaPublicKey(cert: X509Certificate): RsaPublicKey | null {
    if (!oidEquals(cert.publicKeyAlgorithm, OID_RSA)) return null;
    return extractRsaPublicKey(cert.publicKeyBytes);
}

/**
 * Extract the EC public key from a certificate.
 */
export function certEcPublicKey(cert: X509Certificate): EcPublicKey | null {
    if (!oidEquals(cert.publicKeyAlgorithm, OID_EC_PUBKEY)) return null;
    return decodeEcPublicKey(cert.publicKeyBytes);
}
