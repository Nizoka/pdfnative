/**
 * pdfnative — X.509 Certificate Parser
 * =====================================
 * Parses X.509 v3 certificates (RFC 5280) from DER-encoded bytes.
 * Extracts issuer/subject, public key, validity, extensions.
 * Verifies certificate signatures (RSA + ECDSA).
 */

import {
    derDecode, asn1Integer, asn1OidBytes, asn1String, asn1Time, oidEquals,
    ASN1_SEQUENCE, ASN1_SET, ASN1_OID,
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
const OID_SUBJECT_KEY_ID = new Uint8Array([0x55, 0x1d, 0x0e]);           // 2.5.29.14
const OID_AUTHORITY_KEY_ID = new Uint8Array([0x55, 0x1d, 0x23]);         // 2.5.29.35
const OID_CRL_DISTRIBUTION_POINTS = new Uint8Array([0x55, 0x1d, 0x1f]);  // 2.5.29.31
const OID_EXT_KEY_USAGE = new Uint8Array([0x55, 0x1d, 0x25]);            // 2.5.29.37
const OID_AUTHORITY_INFO_ACCESS = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x01, 0x01]);  // 1.3.6.1.5.5.7.1.1
const OID_AD_OCSP = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01]);                // 1.3.6.1.5.5.7.48.1
const OID_AD_CA_ISSUERS = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x02]);          // 1.3.6.1.5.5.7.48.2
const OID_OCSP_NOCHECK = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x05]);     // 1.3.6.1.5.5.7.48.1.5

// GeneralName context tag for uniformResourceIdentifier ([6] IMPLICIT IA5String, primitive)
const TAG_GENERAL_NAME_URI = 0x86;

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

    // ── LTV extension fields (all optional so that hand-built demo/test
    //    certificate literals predating 1.7.0 keep compiling; the parser
    //    always populates them) ─────────────────────────────────────────

    /** Subject Key Identifier (2.5.29.14) — keyIdentifier bytes. @since 1.7.0 */
    readonly subjectKeyId?: Uint8Array;
    /** Authority Key Identifier (2.5.29.35) — keyIdentifier [0] bytes. @since 1.7.0 */
    readonly authorityKeyId?: Uint8Array;
    /** Extended Key Usage (2.5.29.37) — list of KeyPurposeId OID byte arrays. @since 1.7.0 */
    readonly extKeyUsage?: readonly Uint8Array[];
    /** OCSP responder URLs from Authority Information Access (1.3.6.1.5.5.7.48.1). @since 1.7.0 */
    readonly ocspUrls?: readonly string[];
    /** CA-issuers URLs from Authority Information Access (1.3.6.1.5.5.7.48.2). @since 1.7.0 */
    readonly caIssuersUrls?: readonly string[];
    /** CRL URLs from CRL Distribution Points (2.5.29.31, fullName URI form). @since 1.7.0 */
    readonly crlUrls?: readonly string[];
    /** true when the id-pkix-ocsp-nocheck extension (1.3.6.1.5.5.7.48.1.5) is present. @since 1.7.0 */
    readonly hasOcspNoCheck?: boolean;
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
    let subjectKeyId: Uint8Array | undefined;
    let authorityKeyId: Uint8Array | undefined;
    const extKeyUsage: Uint8Array[] = [];
    const ocspUrls: string[] = [];
    const caIssuersUrls: string[] = [];
    const crlUrls: string[] = [];
    let hasOcspNoCheck = false;
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
            } else if (oidEquals(oid, OID_SUBJECT_KEY_ID)) {
                // SubjectKeyIdentifier ::= KeyIdentifier (OCTET STRING)
                const ski = derDecode(extValue);
                if (ski.tag === 0x04) subjectKeyId = ski.value;
            } else if (oidEquals(oid, OID_AUTHORITY_KEY_ID)) {
                // AuthorityKeyIdentifier ::= SEQUENCE { keyIdentifier [0] IMPLICIT OCTET STRING OPTIONAL, … }
                const aki = derDecode(extValue);
                for (const child of aki.children) {
                    if (child.tag === 0x80) { authorityKeyId = child.value; break; }
                }
            } else if (oidEquals(oid, OID_EXT_KEY_USAGE)) {
                // ExtKeyUsageSyntax ::= SEQUENCE OF KeyPurposeId (OID)
                const eku = derDecode(extValue);
                for (const child of eku.children) {
                    if (child.tag === ASN1_OID) extKeyUsage.push(child.value);
                }
            } else if (oidEquals(oid, OID_AUTHORITY_INFO_ACCESS)) {
                // AuthorityInfoAccessSyntax ::= SEQUENCE OF AccessDescription
                //   AccessDescription ::= SEQUENCE { accessMethod OID, accessLocation GeneralName }
                // Only GeneralName uniformResourceIdentifier ([6] IMPLICIT IA5String) is extracted.
                const aia = derDecode(extValue);
                for (const ad of aia.children) {
                    if (ad.tag !== ASN1_SEQUENCE || ad.children.length < 2) continue;
                    const method = ad.children[0];
                    const location = ad.children[1];
                    if (method.tag !== ASN1_OID || location.tag !== TAG_GENERAL_NAME_URI) continue;
                    const url = asn1String(location);
                    if (oidEquals(method.value, OID_AD_OCSP)) ocspUrls.push(url);
                    else if (oidEquals(method.value, OID_AD_CA_ISSUERS)) caIssuersUrls.push(url);
                }
            } else if (oidEquals(oid, OID_CRL_DISTRIBUTION_POINTS)) {
                // CRLDistributionPoints ::= SEQUENCE OF DistributionPoint
                //   DistributionPoint ::= SEQUENCE { distributionPoint [0] DistributionPointName OPTIONAL, … }
                //   DistributionPointName ::= CHOICE { fullName [0] GeneralNames, … }
                // Only fullName ([0]) GeneralNames URI entries ([6]) are extracted.
                const cdp = derDecode(extValue);
                for (const dp of cdp.children) {
                    if (dp.tag !== ASN1_SEQUENCE) continue;
                    for (const dpn of dp.children) {
                        if (dpn.tag !== 0xa0) continue;      // distributionPoint [0]
                        for (const fullName of dpn.children) {
                            if (fullName.tag !== 0xa0) continue;  // fullName [0] GeneralNames
                            for (const gn of fullName.children) {
                                if (gn.tag === TAG_GENERAL_NAME_URI) crlUrls.push(asn1String(gn));
                            }
                        }
                    }
                }
            } else if (oidEquals(oid, OID_OCSP_NOCHECK)) {
                hasOcspNoCheck = true;
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
        subjectKeyId,
        authorityKeyId,
        extKeyUsage,
        ocspUrls,
        caIssuersUrls,
        crlUrls,
        hasOcspNoCheck,
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

    const raw = fullDer.subarray(node.offset, node.offset + node.totalLength);
    // Defensive invariant: every Name slice MUST start with the ASN.1
    // SEQUENCE tag (0x30). Issue #46 was an off-by-N caused by missing
    // recursive offset adjustment in `decodeAt()`. If this throws, the
    // ASN.1 parser regressed — do NOT silently produce malformed CMS
    // IssuerAndSerialNumber output.
    if (raw.length === 0 || raw[0] !== ASN1_SEQUENCE) {
        throw new Error(
            `X.509 parseName: expected SEQUENCE tag 0x30 at slice offset 0, got 0x${raw[0]?.toString(16) ?? 'EOF'} ` +
            `(offset=${node.offset}, totalLength=${node.totalLength}). This indicates a corrupt ASN.1 offset.`,
        );
    }

    return {
        cn, c, o, ou,
        raw,
    };
}

