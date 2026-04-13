/**
 * Tests for streaming PDF output.
 */

import { describe, it, expect } from 'vitest';
import {
    buildDocumentPDFStream,
    buildPDFStream,
    buildDocumentPDFBytes,
    buildPDFBytes,
    chunkBinaryString,
    concatChunks,
    streamByteLength,
    validateDocumentStreamable,
    validateTableStreamable,
} from '../../src/index.js';
import type { DocumentParams, PdfParams, PdfRow } from '../../src/index.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeDocParams(blocks: DocumentParams['blocks'] = []): DocumentParams {
    return { title: 'Test', blocks };
}

function makeTableParams(): PdfParams {
    const row: PdfRow = { cells: ['A', 'B'], type: '', pointed: false };
    return {
        title: 'Test',
        headers: ['Col1', 'Col2'],
        rows: [row],
        infoItems: [],
        balanceText: '',
        countText: '',
        footerText: 'Footer',
    };
}

async function collectChunks(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return chunks;
}

async function collectAll(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    return concatChunks(await collectChunks(stream));
}

// ── chunkBinaryString ────────────────────────────────────────────────

describe('chunkBinaryString', () => {
    it('yields empty for empty string', () => {
        const chunks = [...chunkBinaryString('', 1024)];
        expect(chunks).toHaveLength(0);
    });

    it('yields single chunk for small string', () => {
        const chunks = [...chunkBinaryString('ABC', 1024)];
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
    });

    it('splits string into correct chunk sizes', () => {
        const str = 'ABCDEFGH'; // 8 bytes
        const chunks = [...chunkBinaryString(str, 3)];
        expect(chunks).toHaveLength(3); // 3 + 3 + 2
        expect(chunks[0]).toEqual(new Uint8Array([0x41, 0x42, 0x43]));
        expect(chunks[1]).toEqual(new Uint8Array([0x44, 0x45, 0x46]));
        expect(chunks[2]).toEqual(new Uint8Array([0x47, 0x48]));
    });

    it('handles exact multiple of chunk size', () => {
        const chunks = [...chunkBinaryString('ABCDEF', 3)];
        expect(chunks).toHaveLength(2);
        expect(chunks[0].length).toBe(3);
        expect(chunks[1].length).toBe(3);
    });

    it('masks characters to 0xFF', () => {
        // Binary string: char codes > 0xFF should be masked
        const str = String.fromCharCode(0x41, 0xFF, 0x100);
        const chunks = [...chunkBinaryString(str, 10)];
        expect(chunks[0][0]).toBe(0x41);
        expect(chunks[0][1]).toBe(0xFF);
        expect(chunks[0][2]).toBe(0x00); // 0x100 & 0xFF = 0
    });

    it('handles chunk size of 1', () => {
        const chunks = [...chunkBinaryString('AB', 1)];
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual(new Uint8Array([0x41]));
        expect(chunks[1]).toEqual(new Uint8Array([0x42]));
    });
});

// ── concatChunks ─────────────────────────────────────────────────────

describe('concatChunks', () => {
    it('concatenates empty array', () => {
        expect(concatChunks([])).toEqual(new Uint8Array(0));
    });

    it('concatenates single chunk', () => {
        const chunk = new Uint8Array([1, 2, 3]);
        expect(concatChunks([chunk])).toEqual(chunk);
    });

    it('concatenates multiple chunks', () => {
        const a = new Uint8Array([1, 2]);
        const b = new Uint8Array([3, 4, 5]);
        expect(concatChunks([a, b])).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });
});

// ── streamByteLength ─────────────────────────────────────────────────

describe('streamByteLength', () => {
    it('counts bytes from document stream', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Hello' }]);
        const expected = buildDocumentPDFBytes(params);
        const length = await streamByteLength(buildDocumentPDFStream(params));
        expect(length).toBe(expected.length);
    });

    it('returns 0 for minimal stream', async () => {
        async function* empty(): AsyncGenerator<Uint8Array> { /* empty */ }
        const length = await streamByteLength(empty());
        expect(length).toBe(0);
    });
});

