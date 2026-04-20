/**
 * Header/footer template sample PDFs — PageTemplate zones + placeholders.
 */

import { resolve } from 'path';
import { buildPDFBytes, buildDocumentPDFBytes } from '../../src/index.js';
import type { PdfParams, DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const baseRows = Array.from({ length: 50 }, (_, i) => ({
        cells: [
            `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
            `Transaction #${i + 1} – Recurring monthly payment`,
            i % 3 === 0 ? `${(50 + i * 3).toFixed(2)}` : '',
            i % 3 !== 0 ? `${(200 + i * 5).toFixed(2)}` : '',
            `${(10000 + (i % 2 === 0 ? 1 : -1) * i * 15).toFixed(2)}`,
        ],
        type: i % 3 === 0 ? 'debit' : 'credit',
        pointed: i === 0,
    }));

    const baseParams: PdfParams = {
        title: 'Header & Footer Template Sample',
        infoItems: [
            { label: 'Account', value: 'Main Business Account' },
            { label: 'Period', value: 'Q1 2026' },
        ],
        balanceText: '€ 10,000.00',
        countText: '50 operations',
        headers: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
        rows: baseRows,
        footerText: 'pdfnative – Header/Footer template',
    };

    // ── Full template (all 3 zones + all placeholders) ───────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'headers', 'header-footer-full.pdf'),
        'headers/header-footer-full.pdf',
        buildPDFBytes(baseParams, {
            headerTemplate: { left: '{title}', center: 'Q1 2026 – Financial Report', right: '{date}' },
            footerTemplate: { left: 'Confidential', center: 'pdfnative v1.0', right: 'Page {page} of {pages}' },
        }),
    );

    // ── Center-only header + right-only footer ───────────────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'headers', 'header-footer-minimal.pdf'),
        'headers/header-footer-minimal.pdf',
        buildPDFBytes(baseParams, {
            headerTemplate: { center: '{title}' },
            footerTemplate: { right: '{page}/{pages}' },
        }),
    );

    // ── Document builder with templates ──────────────────────────
    {
        const docParams: DocumentParams = {
            title: 'Technical Report 2026',
            blocks: [
                { type: 'heading', text: 'Introduction', level: 1 },
                { type: 'paragraph', text: 'This report demonstrates the header and footer template system. Templates support three zones (left, center, right) and four placeholder variables: {page}, {pages}, {date}, and {title}.' },
                { type: 'heading', text: 'Template Variables', level: 2 },
                { type: 'table', headers: ['Placeholder', 'Description', 'Example Output'], rows: [
                    { cells: ['{page}', 'Current page number', '1'], type: 'credit', pointed: false },
                    { cells: ['{pages}', 'Total page count', '3'], type: 'credit', pointed: false },
                    { cells: ['{date}', 'Generation date (YYYY-MM-DD)', '2026-04-12'], type: 'credit', pointed: false },
                    { cells: ['{title}', 'Document title', 'Technical Report 2026'], type: 'credit', pointed: true },
                ]},
                { type: 'heading', text: 'Multi-Page Content', level: 2 },
                { type: 'paragraph', text: 'The following list demonstrates that headers and footers are consistently rendered on every page. Each item adds enough vertical space to verify pagination.' },
                { type: 'list', items: Array.from({ length: 40 }, (_, i) => `Item ${i + 1}: Verify header/footer on this page`), style: 'numbered' },
                { type: 'heading', text: 'Conclusion', level: 1 },
                { type: 'paragraph', text: 'Headers and footers provide consistent branding and navigation across all pages of a document. The template system is fully backward compatible with the existing footerText option.' },
            ],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'headers', 'header-footer-doc.pdf'),
            'headers/header-footer-doc.pdf',
            buildDocumentPDFBytes(docParams, {
                headerTemplate: { left: 'Technical Report', center: '{title}', right: '{date}' },
                footerTemplate: { left: '© 2026 pdfnative', right: 'Page {page} of {pages}' },
            }),
        );
    }

    // ── Custom font size + tagged PDF/A with templates ───────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'headers', 'header-footer-tagged.pdf'),
        'headers/header-footer-tagged.pdf',
        buildPDFBytes(baseParams, {
            tagged: true,
            headerTemplate: { left: '{title}', right: 'PDF/A-2b Compliant' },
            footerTemplate: { left: '{date}', center: 'ISO 19005-2', right: 'Page {page} of {pages}' },
        }),
    );
}
