/**
 * PDF/A variant samples — tagged mode: pdfa1b, pdfa2b, pdfa2u, pdfa3b.
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import type { PdfASample } from '../helpers/types.js';

const PDFA_SAMPLES: PdfASample[] = [
    { filename: 'tagged-pdfa2b-default', tagged: true, description: 'PDF/A-2b (default tagged=true)' },
    { filename: 'tagged-pdfa2b-explicit', tagged: 'pdfa2b', description: 'PDF/A-2b (explicit)' },
    { filename: 'tagged-pdfa1b', tagged: 'pdfa1b', description: 'PDF/A-1b (legacy)' },
    { filename: 'tagged-pdfa2u', tagged: 'pdfa2u', description: 'PDF/A-2u (Unicode)' },
    { filename: 'tagged-pdfa3b', tagged: 'pdfa3b', description: 'PDF/A-3b (with attachments)' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
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
}