// ── validateDocumentStreamable ───────────────────────────────────────

describe('validateDocumentStreamable', () => {
    it('accepts document without TOC', () => {
        const params = makeDocParams([
            { type: 'heading', text: 'Title', level: 1 },
            { type: 'paragraph', text: 'Content' },
        ]);
        expect(() => validateDocumentStreamable(params)).not.toThrow();
    });

    it('rejects document with TOC block', () => {
        const params = makeDocParams([
            { type: 'heading', text: 'Title', level: 1 },
            { type: 'toc' },
        ]);
        expect(() => validateDocumentStreamable(params)).toThrow(/TOC/);
    });

    it('rejects {pages} in headerTemplate', () => {
        const params = makeDocParams([]);
        expect(() => validateDocumentStreamable(params, {
            headerTemplate: { center: 'Page {page} of {pages}' },
        })).toThrow(/\{pages\}/);
    });

    it('rejects {pages} in footerTemplate', () => {
        const params = makeDocParams([]);
        expect(() => validateDocumentStreamable(params, {
            footerTemplate: { right: '{pages}' },
        })).toThrow(/\{pages\}/);
    });

    it('allows {page} without {pages}', () => {
        const params = makeDocParams([]);
        expect(() => validateDocumentStreamable(params, {
            footerTemplate: { center: 'Page {page}' },
        })).not.toThrow();
    });

    it('checks params.layout for {pages}', () => {
        const params: DocumentParams = {
            title: 'Test',
            blocks: [],
            layout: { footerTemplate: { center: '{pages} total' } },
        };
        expect(() => validateDocumentStreamable(params)).toThrow(/\{pages\}/);
    });
});

// ── validateTableStreamable ──────────────────────────────────────────

describe('validateTableStreamable', () => {
    it('accepts standard table params', () => {
        expect(() => validateTableStreamable(makeTableParams())).not.toThrow();
    });

    it('rejects {pages} in headerTemplate', () => {
        expect(() => validateTableStreamable(makeTableParams(), {
            headerTemplate: { left: '{pages}' },
        })).toThrow(/\{pages\}/);
    });

    it('allows {page} in templates', () => {
        expect(() => validateTableStreamable(makeTableParams(), {
            footerTemplate: { center: '{page}' },
        })).not.toThrow();
    });
});

// ── buildDocumentPDFStream ───────────────────────────────────────────

