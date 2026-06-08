/**
 * Tests for true constant-memory streaming output (parts-progressive).
 *
 * The `*StreamTrue` generators assemble the PDF into its raw parts and yield
 * fixed-size byte chunks while freeing each part, so the fully-joined PDF
 * binary never materialises. Output must be byte-identical to the buffered
 * builders.
 */

import { describe, it, expect } from 'vitest';
import {
    buildDocumentPDFStreamTrue,
    buildPDFStreamTrue,
    buildDocumentPDFBytes,
    buildPDFBytes,
    concatChunks,
} from '../../src/index.js';
import type { DocumentParams, DocumentBlock, PdfParams, PdfRow } from '../../src/index.js';

async function collectChunks(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

function makeDocParams(): DocumentParams {
    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Streaming', level: 1 },
    ];
    for (let i = 0; i < 60; i++) {
        blocks.push({ type: 'paragraph', text: `Paragraph ${i} — lorem ipsum dolor sit amet consectetur.` });
    }
    return { title: 'True Stream Doc', blocks };
}

function makeTableParams(): PdfParams {
    const rows: PdfRow[] = [];
    for (let i = 0; i < 200; i++) {
        rows.push({ cells: [`R${i}`, `Value ${i}`], type: '', pointed: false });
    }
    return {
        title: 'True Stream Table',
        headers: ['Col A', 'Col B'],
        rows,
        infoItems: [],
        balanceText: '',
        countText: '',
        footerText: 'Footer',
    };
}

/** Fixed date so both calls in byte-identity tests produce the same timestamp. */
const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

describe('buildDocumentPDFStreamTrue', () => {
    it('yields byte-identical output to buildDocumentPDFBytes', async () => {
        const params = makeDocParams();
        const layout = { creationDate: FIXED_DATE };
        const expected = buildDocumentPDFBytes(params, layout);
        const got = concatChunks(await collectChunks(buildDocumentPDFStreamTrue(params, layout)));
        expect(got.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) expect(got[i]).toBe(expected[i]);
    });

    it('respects a small custom chunk size', async () => {
        const params = makeDocParams();
        const chunks = await collectChunks(buildDocumentPDFStreamTrue(params, undefined, { chunkSize: 1024 }));
        // All but the last chunk must be exactly chunkSize.
        for (let i = 0; i < chunks.length - 1; i++) {
            expect(chunks[i].length).toBe(1024);
        }
        expect(chunks[chunks.length - 1].length).toBeLessThanOrEqual(1024);
        expect(chunks.length).toBeGreaterThan(1);
    });

    it('first bytes are the PDF header signature', async () => {
        const chunks = await collectChunks(buildDocumentPDFStreamTrue(makeDocParams()));
        const head = String.fromCharCode(...chunks[0].slice(0, 5));
        expect(head).toBe('%PDF-');
    });

    it('rejects TOC blocks (multi-pass pagination)', async () => {
        const params: DocumentParams = {
            title: 'X',
            blocks: [{ type: 'toc' }],
        };
        await expect(collectChunks(buildDocumentPDFStreamTrue(params))).rejects.toThrow(/TOC/);
    });

    it('rejects {pages} placeholder in templates', async () => {
        const params = makeDocParams();
        await expect(
            collectChunks(
                buildDocumentPDFStreamTrue(params, {
                    footerTemplate: { center: 'Page {page} of {pages}' },
                }),
            ),
        ).rejects.toThrow(/\{pages\}/);
    });
});

describe('buildPDFStreamTrue', () => {
    it('yields byte-identical output to buildPDFBytes', async () => {
        const params = makeTableParams();
        const layout = { creationDate: FIXED_DATE };
        const expected = buildPDFBytes(params, layout);
        const got = concatChunks(await collectChunks(buildPDFStreamTrue(params, layout)));
        expect(got.length).toBe(expected.length);
        for (let i = 0; i < expected.length; i++) expect(got[i]).toBe(expected[i]);
    });

    it('produces a valid PDF trailer at the end', async () => {
        const got = concatChunks(await collectChunks(buildPDFStreamTrue(makeTableParams())));
        const tail = String.fromCharCode(...got.slice(got.length - 6));
        expect(tail).toContain('%%EOF');
    });
});
