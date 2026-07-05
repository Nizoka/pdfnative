/**
 * Layout debug overlay + inspection showcase (v1.5.0).
 *
 * Renders the same document twice — once clean, once with the opt-in visual
 * overlay (`layout: { debug: true }`) drawing margin / content / cell boxes —
 * and appends a page listing the programmatic `inspectDocumentLayout()` block
 * geometry. The overlay is byte-neutral: with debug off, output is identical to
 * previous releases.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, inspectDocumentLayout } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

const blocks: DocumentParams['blocks'] = [
    { type: 'heading', text: 'Quarterly report', level: 1 },
    { type: 'paragraph', text: 'This document is rendered with the layout debug overlay so you can see exactly where each block lands.' },
    {
        type: 'table',
        headers: ['Item', 'Amount'],
        rows: [
            { cells: ['Revenue', '120,000'], type: 'credit', pointed: false },
            { cells: ['Costs', '80,000'], type: 'debit', pointed: false },
            { cells: ['Profit', '40,000'], type: 'credit', pointed: false },
        ],
        columns: [{ f: 0.6, a: 'l', mx: 40, mxH: 40 }, { f: 0.4, a: 'r', mx: 20, mxH: 20 }],
    },
    { type: 'paragraph', text: 'Turn the overlay off (or omit debug) and the bytes are identical to a normal render.' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    const params: DocumentParams = { title: 'Layout debug overlay (v1.5.0)', blocks };

    // Clean render (no overlay).
    ctx.writeSafe(
        resolve(ctx.outputDir, 'debug', 'layout-clean.pdf'),
        'debug/layout-clean.pdf',
        buildDocumentPDFBytes(params),
    );

    // Overlay: margins + content bounds + table cells.
    ctx.writeSafe(
        resolve(ctx.outputDir, 'debug', 'layout-overlay.pdf'),
        'debug/layout-overlay.pdf',
        buildDocumentPDFBytes(params, { debug: true }),
    );

    // Programmatic inspection → render the geometry into a report PDF.
    const report = inspectDocumentLayout(params);
    const rows = report.pages.flatMap((page) =>
        page.blocks.map((b) => ({
            cells: [String(page.index + 1), b.type, `${Math.round(b.x)}`, `${Math.round(b.top)}`, `${Math.round(b.width)}×${Math.round(b.height)}`],
            type: '',
            pointed: false,
        })),
    );
    const inspectParams: DocumentParams = {
        title: 'inspectDocumentLayout() report',
        blocks: [
            { type: 'heading', text: 'Block geometry', level: 1 },
            { type: 'paragraph', text: `${report.totalPages} page(s), ${report.pageWidth}×${report.pageHeight} pt.` },
            {
                type: 'table',
                headers: ['Page', 'Type', 'X', 'Top', 'W×H'],
                rows,
                columns: [
                    { f: 0.12, a: 'l', mx: 8, mxH: 8 },
                    { f: 0.32, a: 'l', mx: 20, mxH: 20 },
                    { f: 0.14, a: 'r', mx: 8, mxH: 8 },
                    { f: 0.14, a: 'r', mx: 8, mxH: 8 },
                    { f: 0.28, a: 'r', mx: 16, mxH: 16 },
                ],
            },
        ],
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'debug', 'layout-inspection.pdf'),
        'debug/layout-inspection.pdf',
        buildDocumentPDFBytes(inspectParams),
    );
}
