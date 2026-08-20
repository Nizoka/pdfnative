/**
 * pdfnative — CMS SignedData Parsing & DER Surgery (RFC 5652)
 * ============================================================
 * Parses CMS/PKCS#7 SignedData structures (the inverse of cms.ts) and
 * performs the one mutation LTV workflows need: appending an *unsigned*
 * attribute (e.g. the RFC 3161 id-aa-signatureTimeStampToken) to an
 * existing SignerInfo without disturbing a single signed byte.
 */

import {
    derDecode, derWrap, derSequence, derSetOf, derOid, derRawBytes,
    asn1OidBytes, oidEquals, concatUint8Arrays,
    ASN1_SEQUENCE, ASN1_SET, ASN1_OCTET_STRING,
    type Asn1Node,
} from './asn1.js';

// ── OID Constants ────────────────────────────────────────────────────

const OID_SIGNED_DATA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

const TAG_CONTEXT_0_CONSTRUCTED = 0xa0;
const TAG_CONTEXT_1_CONSTRUCTED = 0xa1;

// ── Types ────────────────────────────────────────────────────────────

/**
 * Structural view over a DER-encoded CMS ContentInfo/SignedData.
 * All byte fields are subarrays of (or copies from) the input buffer.
 * @since 1.7.0
 */
export interface ParsedCms {
    /** Certificates from the [0] IMPLICIT certificate set (raw DER each). */
    readonly certificates: readonly Uint8Array[];
    /** Raw TLV of the first SignerInfo. */
    readonly signerInfoRaw: Uint8Array;
    /**
     * Raw TLV of the [0] IMPLICIT signed attributes as embedded in the
     * SignerInfo (tag 0xa0), or `undefined` when absent. Retag byte 0 to
     * 0x31 to recover the SET OF bytes the signature was computed over.
     */
    readonly signedAttrsRaw: Uint8Array | undefined;
    /** SignatureValue OCTET STRING contents. */
    readonly signatureValue: Uint8Array;
    /** SignerInfo digestAlgorithm OID content bytes. */
    readonly digestAlgorithmOid: Uint8Array;
    /**
     * Attribute TLVs from the [1] IMPLICIT unsigned attributes, in stored
     * order. Empty when the slot is absent.
     */
    readonly unsignedAttrs: readonly Uint8Array[];
    /** EncapsulatedContentInfo eContentType OID content bytes. */
    readonly eContentTypeOid: Uint8Array;
    /**
     * Contents of the eContent OCTET STRING ([0] EXPLICIT), or `undefined`
     * for detached signatures. For RFC 3161 tokens this is the TSTInfo DER.
     */
    readonly eContent: Uint8Array | undefined;
}

// ── Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a DER-encoded CMS ContentInfo containing a SignedData (RFC 5652
 * §5.1) into its LTV-relevant parts. Only the first SignerInfo is
 * surfaced — PDF signatures always carry exactly one.
 *
 * @param der - ContentInfo DER (e.g. a PDF /Contents value or TimeStampToken).
 * @returns Structural view; throws with a `CMS:` prefix on malformed input.
 * @since 1.7.0
 */
