/**
 * pdfnative — PDF Compression Tests
 * ====================================
 * Unit tests for FlateDecode stream compression (pdf-compress.ts).
 *
 * Tests: adler32, deflateStored, deflateSync, compressStream, uint8ToBinaryString.
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import {
    adler32,
    deflateStored,
    deflateSync,
    compressStream,
    uint8ToBinaryString,
    setDeflateImpl,
    setDeflateRawImpl,
    wrapZlib,
    _resetZlibCache,
    initNodeCompression,
} from '../../src/core/pdf-compress.js';
import { toBytes } from '../../src/core/pdf-stream.js';

let zlibInflateSync: (buf: Uint8Array) => Uint8Array;

// Initialize native zlib for ESM context (vitest runs in ESM)
beforeAll(async () => {
    await initNodeCompression();
    const modName = 'node:zlib';
    const mod = await import(/* @vite-ignore */ modName) as { inflateSync: (buf: Uint8Array) => Uint8Array };
    zlibInflateSync = mod.inflateSync;
});

describe('adler32', () => {
    it('should return 1 for empty input', () => {
        expect(adler32(new Uint8Array(0))).toBe(1);
    });

    it('should compute correct checksum for "Wikipedia"', () => {
        const data = new TextEncoder().encode('Wikipedia');
        // Known Adler-32 for "Wikipedia" = 0x11E60398
        expect(adler32(data)).toBe(0x11E60398);
    });

    it('should compute correct checksum for single byte', () => {
        const data = new Uint8Array([0x41]); // 'A'
        // a = 1 + 65 = 66, b = 0 + 66 = 66 â†’ (66 << 16) | 66 = 0x00420042
        expect(adler32(data)).toBe(0x00420042);
    });

    it('should handle all-zero bytes', () => {
        const data = new Uint8Array(100);
        // a stays 1, b = 100 â†’ (100 << 16) | 1
        expect(adler32(data)).toBe((100 << 16) | 1);
    });

    it('should handle large input without overflow', () => {
        const data = new Uint8Array(100_000).fill(0xFF);
        const result = adler32(data);
        expect(result).toBeGreaterThan(0);
        expect(result).toBeLessThanOrEqual(0xFFFFFFFF);
    });
});

describe('deflateStored', () => {
    it('should produce valid zlib header', () => {
        const data = new Uint8Array([1, 2, 3]);
        const result = deflateStored(data);
        expect(result[0]).toBe(0x78); // CMF
        expect(result[1]).toBe(0x01); // FLG
    });

    it('should round-trip via zlibInflateSync', () => {
        const original = new TextEncoder().encode('Hello, FlateDecode!');
        const stored = deflateStored(original);
        const inflated = new Uint8Array(zlibInflateSync(stored));
        expect(inflated).toEqual(original);
    });

    it('should round-trip empty data', () => {
        const original = new Uint8Array(0);
        const stored = deflateStored(original);
        const inflated = new Uint8Array(zlibInflateSync(stored));
        expect(inflated).toEqual(original);
    });

    it('should handle data larger than 65535 bytes (multi-block)', () => {
        const original = new Uint8Array(70000);
        for (let i = 0; i < original.length; i++) original[i] = i & 0xFF;
        const stored = deflateStored(original);
        const inflated = new Uint8Array(zlibInflateSync(stored));
        expect(inflated).toEqual(original);
    });

    it('should handle exactly 65535 bytes (single block boundary)', () => {
        const original = new Uint8Array(65535).fill(0xAB);
        const stored = deflateStored(original);
        const inflated = new Uint8Array(zlibInflateSync(stored));
        expect(inflated).toEqual(original);
    });

    it('should produce output larger than input (stored overhead)', () => {
        const data = new Uint8Array([42]);
        const result = deflateStored(data);
        // 2 (header) + 5 (block header) + 1 (data) + 4 (checksum) = 12
        expect(result.length).toBe(12);
    });

    it('should contain correct Adler-32 at the end', () => {
        const data = new TextEncoder().encode('test');
        const result = deflateStored(data);
        const checksum = adler32(data);
        const len = result.length;
        const trailing = (result[len - 4] << 24) | (result[len - 3] << 16) |
                         (result[len - 2] << 8) | result[len - 1];
        expect(trailing >>> 0).toBe(checksum);
    });
});

