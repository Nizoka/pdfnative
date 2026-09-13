/**
 * Typeset a long report: paragraphs break across pages at line boundaries
 * under widow and orphan rules, headings stay with the text they introduce,
 * body text is justified, and "150 €" or "12 kg" never split across a line.
 * The same content laid out atomically is built alongside, to show that
 * breaking inside paragraphs never needs more pages.
 *
 * @task Typeset a long report with paragraph breaking, justification and unit binding
 * @surface library
 * @since 1.8.0
 * @expect splitPages <= atomicPages
 * @expect text of page 0 contains '150'
 */
import { buildDocumentPDFBytes, extractText, openPdf } from 'pdfnative';
import type { DocumentParams, DocumentBlock } from 'pdfnative';

const PASSAGE =
    'The quarter closed with an order book of 150 € thousand and shipments of 12 kg of '
    + 'samples per site. Breaking long paragraphs at line boundaries keeps pages full, and '
    + 'the widow and orphan rules keep single lines from being stranded at a page edge. ';

function section(n: number): DocumentBlock[] {
    return [
        { type: 'heading', text: `${n}. Regional results`, level: 2 },
        { type: 'paragraph', text: PASSAGE.repeat(5), align: 'justify' },
    ];
}

const params: DocumentParams = {
    title: 'Quarterly report',
    blocks: [
        { type: 'heading', text: 'Quarterly report', level: 1 },
        ...[1, 2, 3, 4, 5, 6].flatMap(section),
    ],
    footerText: 'Quarterly report',
};

export async function run(): Promise<{ bytes: Uint8Array; splitPages: number; atomicPages: number; text: string }> {
    const creationDate = new Date('2026-09-01T00:00:00Z');
    const bytes = buildDocumentPDFBytes(params, {
        creationDate,
        typography: {
            splitParagraphs: true,
            orphans: 2,
            widows: 2,
            keepHeadingsWithNext: true,
            unitBinding: true,
        },
    });
    const atomic = buildDocumentPDFBytes(params, { creationDate });

    return {
        bytes,
        splitPages: openPdf(bytes).pageCount,
        atomicPages: openPdf(atomic).pageCount,
        text: extractText(bytes, { pages: [0] })[0].text,
    };
}