export function parseCmsSignedData(der: Uint8Array): ParsedCms {
    const { signedData } = locateSignedData(der);

    // SignedData ::= SEQUENCE { version, digestAlgorithms, encapContentInfo,
    //   certificates [0] IMPLICIT OPTIONAL, crls [1] IMPLICIT OPTIONAL,
    //   signerInfos SET }
    if (signedData.children.length < 4) throw new Error('CMS: SignedData too short');

    // ── EncapsulatedContentInfo ──────────────────────────────────
    const encap = signedData.children[2];
    if (encap.tag !== ASN1_SEQUENCE || encap.children.length < 1) {
        throw new Error('CMS: malformed EncapsulatedContentInfo');
    }
    const eContentTypeOid = asn1OidBytes(encap.children[0]);
    let eContent: Uint8Array | undefined;
    if (encap.children.length > 1 && encap.children[1].tag === TAG_CONTEXT_0_CONSTRUCTED) {
        const inner = encap.children[1].children[0];
        if (inner.tag !== ASN1_OCTET_STRING) throw new Error('CMS: eContent is not an OCTET STRING');
        eContent = inner.value;
    }

    // ── Certificates [0] IMPLICIT (optional, follows encapContentInfo) ──
    const certificates: Uint8Array[] = [];
    for (let i = 3; i < signedData.children.length; i++) {
        const child = signedData.children[i];
        if (child.tag !== TAG_CONTEXT_0_CONSTRUCTED) continue;
        for (const cert of child.children) {
            if (cert.tag === ASN1_SEQUENCE) certificates.push(derRawBytes(der, cert));
        }
        break;
    }

    // ── SignerInfos SET (last child) ─────────────────────────────
    const signerInfos = signedData.children[signedData.children.length - 1];
    if (signerInfos.tag !== ASN1_SET || signerInfos.children.length === 0) {
        throw new Error('CMS: missing signerInfos');
    }
    const signerInfo = signerInfos.children[0];
    const signerInfoRaw = derRawBytes(der, signerInfo);

    // SignerInfo ::= SEQUENCE { version, sid, digestAlgorithm,
    //   signedAttrs [0] IMPLICIT OPTIONAL, signatureAlgorithm,
    //   signature OCTET STRING, unsignedAttrs [1] IMPLICIT OPTIONAL }
    if (signerInfo.children.length < 5) throw new Error('CMS: SignerInfo too short');
    const digestAlgorithmOid = asn1OidBytes(signerInfo.children[2].children[0]);

    let idx = 3;
    let signedAttrsRaw: Uint8Array | undefined;
    if (signerInfo.children[idx].tag === TAG_CONTEXT_0_CONSTRUCTED) {
        signedAttrsRaw = derRawBytes(der, signerInfo.children[idx]);
        idx++;
    }
    idx++; // signatureAlgorithm
    const sigNode = signerInfo.children[idx];
    if (sigNode === undefined || sigNode.tag !== ASN1_OCTET_STRING) {
        throw new Error('CMS: missing signatureValue');
    }
    const signatureValue = sigNode.value;
    idx++;

    const unsignedAttrs: Uint8Array[] = [];
    if (idx < signerInfo.children.length && signerInfo.children[idx].tag === TAG_CONTEXT_1_CONSTRUCTED) {
        for (const attr of signerInfo.children[idx].children) {
            unsignedAttrs.push(derRawBytes(der, attr));
        }
    }

    return {
        certificates,
        signerInfoRaw,
        signedAttrsRaw,
        signatureValue,
        digestAlgorithmOid,
        unsignedAttrs,
        eContentTypeOid,
        eContent,
    };
}

// ── Attribute construction ───────────────────────────────────────────

/**
 * Build a CMS Attribute TLV: `SEQUENCE { attrType OID, attrValues SET OF }`.
 * The value set is encoded via {@link derSetOf} (canonical X.690 §11.6
 * ordering, required for DER validity when several values are present).
 *
 * @param oidBytes - Attribute type OID content bytes (without tag/length).
 * @param values - One or more DER-encoded attribute values.
 * @since 1.7.0
 */
export function buildAttribute(oidBytes: Uint8Array, ...values: Uint8Array[]): Uint8Array {
    if (values.length === 0) throw new Error('CMS: attribute requires at least one value');
    return derSequence(derOid(oidBytes), derSetOf(...values));
}

// ── DER surgery: unsigned attribute insertion ────────────────────────

/**
 * Append an attribute to the `[1] IMPLICIT unsignedAttrs` slot of the first
 * SignerInfo in a CMS SignedData, creating the slot when absent. This is
 * how a signature acquires its RFC 3161 timestamp token (PAdES B-T)
 * *after* the signature value has been produced.
 *
 * The signed bytes (signedAttrs and everything they cover) are copied
 * verbatim — only the DER lengths of the TLVs *enclosing* the insertion
 * point (SignerInfo → signerInfos SET → SignedData → [0] EXPLICIT content
 * → ContentInfo) are recomputed, via a generic rebuild-along-path helper.
 * The new attribute is appended after any existing unsigned attributes;
 * unsignedAttrs is outside the signature so validators accept stored order.
 *
 * @param cmsDer - DER-encoded CMS ContentInfo (SignedData).
 * @param attributeTlv - Complete Attribute TLV (see {@link buildAttribute}).
 * @returns A new buffer; the input is not modified.
 * @since 1.7.0
 */
