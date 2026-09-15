/**
 * Prepare a press-ready PDF/X-4: CMYK colours, the printer's CMYK output
 * profile as OutputIntent, bleed with crop and registration marks, and an
 * embedded font. `validatePdfX()` checks the structural requirements of the
 * result. The profile comes from the caller — in a real job, the ICC file
 * your printer names (ISO Coated v2, GRACoL, …).
 *
 * @task Prepare a press-ready PDF/X-4 with CMYK colours and the printer's profile
 * @surface library
 * @since 1.8.0
 * @expect validatePdfX(bytes).valid === true
 * @expect pdf contains '/S /GTS_PDFX'
 * @expect pdf contains '0 0 0 1 k'
 */
import { buildDocumentPDFBytes, validatePdfX } from 'pdfnative';
import type { FontData, PdfXValidationResult } from 'pdfnative';
import * as notoSans from 'pdfnative/fonts/noto-sans-data.js';

const BLEED = 8.5; // 3 mm in points

export async function run(options: { readonly iccProfile: Uint8Array }): Promise<{
    bytes: Uint8Array;
    report: PdfXValidationResult;
}> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Spring catalogue',
            fontEntries: [{ fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' }],
            blocks: [
                { type: 'heading', text: 'Spring catalogue', level: 1 },
                { type: 'paragraph', text: 'Body text in process black.', color: [0, 0, 0, 100] },
                { type: 'paragraph', text: 'Accent in process cyan.', color: [100, 0, 0, 0] },
            ],
            footerText: 'Spring catalogue',
        },
        {
            pageWidth: 595.28 + 2 * BLEED,
            pageHeight: 841.89 + 2 * BLEED,
            margins: { t: 36 + BLEED, r: 36 + BLEED, b: 36 + BLEED, l: 36 + BLEED },
            print: { bleed: BLEED, marks: true },
            pdfx: 'pdfx4',
            outputIntent: {
                iccProfile: options.iccProfile,
                outputConditionIdentifier: 'FOGRA39',
                registryName: 'http://www.color.org',
            },
            creationDate: new Date('2026-09-01T00:00:00Z'),
        },
    );
    return { bytes, report: validatePdfX(bytes) };
}
