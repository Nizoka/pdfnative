/**
 * pdfnative — PDF Stream Filter Decoders
 * ========================================
 * Pure, zero-dependency decoders for the standard PDF stream filters that
 * are not handled by {@link inflateSync} (FlateDecode).
 *
 * Implemented filters (ISO 32000-1 §7.4):
 *   - ASCIIHexDecode  (§7.4.2)
 *   - ASCII85Decode   (§7.4.3)
 *   - LZWDecode       (§7.4.4)  — variable-width 9..12 bit codes
 *   - RunLengthDecode (§7.4.5)
 *
 * @since 1.1.0
 */

// Cap to defend against zip-bomb-style adversarial streams. Must mirror the
// output cap used by `pdf-inflate.ts` so all decoders behave consistently.
const MAX_DECODE_OUTPUT = 256 * 1024 * 1024; // 256 MiB

/** Throw when a decoder would produce more than the safety cap. */
function checkOutputSize(n: number, filter: string): void {
    if (n > MAX_DECODE_OUTPUT) {
        throw new Error(
            `${filter} output exceeds ${MAX_DECODE_OUTPUT} bytes (possible zip-bomb)`,
        );
    }
}

// ── ASCIIHexDecode (§7.4.2) ──────────────────────────────────────────

/**
 * Decode an ASCIIHexDecode stream. Two hex digits encode one byte.
 * Whitespace is ignored; `>` terminates the stream. An odd trailing digit
 * is treated as if followed by `0` (per ISO 32000-1 §7.4.2).
 */
export function decodeASCIIHex(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let nibble = -1;
    for (let i = 0; i < data.length; i++) {
        const c = data[i];
        if (c === 0x3E /* > */) break;
        // Whitespace per §7.2.3
        if (c === 0x00 || c === 0x09 || c === 0x0A || c === 0x0C || c === 0x0D || c === 0x20) continue;
        let v: number;
        if (c >= 0x30 && c <= 0x39) v = c - 0x30;
        else if (c >= 0x41 && c <= 0x46) v = c - 0x41 + 10;
        else if (c >= 0x61 && c <= 0x66) v = c - 0x61 + 10;
        else throw new Error(`ASCIIHexDecode: invalid character 0x${c.toString(16)}`);
        if (nibble < 0) {
            nibble = v;
        } else {
            out.push((nibble << 4) | v);
            checkOutputSize(out.length, 'ASCIIHexDecode');
            nibble = -1;
        }
    }
    if (nibble >= 0) out.push(nibble << 4);
    return Uint8Array.from(out);
}

// ── ASCII85Decode (§7.4.3) ───────────────────────────────────────────

/**
 * Decode an ASCII85Decode stream (Adobe variant).
 *
 * Five base-85 digits in the range `!`..`u` encode four bytes. The shorthand
 * `z` represents four zero bytes. The end-of-data marker is `~>`. Whitespace
 * is ignored. A short final group (1..4 digits) decodes to (count-1) bytes
 * with the missing digits taken as `u` (84) and the trailing bytes discarded.
 */
export function decodeASCII85(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let group = 0;
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        const c = data[i];
        // End marker `~>`
        if (c === 0x7E /* ~ */) {
            if (i + 1 < data.length && data[i + 1] === 0x3E /* > */) break;
            throw new Error('ASCII85Decode: lone ~ without >');
        }
        if (c === 0x3E /* > */) break;
        // Whitespace
        if (c === 0x00 || c === 0x09 || c === 0x0A || c === 0x0C || c === 0x0D || c === 0x20) continue;
        // `z` = four zero bytes (only valid at group boundary)
        if (c === 0x7A /* z */) {
            if (count !== 0) throw new Error('ASCII85Decode: z inside group');
            out.push(0, 0, 0, 0);
            checkOutputSize(out.length, 'ASCII85Decode');
            continue;
        }
        if (c < 0x21 || c > 0x75) throw new Error(`ASCII85Decode: invalid char 0x${c.toString(16)}`);
        // group = group*85 + (c - '!')
        // Use Math.imul-safe arithmetic: max group at count=4 is 85^5 = 4,437,053,125 (>2^32),
        // but final group fits in 32 bits unsigned.
        group = group * 85 + (c - 0x21);
        count++;
        if (count === 5) {
            if (group > 0xFFFFFFFF) throw new Error('ASCII85Decode: group overflow');
            out.push((group >>> 24) & 0xFF, (group >>> 16) & 0xFF, (group >>> 8) & 0xFF, group & 0xFF);
            checkOutputSize(out.length, 'ASCII85Decode');
            group = 0;
            count = 0;
        }
    }
    if (count > 0) {
        // Pad with `u` (84) to complete the group, then drop (5 - count) trailing bytes.
        for (let k = count; k < 5; k++) group = group * 85 + 84;
        if (group > 0xFFFFFFFF) throw new Error('ASCII85Decode: trailing group overflow');
        const tail = [(group >>> 24) & 0xFF, (group >>> 16) & 0xFF, (group >>> 8) & 0xFF, group & 0xFF];
        for (let k = 0; k < count - 1; k++) out.push(tail[k]);
        checkOutputSize(out.length, 'ASCII85Decode');
    }
    return Uint8Array.from(out);
}

