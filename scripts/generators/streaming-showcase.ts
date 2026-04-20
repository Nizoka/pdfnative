/**
 * Streaming output showcase — progressive PDF chunk emission.
 */

import { resolve } from 'path';
import { buildDocumentPDFStream, buildPDFStream, concatChunks } from '../../src/index.js';
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
}
