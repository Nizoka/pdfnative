/**
 * Page-tree manipulation + streamToFile showcase (v1.4.0).
 *
 * Demonstrates:
 *   - mergePdfs()   — concatenate documents.
 *   - splitPdf()    — slice a document into page ranges.
 *   - extractPages()— pull a reordered subset of pages.
 *   - streamToFile()— write a streaming builder straight to disk.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    buildDocumentPDFBytes,
    mergePdfs, splitPdf, extractPages,
    streamToFile, buildDocumentPDFStreamTrue,
    openPdf,
} from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function doc(title: string, sections: number): Uint8Array {
    const blocks: DocumentBlock[] = [];
    for (let i = 1; i <= sections; i++) {
        blocks.push({ type: 'heading', text: `${title} — Section ${i}`, level: 1 });
        blocks.push({ type: 'paragraph', text: `This is page ${i} of the “${title}” document.` });
        if (i < sections) blocks.push({ type: 'pageBreak' });
    }
    const params: DocumentParams = { title, blocks };
    return buildDocumentPDFBytes(params);
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const reportA = doc('Quarterly Report', 3);
    const invoice = doc('Invoice', 2);

    // ── merge ────────────────────────────────────────────────────
    const merged = mergePdfs([reportA, invoice]);
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'merged.pdf'),
        'manipulation/merged.pdf',
        merged,
    );

    // ── split the merged document back into its parts ────────────
    const [part1, part2] = splitPdf(merged, [
        { start: 0, end: 2 }, // the 3-page report
        { start: 3, end: 4 }, // the 2-page invoice
    ]);
    ctx.writeSafe(resolve(ctx.outputDir, 'manipulation', 'split-report.pdf'), 'manipulation/split-report.pdf', part1);
    ctx.writeSafe(resolve(ctx.outputDir, 'manipulation', 'split-invoice.pdf'), 'manipulation/split-invoice.pdf', part2);

    // ── extract a reordered subset (last, first, middle) ─────────
    const extracted = extractPages(merged, [4, 0, 2]);
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'extract-reordered.pdf'),
        'manipulation/extract-reordered.pdf',
        extracted,
    );

    // ── streamToFile: write a streaming builder straight to disk ──
    const streamedPath = resolve(ctx.outputDir, 'manipulation', 'streamed.pdf');
    const params: DocumentParams = {
        title: 'Streamed To File',
        blocks: [
            { type: 'heading', text: 'Constant-memory streaming', level: 1 },
            { type: 'paragraph', text: 'This file was written via streamToFile() without buffering the whole PDF in memory.' },
        ],
    };
    await streamToFile(buildDocumentPDFStreamTrue(params), streamedPath);
    // Register the on-disk result in the report (re-read; no second build).
    const streamedBytes = readFileSync(streamedPath);
    ctx.results.push({
        file: 'manipulation/streamed.pdf',
        size: streamedBytes.length,
        pages: openPdf(streamedBytes).pageCount,
    });
}
