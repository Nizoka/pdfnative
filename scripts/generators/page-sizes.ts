/**
 * Page size sample PDFs — demonstrates all standard page sizes from PAGE_SIZES.
 */

import { resolve } from 'path';
import { buildPDFBytes, buildDocumentPDFBytes, PAGE_SIZES } from '../../src/index.js';
import type { PdfParams, DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const sizes = ['A4', 'Letter', 'Legal', 'A3', 'Tabloid'] as const;

    const makeRows = (count: number) =>
        Array.from({ length: count }, (_, i) => ({
            cells: [
                `Row ${i + 1}`,
                `Item description for row ${i + 1}`,
                `${(100 + i * 25).toFixed(2)}`,
                `${(i * 3).toFixed(2)}%`,
            ],
            type: i % 2 === 0 ? 'debit' : 'credit',
            pointed: i === 0,
        }));

    // ── Each standard size via table builder ─────────────────────
    for (const sizeName of sizes) {
        const size = PAGE_SIZES[sizeName];
        const params: PdfParams = {
            title: `Page Size: ${sizeName} (${size.width} × ${size.height} pt)`,
            infoItems: [
                { label: 'Format', value: sizeName },
                { label: 'Width', value: `${size.width} pt (${(size.width / 72).toFixed(2)} in)` },
                { label: 'Height', value: `${size.height} pt (${(size.height / 72).toFixed(2)} in)` },
            ],
            balanceText: `${sizeName} format`,
            countText: '30 rows',
            headers: ['#', 'Description', 'Amount', 'Rate'],
            rows: makeRows(30),
            footerText: `pdfnative – ${sizeName} page size sample`,
        };
        const filename = `page-size-${sizeName.toLowerCase()}.pdf`;
        ctx.writeSafe(
            resolve(ctx.outputDir, 'page-sizes', filename),
            `page-sizes/${filename}`,
            buildPDFBytes(params, {
                pageWidth: size.width,
                pageHeight: size.height,
            }),
        );
    }

    // ── Document builder with A3 landscape (rotated) ─────────────
    {
        const docParams: DocumentParams = {
            title: 'Page Size Comparison – Document Builder',
            blocks: [
                { type: 'heading', text: 'A3 Landscape Document', level: 1 },
                { type: 'paragraph', text: 'This document uses A3 dimensions in landscape orientation (1190.55 × 841.89 pt). The wider format is suitable for wide tables, charts, and dashboards.' },
                { type: 'table', headers: ['Month', 'Revenue', 'Expenses', 'Net', 'Growth', 'Margin'], rows: [
                    { cells: ['January', '$120,000', '$85,000', '$35,000', '+5%', '29.2%'], type: 'credit', pointed: false },
                    { cells: ['February', '$135,000', '$90,000', '$45,000', '+12.5%', '33.3%'], type: 'credit', pointed: false },
                    { cells: ['March', '$128,000', '$92,000', '$36,000', '-5.2%', '28.1%'], type: 'debit', pointed: true },
                    { cells: ['April', '$142,000', '$88,000', '$54,000', '+10.9%', '38.0%'], type: 'credit', pointed: false },
                    { cells: ['May', '$155,000', '$95,000', '$60,000', '+9.2%', '38.7%'], type: 'credit', pointed: false },
                    { cells: ['June', '$148,000', '$91,000', '$57,000', '-4.5%', '38.5%'], type: 'credit', pointed: false },
                ]},
                { type: 'paragraph', text: 'Wide formats benefit from extended column layouts. The document builder automatically adjusts content width to the page dimensions.' },
            ],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'page-sizes', 'page-size-a3-landscape.pdf'),
            'page-sizes/page-size-a3-landscape.pdf',
            buildDocumentPDFBytes(docParams, {
                pageWidth: PAGE_SIZES.A3.height,
                pageHeight: PAGE_SIZES.A3.width,
            }),
        );
    }
}
