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
 * Whether {@link _zlibDeflateSync} came from an explicit {@link setDeflateImpl}
 * call rather than from auto-resolving `node:zlib`. An explicit choice always
 * outranks an auto-detected one.
 */
let _zlibImplIsExplicit = false;

/** Raw RFC 1951 deflate injected through {@link setDeflateRawImpl}. */
let _rawDeflateImpl: ((buf: Uint8Array) => Uint8Array) | null = null;

/**
 * Inject a custom deflate implementation (e.g. a bundled zlib in the browser,
 * or a pre-loaded `node:zlib` in ESM).
 *
 * ## Contract
 *
 * The function MUST be **synchronous** and MUST return **zlib-wrapped**
 * output (RFC 1950: a 2-byte header, the DEFLATE payload, and an Adler-32
 * trailer). Its return value is written into a `/FlateDecode` stream
 * verbatim — ISO 32000-1 §7.3.8.1 requires the zlib wrapper, not the bare
 * RFC 1951 DEFLATE payload.
 *
 * Two mistakes are easy to make and neither is obvious at runtime, so
 * {@link deflateSync} validates the returned value and throws instead:
 *
 * - **Raw DEFLATE** (fflate's `deflateSync`, `CompressionStream`'s
 *   `'deflate-raw'`) produces a stream no reader can inflate. Viewers show a
 *   blank page and text extraction silently returns `''`.
 * - **An asynchronous API** (fflate's callback `deflate`, any Promise- or
 *   stream-based compressor, including `CompressionStream`) returns
 *   `undefined` or a `Promise`, never bytes. `CompressionStream` cannot be
 *   adapted here at all: it is asynchronous by nature, and PDF assembly is
 *   synchronous. Use {@link initNodeCompression} on Node, or a synchronous
 *   library in the browser.
 *
 * @param fn - Synchronous deflate returning zlib (RFC 1950) bytes, or `null`
 *   to fall back to the built-in stored-block writer.
 *
 * @example Correct — fflate's zlib-wrapping entry point
 * ```typescript
 * import { setDeflateImpl } from 'pdfnative';
 * import { zlibSync } from 'fflate';
 * setDeflateImpl((buf) => zlibSync(buf));
 * ```
 *
 * @example Correct — pako
 * ```typescript
 * import { setDeflateImpl } from 'pdfnative';
 * import pako from 'pako';
 * setDeflateImpl((buf) => pako.deflate(buf));
 * ```
 *
 * @example Correct — Node, without injecting anything
 * ```typescript
 * import { initNodeCompression } from 'pdfnative';
 * await initNodeCompression();
 * ```
 */
export function setDeflateImpl(fn: ((buf: Uint8Array) => Uint8Array) | null): void {
    _zlibDeflateSync = fn;
    _zlibImplIsExplicit = fn !== null;
}

/**
 * Inject a **raw** DEFLATE (RFC 1951) compressor; pdfnative adds the zlib
 * wrapper itself.
 *
 * Most portable compressors — anything built for ZIP, `CompressionStream`'s
 * `'deflate-raw'`, fflate's `deflateSync` — emit the bare RFC 1951 payload,
 * because that is what ZIP's method 8 stores. PDF wants the RFC 1950 zlib
 * envelope around it (ISO 32000-1 §7.3.8.1). Getting that wrapper wrong is
 * the single most common way to produce a PDF whose pages silently render
 * blank, which is exactly what {@link setDeflateImpl} now rejects. This
 * entry point removes the trap: hand over raw bytes and pdfnative writes the
 * 2-byte header and the Adler-32 trailer, computed over the *uncompressed*
 * input as RFC 1950 §2.2 requires.
 *
 * The function must still be **synchronous**, and its output is validated
 * the same way {@link setDeflateImpl}'s is.
 *
 * Precedence, highest first: an explicit {@link setDeflateImpl}, then this,
 * then an auto-resolved `node:zlib`, then the built-in stored-block writer.
 * An explicit choice therefore wins over Node's native zlib, which matters
 * when the point is byte-identical output across runtimes.
 *
 * @param fn - Synchronous raw-DEFLATE compressor, or `null` to remove it.
 *
 * @example zipnative — zero-dependency, cross-runtime, deterministic
 * ```typescript
 * import { getCodec, METHOD_DEFLATE } from 'zipnative';
 * import { setDeflateRawImpl } from 'pdfnative';
 *
 * const codec = getCodec(METHOD_DEFLATE);
 * setDeflateRawImpl((buf) => codec.compressSync!(buf, { level: 6, deterministic: true }));
 * ```
 * This is the recommended way to get real compression in the browser, in
 * Deno, Bun or a Worker, where pdfnative would otherwise fall back to
 * stored blocks and compress nothing at all. `deterministic: true` pins
 * zipnative's pure-TypeScript encoder, so the emitted PDF is byte-identical
 * on every runtime.
 *
 * @example fflate
 * ```typescript
 * import { deflateSync } from 'fflate';
 * setDeflateRawImpl((buf) => deflateSync(buf));
 * ```
 *
 * @since 1.8.0
 */
