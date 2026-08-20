/**
 * pdfnative — RFC 3161 Time-Stamp Protocol Structures
 * ====================================================
 * Builds TimeStampReq and parses TimeStampResp / TimeStampToken DER for
 * PAdES B-T signature timestamps and ISO 32000-2 document timestamps.
 * Pure structure codec — the HTTP transport to a TSA lives in user land
 * via the {@link TimestampProvider} interface (src/ never touches the
 * network).
 */

import {
    derDecode, derSequence, derOid, derNull, derOctetString, derInteger,
    derBoolean, derRawBytes, asn1Integer, asn1OidBytes, asn1String, asn1Time,
    oidEquals,
    ASN1_SEQUENCE, ASN1_INTEGER, ASN1_BOOLEAN, ASN1_GENERALIZED_TIME,
    ASN1_UTF8_STRING,
} from './asn1.js';
import { parseCmsSignedData } from './cms-utils.js';
import type { CmsDigestAlgorithm } from './cms.js';

// ── OID Constants ────────────────────────────────────────────────────

const OID_SHA256 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const OID_SHA384 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02]);
const OID_SHA512 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03]);
// id-ct-TSTInfo — 1.2.840.113549.1.9.16.1.4 (RFC 3161 §2.4.2)
const OID_CT_TST_INFO = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x01, 0x04]);

const DIGEST_SPECS: Record<CmsDigestAlgorithm, { readonly oid: Uint8Array; readonly length: number; readonly label: string }> = {
    sha256: { oid: OID_SHA256, length: 32, label: 'SHA-256' },
    sha384: { oid: OID_SHA384, length: 48, label: 'SHA-384' },
    sha512: { oid: OID_SHA512, length: 64, label: 'SHA-512' },
};

// ── Types ────────────────────────────────────────────────────────────

/** Options for {@link buildTimestampRequest}. @since 1.7.0 */
export interface TimestampRequestOptions {
    /** Digest algorithm the imprint was computed with (default `'sha256'`). */
    readonly digestAlgorithm?: CmsDigestAlgorithm;
    /** Optional nonce echoed by the TSA (replay protection). */
    readonly nonce?: bigint;
    /**
     * Ask the TSA to embed its certificate chain in the token (default
     * `true` — PAdES validators need the TSA certificate).
     */
    readonly certReq?: boolean;
    /** Optional TSA policy OID content bytes (without tag/length). */
    readonly reqPolicy?: Uint8Array;
}

/** Parsed TimeStampResp (RFC 3161 §2.4.2). @since 1.7.0 */
export interface TimestampResponse {
    /** PKIStatus — 0 granted, 1 grantedWithMods, 2 rejection, 3 waiting, … */
    readonly status: number;
    /** Optional human-readable status text (PKIFreeText, joined). */
    readonly statusString?: string;
    /** TimeStampToken DER (a CMS SignedData), present when granted. */
    readonly token?: Uint8Array;
}

/** Parsed TSTInfo from a TimeStampToken (RFC 3161 §2.4.2). @since 1.7.0 */
export interface TstInfo {
    /** TSA policy OID content bytes. */
    readonly policyOid: Uint8Array;
    /** MessageImprint hash algorithm OID content bytes. */
    readonly hashAlgorithmOid: Uint8Array;
    /** MessageImprint hashedMessage bytes. */
    readonly messageImprint: Uint8Array;
    /** Token serial number. */
    readonly serialNumber: bigint;
    /** genTime (GeneralizedTime, UTC). */
    readonly genTime: Date;
    /** Nonce echoed from the request, when present. */
    readonly nonce?: bigint;
    /** Certificates embedded in the token's SignedData (raw DER each). */
    readonly tsaCertificates: readonly Uint8Array[];
}

// ── TimeStampReq builder ─────────────────────────────────────────────

/**
 * Build a DER-encoded TimeStampReq (RFC 3161 §2.4.1, version 1):
 *
 * ```
 * TimeStampReq ::= SEQUENCE {
 *   version        INTEGER { v1(1) },
 *   messageImprint MessageImprint,
 *   reqPolicy      TSAPolicyId          OPTIONAL,
 *   nonce          INTEGER              OPTIONAL,
 *   certReq        BOOLEAN DEFAULT FALSE }
 * ```
 *
 * @param messageImprint - Digest of the data to timestamp (for PAdES B-T:
 *   the digest of the CMS signature value), 32/48/64 bytes per algorithm.
 * @param options - Digest, nonce, certReq, policy — see {@link TimestampRequestOptions}.
 * @returns TimeStampReq DER, ready to hand to a {@link TimestampProvider}.
 * @since 1.7.0
 */
export function buildTimestampRequest(messageImprint: Uint8Array, options?: TimestampRequestOptions): Uint8Array {
    const digest = options?.digestAlgorithm ?? 'sha256';
    const spec = DIGEST_SPECS[digest];
    if (messageImprint.length !== spec.length) {
        throw new Error(`RFC 3161: expected ${spec.length}-byte ${spec.label} message imprint`);
    }
    const certReq = options?.certReq ?? true;

    const fields: Uint8Array[] = [
        derInteger(1n),
        derSequence(
            derSequence(derOid(spec.oid), derNull()),
            derOctetString(messageImprint),
        ),
    ];
    if (options?.reqPolicy) fields.push(derOid(options.reqPolicy));
    if (options?.nonce !== undefined) fields.push(derInteger(options.nonce));
    // certReq DEFAULT FALSE — DER forbids encoding the default value.
    if (certReq) fields.push(derBoolean(true));

    return derSequence(...fields);
}