describe('deflateSync', () => {
    beforeEach(async () => {
        _resetZlibCache();
        await initNodeCompression();
    });

    it('should compress and decompress text data', () => {
        const original = new TextEncoder().encode('BT /F1 12 Tf 100 700 Td (Hello World) Tj ET');
        const compressed = deflateSync(original);
        const back = new Uint8Array(zlibInflateSync(compressed));
        expect(back).toEqual(original);
    });

    it('should produce smaller output for repetitive data', () => {
        const repetitive = new TextEncoder().encode('BT /F1 12 Tf '.repeat(100));
        const compressed = deflateSync(repetitive);
        expect(compressed.length).toBeLessThan(repetitive.length);
    });

    it('should compress binary data (TTF-like)', () => {
        const binary = new Uint8Array(1000);
        for (let i = 0; i < binary.length; i++) binary[i] = i & 0xFF;
        const compressed = deflateSync(binary);
        const back = new Uint8Array(zlibInflateSync(compressed));
        expect(back).toEqual(binary);
    });

    it('should handle empty input', () => {
        const compressed = deflateSync(new Uint8Array(0));
        const back = new Uint8Array(zlibInflateSync(compressed));
        expect(back).toEqual(new Uint8Array(0));
    });

    it('should handle single byte', () => {
        const original = new Uint8Array([0x42]);
        const compressed = deflateSync(original);
        const back = new Uint8Array(zlibInflateSync(compressed));
        expect(back).toEqual(original);
    });

    it('should handle large content stream (10K operators)', () => {
        const ops = 'BT /F1 10 Tf 50.00 750.00 Td (Sample text line) Tj ET\n'.repeat(200);
        const original = new TextEncoder().encode(ops);
        const compressed = deflateSync(original);
        const back = new Uint8Array(zlibInflateSync(compressed));
        expect(back).toEqual(original);
        expect(compressed.length).toBeLessThan(original.length * 0.5);
    });
});

describe('compressStream', () => {
    beforeEach(async () => {
        _resetZlibCache();
        await initNodeCompression();
    });

    it('should compress a binary string and return a binary string', () => {
        const stream = 'BT /F1 12 Tf 100 700 Td (Hello) Tj ET';
        const compressed = compressStream(stream);
        expect(typeof compressed).toBe('string');
        // Decompress to verify
        const compressedBytes = toBytes(compressed);
        const back = new Uint8Array(zlibInflateSync(compressedBytes));
        const original = toBytes(stream);
        expect(back).toEqual(original);
    });

    it('should produce smaller output for repetitive PDF content', () => {
        const stream = 'BT /F1 12 Tf 100 700 Td (Hello) Tj ET\n'.repeat(50);
        const compressed = compressStream(stream);
        expect(compressed.length).toBeLessThan(stream.length);
    });

    it('should handle ToUnicode CMap content', () => {
        const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
3 beginbfchar
<0048> <0048>
<0065> <0065>
<006C> <006C>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
        const compressed = compressStream(cmap);
        const back = new Uint8Array(zlibInflateSync(toBytes(compressed)));
        expect(back).toEqual(toBytes(cmap));
    });

    it('should handle binary stream data (font bytes)', () => {
        const binaryStr = String.fromCharCode(...Array.from({ length: 256 }, (_, i) => i));
        const compressed = compressStream(binaryStr);
        const back = new Uint8Array(zlibInflateSync(toBytes(compressed)));
        expect(back).toEqual(toBytes(binaryStr));
    });
});

