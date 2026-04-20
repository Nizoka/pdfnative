/**
 * pdfnative — DEFLATE Decompressor (FlateDecode reader)
 * ======================================================
 * Zero-dependency DEFLATE decompression for reading FlateDecode streams.
 *
 * Platform strategy (mirrors pdf-compress.ts):
 *   - Node.js: zlib.inflateSync() via initNodeDecompression()
 *   - Fallback: pure JS inflate (RFC 1951) — full Huffman decoding
 *
 * ISO 32000-1 §7.3.8.1: FlateDecode expects zlib format (RFC 1950).
 */

// ── Platform Detection ───────────────────────────────────────────────

let _zlibInflateSync: ((buf: Uint8Array) => Uint8Array) | null | undefined;

/**
 * Default maximum decompressed size (bytes) for inflate operations.
 * Prevents zip-bomb memory exhaustion (CWE-400: Uncontrolled Resource Consumption).
 *
 * DEFLATE worst-case compression ratio is ~1032:1, so a 1 MB malicious stream
 * could expand to ~1 GB without this cap.
 *
 * Default: 100 MB. Override with {@link setMaxInflateOutputSize}.
 */
export const DEFAULT_MAX_INFLATE_OUTPUT = 100 * 1024 * 1024;

let _maxInflateOutput = DEFAULT_MAX_INFLATE_OUTPUT;

/**
 * Set the global maximum decompressed output size for {@link inflateSync}.
 * Applies to both the native zlib path and the pure-JS fallback.
 *
 * @param size - Maximum output size in bytes. Use `Infinity` to disable (not recommended for untrusted input).
 */
export function setMaxInflateOutputSize(size: number): void {
    if (!Number.isFinite(size) && size !== Infinity) {
        throw new Error('setMaxInflateOutputSize: size must be a finite number or Infinity');
    }
    if (size <= 0) {
        throw new Error('setMaxInflateOutputSize: size must be positive');
    }
    _maxInflateOutput = size;
}

/**
 * Get the current maximum decompressed output size.
 */
export function getMaxInflateOutputSize(): number {
    return _maxInflateOutput;
}

/**
 * Inject a custom inflate implementation.
 *
 * @param fn - inflateSync-compatible function, or null to disable
 */
export function setInflateImpl(fn: ((buf: Uint8Array) => Uint8Array) | null): void {
    _zlibInflateSync = fn;
}

/**
 * Attempt to resolve Node.js zlib.inflateSync (CJS contexts).
 */
function getZlibInflateSync(): ((buf: Uint8Array) => Uint8Array) | null {
    if (_zlibInflateSync !== undefined) return _zlibInflateSync;
    try {
        const g = globalThis as Record<string, unknown>;
        const proc = g['process'] as { versions?: { node?: string } } | undefined;
        if (!proc?.versions?.node) {
            _zlibInflateSync = null;
            return null;
        }
        const mod = g['__non_webpack_require__'] as ((m: string) => Record<string, unknown>) | undefined
            ?? (g['require'] as ((m: string) => Record<string, unknown>) | undefined);
        if (mod) {
            const zlib = mod('node:zlib');
            const fn = zlib['inflateSync'] as ((buf: Uint8Array, opts?: { maxOutputLength?: number }) => Uint8Array) | undefined;
            if (typeof fn === 'function') {
                _zlibInflateSync = (buf: Uint8Array) => new Uint8Array(fn(buf, { maxOutputLength: _maxInflateOutput }));
                return _zlibInflateSync;
            }
        }
        _zlibInflateSync = null;
        return null;
    } catch {
        _zlibInflateSync = null;
        return null;
    }
}

/**
 * Initialize Node.js decompression for ESM contexts.
 * Must be called once before parsing PDFs with compressed streams.
 */
