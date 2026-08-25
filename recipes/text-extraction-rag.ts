/**
 * Positioned text extraction for indexing pipelines (RAG, search). With
 * `includeRuns` each text-showing operation is returned with its
 * device-space origin and effective font size, alongside the
 * reading-order text per page.
 *
 * @task Extract reading-order text plus positioned runs from a document
 * @surface library
 * @since 1.6.0
 * @expect text of page 0 contains 'retrieval'
 * @expect runs.length > 0
 * @expect every run has numeric x, y and fontSize
 */
import { buildDocumentPDFBytes, extractText } from 'pdfnative';
import type { DocumentParams, ExtractedPageText } from 'pdfnative';

const params: DocumentParams = {
    title: 'Corpus notes',
    blocks: [
        { type: 'heading', text: 'Chunking strategy', level: 1 },
        { type: 'paragraph', text: 'Split documents into passages before retrieval; keep headings with their sections.' },
        { type: 'paragraph', text: 'Store the run positions so citations can point back into the page.' },
    ],
    footerText: 'Corpus notes',
};

export async function run(): Promise<{ bytes: Uint8Array; pages: readonly ExtractedPageText[] }> {
    const bytes = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });
    const pages = extractText(bytes, { includeRuns: true });
    return { bytes, pages };
}