function parseTime(node: Asn1Node): Date {
    // Time decoding (UTCTime 2-digit-year pivot + GeneralizedTime) was
    // lifted into asn1Time() in 1.7.0 so that CRL/OCSP/RFC 3161 parsers
    // share it. Behaviour is byte-for-byte identical to the pre-1.7.0
    // private implementation.
    return asn1Time(node);
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
        const pubKey = extractRsaPublicKey(issuerCert.publicKeyBytes);
        return rsaVerifyHash(hash, cert.signatureBytes, pubKey, 'sha384');
    }
    if (oidEquals(cert.signatureAlgorithm, OID_SHA512_RSA)) {
        const hash = sha512(tbs);
        const pubKey = extractRsaPublicKey(issuerCert.publicKeyBytes);
        return rsaVerifyHash(hash, cert.signatureBytes, pubKey, 'sha512');
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

/**
 * Check whether a certificate carries a given Extended Key Usage purpose
 * (2.5.29.37), e.g. id-kp-timeStamping (1.3.6.1.5.5.7.3.8) for RFC 3161 TSA
 * certificates or id-kp-OCSPSigning (1.3.6.1.5.5.7.3.9) for delegated OCSP
 * responders.
 *
 * @param cert - Parsed certificate.
 * @param oidBytes - KeyPurposeId OID content bytes (without tag/length).
 * @returns true when the EKU extension lists the purpose.
 * @since 1.7.0
 */
export function certHasEku(cert: X509Certificate, oidBytes: Uint8Array): boolean {
    if (!cert.extKeyUsage) return false;
    return cert.extKeyUsage.some((oid) => oidEquals(oid, oidBytes));
}
