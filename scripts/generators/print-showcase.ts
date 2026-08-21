/**
 * Print production showcase (v1.7.0) — bleed, trim, printer's marks,
 * /Trapped, print viewer preferences and large-format /UserUnit.
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
import type { GenerateContext } from '../helpers/io.js';

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
}
