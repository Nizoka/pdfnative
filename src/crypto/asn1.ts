/**
 * pdfnative — ASN.1 DER Encoder / Decoder
 * ========================================
 * Minimal DER (Distinguished Encoding Rules) codec for X.509, CMS, and PKCS.
 * Supports all types needed for PDF digital signatures: INTEGER, SEQUENCE,
 * SET, OID, OCTET_STRING, BIT_STRING, NULL, UTF8String, PrintableString,
 * UTCTime, GeneralizedTime, BOOLEAN, CONTEXT-SPECIFIC tags.
 */

// ── ASN.1 Tag Constants ──────────────────────────────────────────────

export const ASN1_BOOLEAN        = 0x01;
export const ASN1_INTEGER        = 0x02;
export const ASN1_BIT_STRING     = 0x03;
export const ASN1_OCTET_STRING   = 0x04;
export const ASN1_NULL           = 0x05;
export const ASN1_OID            = 0x06;
export const ASN1_UTF8_STRING    = 0x0c;
export const ASN1_PRINTABLE_STRING = 0x13;
export const ASN1_IA5_STRING     = 0x16;
export const ASN1_UTC_TIME       = 0x17;
export const ASN1_GENERALIZED_TIME = 0x18;
export const ASN1_SEQUENCE       = 0x30;
export const ASN1_SET            = 0x31;
export const ASN1_CONTEXT_0      = 0xa0;
export const ASN1_CONTEXT_1      = 0xa1;
export const ASN1_CONTEXT_2      = 0xa2;
export const ASN1_CONTEXT_3      = 0xa3;
export const ASN1_IMPLICIT_0     = 0x80;

// ── Parsed ASN.1 Node ────────────────────────────────────────────────

export interface Asn1Node {
    readonly tag: number;
    /** Raw value bytes (for primitive types) or empty for constructed. */
    readonly value: Uint8Array;
    /** Child nodes (for constructed types: SEQUENCE, SET, CONTEXT). */
    readonly children: readonly Asn1Node[];
    /** Byte offset in the original buffer where this TLV starts. */
    readonly offset: number;
    /** Total length of this TLV (tag + length + value). */
    readonly totalLength: number;
}

// ── DER Decoder ──────────────────────────────────────────────────────

/**
 * Parse a DER-encoded ASN.1 structure.
 * Returns the root node with children for constructed types.
 */
export function derDecode(buf: Uint8Array): Asn1Node {
    const { node } = decodeAt(buf, 0);
    return node;
}

/**
 * Parse all top-level TLVs from a buffer (for multi-element parsing).
 */
export function derDecodeAll(buf: Uint8Array): Asn1Node[] {
    const nodes: Asn1Node[] = [];
    let pos = 0;
    while (pos < buf.length) {
        const { node, nextPos } = decodeAt(buf, pos);
        nodes.push(node);
        pos = nextPos;
    }
    return nodes;
}

function decodeAt(buf: Uint8Array, pos: number): { node: Asn1Node; nextPos: number } {
    if (pos >= buf.length) throw new Error(`ASN.1: unexpected end at offset ${pos}`);

    const startPos = pos;
    const tag = buf[pos++];
    const { length, nextPos: lenEnd } = decodeLength(buf, pos);
    pos = lenEnd;

    const valueEnd = pos + length;
    if (valueEnd > buf.length) {
        throw new Error(`ASN.1: value extends beyond buffer at offset ${startPos} (need ${valueEnd}, have ${buf.length})`);
    }

    const isConstructed = (tag & 0x20) !== 0;
    const value = buf.subarray(pos, valueEnd);

    let children: Asn1Node[] = [];
    if (isConstructed) {
        let childPos = 0;
        while (childPos < value.length) {
            const { node: child, nextPos: childNext } = decodeAt(value, childPos);
            // Adjust offsets to be relative to original buffer
            children.push({
                ...child,
                offset: pos + childPos,
            });
            childPos = childNext;
        }
    }

    return {
        node: {
            tag,
            value: isConstructed ? new Uint8Array(0) : value,
            children,
            offset: startPos,
            totalLength: valueEnd - startPos,
        },
        nextPos: valueEnd,
    };
}

function decodeLength(buf: Uint8Array, pos: number): { length: number; nextPos: number } {
    if (pos >= buf.length) throw new Error('ASN.1: unexpected end in length');

    const first = buf[pos++];
    if (first < 0x80) {
        return { length: first, nextPos: pos };
    }

    const numBytes = first & 0x7f;
    if (numBytes === 0) throw new Error('ASN.1: indefinite length not supported in DER');
    if (numBytes > 4) throw new Error(`ASN.1: length too large (${numBytes} bytes)`);

    let length = 0;
    for (let i = 0; i < numBytes; i++) {
        if (pos >= buf.length) throw new Error('ASN.1: unexpected end in length bytes');
        length = (length << 8) | buf[pos++];
    }
    return { length, nextPos: pos };
}

// ── DER Encoder ──────────────────────────────────────────────────────