// ── TimeStampResp parser ─────────────────────────────────────────────

/**
 * Parse a DER-encoded TimeStampResp (RFC 3161 §2.4.2):
 * `SEQUENCE { status PKIStatusInfo, timeStampToken OPTIONAL }`.
 * A token is only returned for granted (0) / grantedWithMods (1) statuses
 * with a token present — callers MUST treat any other status as failure
 * and never embed the (absent) token.
 *
 * @since 1.7.0
 */
export function parseTimestampResponse(der: Uint8Array): TimestampResponse {
    const root = derDecode(der);
    if (root.tag !== ASN1_SEQUENCE || root.children.length < 1) {
        throw new Error('RFC 3161: not a TimeStampResp SEQUENCE');
    }

    // PKIStatusInfo ::= SEQUENCE { status INTEGER, statusString PKIFreeText
    //   OPTIONAL, failInfo PKIFailureInfo OPTIONAL }
    const statusInfo = root.children[0];
    if (statusInfo.tag !== ASN1_SEQUENCE || statusInfo.children.length < 1) {
        throw new Error('RFC 3161: malformed PKIStatusInfo');
    }
    const status = Number(asn1Integer(statusInfo.children[0]));

    let statusString: string | undefined;
    if (statusInfo.children.length > 1 && statusInfo.children[1].tag === ASN1_SEQUENCE) {
        const texts: string[] = [];
        for (const t of statusInfo.children[1].children) {
            if (t.tag === ASN1_UTF8_STRING) texts.push(asn1String(t));
        }
        if (texts.length > 0) statusString = texts.join('; ');
    }

    let token: Uint8Array | undefined;
    if (root.children.length > 1 && root.children[1].tag === ASN1_SEQUENCE) {
        token = derRawBytes(der, root.children[1]);
    }

    return { status, statusString, token };
}

// ── TimeStampToken parser ────────────────────────────────────────────

/**
 * Parse a TimeStampToken (a CMS SignedData whose eContent is a TSTInfo,
 * eContentType id-ct-TSTInfo 1.2.840.113549.1.9.16.1.4) into its TSTInfo
 * fields plus the embedded TSA certificates.
 *
 * @param tokenDer - TimeStampToken DER (ContentInfo).
 * @since 1.7.0
 */
export function parseTimestampToken(tokenDer: Uint8Array): TstInfo {
    const cms = parseCmsSignedData(tokenDer);
    if (!oidEquals(cms.eContentTypeOid, OID_CT_TST_INFO)) {
        throw new Error('RFC 3161: token eContentType is not id-ct-TSTInfo');
    }
    if (!cms.eContent) throw new Error('RFC 3161: token has no eContent');

    // TSTInfo ::= SEQUENCE { version, policy, messageImprint, serialNumber,
    //   genTime, accuracy OPTIONAL, ordering DEFAULT FALSE, nonce OPTIONAL,
    //   tsa [0] OPTIONAL, extensions [1] IMPLICIT OPTIONAL }
    const tst = derDecode(cms.eContent);
    if (tst.tag !== ASN1_SEQUENCE || tst.children.length < 5) {
        throw new Error('RFC 3161: malformed TSTInfo');
    }

    const policyOid = asn1OidBytes(tst.children[1]);

    const imprint = tst.children[2];
    if (imprint.tag !== ASN1_SEQUENCE || imprint.children.length < 2) {
        throw new Error('RFC 3161: malformed MessageImprint');
    }
    const hashAlgorithmOid = asn1OidBytes(imprint.children[0].children[0]);
    const messageImprint = imprint.children[1].value;

    const serialNumber = asn1Integer(tst.children[3]);

    const genTimeNode = tst.children[4];
    if (genTimeNode.tag !== ASN1_GENERALIZED_TIME) {
        throw new Error('RFC 3161: genTime is not a GeneralizedTime');
    }
    const genTime = asn1Time(genTimeNode);

    // Optional tail: accuracy (SEQUENCE), ordering (BOOLEAN), nonce (INTEGER)
    let nonce: bigint | undefined;
    for (let i = 5; i < tst.children.length; i++) {
        const child = tst.children[i];
        if (child.tag === ASN1_INTEGER) { nonce = asn1Integer(child); break; }
        if (child.tag !== ASN1_SEQUENCE && child.tag !== ASN1_BOOLEAN) break;
    }

    return {
        policyOid,
        hashAlgorithmOid,
        messageImprint,
        serialNumber,
        genTime,
        nonce,
        tsaCertificates: cms.certificates,
    };
}

/**
 * Check that a parsed timestamp token covers the expected data: byte-compare
 * the TSTInfo messageImprint against `expectedHash`. Callers MUST reject a
 * token whose imprint does not match before embedding it (PAdES B-T).
 *
 * @since 1.7.0
 */
export function verifyTimestampImprint(info: TstInfo, expectedHash: Uint8Array): boolean {
    if (info.messageImprint.length !== expectedHash.length) return false;
    for (let i = 0; i < expectedHash.length; i++) {
        if (info.messageImprint[i] !== expectedHash[i]) return false;
    }
    return true;
}
