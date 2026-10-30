/**
 * Spot colours for the press: two inks declared once in
 * `layout.print.spotColours` with their process alternates, painted as a
 * solid, a tint, and a two-ink mix. pdfnative writes one `/Separation`
 * colour space per ink the content uses and a `/DeviceN` space for the mix,
 * each with the tint transform that lets a viewer without the ink show the
 * alternate.
 *
 * @task Paint text in named spot inks and a two-ink mix, with process alternates
 * @surface library
 * @since 1.9.0
 * @expect pages === 1
 * @expect pdf contains '/Separation'
 * @expect pdf contains '/DeviceN'
 */
import { buildDocumentPDFBytes, openPdf } from 'pdfnative';

export async function run(): Promise<{ bytes: Uint8Array; pages: number }> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Spot colours',
            blocks: [
                { type: 'heading', text: 'Brand blue, solid', level: 1, color: { spot: 'PANTONE 300 C' } },
                { type: 'paragraph', text: 'Brand blue at a 40 % tint.', color: { spot: 'PANTONE 300 C', tint: 0.4 } },
                { type: 'paragraph', text: 'Gold accent, solid.', color: { spot: 'Gold' } },
                { type: 'paragraph', text: 'A duotone mix: 60 % blue over 30 % gold.', color: { inks: { 'PANTONE 300 C': 0.6, Gold: 0.3 } } },
                { type: 'paragraph', text: 'Body text stays in process black.' },
            ],
        },
        {
            creationDate: new Date('2026-10-23T00:00:00Z'),
            print: {
                spotColours: [
                    { name: 'PANTONE 300 C', alternate: [100, 44, 0, 0] }, // CMYK percent
                    { name: 'Gold', alternate: [0, 17, 74, 17] },
                ],
            },
        },
    );
    return { bytes, pages: openPdf(bytes).pageCount };
}
