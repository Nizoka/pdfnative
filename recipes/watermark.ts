/**
 * A rotated, semi-transparent text watermark behind the content of every
 * page. The watermark never disturbs the body text: extraction still
 * returns the paragraph, and the watermark string itself is present too.
 *
 * @task Stamp a rotated DRAFT watermark behind the page content
 * @surface library
 * @since 1.6.0
 * @expect text of page 0 contains 'Confidential clause'
 * @expect text of page 0 contains 'DRAFT'
 */
import { buildDocumentPDFBytes, extractText } from 'pdfnative';
import type { DocumentParams } from 'pdfnative';

const params: DocumentParams = {
    title: 'Draft contract',
    blocks: [
        { type: 'heading', text: 'Terms', level: 1 },
        { type: 'paragraph', text: 'Confidential clause: neither party discloses the commercial terms.' },
    ],
    footerText: 'Draft contract',
};

export async function run(): Promise<{ bytes: Uint8Array; text: string }> {
    const bytes = buildDocumentPDFBytes(params, {
        watermark: {
            text: { text: 'DRAFT', fontSize: 60, opacity: 0.15, angle: -45 },
            position: 'background',
        },
        creationDate: new Date('2026-08-25T00:00:00Z'),
    });
    const text = extractText(bytes, { pages: [0] })[0].text;
    return { bytes, text };
}
