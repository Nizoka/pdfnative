/**
 * Add a clickable link to an existing PDF without rewriting it: open the
 * document, build a `/Link` annotation with a `/URI` action (the URL goes
 * through the builder's allow-list — `javascript:`, `file:` and `data:` are
 * refused) and append it as an incremental update, so every earlier byte,
 * and any signature over them, stays intact.
 *
 * @task Add a URL link annotation to an existing PDF as an incremental update
 * @surface library
 * @since 1.9.0
 * @expect pdf contains '/Subtype /Link'
 * @expect pdf contains '/URI (https://pdfnative.dev)'
 * @expect the update keeps the original bytes as its prefix
 */
import { buildAnnotationBody, buildDocumentPDFBytes, createModifier, openPdf } from 'pdfnative';

export async function run(): Promise<{ original: Uint8Array; bytes: Uint8Array }> {
    const original = buildDocumentPDFBytes(
        {
            title: 'Release notes',
            blocks: [
                { type: 'heading', text: 'Release notes', level: 1 },
                { type: 'paragraph', text: 'The full changelog is on pdfnative.dev.' },
            ],
        },
        { creationDate: new Date('2026-10-23T00:00:00Z') },
    );

    const modifier = createModifier(openPdf(original));
    // Rect in PDF user space (points, origin bottom-left): a strip over the second line of text.
    modifier.addAnnotation(0, buildAnnotationBody({
        type: 'link',
        rect: [36, 700, 300, 716],
        url: 'https://pdfnative.dev',
        contents: 'Open the changelog',
    }));
    return { original, bytes: modifier.save() };
}
