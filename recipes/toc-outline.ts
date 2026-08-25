/**
 * Table of contents and bookmarks together: a `toc` block renders linked
 * entries for every heading, while `outline: 'auto'` derives the viewer's
 * bookmark panel from the same headings and adds /Outlines to the catalog.
 *
 * @task Generate a linked table of contents plus automatic bookmarks
 * @surface library
 * @since 1.6.0
 * @expect pages === 3
 * @expect catalog has /Outlines
 * @expect text of page 0 contains 'Table of Contents'
 */
import { buildDocumentPDFBytes, openPdf, extractText } from 'pdfnative';
import type { DocumentParams } from 'pdfnative';

const params: DocumentParams = {
    title: 'Operations handbook',
    blocks: [
        { type: 'toc', maxLevel: 2 },
        { type: 'pageBreak' },
        { type: 'heading', text: 'Onboarding', level: 1 },
        { type: 'paragraph', text: 'Accounts, hardware and access requests.' },
        { type: 'heading', text: 'First week', level: 2 },
        { type: 'paragraph', text: 'Pairing schedule and reading list.' },
        { type: 'pageBreak' },
        { type: 'heading', text: 'Incident response', level: 1 },
        { type: 'paragraph', text: 'Escalation ladder and post-incident review.' },
    ],
    footerText: 'Operations handbook',
    outline: 'auto',
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number; hasOutlines: boolean; tocText: string }> {
    const bytes = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });
    const reader = openPdf(bytes);
    const hasOutlines = reader.getCatalog().get('Outlines') !== undefined;
    const tocText = extractText(bytes, { pages: [0] })[0].text;
    return { bytes, pages: reader.pageCount, hasOutlines, tocText };
}