export function addUnsignedAttribute(cmsDer: Uint8Array, attributeTlv: Uint8Array): Uint8Array {
    if (attributeTlv.length === 0 || attributeTlv[0] !== ASN1_SEQUENCE) {
        throw new Error('CMS: attribute TLV must be a SEQUENCE');
    }

    const { root, explicitContent, signedData } = locateSignedData(cmsDer);
    const signerInfos = signedData.children[signedData.children.length - 1];
    if (signerInfos.tag !== ASN1_SET || signerInfos.children.length === 0) {
        throw new Error('CMS: missing signerInfos');
    }
    const signerInfo = signerInfos.children[0];

    const existing = signerInfo.children[signerInfo.children.length - 1];
    if (existing.tag === TAG_CONTEXT_1_CONSTRUCTED) {
        // Slot exists — rebuild [1] with the attribute appended to its content.
        const path = [root, explicitContent, signedData, signerInfos, signerInfo];
        const rebuilt = derWrap(
            TAG_CONTEXT_1_CONSTRUCTED,
            concatUint8Arrays(tlvContent(cmsDer, existing), attributeTlv),
        );
        return rebuildAlongPath(cmsDer, path, existing, rebuilt);
    }

    // Slot absent — rebuild the SignerInfo with a fresh [1] appended.
    const path = [root, explicitContent, signedData, signerInfos];
    const rebuilt = derWrap(
        ASN1_SEQUENCE,
        concatUint8Arrays(tlvContent(cmsDer, signerInfo), derWrap(TAG_CONTEXT_1_CONSTRUCTED, attributeTlv)),
    );
    return rebuildAlongPath(cmsDer, path, signerInfo, rebuilt);
}

// ── Internal helpers ─────────────────────────────────────────────────

/** Decode the ContentInfo wrapper and return the SignedData nodes. */
function locateSignedData(der: Uint8Array): { root: Asn1Node; explicitContent: Asn1Node; signedData: Asn1Node } {
    const root = derDecode(der);
    if (root.tag !== ASN1_SEQUENCE || root.children.length < 2) {
        throw new Error('CMS: not a ContentInfo SEQUENCE');
    }
    const contentType = asn1OidBytes(root.children[0]);
    if (!oidEquals(contentType, OID_SIGNED_DATA)) {
        throw new Error('CMS: ContentInfo is not id-signedData');
    }
    const explicitContent = root.children[1];
    if (explicitContent.tag !== TAG_CONTEXT_0_CONSTRUCTED || explicitContent.children.length < 1) {
        throw new Error('CMS: missing [0] EXPLICIT SignedData');
    }
    const signedData = explicitContent.children[0];
    if (signedData.tag !== ASN1_SEQUENCE) throw new Error('CMS: SignedData is not a SEQUENCE');
    return { root, explicitContent, signedData };
}

/** Header length (tag + length field) of a TLV at `node.offset` in `buf`. */
function tlvHeaderLength(buf: Uint8Array, node: Asn1Node): number {
    const first = buf[node.offset + 1];
    return first < 0x80 ? 2 : 2 + (first & 0x7f);
}

/** Content bytes of a TLV (value region, header stripped). */
function tlvContent(buf: Uint8Array, node: Asn1Node): Uint8Array {
    const start = node.offset + tlvHeaderLength(buf, node);
    return buf.subarray(start, node.offset + node.totalLength);
}

/**
 * Replace the TLV at `leaf` with `replacement` and re-encode the DER length
 * of every enclosing TLV listed in `path` (ordered root → innermost parent).
 * Every byte outside the rebuilt headers is copied verbatim from `buf`,
 * which is what guarantees signed regions survive the surgery untouched.
 */
function rebuildAlongPath(
    buf: Uint8Array,
    path: readonly Asn1Node[],
    leaf: Asn1Node,
    replacement: Uint8Array,
): Uint8Array {
    let start = leaf.offset;
    let end = leaf.offset + leaf.totalLength;
    let rebuilt = replacement;

    for (let i = path.length - 1; i >= 0; i--) {
        const ancestor = path[i];
        const contentStart = ancestor.offset + tlvHeaderLength(buf, ancestor);
        const contentEnd = ancestor.offset + ancestor.totalLength;
        rebuilt = derWrap(
            ancestor.tag,
            concatUint8Arrays(buf.subarray(contentStart, start), rebuilt, buf.subarray(end, contentEnd)),
        );
        start = ancestor.offset;
        end = contentEnd;
    }

    return concatUint8Arrays(buf.subarray(0, start), rebuilt, buf.subarray(end));
}
