/**
 * Print production: the page is designed at trim size plus 3 mm bleed on
 * every side (8.5 pt), `layout.print.bleed` derives the TrimBox and
 * BleedBox, and `marks: true` draws crop and registration marks outside
 * the trim area. The boxes are read back from the parsed page.
 *
 * @task Prepare a print-ready page with bleed, TrimBox and printer's marks
 * @surface library
 * @since 1.7.0
 * @expect trimBox === [8.5, 8.5, 603.78, 850.39]
 * @expect bleedBox === [0, 0, 612.28, 858.89]
 */
import { buildDocumentPDFBytes, openPdf, dictGetArray } from 'pdfnative';

const BLEED = 8.5; // 3 mm in points
const TRIM_W = 595.28; // A4 trim width
const TRIM_H = 841.89; // A4 trim height

export async function run(): Promise<{
    bytes: Uint8Array;
    trimBox: readonly number[];
    bleedBox: readonly number[];
}> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Poster',
            blocks: [{ type: 'paragraph', text: 'Background art runs to the page edge; keep copy inside the trim.' }],
            footerText: 'Poster',
        },
        {
            // Page size = trim size + 2 × bleed; backgrounds may run to the edge.
            pageWidth: TRIM_W + 2 * BLEED,
            pageHeight: TRIM_H + 2 * BLEED,
            print: { bleed: BLEED, marks: true },
            creationDate: new Date('2026-08-25T00:00:00Z'),
        },
    );

    const page = openPdf(bytes).getPage(0);
    const asNumbers = (name: string): number[] =>
        (dictGetArray(page, name) ?? []).filter((v): v is number => typeof v === 'number');

    return { bytes, trimBox: asNumbers('TrimBox'), bleedBox: asNumbers('BleedBox') };
}