export async function initNodeDecompression(): Promise<void> {
    if (_zlibInflateSync !== undefined) return;
    try {
        const g = globalThis as Record<string, unknown>;
        const proc = g['process'] as { versions?: { node?: string } } | undefined;
        if (!proc?.versions?.node) {
            _zlibInflateSync = null;
            return;
        }
        const modName = 'node:zlib';
        const zlib = await (import(modName) as Promise<Record<string, unknown>>);
        const fn = zlib['inflateSync'] as ((buf: Uint8Array, opts?: { maxOutputLength?: number }) => Uint8Array) | undefined;
        if (typeof fn === 'function') {
            _zlibInflateSync = (buf: Uint8Array) => new Uint8Array(fn(buf, { maxOutputLength: _maxInflateOutput }));
        } else {
            _zlibInflateSync = null;
        }
    } catch {
        _zlibInflateSync = null;
    }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Decompress zlib-format data (RFC 1950 + RFC 1951).
 *
 * @param data - Compressed bytes in zlib format
 * @returns Decompressed bytes
 */
export function inflateSync(data: Uint8Array): Uint8Array {
    const native = getZlibInflateSync();
    if (native) return native(data);
    return inflateJS(data);
}

// ── Pure JS Inflate Implementation ───────────────────────────────────

/**
 * Pure JavaScript DEFLATE decompressor (RFC 1951) with zlib wrapper (RFC 1950).
 */
function inflateJS(data: Uint8Array): Uint8Array {
    if (data.length < 6) throw new Error('inflate: data too short for zlib format');

    // Verify zlib header (RFC 1950 §2.2)
    const cmf = data[0];
    const flg = data[1];
    if ((cmf * 256 + flg) % 31 !== 0) throw new Error('inflate: invalid zlib header checksum');
    if ((cmf & 0x0f) !== 8) throw new Error('inflate: unsupported compression method (expected deflate)');
    if (flg & 0x20) throw new Error('inflate: preset dictionary not supported');

    // Decompress DEFLATE blocks starting after 2-byte zlib header
    const result = inflateRaw(data, 2);

    // Verify Adler-32 (last 4 bytes, big-endian)
    const adlerPos = result.bytesRead + 2;
    if (adlerPos + 4 > data.length) throw new Error('inflate: missing Adler-32 checksum');
    const expected = (data[adlerPos] << 24 | data[adlerPos + 1] << 16 | data[adlerPos + 2] << 8 | data[adlerPos + 3]) >>> 0;
    const actual = adler32(result.data);
    if (actual !== expected) throw new Error(`inflate: Adler-32 mismatch (got ${actual}, expected ${expected})`);

    return result.data;
}

// ── Adler-32 ─────────────────────────────────────────────────────────

function adler32(data: Uint8Array): number {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % MOD;
        b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
}

// ── Raw DEFLATE Decompressor ─────────────────────────────────────────

interface InflateResult {
    readonly data: Uint8Array;
    readonly bytesRead: number;
}

/** Fixed Huffman literal/length code lengths (RFC 1951 §3.2.6). */
function buildFixedLitLenTable(): Uint8Array {
    const lengths = new Uint8Array(288);
    for (let i = 0; i <= 143; i++) lengths[i] = 8;
    for (let i = 144; i <= 255; i++) lengths[i] = 9;
    for (let i = 256; i <= 279; i++) lengths[i] = 7;
    for (let i = 280; i <= 287; i++) lengths[i] = 8;
    return lengths;
}

/** Fixed Huffman distance code lengths (RFC 1951 §3.2.6). */
function buildFixedDistTable(): Uint8Array {
    const lengths = new Uint8Array(32);
    lengths.fill(5);
    return lengths;
}

let _fixedLitLenTable: HuffmanTable | undefined;
let _fixedDistTable: HuffmanTable | undefined;

interface HuffmanTable {
    readonly counts: Uint16Array;  // count of codes for each bit length
    readonly symbols: Uint16Array; // sorted symbol values
}

/**
 * Build a Huffman decode table from code lengths (RFC 1951 §3.2.2).
 */
function buildHuffmanTable(lengths: Uint8Array, maxSymbol: number): HuffmanTable {
    const MAX_BITS = 15;
    const counts = new Uint16Array(MAX_BITS + 1);
    const symbols = new Uint16Array(maxSymbol);

    // Count codes per length
    for (let i = 0; i < maxSymbol; i++) {
        if (lengths[i] > 0) counts[lengths[i]]++;
    }

    // Compute first code for each length
    const offsets = new Uint16Array(MAX_BITS + 1);
    for (let i = 1; i < MAX_BITS; i++) {
        offsets[i + 1] = offsets[i] + counts[i];
    }

    // Assign symbols sorted by code
    for (let i = 0; i < maxSymbol; i++) {
        if (lengths[i] > 0) {
            symbols[offsets[lengths[i]]++] = i;
        }
    }

    return { counts, symbols };
}

// ── Bit Reader ───────────────────────────────────────────────────────

interface BitReader {
    buf: Uint8Array;
    pos: number;      // byte position
    bitBuf: number;    // bit buffer
    bitCnt: number;    // bits in buffer
}

function readBits(br: BitReader, n: number): number {
    while (br.bitCnt < n) {
        if (br.pos >= br.buf.length) throw new Error('inflate: unexpected end of data');
        br.bitBuf |= br.buf[br.pos++] << br.bitCnt;
        br.bitCnt += 8;
    }
    const val = br.bitBuf & ((1 << n) - 1);
    br.bitBuf >>>= n;
    br.bitCnt -= n;
    return val;
}

function decodeSymbol(br: BitReader, table: HuffmanTable): number {
    let code = 0;
    let first = 0;
    let index = 0;

    for (let len = 1; len <= 15; len++) {
        // Read one bit (MSB-first canonical Huffman code)
        if (br.bitCnt < 1) {
            if (br.pos >= br.buf.length) throw new Error('inflate: unexpected end of data');
            br.bitBuf |= br.buf[br.pos++] << br.bitCnt;
            br.bitCnt += 8;
        }
        const bit = br.bitBuf & 1;
        br.bitBuf >>>= 1;
        br.bitCnt--;

        code = (code << 1) | bit;

        const count = table.counts[len];
        if (code - count < first) {
            return table.symbols[index + (code - first)];
        }
        index += count;
        first = (first + count) << 1;
    }

    throw new Error('inflate: invalid Huffman code');
}

// ── Length/Distance Extra Bits Tables ─────────────────────────────────

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/** Code length order for dynamic Huffman table (RFC 1951 §3.2.7). */
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// ── Block Decompression ──────────────────────────────────────────────

function inflateRaw(data: Uint8Array, startOffset: number): InflateResult {
    const br: BitReader = { buf: data, pos: startOffset, bitBuf: 0, bitCnt: 0 };
    const maxOutput = _maxInflateOutput;

    // Output buffer — grows dynamically, capped at maxOutput
    const initialCap = Math.min(data.length * 4, maxOutput);
    let out = new Uint8Array(initialCap);
    let outPos = 0;

    function ensureCapacity(needed: number): void {
        if (outPos + needed > maxOutput) {
            throw new Error(`inflate: decompressed output exceeds maximum of ${maxOutput} bytes (potential zip bomb)`);
        }
        while (outPos + needed > out.length) {
            const newSize = Math.min(out.length * 2, maxOutput);
            const newOut = new Uint8Array(newSize);
            newOut.set(out);
            out = newOut;
        }
    }

    let bfinal = 0;
    while (bfinal === 0) {
        bfinal = readBits(br, 1);
        const btype = readBits(br, 2);

        if (btype === 0) {
            // Stored block — skip to byte boundary
            br.bitBuf = 0;
            br.bitCnt = 0;

            if (br.pos + 4 > br.buf.length) throw new Error('inflate: stored block header truncated');
            const len = br.buf[br.pos] | (br.buf[br.pos + 1] << 8);
            const nlen = br.buf[br.pos + 2] | (br.buf[br.pos + 3] << 8);
            br.pos += 4;

            if ((len ^ 0xFFFF) !== nlen) throw new Error('inflate: stored block LEN/NLEN mismatch');
            if (br.pos + len > br.buf.length) throw new Error('inflate: stored block data truncated');

            ensureCapacity(len);
            out.set(br.buf.subarray(br.pos, br.pos + len), outPos);
            outPos += len;
            br.pos += len;
        } else if (btype === 1 || btype === 2) {
            // Compressed block
            let litLenTable: HuffmanTable;
            let distTable: HuffmanTable;

            if (btype === 1) {
                // Fixed Huffman codes
                if (!_fixedLitLenTable) {
                    _fixedLitLenTable = buildHuffmanTable(buildFixedLitLenTable(), 288);
                    _fixedDistTable = buildHuffmanTable(buildFixedDistTable(), 32);
                }
                litLenTable = _fixedLitLenTable;
                distTable = _fixedDistTable ?? buildHuffmanTable(buildFixedDistTable(), 32);
            } else {
                // Dynamic Huffman codes
                const hlit = readBits(br, 5) + 257;
                const hdist = readBits(br, 5) + 1;
                const hclen = readBits(br, 4) + 4;

                // Read code length code lengths
                const clLengths = new Uint8Array(19);
                for (let i = 0; i < hclen; i++) {
                    clLengths[CL_ORDER[i]] = readBits(br, 3);
                }
                const clTable = buildHuffmanTable(clLengths, 19);

                // Decode literal/length + distance code lengths
                const totalCodes = hlit + hdist;
                const codeLengths = new Uint8Array(totalCodes);
                let ci = 0;
                while (ci < totalCodes) {
                    const sym = decodeSymbol(br, clTable);
                    if (sym < 16) {
                        codeLengths[ci++] = sym;
                    } else if (sym === 16) {
                        const repeat = readBits(br, 2) + 3;
                        const prev = ci > 0 ? codeLengths[ci - 1] : 0;
                        for (let r = 0; r < repeat && ci < totalCodes; r++) codeLengths[ci++] = prev;
                    } else if (sym === 17) {
                        const repeat = readBits(br, 3) + 3;
                        for (let r = 0; r < repeat && ci < totalCodes; r++) codeLengths[ci++] = 0;
                    } else if (sym === 18) {
                        const repeat = readBits(br, 7) + 11;
                        for (let r = 0; r < repeat && ci < totalCodes; r++) codeLengths[ci++] = 0;
                    }
                }

                litLenTable = buildHuffmanTable(codeLengths.subarray(0, hlit), hlit);
                distTable = buildHuffmanTable(codeLengths.subarray(hlit), hdist);
            }

            // Decode symbols
            for (;;) {
                const sym = decodeSymbol(br, litLenTable);
                if (sym < 256) {
                    ensureCapacity(1);
                    out[outPos++] = sym;
                } else if (sym === 256) {
                    break; // End of block
                } else {
                    // Length + distance pair
                    const lenIdx = sym - 257;
                    const length = LEN_BASE[lenIdx] + readBits(br, LEN_EXTRA[lenIdx]);

                    const distSym = decodeSymbol(br, distTable);
                    const distance = DIST_BASE[distSym] + readBits(br, DIST_EXTRA[distSym]);

                    ensureCapacity(length);
                    // Copy from output buffer (may overlap)
                    for (let i = 0; i < length; i++) {
                        out[outPos] = out[outPos - distance];
                        outPos++;
                    }
                }
            }
        } else {
            throw new Error(`inflate: unsupported block type ${btype}`);
        }
    }

    return { data: out.subarray(0, outPos), bytesRead: br.pos - startOffset };
}
