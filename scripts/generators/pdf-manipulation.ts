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
    streamMergedPdfs, streamSplitPdf,
    streamToFile, buildDocumentPDFStreamTrue,
    openPdf,
} from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const c of gen) { chunks.push(c); total += c.length; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

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

    // ── merge an ENCRYPTED source with a plain one (v1.6.0 decryptor) ──
    const secret = buildDocumentPDFBytes({
        title: 'Confidential Appendix',
        blocks: [
            { type: 'heading', text: 'Confidential Appendix', level: 1 },
            { type: 'paragraph', text: 'This source was AES-256 encrypted and decrypted on ingest.' },
        ],
    }, { encryption: { ownerPassword: 'boardroom', algorithm: 'aes256' } });
    const mergedSecure = mergePdfs([reportA, { bytes: secret, password: 'boardroom' }]);
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'merged-with-encrypted.pdf'),
        'manipulation/merged-with-encrypted.pdf',
        mergedSecure,
    );

    // ── RE-ENCRYPT the merged output (v1.6.0 MergeOptions.encrypt) ────
    // Full encrypted round trip: decrypt an AES-256 source on ingest, then
    // protect the rebuilt document with fresh AES-256 passwords.
    // Open with user password "pdfnative" (owner: "pdfnative-owner").
    const mergedReEncrypted = mergePdfs(
        [reportA, { bytes: secret, password: 'boardroom' }],
        { encrypt: { ownerPassword: 'pdfnative-owner', userPassword: 'pdfnative', algorithm: 'aes256' } },
    );
    ctx.writeSafe(
        resolve(ctx.outputDir, 'manipulation', 'merged-reencrypted.pdf'),
        'manipulation/merged-reencrypted.pdf',
        mergedReEncrypted,
    );

    // ── streaming merge (constant memory) written straight to disk ────
    const streamMergePath = resolve(ctx.outputDir, 'manipulation', 'stream-merged.pdf');
    await streamToFile(streamMergedPdfs([reportA, invoice]), streamMergePath);
    const streamMergedBytes = readFileSync(streamMergePath);
    ctx.results.push({
        file: 'manipulation/stream-merged.pdf',
        size: streamMergedBytes.length,
        pages: openPdf(streamMergedBytes).pageCount,
    });

    // ── streaming split: one file per range ───────────────────────────
    let idx = 0;
    for await (const part of streamSplitPdf(merged, [{ start: 0, end: 2 }, { start: 3, end: 4 }])) {
        const bytes = await collect(part.pdf);
        ctx.writeSafe(
            resolve(ctx.outputDir, 'manipulation', `stream-split-${idx}.pdf`),
            `manipulation/stream-split-${idx}.pdf`,
            bytes,
        );
        idx++;
    }

    // ── streaming split WITH re-encryption (v1.6.0) ───────────────────
    // Each emitted range is AES-128 protected (user password "pdfnative").
    let encIdx = 0;
    for await (const part of streamSplitPdf(merged, [{ start: 0, end: 1 }], {
        encrypt: { ownerPassword: 'pdfnative-owner', userPassword: 'pdfnative', algorithm: 'aes128' },
    })) {
        const bytes = await collect(part.pdf);
        ctx.writeSafe(
            resolve(ctx.outputDir, 'manipulation', `stream-split-encrypted-${encIdx}.pdf`),
            `manipulation/stream-split-encrypted-${encIdx}.pdf`,
            bytes,
        );
        encIdx++;
    }
}
