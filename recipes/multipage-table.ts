/**
 * A table long enough to paginate. `repeatHeader` (the default, stated
 * here explicitly) re-draws the header row on every continuation page,
 * which the extracted text of page 1 confirms.
 *
 * @task Paginate a long table with the header row repeated on every page
 * @surface library
 * @since 1.6.0
 * @expect pages === 2
 * @expect text of page 1 contains 'Description'
 */
import { buildDocumentPDFBytes, openPdf, extractText } from 'pdfnative';
import type { DocumentParams, PdfRow } from 'pdfnative';

const rows: PdfRow[] = Array.from({ length: 70 }, (_, i) => ({
    cells: [`2026-06-${String((i % 28) + 1).padStart(2, '0')}`, `Ledger entry ${i + 1}`, (100 + i).toFixed(2)],
    type: i % 2 === 0 ? 'credit' : 'debit',
    pointed: false,
}));

const params: DocumentParams = {
    title: 'June ledger',
    blocks: [
        {
            type: 'table',
            headers: ['Date', 'Description', 'Amount'],
            rows,
            repeatHeader: true,
        },
    ],
    footerText: 'June ledger',
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number; page1Text: string }> {
    const bytes = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });
    const pages = openPdf(bytes).pageCount;
    const page1Text = extractText(bytes, { pages: [1] })[0].text;
    return { bytes, pages, page1Text };
}
