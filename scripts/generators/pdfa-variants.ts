/**
 * PDF/A variant samples — tagged mode: pdfa1b, pdfa2b, pdfa2u, pdfa3b.
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import type { PdfASample } from '../helpers/types.js';
import { loadFontEntries, loadSelectedFontEntries } from '../helpers/fonts.js';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';

const PDFA_SAMPLES: PdfASample[] = [
    { filename: 'tagged-pdfa2b-default', tagged: true, description: 'PDF/A-2b (default tagged=true)' },
    { filename: 'tagged-pdfa2b-explicit', tagged: 'pdfa2b', description: 'PDF/A-2b (explicit)' },
    { filename: 'tagged-pdfa1b', tagged: 'pdfa1b', description: 'PDF/A-1b (legacy)' },
    { filename: 'tagged-pdfa2u', tagged: 'pdfa2u', description: 'PDF/A-2u (Unicode)' },
    { filename: 'tagged-pdfa3b', tagged: 'pdfa3b', description: 'PDF/A-3b (with attachments)' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    // Register Latin font for PDF/A embedding (required for veraPDF conformance)
    const latinEntries = await loadFontEntries('latin', '/F3');

    for (const pdfa of PDFA_SAMPLES) {
        const params: PdfParams = {
            title: `PDF/A Compliance – ${pdfa.description}`,
            infoItems: [
                { label: 'Mode', value: String(pdfa.tagged) },
                { label: 'Standard', value: pdfa.description },
            ],
            balanceText: 'Accessible PDF',
            countText: '3 sample rows',
            headers: ['Item', 'Value', 'Category', 'Status', 'Notes'],
            rows: [
                { cells: ['Structure tree', 'Enabled', 'Accessibility', 'OK', 'StructTreeRoot'], type: 'credit', pointed: false },
                { cells: ['XMP metadata', 'Present', 'Metadata', 'OK', 'ISO 19005'], type: 'credit', pointed: false },
                { cells: ['ICC profile', 'sRGB', 'Color', 'OK', 'OutputIntent'], type: 'credit', pointed: true },
            ],
            footerText: `pdfnative – ${pdfa.description}`,
            fontEntries: latinEntries,
        };

        // PDF/A-3b includes an embedded XML attachment
        const layoutOpts = pdfa.tagged === 'pdfa3b'
            ? {
                tagged: pdfa.tagged,
                attachments: [{
                    filename: 'invoice-data.xml',
                    data: new TextEncoder().encode(
                        '<?xml version="1.0" encoding="UTF-8"?>\n' +
                        '<invoice>\n  <total currency="EUR">1234.56</total>\n' +
                        '  <date>2026-01-15</date>\n</invoice>\n'
                    ),
                    mimeType: 'application/xml',
                    description: 'Structured invoice data',
                    relationship: 'Data' as const,
                }],
            }
            : { tagged: pdfa.tagged };

        const bytes = buildPDFBytes(params, layoutOpts);
        const filename = `${pdfa.filename}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'tagged', filename), `tagged/${filename}`, bytes);
    }
    // Tai Tham under PDF/A-2u (#87): every glyph the Universal Shaping Engine
    // emits — the MA+E ligature among them — maps back to its code points in
    // the ToUnicode CMap, which level U requires (ISO 19005-2 §6.2.11.7.2).
    {
        // The Latin face first: the English prose is set in Noto Sans, and the
        // Tai Tham font draws the Tai Tham lines (language match). Before
        // 1.9.0 the order was reversed and Noto Sans was registered but never
        // reached, so the whole 2 MB variable font was embedded unused (C18).
        const taitham = await loadSelectedFontEntries(['latin', 'nod']);
        const params: DocumentParams = {
            title: 'PDF/A-2u — Tai Tham (Northern Thai)',
            blocks: [
                { type: 'heading', text: 'Tai Tham under PDF/A-2u', level: 1 },
                { type: 'paragraph', text: 'Every glyph of a Unicode-level PDF/A file must map to text. The lines below are shaped by the Universal Shaping Engine; their ligatures and subjoined forms are named in the ToUnicode CMap by the code points they came from.' },
                { type: 'paragraph', text: 'ᨲ᩠ᩅᩫᨾᩮᩬᩥᨦ ᨸᩮ᩠ᨶ ᩋᨠ᩠ᨡᩁ ᩃ᩶ᩣ᩠ᨶᨶᩣ. ᩉ᩠ᨶ᩶ᩣᨶᩦ᩶ ᩈᨯᩯ᩠ᨦ ᨲ᩠ᩅᩫᩉ᩠ᨶᩢᨦᩈᩨ ᨲᩫ᩠ᩅᨲᩣ᩠ᨾ ᩈᩕᩡ ᩓ ᩅᩢᨶᨶᨿᩩᨲ ᨴᩩᨠᨲᩫ᩠ᩅ ᨶᩱᩉ᩠ᨶ᩶ᩣᨯ᩠ᨿᩅ.' },
                { type: 'paragraph', text: 'Pre-base vowels and the MA+E ligature: ᨠᩮ ᨠᩯ ᨠᩰ ᨠᩱ ᨠᩲ ᨾᩮᩬᩥᨦ — sakot stacks: ᨠ᩠ᨠ ᨲ᩠ᩅ ᩉ᩠ᨶ᩶ᩣ ᨾ᩠ᨿ — medial consonants: ᨻᩕ ᨠᩖ ᨠᩗ ᨠ᩠ᩅ' },
            ],
            fontEntries: taitham,
            footerText: 'pdfnative – PDF/A-2u Tai Tham',
        };
        const bytes = buildDocumentPDFBytes(params, { tagged: 'pdfa2u' });
        ctx.writeSafe(resolve(ctx.outputDir, 'tagged', 'tagged-pdfa2u-taitham.pdf'), 'tagged/tagged-pdfa2u-taitham.pdf', bytes);
    }
}
