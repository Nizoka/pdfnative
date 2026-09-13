/**
 * Print production showcase (v1.7.0) — bleed, trim, printer's marks,
 * /Trapped, print viewer preferences and large-format /UserUnit; since
 * v1.8.0 also CMYK colour under a CMYK OutputIntent, as PDF/X-4 and as
 * PDF/A-2b, with marks in the registration colour.
 *
 * The main sample is an A4 flyer designed at trim size + 3 mm bleed
 * (8.5 pt): the page is enlarged by the bleed on every side, a background
 * band runs to the page edge (into the bleed), and crop + registration
 * marks are drawn outside the TrimBox. Open it in Acrobat with
 * "Show art, trim & bleed boxes" enabled to see the geometry.
 *
 * Output: test-output/print/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, PAGE_SIZES } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import { buildMinimalSRGBProfile } from '../../src/core/pdf-tags.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';
import { buildSyntheticCmykProfile } from '../lib/synthetic-cmyk-profile.js';

const BLEED = 8.5; // 3 mm

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. A4 flyer with bleed + printer's marks ────────────────────
    const params: DocumentParams = {
        title: 'Print Production — Bleed & Marks',
        blocks: [
            { type: 'heading', text: 'Print-ready PDF', level: 1 },
            { type: 'paragraph', text: 'This page is designed at A4 trim size plus 3 mm bleed on every side. The TrimBox marks the finished format after cutting; the BleedBox extends to the page edge so backgrounds survive cutter tolerance.' },
            { type: 'paragraph', text: 'Crop marks (corner hairlines) and registration targets (edge circles) sit OUTSIDE the TrimBox - they are cut away with the bleed.' },
            { type: 'paragraph', text: 'The /Info dictionary declares /Trapped /False and the XMP packet mirrors it as pdf:Trapped, ready for prepress workflows.' },
            { type: 'paragraph', text: 'Print-dialog defaults: double-sided (long edge), 1 copy, tray picked from the PDF page size.' },
        ],
        metadata: { trapped: 'False' },
        footerText: 'pdfnative - print production',
    };
    const flyer = buildDocumentPDFBytes(params, {
        pageWidth: PAGE_SIZES.A4.width + 2 * BLEED,
        pageHeight: PAGE_SIZES.A4.height + 2 * BLEED,
        margins: { t: 36 + BLEED, r: 36 + BLEED, b: 36 + BLEED, l: 36 + BLEED },
        print: { bleed: BLEED, marks: true },
        viewerPreferences: {
            duplex: 'duplexFlipLongEdge',
            pickTrayByPDFSize: true,
            printPageRange: [[1, 1]],
            numCopies: 1,
        },
    });
    ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-bleed-marks.pdf'), 'print/print-bleed-marks.pdf', flyer);

    // ── 2. Explicit boxes (no shorthand) + crop-only marks ──────────
    const explicit = buildDocumentPDFBytes({
        title: 'Print Production — Explicit Boxes',
        blocks: [
            { type: 'heading', text: 'Explicit page boxes', level: 1 },
            { type: 'paragraph', text: 'TrimBox, BleedBox, ArtBox and CropBox set explicitly, with crop marks only (no registration targets).' },
        ],
        footerText: 'pdfnative - print production',
    }, {
        print: {
            trimBox: [BLEED, BLEED, PAGE_SIZES.A4.width - BLEED, PAGE_SIZES.A4.height - BLEED],
            bleedBox: [0, 0, PAGE_SIZES.A4.width, PAGE_SIZES.A4.height],
            artBox: [50, 50, PAGE_SIZES.A4.width - 50, PAGE_SIZES.A4.height - 50],
            marks: { registration: false, length: 20, weight: 0.5 },
        },
    });
    ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-explicit-boxes.pdf'), 'print/print-explicit-boxes.pdf', explicit);

    // ── 3. Large format: 5 m banner via /UserUnit ───────────────────
    // 500 cm × 100 cm at UserUnit 10: each unit is 10/72 inch, so the
    // 1417×283 unit page reads as a 5×1 m banner.
    const banner = buildDocumentPDFBytes({
        title: 'Print Production — Large Format',
        blocks: [
            { type: 'heading', text: 'Large-format banner', level: 1 },
            { type: 'paragraph', text: 'This page declares /UserUnit 10 - each user-space unit is 10/72 inch, so the page prints as a five-metre banner. The header is raised to %PDF-1.7 (UserUnit needs PDF 1.6+).' },
        ],
        footerText: 'pdfnative - print production',
    }, {
        pageWidth: 1417,
        pageHeight: 283,
        margins: { t: 20, r: 30, b: 20, l: 30 },
        print: { userUnit: 10 },
    });
    ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-large-format.pdf'), 'print/print-large-format.pdf', banner);

    // ── 4. Custom OutputIntent (tagged PDF/A-2b) ────────────────────
    // A characterised print condition: the caller supplies the RGB ICC
    // profile and names the output condition instead of the built-in
    // sRGB defaults. Here the engine's own sRGB profile stands in for a
    // press-supplied one — swap in your printer's profile bytes.
    const fontEntries = await loadSelectedFontEntries(['latin']);
    if (fontEntries.length === 1) {
        const iccProfile = Uint8Array.from(buildMinimalSRGBProfile(), c => c.charCodeAt(0));
        const intent = buildDocumentPDFBytes({
            title: 'Print Production — Custom OutputIntent',
            blocks: [
                { type: 'heading', text: 'Custom OutputIntent', level: 1 },
                { type: 'paragraph', text: 'This tagged PDF/A-2b document carries a caller-supplied RGB ICC profile as its OutputIntent, with a named output condition - the characterised print condition prepress workflows expect.' },
                { type: 'paragraph', text: 'The /Info dictionary declares /Trapped /True, mirrored as pdf:Trapped in XMP.' },
            ],
            metadata: { trapped: 'True' },
            footerText: 'pdfnative - print production',
            fontEntries,
        }, {
            tagged: 'pdfa2b',
            print: { bleed: BLEED },
            outputIntent: {
                iccProfile,
                outputConditionIdentifier: 'sRGB IEC61966-2.1',
                outputCondition: 'sRGB characterised display/print condition',
                info: 'Caller-supplied RGB profile (engine sRGB used as stand-in)',
            },
        });
        ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-output-intent.pdf'), 'print/print-output-intent.pdf', intent);

        // ── 5. CMYK press condition, claimed as PDF/X-4 (v1.8.0) ────
        // CMYK content colours, a CMYK OutputIntent, bleed and marks in the
        // registration colour. The profile is a synthetic stand-in built by
        // the sample script; a real job embeds the printer's profile.
        const cmykProfile = buildSyntheticCmykProfile();
        const pressBlocks: DocumentParams['blocks'] = [
            { type: 'heading', text: 'Print-ready PDF/X-4', level: 1 },
            { type: 'paragraph', text: 'Process cyan, set as [100, 0, 0, 0]: four-component colours are written with the k operator.', color: [100, 0, 0, 0] },
            { type: 'paragraph', text: 'Process magenta, [0, 100, 0, 0].', color: [0, 100, 0, 0] },
            { type: 'paragraph', text: 'Rich black, [60, 40, 40, 100], for large type on press.', color: [60, 40, 40, 100] },
            { type: 'paragraph', text: 'This line is RGB. Under a CMYK OutputIntent it is routed through a calibrated sRGB /DefaultRGB, so the print workflow knows what colour it means.' },
            {
                type: 'chart', chartType: 'bar', title: 'Ink coverage by plate', categories: ['Q1', 'Q2', 'Q3'],
                series: [
                    { label: 'Cyan', values: [40, 55, 48], color: [100, 0, 0, 0] },
                    { label: 'Magenta', values: [30, 35, 52], color: [0, 100, 0, 0] },
                ],
            },
            { type: 'paragraph', text: 'Crop and registration marks outside the TrimBox use the All separation, so they print on every plate.' },
        ];
        const pressLayout = {
            pageWidth: PAGE_SIZES.A4.width + 2 * BLEED,
            pageHeight: PAGE_SIZES.A4.height + 2 * BLEED,
            margins: { t: 36 + BLEED, r: 36 + BLEED, b: 36 + BLEED, l: 36 + BLEED },
            print: { bleed: BLEED, marks: true },
            outputIntent: {
                iccProfile: cmykProfile,
                outputConditionIdentifier: 'Synthetic CMYK',
                outputCondition: 'Naive CMYK conversion (sample stand-in, not a press condition)',
                registryName: 'http://www.color.org',
            },
        };
        const pdfx = buildDocumentPDFBytes({
            title: 'Print Production — PDF/X-4',
            blocks: pressBlocks,
            footerText: 'pdfnative - PDF/X-4',
            fontEntries,
        }, { ...pressLayout, pdfx: 'pdfx4' });
        ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-cmyk-pdfx4.pdf'), 'print/print-cmyk-pdfx4.pdf', pdfx);

        // ── 6. The same page as PDF/A-2b under the CMYK intent ──────
        const pdfaCmyk = buildDocumentPDFBytes({
            title: 'Print Production — PDF/A-2b, CMYK intent',
            blocks: pressBlocks,
            footerText: 'pdfnative - PDF/A-2b CMYK',
            fontEntries,
        }, { ...pressLayout, tagged: 'pdfa2b' });
        ctx.writeSafe(resolve(ctx.outputDir, 'print', 'print-cmyk-pdfa2b.pdf'), 'print/print-cmyk-pdfa2b.pdf', pdfaCmyk);
    }
}
