/**
 * Dry-run layout inspection: `inspectDocumentLayout` reports how the
 * builder will paginate and place each block — page index, x, top, width,
 * height — without rendering a PDF. Useful for layout assertions and
 * tooling.
 *
 * @task Preview pagination and block geometry without rendering a PDF
 * @surface library
 * @since 1.5.0
 * @expect totalPages === 2
 * @expect first block type === 'heading' on page 0 with width > 0
 */
import { inspectDocumentLayout } from 'pdfnative';
import type { DocumentParams, LayoutInspection } from 'pdfnative';

const params: DocumentParams = {
    title: 'Layout probe',
    blocks: [
        { type: 'heading', text: 'Section one', level: 1 },
        { type: 'paragraph', text: 'A paragraph measured, not rendered.' },
        { type: 'pageBreak' },
        { type: 'heading', text: 'Section two', level: 1 },
        { type: 'paragraph', text: 'Placed on the second page.' },
    ],
    footerText: 'Layout probe',
};

export async function run(): Promise<{ inspection: LayoutInspection }> {
    const inspection = inspectDocumentLayout(params);
    return { inspection };
}
