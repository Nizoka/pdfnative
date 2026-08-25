/**
 * Invoice as tagged PDF/A-2b — an itemised table with an embedded Latin
 * font, so the archival claim survives validation. The creation date is
 * pinned to keep the output byte-identical across runs.
 *
 * @task Build a PDF/A-2b invoice with an itemised line-item table
 * @surface library
 * @since 1.6.0
 * @expect pages === 1
 * @expect text of page 0 contains 'Invoice'
 * @expect pdfA claim === 'pdfa2b'
 */
import { buildDocumentPDFBytes, openPdf, extractText } from 'pdfnative';
import type { DocumentParams, FontData, FontEntry } from 'pdfnative';
import * as notoSans from 'pdfnative/fonts/noto-sans-data.js';

// PDF/A requires every rendered glyph to come from an embedded font
// (ISO 19005 §6.2.11.4.1); the bundled Noto Sans data module covers Latin.
// /F1 and /F2 are reserved by the engine — custom fontRefs start at /F3.
const latinFont: FontEntry = {
    fontRef: '/F3',
    lang: 'latin',
    fontData: notoSans as unknown as FontData,
};

const params: DocumentParams = {
    title: 'Invoice INV-2026-0042',
    blocks: [
        { type: 'paragraph', text: 'Billed to: Acme Widgets Ltd, 4 Foundry Lane, Sheffield' },
        { type: 'spacer', height: 8 },
        {
            type: 'table',
            caption: 'Line items',
            headers: ['Item', 'Quantity', 'Unit price', 'Total'],
            rows: [
                { cells: ['Consultancy (June)', '3 days', '650.00', '1,950.00'], type: 'debit', pointed: false },
                { cells: ['Managed hosting', '1 month', '120.00', '120.00'], type: 'debit', pointed: false },
                { cells: ['Support retainer', '1 month', '250.00', '250.00'], type: 'debit', pointed: false },
            ],
        },
        { type: 'spacer', height: 8 },
        { type: 'paragraph', text: 'Total due: 2,320.00 GBP within 30 days.', align: 'right' },
    ],
    footerText: 'Registered in England no. 01234567',
    fontEntries: [latinFont],
    metadata: { author: 'Accounts', subject: 'Invoice INV-2026-0042' },
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number; text: string }> {
    const bytes = buildDocumentPDFBytes(params, {
        tagged: 'pdfa2b',
        creationDate: new Date('2026-08-25T00:00:00Z'),
    });
    const pages = openPdf(bytes).pageCount;
    const text = extractText(bytes, { pages: [0] })[0].text;
    return { bytes, pages, text };
}
