/**
 * pdfnative — OCSP Request Builder / Response Parser (RFC 6960)
 * ==============================================================
 * Builds unsigned OCSPRequest DER and parses OCSPResponse /
 * BasicOCSPResponse for LTV revocation data collection (PAdES B-LT).
 * Pure structure codec — the HTTP POST to a responder lives in user land
 * via the {@link RevocationProvider} interface (src/ never touches the
 * network).
 */

import {
    derDecode, derSequence, derOid, derNull, derOctetString, derInteger,
    derContextExplicit, derRawBytes, asn1OidBytes, asn1Time,
    oidEquals,
    ASN1_SEQUENCE, ASN1_GENERALIZED_TIME,
} from './asn1.js';
import { sha1 } from './sha.js';
import type { X509Certificate } from './x509.js';

// ── OID Constants ────────────────────────────────────────────────────

// SHA-1 — 1.3.14.3.2.26 (conventional CertID digest, RFC 6960 §4.1.1;
// identification only, never a security digest — see sha1() docblock).
const OID_SHA1 = new Uint8Array([0x2b, 0x0e, 0x03, 0x02, 0x1a]);
// id-pkix-ocsp-basic — 1.3.6.1.5.5.7.48.1.1
const OID_OCSP_BASIC = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x01]);
// id-pkix-ocsp-nonce — 1.3.6.1.5.5.7.48.1.2
const OID_OCSP_NONCE = new Uint8Array([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x30, 0x01, 0x02]);

const TAG_ENUMERATED = 0x0a;
const TAG_CERT_STATUS_GOOD = 0x80;      // [0] IMPLICIT NULL (primitive)
const TAG_CERT_STATUS_REVOKED = 0xa1;   // [1] IMPLICIT RevokedInfo (constructed)
const TAG_CONTEXT_0_CONSTRUCTED = 0xa0;

// ── Types ────────────────────────────────────────────────────────────

/** Options for {@link buildOcspRequest}. @since 1.7.0 */
export interface OcspRequestOptions {
    /** Optional nonce bytes (id-pkix-ocsp-nonce request extension). */
    readonly nonce?: Uint8Array;
}

/** SingleResponse certStatus. @since 1.7.0 */
export type OcspCertStatus = 'good' | 'revoked' | 'unknown';

/** Parsed OCSPResponse (RFC 6960 §4.2.1). @since 1.7.0 */
export interface OcspResponse {
    /** OCSPResponseStatus — 0 successful, 1 malformedRequest, 2 internalError,
     *  3 tryLater, 5 sigRequired, 6 unauthorized. */
    readonly responseStatus: number;
    /** Status of the first SingleResponse (absent unless successful). */
    readonly certStatus?: OcspCertStatus;
    /** ResponseData producedAt. */
    readonly producedAt?: Date;
    /** First SingleResponse thisUpdate. */
    readonly thisUpdate?: Date;
    /** First SingleResponse nextUpdate, when present. */
    readonly nextUpdate?: Date;
    /** RevokedInfo revocationTime, when certStatus is 'revoked'. */
    readonly revocationTime?: Date;
    /** Certificates embedded in the BasicOCSPResponse (raw DER each). */
    readonly responderCertificates: readonly Uint8Array[];
    /** The complete OCSPResponse DER (what /DSS /OCSPs streams store). */
    readonly raw: Uint8Array;
}

// ── Request builder ──────────────────────────────────────────────────

/**
 * Build an unsigned DER OCSPRequest (RFC 6960 §4.1.1) for one certificate:
 *
 * ```
 * CertID ::= SEQUENCE {
 *   hashAlgorithm  AlgorithmIdentifier (SHA-1),
 *   issuerNameHash OCTET STRING,  -- SHA-1 of issuer Name DER
 *   issuerKeyHash  OCTET STRING,  -- SHA-1 of issuer SPKI BIT STRING contents
 *   serialNumber   CertificateSerialNumber }
 * ```
 *
 * `issuerNameHash` hashes the issuer Name exactly as it appears in the
 * certificate being checked (`cert.issuer.raw`); `issuerKeyHash` hashes the
 * issuer certificate's subjectPublicKey BIT STRING contents (tag, length
 * and unused-bits byte excluded — `issuer.publicKeyBytes`).
 *
 * @param cert - Certificate whose revocation status is being checked.
 * @param issuer - The certificate's issuer (provides the public key).
 * @param options - Optional nonce — see {@link OcspRequestOptions}.
 * @returns OCSPRequest DER, ready to hand to a {@link RevocationProvider}.
 * @since 1.7.0
 */
export function buildOcspRequest(cert: X509Certificate, issuer: X509Certificate, options?: OcspRequestOptions): Uint8Array {
    const certId = derSequence(
        derSequence(derOid(OID_SHA1), derNull()),
        derOctetString(sha1(cert.issuer.raw)),
        derOctetString(sha1(issuer.publicKeyBytes)),
        derInteger(cert.serialNumber),
    );

    // TBSRequest ::= SEQUENCE { version [0] DEFAULT v1 (omitted per DER),
    //   requestList SEQUENCE OF Request, requestExtensions [2] EXPLICIT OPT }
    const requestList = derSequence(derSequence(certId));

    const tbsFields: Uint8Array[] = [requestList];
    if (options?.nonce) {
        // Nonce ::= OCTET STRING; extnValue is an OCTET STRING wrapping the
        // DER-encoded nonce value (RFC 8954).
        const nonceExt = derSequence(
            derOid(OID_OCSP_NONCE),
            derOctetString(derOctetString(options.nonce)),
        );
        tbsFields.push(derContextExplicit(2, derSequence(nonceExt)));
    }

    return derSequence(derSequence(...tbsFields));
}