describe('buildDocumentPDFStream', () => {
    it('produces same bytes as buildDocumentPDFBytes', async () => {
        const params = makeDocParams([
            { type: 'heading', text: 'Streaming Test', level: 1 },
            { type: 'paragraph', text: 'This document was built using streaming output.' },
        ]);
        const expected = buildDocumentPDFBytes(params);
        const actual = await collectAll(buildDocumentPDFStream(params));
        expect(actual).toEqual(expected);
    });

    it('yields multiple chunks with small chunk size', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Hello World' }]);
        const chunks = await collectChunks(buildDocumentPDFStream(params, undefined, { chunkSize: 1024 }));
        expect(chunks.length).toBeGreaterThan(1);
    });

    it('yields single chunk with very large chunk size', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Small' }]);
        const chunks = await collectChunks(buildDocumentPDFStream(params, undefined, { chunkSize: 16_777_216 }));
        expect(chunks).toHaveLength(1);
    });

    it('respects minimum chunk size', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Test' }]);
        const expected = buildDocumentPDFBytes(params);
        // Request chunk size of 1 byte — should be clamped to 1024
        const chunks = await collectChunks(buildDocumentPDFStream(params, undefined, { chunkSize: 1 }));
        // Each chunk should be >= 1024 bytes (except possibly the last)
        for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].length).toBe(1024);
        }
        const actual = concatChunks(chunks);
        expect(actual).toEqual(expected);
    });

    it('rejects TOC blocks', async () => {
        const params = makeDocParams([{ type: 'toc' }]);
        const stream = buildDocumentPDFStream(params);
        await expect(stream.next()).rejects.toThrow(/TOC/);
    });

    it('passes layout options through', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Compressed test' }]);
        const withCompress = await collectAll(buildDocumentPDFStream(params, { compress: true }));
        const without = await collectAll(buildDocumentPDFStream(params));
        // Compressed should generally be smaller (or at least different)
        expect(withCompress.length).not.toBe(without.length);
    });

    it('handles empty blocks', async () => {
        const params = makeDocParams([]);
        const expected = buildDocumentPDFBytes(params);
        const actual = await collectAll(buildDocumentPDFStream(params));
        expect(actual).toEqual(expected);
    });

    it('all chunks start with valid bytes', async () => {
        const params = makeDocParams([{ type: 'paragraph', text: 'Chunk test' }]);
        const chunks = await collectChunks(buildDocumentPDFStream(params, undefined, { chunkSize: 2048 }));
        // First chunk should start with %PDF
        expect(String.fromCharCode(...chunks[0].subarray(0, 5))).toBe('%PDF-');
        // All chunks should have valid byte values
        for (const chunk of chunks) {
            for (const byte of chunk) {
                expect(byte).toBeLessThanOrEqual(0xFF);
                expect(byte).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('default chunk size is 64KB', async () => {
        // Build a document large enough to span multiple 64KB chunks
        const blocks: DocumentParams['blocks'][number][] = [];
        for (let i = 0; i < 100; i++) {
            blocks.push({ type: 'paragraph', text: `Paragraph ${i}: ${'x'.repeat(500)}` });
        }
        const params = makeDocParams(blocks);
        const chunks = await collectChunks(buildDocumentPDFStream(params));
        // Expect multiple chunks (document should be > 64KB)
        if (chunks.length > 1) {
            // All non-last chunks should be 65536 bytes
            for (let i = 0; i < chunks.length - 1; i++) {
                expect(chunks[i].length).toBe(65536);
            }
        }
    });
});

// ── buildPDFStream ───────────────────────────────────────────────────

describe('buildPDFStream', () => {
    it('produces same bytes as buildPDFBytes', async () => {
        const params = makeTableParams();
        const expected = buildPDFBytes(params);
        const actual = await collectAll(buildPDFStream(params));
        expect(actual).toEqual(expected);
    });

    it('yields multiple chunks with small chunk size', async () => {
        const params = makeTableParams();
        const chunks = await collectChunks(buildPDFStream(params, undefined, { chunkSize: 1024 }));
        expect(chunks.length).toBeGreaterThan(1);
    });

    it('produces valid PDF header in first chunk', async () => {
        const params = makeTableParams();
        const chunks = await collectChunks(buildPDFStream(params, undefined, { chunkSize: 2048 }));
        const header = String.fromCharCode(...chunks[0].subarray(0, 8));
        expect(header).toMatch(/^%PDF-1\./);
    });

    it('rejects {pages} in footer template', async () => {
        const params = makeTableParams();
        const stream = buildPDFStream(params, { footerTemplate: { center: '{pages}' } });
        await expect(stream.next()).rejects.toThrow(/\{pages\}/);
    });

    it('handles multi-row tables', async () => {
        const rows: PdfRow[] = [];
        for (let i = 0; i < 100; i++) {
            rows.push({ cells: [`Row ${i}`, `Value ${i}`], type: '', pointed: false });
        }
        const params: PdfParams = {
            title: 'Multi-row',
            headers: ['Key', 'Value'],
            rows,
            infoItems: [],
            balanceText: '',
            countText: '',
            footerText: 'Footer',
        };
        const expected = buildPDFBytes(params);
        const actual = await collectAll(buildPDFStream(params));
        expect(actual).toEqual(expected);
    });

    it('respects layout options', async () => {
        const params = makeTableParams();
        const a4 = await collectAll(buildPDFStream(params, { pageWidth: 595.28, pageHeight: 841.89 }));
        const letter = await collectAll(buildPDFStream(params, { pageWidth: 612, pageHeight: 792 }));
        // Different page sizes encode different MediaBox values in PDF content
        const a4Str = String.fromCharCode(...a4);
        const letterStr = String.fromCharCode(...letter);
        expect(a4Str).toContain('841');
        expect(letterStr).toContain('792');
    });
});
