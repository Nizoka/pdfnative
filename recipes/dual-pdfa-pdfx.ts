/**
 * One file, two claims: PDF/A-2b for the archive and PDF/X-4 for the press.
 * Since 1.9.0 `tagged: 'pdfa2b'` (or `'pdfa2u'`) combines with
 * `pdfx: 'pdfx4'`: the XMP carries `pdfaid` and `pdfxid`, two OutputIntents
 * (`/GTS_PDFA1`, `/GTS_PDFX`) share one ICC stream, and `validatePdfX()`
 * accepts the result. The profile here is the synthetic CMYK profile from
 * `pdfnative/tools` — it characterises no press; a real job uses the
 * printer's profile.
 *
 * @task Claim PDF/A-2b and PDF/X-4 in the same document
 * @surface library
 * @since 1.9.0
 * @expect validatePdfX(bytes).valid === true
 * @expect pdf contains 'pdfaid:part'
 * @expect pdf contains '/S /GTS_PDFX'
 * @expect pdf contains '/S /GTS_PDFA1'
 */
import { buildDocumentPDFBytes, validatePdfX } from 'pdfnative';
import type { FontData, PdfXValidationResult } from 'pdfnative';
import { buildSyntheticCmykProfile } from 'pdfnative/tools';
import * as notoSans from 'pdfnative/fonts/noto-sans-data.js';

export async function run(): Promise<{ bytes: Uint8Array; report: PdfXValidationResult }> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Annual report — archive and press master',
            fontEntries: [{ fontData: notoSans as unknown as FontData, fontRef: '/F3', lang: 'latin' }],
            blocks: [
                { type: 'heading', text: 'Annual report', level: 1 },
                { type: 'paragraph', text: 'Archived as PDF/A-2b, printed from the same bytes as PDF/X-4.', color: [0, 0, 0, 100] },
            ],
            footerText: 'Annual report',
            metadata: { trapped: 'False' },
        },
        {
            creationDate: new Date('2026-10-23T00:00:00Z'),
            tagged: 'pdfa2b',
            pdfx: 'pdfx4',
            outputIntent: {
                iccProfile: buildSyntheticCmykProfile(),
                outputConditionIdentifier: 'Synthetic CMYK (characterises no press)',
                registryName: 'http://www.color.org',
            },
        },
    );
    return { bytes, report: validatePdfX(bytes) };
}
