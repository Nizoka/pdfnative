/**
 * pdfnative — PDF Stream Compression (FlateDecode)
 * ===================================================
 * Zero-dependency FlateDecode compression using platform-native APIs.
 *
 * Strategy A+B hybrid:
 *   - Node.js: zlib.deflateSync() — synchronous, native performance
 *   - Fallback: DEFLATE stored-block wrapper — valid FlateDecode, zero compression
 *
 * ISO 32000-1 §7.3.8.1: FlateDecode expects zlib format (RFC 1950).
 */

import { toBytes } from './pdf-stream.js';

// ── Platform Detection ───────────────────────────────────────────────

/** Cached reference to Node.js zlib.deflateSync (resolved once). */
let _zlibDeflateSync: ((buf: Uint8Array) => Uint8Array) | null | undefined;

/**
 * Inject a custom deflate implementation (e.g. for pre-loaded zlib in ESM).
 * Called once at module init if Node.js is detected via eager resolution.
 *
 * @param fn - deflateSync-compatible function, or null to disable
 */
export function setDeflateImpl(fn: ((buf: Uint8Array) => Uint8Array) | null): void {
    _zlibDeflateSync = fn;
}

/**
 * Attempt to resolve Node.js zlib.deflateSync.
 * Tries CJS require (available in CJS and some bundlers) then returns null.
 * For ESM contexts, call `initNodeCompression()` before first use.
 */
function getZlibDeflateSync(): ((buf: Uint8Array) => Uint8Array) | null {
    if (_zlibDeflateSync !== undefined) return _zlibDeflateSync;
    try {
        const g = globalThis as Record<string, unknown>;
        const proc = g['process'] as { versions?: { node?: string } } | undefined;
        if (!proc?.versions?.node) {
            _zlibDeflateSync = null;
            return null;
        }
        // Try CJS require (available in CommonJS, some bundlers, and Node CJS context)
        const mod = g['__non_webpack_require__'] as ((m: string) => Record<string, unknown>) | undefined
            ?? (g['require'] as ((m: string) => Record<string, unknown>) | undefined);
        if (mod) {
            const zlib = mod('node:zlib');
            const fn = zlib['deflateSync'] as ((buf: Uint8Array) => Uint8Array) | undefined;
            if (typeof fn === 'function') {
                _zlibDeflateSync = (buf: Uint8Array) => new Uint8Array(fn(buf));
                return _zlibDeflateSync;
            }
        }
        _zlibDeflateSync = null;
        return null;
    } catch {
        _zlibDeflateSync = null;
        return null;
    }
}

/**
 * Initialize Node.js compression for ESM contexts.
 * Must be called once before `buildPDF`/`buildDocumentPDF` with `compress: true`.
 * No-op if already initialized or if not in Node.js.
 *
 * @example
 * ```ts
 * import { initNodeCompression, buildPDFBytes } from 'pdfnative';
 * await initNodeCompression();
 * const pdf = buildPDFBytes(params, { compress: true });
 * ```
 */
export async function initNodeCompression(): Promise<void> {
    if (_zlibDeflateSync !== undefined) return;
    try {
        const g = globalThis as Record<string, unknown>;
        const proc = g['process'] as { versions?: { node?: string } } | undefined;
        if (!proc?.versions?.node) {
            _zlibDeflateSync = null;
            return;
        }
        // Dynamic import with string indirection to bypass static module resolution
        const modName = 'node:zlib';
        const zlib = await (import(modName) as Promise<Record<string, unknown>>);
        const fn = zlib['deflateSync'] as ((buf: Uint8Array) => Uint8Array) | undefined;
        if (typeof fn === 'function') {
            _zlibDeflateSync = (buf: Uint8Array) => new Uint8Array(fn(buf));
        } else {
            _zlibDeflateSync = null;
        }
    } catch {
        _zlibDeflateSync = null;
    }
}

// ── Adler-32 Checksum (RFC 1950 §8.2) ───────────────────────────────

/**
 * Compute Adler-32 checksum for a byte array.
 *
 * @param data - Input bytes
 * @returns 32-bit checksum
 */
