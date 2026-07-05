import { describe, it, expect } from 'vitest';
import {
    buildDocumentPDFBytes, buildDocumentPDFStreamTrue,
    buildPDFBytes, buildPDFStreamTrue,
} from '../../src/index.js';
import type { DocumentParams, PdfParams } from '../../src/index.js';

// Roadmap v1.5.0 — true constant-memory streaming must be byte-identical to the
// buffered builders (parity guard; also protects against the debug-overlay
// integration in assembleDocumentParts leaking into the default path).

async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const c of gen) chunks.push(c.slice());
    let n = 0; for (const c of chunks) n += c.length;
    const out = new Uint8Array(n); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

const doc: DocumentParams = {
    title: 'Stream Parity',
    blocks: [
        { type: 'heading', level: 1, text: 'Title' },
        { type: 'paragraph', text: 'Lorem ipsum '.repeat(50) },
        { type: 'table', headers: ['A', 'B'], rows: Array.from({ length: 40 }, (_, i) => ({ cells: [`r${i}`, `v${i}`], type: '', pointed: false })) },
    ],
};

const table: PdfParams = {
    title: 'T',
    infoItems: [{ label: 'Ref', value: '123' }],
    balanceText: '100.00',
    countText: '30 ops',
    footerText: 'footer',
    headers: ['X', 'Y'],
    rows: Array.from({ length: 30 }, (_, i) => ({ cells: [`${i}`, `${i * 2}`], type: '', pointed: false })),
};

describe('true-streaming byte parity', () => {
    it('buildDocumentPDFStreamTrue == buildDocumentPDFBytes', async () => {
        const buffered = buildDocumentPDFBytes(doc);
        const streamed = await collect(buildDocumentPDFStreamTrue(doc));
        expect(Buffer.from(streamed).equals(Buffer.from(buffered))).toBe(true);
    });

    it('buildPDFStreamTrue == buildPDFBytes', async () => {
        const buffered = buildPDFBytes(table);
        const streamed = await collect(buildPDFStreamTrue(table));
        expect(Buffer.from(streamed).equals(Buffer.from(buffered))).toBe(true);
    });

    it('emits multiple chunks for a small chunkSize', async () => {
        let count = 0;
        for await (const _ of buildDocumentPDFStreamTrue(doc, undefined, { chunkSize: 256 })) count++;
        expect(count).toBeGreaterThan(1);
    });
});