export function setDeflateRawImpl(fn: ((buf: Uint8Array) => Uint8Array) | null): void {
    _rawDeflateImpl = fn;
}

/**
 * Wrap a raw RFC 1951 DEFLATE payload in a zlib (RFC 1950) envelope.
 *
 * The Adler-32 trailer is computed over the ORIGINAL uncompressed bytes,
 * not over the compressed payload (RFC 1950 §2.2) — getting that backwards
 * yields a stream that inflates but fails its integrity check.
 *
 * @param raw - Raw DEFLATE payload (RFC 1951)
 * @param source - The uncompressed bytes `raw` was produced from
 * @returns Valid zlib-format bytes (RFC 1950)
 *
 * @since 1.8.0
 */
export function wrapZlib(raw: Uint8Array, source: Uint8Array): Uint8Array {
    const out = new Uint8Array(raw.length + 6);
    // CMF=0x78 (deflate, 32K window), FLG=0x9C (default level, no dict);
    // 0x789C is a multiple of 31, as RFC 1950 §2.2 requires.
    out[0] = 0x78;
    out[1] = 0x9c;
    out.set(raw, 2);
    const sum = adler32(source);
    const end = raw.length + 2;
    out[end] = (sum >>> 24) & 0xff;
    out[end + 1] = (sum >>> 16) & 0xff;
    out[end + 2] = (sum >>> 8) & 0xff;
    out[end + 3] = sum & 0xff;
    return out;
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
    // An explicitly injected implementation always outranks an auto-resolved
    // `node:zlib`, so a caller who deliberately pins a cross-runtime encoder
    // is not silently overridden by Node's native one.
    if (_zlibImplIsExplicit && _zlibDeflateSync) {
        return assertZlibOutput(_zlibDeflateSync(data));
    }
    if (_rawDeflateImpl) {
        return wrapZlib(assertRawOutput(_rawDeflateImpl(data)), data);
    }
    const nativeDeflate = getZlibDeflateSync();
    if (!nativeDeflate) return deflateStored(data);
    return assertZlibOutput(nativeDeflate(data));
}

/**
 * Validate what an injected RAW deflate implementation returned. Only the
 * synchronous-and-returns-bytes half of the contract can be checked here:
 * a raw RFC 1951 payload has no header to inspect.
 */
function assertRawOutput(out: unknown): Uint8Array {
    if (!(out instanceof Uint8Array)) {
        throw new Error(
            `${describeNonBytes(out)} was returned by the implementation passed to `
            + 'setDeflateRawImpl(), which must be synchronous and return a Uint8Array of raw '
            + 'RFC 1951 DEFLATE. See setDeflateRawImpl().',
        );
    }
    return out;
}

/** Name what a wrong implementation returned, for the error message. */
function describeNonBytes(out: unknown): string {
    if (out === undefined) return 'undefined';
    if (out !== null && typeof (out as { then?: unknown }).then === 'function') return 'a Promise';
    return typeof out;
}

/**
 * Validate what an injected deflate implementation returned.
 *
 * A wrong implementation used to fail silently — raw RFC 1951 output produced
 * `/FlateDecode` streams no reader can inflate (blank pages, empty text
 * extraction), and an asynchronous one produced `undefined` or a `Promise`,
 * which crashed much later with an unrelated message. Both now fail here,
 * pointing at the real cause. See {@link setDeflateImpl} for the contract.
 */
function assertZlibOutput(out: unknown): Uint8Array {
    if (!(out instanceof Uint8Array)) {
        throw new Error(
            `the deflate implementation passed to setDeflateImpl() returned ${describeNonBytes(out)} instead of a `
            + 'Uint8Array. It must be synchronous — an async API (fflate\'s callback `deflate`, '
            + '`CompressionStream`) cannot be used here. See setDeflateImpl().',
        );
    }
    // RFC 1950 §2.2: CMF/FLG, with CM=8 (deflate) in the low nibble of CMF and
    // (CMF<<8 | FLG) a multiple of 31. Raw RFC 1951 output essentially never
    // satisfies both, which is what makes this a reliable wrong-impl detector.
    const valid = out.length >= 2 && (out[0] & 0x0f) === 8 && ((out[0] << 8) | out[1]) % 31 === 0;
    if (!valid) {
        throw new Error(
            'the deflate implementation passed to setDeflateImpl() returned raw DEFLATE (RFC 1951) '
            + 'instead of zlib-wrapped data (RFC 1950), which ISO 32000-1 §7.3.8.1 requires for '
            + '/FlateDecode. Use fflate\'s `zlibSync` rather than `deflateSync`, or pass the raw '
            + 'compressor to setDeflateRawImpl() and let pdfnative add the wrapper.',
        );
    }
    return out;
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
    _zlibImplIsExplicit = false;
    _rawDeflateImpl = null;
}
