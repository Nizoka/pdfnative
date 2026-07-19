/**
 * Streaming page-tree variants (v1.6.0). Each streamed output must be
 * byte-identical to its buffered counterpart, and the sequential-consumption
 * contract of streamSplitPdf must be enforced.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import {
    mergePdfs, splitPdf, extractPages,
    streamMergedPdfs, streamExtractPages, streamSplitPdf,
} from '../../src/parser/pdf-pagetree.js';

function doc(title: string, n: number, extra?: Record<string, unknown>): Uint8Array {
    const blocks: Array<Record<string, unknown>> = [];
    for (let i = 0; i < n; i++) {
        blocks.push({ type: 'heading', text: `${title} page ${i + 1}`, level: 1 });
        blocks.push({ type: 'paragraph', text: `Body of ${title} page ${i + 1}.` });
        if (i < n - 1) blocks.push({ type: 'pageBreak' });
    }
    return buildDocumentPDFBytes({ title, blocks: blocks as never, ...(extra as object) });
}

async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const c of gen) { chunks.push(c); total += c.length; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

describe('streamMergedPdfs', () => {
    it('is byte-identical to mergePdfs', async () => {
        const sources = [doc('Alpha', 3), doc('Bravo', 2)];
        const streamed = await collect(streamMergedPdfs(sources));
        expect(streamed).toEqual(mergePdfs(sources));
    });

    it('honours a tiny chunk size and still reassembles identically', async () => {
        const sources = [doc('Gamma', 4)];
        const streamed = await collect(streamMergedPdfs(sources, { chunkSize: 1024 }));
        expect(streamed).toEqual(mergePdfs(sources));
    });

    it('rejects an empty source list', async () => {
        await expect(collect(streamMergedPdfs([]))).rejects.toThrow(/at least one/);
    });

    it('throws before emitting any chunk when maxOutputSize is exceeded', async () => {
        const gen = streamMergedPdfs([doc('Big', 3)], { maxOutputSize: 200 });
        await expect(gen.next()).rejects.toThrow(/maxOutputSize/);
    });

    it('decrypts an encrypted source and streams the merged result', async () => {
        const enc = doc('Secret', 1, { layout: { encryption: { ownerPassword: 'o' } } });
        const streamed = await collect(streamMergedPdfs([{ bytes: enc, password: 'o' }, doc('Plain', 1)]));
        const buffered = mergePdfs([{ bytes: enc, password: 'o' }, doc('Plain', 1)]);
        expect(streamed).toEqual(buffered);
    });
});

describe('streamExtractPages', () => {
    it('is byte-identical to extractPages', async () => {
        const src = doc('Doc', 5);
        const streamed = await collect(streamExtractPages(src, [4, 0, 2]));
        expect(streamed).toEqual(extractPages(src, [4, 0, 2]));
    });
});

describe('streamSplitPdf', () => {
    const src = doc('Split', 5);
    const ranges = [{ start: 0, end: 1 }, { start: 2, end: 4 }];

    it('yields per-range PDFs byte-identical to splitPdf', async () => {
        const buffered = splitPdf(src, ranges);
        const streamed: Uint8Array[] = [];
        for await (const part of streamSplitPdf(src, ranges)) {
            expect(part.index).toBe(streamed.length);
            streamed.push(await collect(part.pdf));
        }
        expect(streamed).toHaveLength(2);
        expect(streamed[0]).toEqual(buffered[0]);
        expect(streamed[1]).toEqual(buffered[1]);
    });

    it('throws if a range generator is not drained before advancing', async () => {
        const outer = streamSplitPdf(src, ranges);
        const first = await outer.next();
        expect(first.done).toBe(false);
        // Do NOT drain first.value.pdf — advancing must throw.
        await expect(outer.next()).rejects.toThrow(/drained/);
    });

    it('exposes the resolved range', async () => {
        const seen: Array<{ start: number; end: number }> = [];
        for await (const part of streamSplitPdf(src, [{ start: 1 }, { start: 3, end: 4 }])) {
            seen.push(part.range);
            await collect(part.pdf);
        }
        expect(seen).toEqual([{ start: 1, end: 1 }, { start: 3, end: 4 }]);
    });
});
