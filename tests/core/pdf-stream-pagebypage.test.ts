/**
 * Tests for page-by-page (object-boundary) streaming output.
 */

import { describe, it, expect } from 'vitest';
import {
    buildDocumentPDFStreamPageByPage,
    buildPDFStreamPageByPage,
    buildDocumentPDFBytes,
    buildPDFBytes,
    concatChunks,
} from '../../src/index.js';
import type { DocumentParams, PdfParams, PdfRow } from '../../src/index.js';

async function collectChunks(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

function makeDocParams(): DocumentParams {
    return {
        title: 'Test PageByPage',
        blocks: [
            { type: 'heading', text: 'A', level: 1 },
            { type: 'paragraph', text: 'Lorem ipsum dolor sit amet.' },
            { type: 'paragraph', text: 'Lorem ipsum dolor sit amet.' },
            { type: 'paragraph', text: 'Lorem ipsum dolor sit amet.' },
        ],
    };
}

function makeTableParams(): PdfParams {
    const row: PdfRow = { cells: ['A', 'B'], type: '', pointed: false };
    return {
        title: 'T',
        headers: ['C1', 'C2'],
        rows: [row, row, row],
        infoItems: [],
        balanceText: '',
        countText: '',
        footerText: 'F',
    };
}

describe('buildDocumentPDFStreamPageByPage', () => {
    it('yields byte-identical output to buildDocumentPDFBytes', async () => {
        const params = makeDocParams();
        const expected = buildDocumentPDFBytes(params);
        const got = concatChunks(await collectChunks(buildDocumentPDFStreamPageByPage(params)));
        expect(got.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) expect(got[i]).toBe(expected[i]);
    });

    it('yields multiple chunks for a non-trivial document', async () => {
        const chunks = await collectChunks(buildDocumentPDFStreamPageByPage(makeDocParams()));
        expect(chunks.length).toBeGreaterThan(2);
    });

    it('first chunk contains the PDF header signature', async () => {
        const chunks = await collectChunks(buildDocumentPDFStreamPageByPage(makeDocParams()));
        const first = chunks[0];
        const head = String.fromCharCode(...first.slice(0, 8));
        expect(head.startsWith('%PDF-')).toBe(true);
    });

    it('most chunks end at object boundaries (endobj)', async () => {
        const chunks = await collectChunks(buildDocumentPDFStreamPageByPage(makeDocParams()));
        // The header chunk (1st) and trailer chunk (last) don't end with endobj;
        // all intermediate chunks must.
        for (let i = 1; i < chunks.length - 1; i++) {
            const tail = String.fromCharCode(...chunks[i].slice(-8));
            expect(tail).toContain('endobj');
        }
    });

    it('final chunk contains the xref/trailer/startxref', async () => {
        const chunks = await collectChunks(buildDocumentPDFStreamPageByPage(makeDocParams()));
        const last = chunks[chunks.length - 1];
        const tail = String.fromCharCode(...last);
        expect(tail).toContain('startxref');
        expect(tail).toContain('%%EOF');
    });

    it('throws on TOC blocks', async () => {
        const params: DocumentParams = {
            title: 'T',
            blocks: [{ type: 'toc', title: 'Contents' }],
        };
        await expect(async () => {
            for await (const _ of buildDocumentPDFStreamPageByPage(params)) { /* consume */ }
        }).rejects.toThrow(/TOC/);
    });
});

describe('buildPDFStreamPageByPage', () => {
    it('yields byte-identical output to buildPDFBytes', async () => {
        const params = makeTableParams();
        // Pin the date so both builds embed the same /CreationDate — without
        // this the comparison flakes when the two calls straddle a second
        // boundary (same pattern as pdf-stream-true.test.ts).
        const layout = { creationDate: new Date('2026-01-01T00:00:00.000Z') };
        const expected = buildPDFBytes(params, layout);
        const got = concatChunks(await collectChunks(buildPDFStreamPageByPage(params, layout)));
        expect(got.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) expect(got[i]).toBe(expected[i]);
    });

    it('yields multiple chunks for table output', async () => {
        const chunks = await collectChunks(buildPDFStreamPageByPage(makeTableParams()));
        expect(chunks.length).toBeGreaterThan(2);
    });
});
