/**
 * Streaming output showcase — progressive PDF chunk emission.
 */

import { resolve } from 'path';
import { buildDocumentPDFStream, buildPDFStream, buildDocumentPDFStreamTrue, buildPDFStreamTrue, concatChunks } from '../../src/index.js';
import type { DocumentParams, PdfParams, PdfRow } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── Streamed document PDF ────────────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Streaming Output Demo',
            blocks: [
                { type: 'heading', text: 'Streaming PDF Generation', level: 1 },
                { type: 'paragraph', text: 'This PDF was generated using buildDocumentPDFStream(), which yields Uint8Array chunks progressively instead of returning the entire PDF at once.' },

                { type: 'heading', text: 'Benefits', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'Reduced peak memory — avoids allocating the full PDF as a single Uint8Array',
                    'Progressive writing — chunks can be piped directly to file or network streams',
                    'Backpressure — async iteration naturally supports consumer-controlled flow',
                ] },

                { type: 'heading', text: 'Constraints', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'TOC blocks are not supported (require multi-pass pagination)',
                    '{pages} placeholder is not supported (total page count unknown during emission)',
                ] },

                { type: 'heading', text: 'Example Usage', level: 2 },
                { type: 'paragraph', text: 'const stream = buildDocumentPDFStream(params);' },
                { type: 'paragraph', text: 'for await (const chunk of stream) { file.write(chunk); }' },
                { type: 'paragraph', text: 'file.end();' },

                { type: 'heading', text: 'Chunk Details', level: 2 },
                { type: 'paragraph', text: 'Default chunk size: 64 KB. Configurable via StreamOptions.chunkSize (min 1 KB, max 16 MB).' },
            ],
        };

        const chunks: Uint8Array[] = [];
        for await (const chunk of buildDocumentPDFStream(params)) {
            chunks.push(chunk);
        }
        const bytes = concatChunks(chunks);
        ctx.writeSafe(resolve(ctx.outputDir, 'streaming', 'streaming-document.pdf'), 'streaming/streaming-document.pdf', bytes);
    }

    // ── Streamed table PDF ───────────────────────────────────────
    {
        const rows: PdfRow[] = [];
        for (let i = 1; i <= 200; i++) {
            rows.push({ cells: [`Item ${i}`, `Description for item ${i}`, `$${(i * 9.99).toFixed(2)}`], type: i % 2 === 0 ? '' : 'credit', pointed: i === 1 });
        }

        const params: PdfParams = {
            title: 'Streaming Table Output',
            headers: ['Item', 'Description', 'Price'],
            rows,
            infoItems: [{ label: 'Generated', value: 'via buildPDFStream()' }],
            balanceText: '',
            countText: `${rows.length} items`,
            footerText: 'Streamed progressively in 64 KB chunks',
        };

        const chunks: Uint8Array[] = [];
        for await (const chunk of buildPDFStream(params)) {
            chunks.push(chunk);
        }
        const bytes = concatChunks(chunks);
        ctx.writeSafe(resolve(ctx.outputDir, 'streaming', 'streaming-table.pdf'), 'streaming/streaming-table.pdf', bytes);
    }

    // ── True constant-memory streaming (v1.3.0) ──────────────────
    // buildDocumentPDFStreamTrue / buildPDFStreamTrue assemble the document as
    // an array of string parts and yield byte-chunks from it, freeing each part
    // as it is emitted — the full binary never co-exists in memory. Output is
    // byte-identical to the corresponding *Bytes builder.
    {
        const params: DocumentParams = {
            title: 'True Streaming (v1.3.0)',
            blocks: [
                { type: 'heading', text: 'Constant-Memory Streaming', level: 1 },
                { type: 'paragraph', text: 'buildDocumentPDFStreamTrue() yields the PDF as Uint8Array chunks while releasing each assembled part as it is written, so peak memory stays bounded regardless of document size. The bytes are identical to buildDocumentPDFBytes().' },
                { type: 'heading', text: 'When to use it', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'Very large reports piped to a file or HTTP response',
                    'Memory-constrained environments (serverless, edge runtimes)',
                    'Any case where holding the whole PDF in RAM is wasteful',
                ] },
            ],
        };
        const chunks: Uint8Array[] = [];
        for await (const chunk of buildDocumentPDFStreamTrue(params)) chunks.push(chunk);
        ctx.writeSafe(resolve(ctx.outputDir, 'streaming', 'streaming-true-document.pdf'), 'streaming/streaming-true-document.pdf', concatChunks(chunks));
    }

    {
        const rows: PdfRow[] = [];
        for (let i = 1; i <= 400; i++) {
            rows.push({ cells: [`Row ${i}`, `True-streamed entry ${i}`, `$${(i * 3.5).toFixed(2)}`], type: i % 2 === 0 ? '' : 'credit', pointed: false });
        }
        const params: PdfParams = {
            title: 'True Streaming Table',
            headers: ['Row', 'Detail', 'Amount'],
            rows,
            infoItems: [{ label: 'Mode', value: 'buildPDFStreamTrue()' }],
            balanceText: '',
            countText: `${rows.length} rows`,
            footerText: 'Emitted via buildPDFStreamTrue() — constant peak memory',
        };
        const chunks: Uint8Array[] = [];
        for await (const chunk of buildPDFStreamTrue(params)) chunks.push(chunk);
        ctx.writeSafe(resolve(ctx.outputDir, 'streaming', 'streaming-true-table.pdf'), 'streaming/streaming-true-table.pdf', concatChunks(chunks));
    }
}