export function adler32(data: Uint8Array): number {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    for (let i = 0; i < data.length; i++) {
        a = (a + data[i]) % MOD;
        b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
}

// ── Stored-Block DEFLATE Wrapper (RFC 1950 + RFC 1951 Type 0) ────────

/**
 * Wrap data in a valid zlib stream using DEFLATE stored blocks (no compression).
 * Produces valid FlateDecode data that any PDF reader can decode.
 *
 * Format: [zlib header (2 bytes)] [stored blocks] [Adler-32 (4 bytes)]
 *
 * @param data - Raw bytes to wrap
 * @returns Valid zlib-format bytes (RFC 1950)
 */
export function deflateStored(data: Uint8Array): Uint8Array {
    const MAX_BLOCK = 65535; // DEFLATE stored block max payload
    const numBlocks = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
    // 2 (zlib header) + numBlocks * 5 (block headers) + data.length + 4 (Adler-32)
    const outLen = 2 + numBlocks * 5 + data.length + 4;
    const out = new Uint8Array(outLen);
    let pos = 0;

    // Zlib header: CMF=0x78 (deflate, 32K window), FLG=0x01 (no dict, fcheck)
    out[pos++] = 0x78;
    out[pos++] = 0x01;

    // DEFLATE stored blocks
    let remaining = data.length;
    let offset = 0;
    while (remaining > 0 || offset === 0) {
        const blockSize = Math.min(remaining, MAX_BLOCK);
        const isFinal = remaining <= MAX_BLOCK ? 1 : 0;

        out[pos++] = isFinal;                       // BFINAL + BTYPE=00
        out[pos++] = blockSize & 0xFF;               // LEN low
        out[pos++] = (blockSize >> 8) & 0xFF;        // LEN high
        out[pos++] = ~blockSize & 0xFF;              // NLEN low
        out[pos++] = (~blockSize >> 8) & 0xFF;       // NLEN high

        out.set(data.subarray(offset, offset + blockSize), pos);
        pos += blockSize;
        offset += blockSize;
        remaining -= blockSize;

        if (remaining === 0) break;
    }

    // Adler-32 checksum (big-endian)
    const checksum = adler32(data);
    out[pos++] = (checksum >> 24) & 0xFF;
    out[pos++] = (checksum >> 16) & 0xFF;
    out[pos++] = (checksum >> 8) & 0xFF;
    out[pos++] = checksum & 0xFF;

    return out;
}

// ── Compression Facade ───────────────────────────────────────────────

/**
 * Compress data using the best available platform API.
 *
 * Priority:
 *   1. Node.js zlib.deflateSync() — native C performance, sync
 *   2. Stored-block fallback — valid FlateDecode, zero compression
 *
 * @param data - Raw bytes to compress
 * @returns Compressed bytes in zlib format (RFC 1950)
 */
export function deflateSync(data: Uint8Array): Uint8Array {
    const nativeDeflate = getZlibDeflateSync();
    if (nativeDeflate) return nativeDeflate(data);
    return deflateStored(data);
}

// ── Stream Compression Helper ────────────────────────────────────────

/**
 * Compress a PDF stream data string.
 * Converts binary string → Uint8Array → deflate → binary string.
 *
 * @param streamData - Binary string (single-byte characters)
 * @returns Compressed binary string
 */
export function compressStream(streamData: string): string {
    const raw = toBytes(streamData);
    const compressed = deflateSync(raw);
    return uint8ToBinaryString(compressed);
}

/**
 * Convert Uint8Array to a binary string (single-byte per char).
 * Uses chunked String.fromCharCode to avoid call stack overflow.
 *
 * @param bytes - Input byte array
 * @returns Binary string
 */
export function uint8ToBinaryString(bytes: Uint8Array): string {
    const chunks: string[] = [];
    const CHUNK = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        chunks.push(String.fromCharCode(...slice));
    }
    return chunks.join('');
}

// ── Reset (testing) ──────────────────────────────────────────────────

/**
 * Reset cached zlib reference (for testing platform fallback paths).
 * @internal
 */
export function _resetZlibCache(): void {
    _zlibDeflateSync = undefined;
}