// ── Response parser ──────────────────────────────────────────────────

/**
 * Parse a DER OCSPResponse (RFC 6960 §4.2.1). When the response is
 * successful and carries an id-pkix-ocsp-basic BasicOCSPResponse, the first
 * SingleResponse is surfaced (pdfnative requests one certificate at a time).
 * Signature verification of the response is the caller's responsibility.
 *
 * @since 1.7.0
 */
export function parseOcspResponse(der: Uint8Array): OcspResponse {
    const root = derDecode(der);
    if (root.tag !== ASN1_SEQUENCE || root.children.length < 1) {
        throw new Error('OCSP: not an OCSPResponse SEQUENCE');
    }
    if (root.children[0].tag !== TAG_ENUMERATED) {
        throw new Error('OCSP: missing responseStatus ENUMERATED');
    }
    const responseStatus = root.children[0].value.length > 0 ? root.children[0].value[0] : 0;

    if (responseStatus !== 0 || root.children.length < 2) {
        return { responseStatus, responderCertificates: [], raw: der };
    }

    // responseBytes [0] EXPLICIT SEQUENCE { responseType OID, response OCTET STRING }
    if (root.children[1].tag !== 0xa0) {
        throw new Error('OCSP: responseBytes is not the [0] EXPLICIT wrapper');
    }
    const responseBytes = root.children[1].children[0];
    if (responseBytes === undefined || responseBytes.tag !== ASN1_SEQUENCE || responseBytes.children.length < 2) {
        throw new Error('OCSP: malformed responseBytes');
    }
    const responseType = asn1OidBytes(responseBytes.children[0]);
    if (!oidEquals(responseType, OID_OCSP_BASIC)) {
        throw new Error('OCSP: responseType is not id-pkix-ocsp-basic');
    }

    const basicDer = responseBytes.children[1].value;
    // BasicOCSPResponse ::= SEQUENCE { tbsResponseData, signatureAlgorithm,
    //   signature BIT STRING, certs [0] EXPLICIT OPTIONAL }
    const basic = derDecode(basicDer);
    if (basic.tag !== ASN1_SEQUENCE || basic.children.length < 3) {
        throw new Error('OCSP: malformed BasicOCSPResponse');
    }

    const responderCertificates: Uint8Array[] = [];
    const certsNode = basic.children[3];
    if (certsNode !== undefined && certsNode.tag === TAG_CONTEXT_0_CONSTRUCTED) {
        const certSeq = certsNode.children[0];
        if (certSeq !== undefined && certSeq.tag === ASN1_SEQUENCE) {
            for (const cert of certSeq.children) {
                if (cert.tag === ASN1_SEQUENCE) responderCertificates.push(derRawBytes(basicDer, cert));
            }
        }
    }

    // ResponseData ::= SEQUENCE { version [0] EXPLICIT DEFAULT v1,
    //   responderID CHOICE ([1]/[2]), producedAt GeneralizedTime,
    //   responses SEQUENCE OF SingleResponse, responseExtensions [1] OPT }
    const tbs = basic.children[0];
    let idx = 0;
    if (tbs.children[idx] !== undefined && tbs.children[idx].tag === TAG_CONTEXT_0_CONSTRUCTED) idx++; // version
    idx++; // responderID
    let producedAt: Date | undefined;
    if (tbs.children[idx] !== undefined && tbs.children[idx].tag === ASN1_GENERALIZED_TIME) {
        producedAt = asn1Time(tbs.children[idx]);
        idx++;
    }

    const responses = tbs.children[idx];
    if (responses === undefined || responses.tag !== ASN1_SEQUENCE || responses.children.length === 0) {
        throw new Error('OCSP: missing SingleResponse');
    }
    const single = responses.children[0];
    if (single.tag !== ASN1_SEQUENCE || single.children.length < 3) {
        throw new Error('OCSP: malformed SingleResponse');
    }

    // SingleResponse ::= SEQUENCE { certID, certStatus CHOICE, thisUpdate,
    //   nextUpdate [0] EXPLICIT OPTIONAL, singleExtensions [1] OPTIONAL }
    const statusNode = single.children[1];
    let certStatus: OcspCertStatus;
    let revocationTime: Date | undefined;
    if (statusNode.tag === TAG_CERT_STATUS_GOOD) {
        certStatus = 'good';
    } else if (statusNode.tag === TAG_CERT_STATUS_REVOKED) {
        certStatus = 'revoked';
        const rt = statusNode.children[0];
        if (rt !== undefined && rt.tag === ASN1_GENERALIZED_TIME) revocationTime = asn1Time(rt);
    } else {
        certStatus = 'unknown';
    }

    const thisUpdate = asn1Time(single.children[2]);
    let nextUpdate: Date | undefined;
    const nu = single.children[3];
    if (nu !== undefined && nu.tag === TAG_CONTEXT_0_CONSTRUCTED && nu.children.length > 0) {
        nextUpdate = asn1Time(nu.children[0]);
    }

    return {
        responseStatus,
        certStatus,
        producedAt,
        thisUpdate,
        nextUpdate,
        revocationTime,
        responderCertificates,
        raw: der,
    };
}