describe('uint8ToBinaryString', () => {
    it('should convert small array', () => {
        const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        expect(uint8ToBinaryString(bytes)).toBe('Hello');
    });

    it('should handle empty array', () => {
        expect(uint8ToBinaryString(new Uint8Array(0))).toBe('');
    });

    it('should preserve high bytes (> 127)', () => {
        const bytes = new Uint8Array([0xE2, 0xE3, 0xCF, 0xD3]);
        const str = uint8ToBinaryString(bytes);
        expect(str.charCodeAt(0)).toBe(0xE2);
        expect(str.charCodeAt(3)).toBe(0xD3);
        expect(str.length).toBe(4);
    });

    it('should handle large arrays without stack overflow', () => {
        const bytes = new Uint8Array(100_000).fill(0x41);
        const str = uint8ToBinaryString(bytes);
        expect(str.length).toBe(100_000);
        expect(str[0]).toBe('A');
        expect(str[99_999]).toBe('A');
    });

    it('should round-trip with toBytes', () => {
        const original = new Uint8Array(256);
        for (let i = 0; i < 256; i++) original[i] = i;
        const str = uint8ToBinaryString(original);
        const back = toBytes(str);
        expect(back).toEqual(original);
    });
});

// ── setDeflateImpl contract (issue #78) ──────────────────────────────
//
// The JSDoc used to recommend implementations that fail silently: raw
// RFC 1951 DEFLATE produced streams no reader can inflate (blank pages,
// empty text extraction), and the async callback API returned undefined.
// deflateSync() now rejects both with an explanatory error.

describe('setDeflateImpl contract enforcement', () => {
    afterEach(async () => {
        _resetZlibCache();
        await initNodeCompression();
    });

    it('accepts a synchronous zlib-wrapped implementation', () => {
        setDeflateImpl((buf) => deflateStored(buf));
        const out = deflateSync(toBytes('hello world'));
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out[0] & 0x0f).toBe(8);
        expect(((out[0] << 8) | out[1]) % 31).toBe(0);
    });

    it('rejects raw RFC 1951 DEFLATE (fflate deflateSync)', () => {
        // Strip the 2-byte zlib header and the 4-byte Adler-32 trailer to
        // emulate what fflate's `deflateSync` returns.
        setDeflateImpl((buf) => deflateStored(buf).subarray(2, -4));
        expect(() => deflateSync(toBytes('hello'))).toThrow(/raw DEFLATE \(RFC 1951\)/);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/zlibSync/);
    });

    it('rejects an implementation returning undefined (async callback API)', () => {
        setDeflateImpl((() => undefined) as unknown as (b: Uint8Array) => Uint8Array);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/returned undefined/);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/must be synchronous/);
    });

    it('rejects an implementation returning a Promise (CompressionStream)', () => {
        setDeflateImpl(((buf: Uint8Array) => Promise.resolve(buf)) as unknown as (b: Uint8Array) => Uint8Array);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/returned a Promise/);
    });

    it('names the offending API in the message so the fix is obvious', () => {
        setDeflateImpl((buf) => deflateStored(buf).subarray(2, -4));
        expect(() => deflateSync(toBytes('x'))).toThrow(/setDeflateImpl/);
    });

    it('falls back to the stored-block writer when no implementation is set', () => {
        setDeflateImpl(null);
        const out = deflateSync(toBytes('hello'));
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out[0]).toBe(0x78);
    });

    it('does not corrupt a document built through compressStream', () => {
        setDeflateImpl((buf) => deflateStored(buf));
        const round = compressStream('BT /F1 12 Tf (hi) Tj ET');
        expect(round.length).toBeGreaterThan(0);
        expect(round.charCodeAt(0)).toBe(0x78);
    });
});

// ── setDeflateRawImpl / wrapZlib (v1.8.0) ────────────────────────────
//
// Raw RFC 1951 is what portable compressors emit (ZIP method 8, zipnative,
// fflate's deflateSync, CompressionStream's 'deflate-raw'). pdfnative adds
// the RFC 1950 envelope so callers cannot get it wrong.