// ── LZWDecode (§7.4.4) ───────────────────────────────────────────────

const LZW_CLEAR_CODE = 256;
const LZW_EOD_CODE = 257;

/**
 * Decode an LZWDecode stream with variable-width codes (9–12 bits) and
 * automatic table reset on the CLEAR code (256). Terminates on the EOD
 * code (257) per ISO 32000-1 §7.4.4. EarlyChange is fixed to 1 (the PDF
 * default); callers that need a different value should pass it explicitly
 * via `DecodeParms`, which is currently not honoured here (rare in PDF).
 */
export function decodeLZW(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let bitBuf = 0;
    let bitCount = 0;
    let p = 0;
    let codeSize = 9;
    let dict: Uint8Array[] = [];
    let prev: Uint8Array | null = null;

    const resetDict = (): void => {
        // Codes 0..255 = single bytes; 256 = CLEAR; 257 = EOD.
        dict = new Array<Uint8Array>(258);
        for (let i = 0; i < 256; i++) dict[i] = Uint8Array.of(i);
        // 256 and 257 are sentinels (never read as data)
        codeSize = 9;
        prev = null;
    };
    resetDict();

    const readCode = (): number => {
        while (bitCount < codeSize) {
            if (p >= data.length) return -1;
            bitBuf = (bitBuf << 8) | data[p++];
            bitCount += 8;
        }
        const shift = bitCount - codeSize;
        const code = (bitBuf >>> shift) & ((1 << codeSize) - 1);
        bitBuf &= (1 << shift) - 1;
        bitCount = shift;
        return code;
    };

    for (;;) {
        const code = readCode();
        if (code < 0 || code === LZW_EOD_CODE) break;
        if (code === LZW_CLEAR_CODE) {
            resetDict();
            continue;
        }
        let entry: Uint8Array;
        if (code < dict.length) {
            entry = dict[code];
        } else if (code === dict.length && prev) {
            // Special case: K-omega-K
            entry = new Uint8Array(prev.length + 1);
            entry.set(prev);
            entry[prev.length] = prev[0];
        } else {
            throw new Error(`LZWDecode: invalid code ${code}`);
        }
        for (let i = 0; i < entry.length; i++) out.push(entry[i]);
        checkOutputSize(out.length, 'LZWDecode');
        if (prev) {
            const next = new Uint8Array(prev.length + 1);
            next.set(prev);
            next[prev.length] = entry[0];
            dict.push(next);
            // Bump code width when we reach the threshold (early-change=1).
            if (dict.length === (1 << codeSize) - 1 && codeSize < 12) codeSize++;
        }
        prev = entry;
    }
    return Uint8Array.from(out);
}

// ── RunLengthDecode (§7.4.5) ─────────────────────────────────────────

/**
 * Decode a RunLengthDecode stream. Each control byte `n`:
 *   - 0..127: copy the next `n+1` bytes literally
 *   - 128:    EOD
 *   - 129..255: repeat the next byte `257 - n` times
 */
export function decodeRunLength(data: Uint8Array): Uint8Array {
    const out: number[] = [];
    let p = 0;
    while (p < data.length) {
        const n = data[p++];
        if (n === 128) break;
        if (n < 128) {
            const len = n + 1;
            if (p + len > data.length) throw new Error('RunLengthDecode: truncated literal');
            for (let i = 0; i < len; i++) out.push(data[p + i]);
            p += len;
        } else {
            if (p >= data.length) throw new Error('RunLengthDecode: truncated repeat');
            const v = data[p++];
            const len = 257 - n;
            for (let i = 0; i < len; i++) out.push(v);
        }
        checkOutputSize(out.length, 'RunLengthDecode');
    }
    return Uint8Array.from(out);
}

// ── Dispatcher ───────────────────────────────────────────────────────

/**
 * Apply a single PDF stream filter by name. Returns the input unchanged
 * for unsupported filters (callers should detect this via the return
 * value being identical or by pre-checking against {@link KNOWN_FILTERS}).
 *
 * Supports: FlateDecode is NOT handled here (use `inflateSync` instead);
 * this function dispatches the non-deflate filter family.
 */
export function applyDecodeFilter(name: string, data: Uint8Array): Uint8Array {
    switch (name) {
        case 'ASCIIHexDecode':
        case 'AHx':
            return decodeASCIIHex(data);
        case 'ASCII85Decode':
        case 'A85':
            return decodeASCII85(data);
        case 'LZWDecode':
        case 'LZW':
            return decodeLZW(data);
        case 'RunLengthDecode':
        case 'RL':
            return decodeRunLength(data);
        default:
            return data;
    }
}

/** Known non-Flate decode filter names (for membership checks). */
export const KNOWN_DECODE_FILTERS = new Set<string>([
    'ASCIIHexDecode', 'AHx',
    'ASCII85Decode', 'A85',
    'LZWDecode', 'LZW',
    'RunLengthDecode', 'RL',
]);