/** Encode a DER length field. */
export function derEncodeLength(length: number): Uint8Array {
    if (length < 0x80) {
        return new Uint8Array([length]);
    }
    if (length <= 0xff) {
        return new Uint8Array([0x81, length]);
    }
    if (length <= 0xffff) {
        return new Uint8Array([0x82, (length >> 8) & 0xff, length & 0xff]);
    }
    if (length <= 0xffffff) {
        return new Uint8Array([0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    }
    return new Uint8Array([
        0x84,
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
    ]);
}

/** Wrap value bytes with a tag and DER length. */
export function derWrap(tag: number, value: Uint8Array): Uint8Array {
    const lenBytes = derEncodeLength(value.length);
    const result = new Uint8Array(1 + lenBytes.length + value.length);
    result[0] = tag;
    result.set(lenBytes, 1);
    result.set(value, 1 + lenBytes.length);
    return result;
}

/** Encode a SEQUENCE (0x30) from child TLVs. */
export function derSequence(...children: Uint8Array[]): Uint8Array {
    return derWrap(ASN1_SEQUENCE, concatBytes(children));
}

/** Encode a SET (0x31) from child TLVs. */
export function derSet(...children: Uint8Array[]): Uint8Array {
    return derWrap(ASN1_SET, concatBytes(children));
}

/** Encode an INTEGER from a BigInt or Uint8Array (big-endian). */
export function derInteger(value: bigint | Uint8Array): Uint8Array {
    let bytes: Uint8Array;

    if (value instanceof Uint8Array) {
        bytes = value;
    } else {
        if (value === 0n) return derWrap(ASN1_INTEGER, new Uint8Array([0]));

        const isNeg = value < 0n;
        let abs = isNeg ? -value : value;
        const hexStr = abs.toString(16);
        const padded = hexStr.length % 2 === 1 ? '0' + hexStr : hexStr;
        bytes = new Uint8Array(padded.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(padded.substring(i * 2, i * 2 + 2), 16);
        }

        if (isNeg) {
            // Two's complement for negative
            for (let i = 0; i < bytes.length; i++) bytes[i] = ~bytes[i] & 0xff;
            // Add 1
            let carry = 1;
            for (let i = bytes.length - 1; i >= 0 && carry; i--) {
                const sum = bytes[i] + carry;
                bytes[i] = sum & 0xff;
                carry = sum >> 8;
            }
        }
    }

    // Strip leading zeros (keep one if MSB would make it negative)
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0 && (bytes[start + 1] & 0x80) === 0) {
        start++;
    }
    bytes = bytes.subarray(start);

    // Add leading 0x00 if MSB is set (positive number looks negative)
    if ((bytes[0] & 0x80) !== 0) {
        const padded = new Uint8Array(bytes.length + 1);
        padded.set(bytes, 1);
        bytes = padded;
    }

    return derWrap(ASN1_INTEGER, bytes);
}

/** Encode an OID from byte values (already encoded arc values). */
export function derOid(oidBytes: Uint8Array): Uint8Array {
    return derWrap(ASN1_OID, oidBytes);
}

/** Encode NULL. */
export function derNull(): Uint8Array {
    return new Uint8Array([ASN1_NULL, 0x00]);
}

/** Encode an OCTET STRING. */
export function derOctetString(data: Uint8Array): Uint8Array {
    return derWrap(ASN1_OCTET_STRING, data);
}

/** Encode a BIT STRING (with 0 unused bits). */
export function derBitString(data: Uint8Array): Uint8Array {
    const withPad = new Uint8Array(data.length + 1);
    withPad[0] = 0x00; // 0 unused bits
    withPad.set(data, 1);
    return derWrap(ASN1_BIT_STRING, withPad);
}

/** Encode a UTF8String. */
export function derUtf8String(text: string): Uint8Array {
    const enc = new TextEncoder();
    return derWrap(ASN1_UTF8_STRING, enc.encode(text));
}

/** Encode a PrintableString. */
export function derPrintableString(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return derWrap(ASN1_PRINTABLE_STRING, bytes);
}

/** Encode a UTCTime from a Date. Format: YYMMDDHHmmssZ */
export function derUtcTime(date: Date): Uint8Array {
    const s = date.toISOString().replace(/[-:T]/g, '').substring(2, 14) + 'Z';
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return derWrap(ASN1_UTC_TIME, bytes);
}

/** Encode context-specific explicit tag. */
export function derContextExplicit(tagNum: number, inner: Uint8Array): Uint8Array {
    return derWrap(0xa0 | tagNum, inner);
}

/** Encode context-specific implicit tag. */
export function derContextImplicit(tagNum: number, value: Uint8Array): Uint8Array {
    return derWrap(0x80 | tagNum, value);
}

// ── ASN.1 Node helpers ───────────────────────────────────────────────

/** Get the integer value from an ASN.1 INTEGER node as BigInt. */
export function asn1Integer(node: Asn1Node): bigint {
    if (node.tag !== ASN1_INTEGER) throw new Error(`Expected INTEGER, got tag 0x${node.tag.toString(16)}`);
    const bytes = node.value;
    if (bytes.length === 0) return 0n;

    const isNeg = (bytes[0] & 0x80) !== 0;
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(isNeg ? (~bytes[i] & 0xff) : bytes[i]);
    }
    return isNeg ? -(result + 1n) : result;
}

/** Get raw OID bytes from an ASN.1 OID node. */
export function asn1OidBytes(node: Asn1Node): Uint8Array {
    if (node.tag !== ASN1_OID) throw new Error(`Expected OID, got tag 0x${node.tag.toString(16)}`);
    return node.value;
}

/** Get string value from a string-type ASN.1 node. */
export function asn1String(node: Asn1Node): string {
    return new TextDecoder().decode(node.value);
}

/** Check if two OID byte arrays are equal. */
export function oidEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/** Get the raw DER bytes of a specific child TLV from the original buffer. */
export function derRawBytes(buf: Uint8Array, node: Asn1Node): Uint8Array {
    return buf.subarray(node.offset, node.offset + node.totalLength);
}

// ── Internal helpers ─────────────────────────────────────────────────

function concatBytes(arrays: Uint8Array[]): Uint8Array {
    let totalLen = 0;
    for (const a of arrays) totalLen += a.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const a of arrays) {
        result.set(a, offset);
        offset += a.length;
    }
    return result;
}

/** Concatenate multiple Uint8Arrays. Exported for use by other crypto modules. */
export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
    return concatBytes(arrays);
}