describe('setDeflateRawImpl', () => {
    /** Strip a zlib envelope, leaving the raw RFC 1951 payload. */
    const toRaw = (data: Uint8Array): Uint8Array => deflateStored(data).subarray(2, -4);

    afterEach(async () => {
        _resetZlibCache();
        await initNodeCompression();
    });

    it('wraps raw output so the result inflates back to the input', () => {
        setDeflateRawImpl(toRaw);
        const input = toBytes('The quick brown fox jumps over the lazy dog.');
        const out = deflateSync(input);
        expect(out[0]).toBe(0x78);
        expect(((out[0] << 8) | out[1]) % 31).toBe(0);
        expect(new Uint8Array(zlibInflateSync(out))).toEqual(input);
    });

    it('outranks an auto-resolved node:zlib', async () => {
        // Node's zlib is available here, but an explicit raw impl is a
        // deliberate choice and must win — that is the whole point when
        // pinning a cross-runtime encoder.
        _resetZlibCache();
        await initNodeCompression();
        let called = 0;
        setDeflateRawImpl((buf) => { called++; return toRaw(buf); });
        deflateSync(toBytes('hello'));
        expect(called).toBe(1);
    });

    it('yields to an explicit setDeflateImpl', () => {
        let rawCalls = 0;
        let zlibCalls = 0;
        setDeflateRawImpl((buf) => { rawCalls++; return toRaw(buf); });
        setDeflateImpl((buf) => { zlibCalls++; return deflateStored(buf); });
        deflateSync(toBytes('hello'));
        expect(zlibCalls).toBe(1);
        expect(rawCalls).toBe(0);
    });

    it('rejects an asynchronous raw implementation', () => {
        setDeflateRawImpl(((buf: Uint8Array) => Promise.resolve(buf)) as unknown as (b: Uint8Array) => Uint8Array);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/a Promise was returned/);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/setDeflateRawImpl/);
    });

    it('rejects a raw implementation returning undefined', () => {
        setDeflateRawImpl((() => undefined) as unknown as (b: Uint8Array) => Uint8Array);
        expect(() => deflateSync(toBytes('hello'))).toThrow(/undefined was returned/);
    });

    it('can be removed with null', async () => {
        setDeflateRawImpl(toRaw);
        setDeflateRawImpl(null);
        _resetZlibCache();
        await initNodeCompression();
        const input = toBytes('back to node zlib');
        expect(new Uint8Array(zlibInflateSync(deflateSync(input)))).toEqual(input);
    });
});

describe('wrapZlib', () => {
    it('produces a stream node:zlib can inflate', () => {
        const input = toBytes('round trip through the wrapper');
        const raw = deflateStored(input).subarray(2, -4);
        const wrapped = wrapZlib(raw, input);
        expect(new Uint8Array(zlibInflateSync(wrapped))).toEqual(input);
    });

    it('checksums the uncompressed source, not the compressed payload', () => {
        const input = toBytes('checksum me');
        const raw = deflateStored(input).subarray(2, -4);
        const wrapped = wrapZlib(raw, input);
        const trailer = wrapped.subarray(wrapped.length - 4);
        const sum = adler32(input);
        expect(Array.from(trailer)).toEqual([
            (sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff,
        ]);
        // The compressed payload has a different checksum, so a naive
        // implementation checksumming `raw` would not match.
        expect(adler32(raw)).not.toBe(sum);
    });

    it('emits a header that satisfies the RFC 1950 modulo-31 rule', () => {
        const wrapped = wrapZlib(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]));
        expect(wrapped[0] & 0x0f).toBe(8);
        expect(((wrapped[0] << 8) | wrapped[1]) % 31).toBe(0);
    });

    it('handles empty input', () => {
        const input = new Uint8Array(0);
        const raw = deflateStored(input).subarray(2, -4);
        expect(new Uint8Array(zlibInflateSync(wrapZlib(raw, input)))).toEqual(input);
    });
});
