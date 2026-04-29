/**
 * Barcode & QR Code samples — all 5 supported formats.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // Latin font for PDF/A embedding (rule 6.2.11.4.1)
    const latinEntries = await loadFontEntries('latin', '/F3');
    // ── All barcode formats showcase ─────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Barcode & QR Code Showcase',
            blocks: [
                { type: 'heading', text: 'Barcode & QR Code Showcase', level: 1 },
                { type: 'paragraph', text: 'pdfnative supports 5 barcode formats rendered as pure PDF path operators. No image embedding — all barcodes are vector-sharp at any zoom level.' },

                { type: 'heading', text: 'Code 128 (ISO/IEC 15417)', level: 2 },
                { type: 'paragraph', text: 'High-density 1D barcode for logistics, shipping labels, and GS1 applications.' },
                { type: 'barcode', format: 'code128', data: 'pdfnative-2026', align: 'center' },

                { type: 'heading', text: 'EAN-13 (ISO/IEC 15420)', level: 2 },
                { type: 'paragraph', text: 'Global retail barcode with automatic check digit calculation.' },
                { type: 'barcode', format: 'ean13', data: '590123412345', align: 'center' },

                { type: 'heading', text: 'QR Code (ISO/IEC 18004)', level: 2 },
                { type: 'paragraph', text: 'Universal 2D barcode with error correction. Scannable by any smartphone.' },
                { type: 'barcode', format: 'qr', data: 'https://github.com/Nizoka/pdfnative', width: 120, align: 'center', ecLevel: 'M' },

                { type: 'heading', text: 'Data Matrix ECC 200 (ISO/IEC 16022)', level: 2 },
                { type: 'paragraph', text: 'Compact 2D barcode for industrial marking, electronics, and healthcare.' },
                { type: 'barcode', format: 'datamatrix', data: 'DM-SAMPLE-001', width: 100, align: 'center' },

                { type: 'heading', text: 'PDF417 (ISO/IEC 15438)', level: 2 },
                { type: 'paragraph', text: 'Stacked 2D barcode used in government IDs, boarding passes, and transport.' },
                { type: 'barcode', format: 'pdf417', data: 'PDF417 Transport Label', width: 300, height: 80, align: 'center' },
            ],
            footerText: 'pdfnative – Barcode & QR Code Showcase',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'barcode', 'barcode-showcase.pdf'), 'barcode/barcode-showcase.pdf', buildDocumentPDFBytes(params));
    }

    // ── Multiple barcodes with alignment variations ──────────────
    {
        const params: DocumentParams = {
            title: 'Barcode Alignment & Sizing',
            blocks: [
                { type: 'heading', text: 'Barcode Alignment & Custom Sizes', level: 1 },

                { type: 'paragraph', text: 'Left-aligned Code 128:' },
                { type: 'barcode', format: 'code128', data: 'LEFT-ALIGN', align: 'left' },

                { type: 'paragraph', text: 'Center-aligned Code 128:' },
                { type: 'barcode', format: 'code128', data: 'CENTER-ALIGN', align: 'center' },

                { type: 'paragraph', text: 'Right-aligned Code 128:' },
                { type: 'barcode', format: 'code128', data: 'RIGHT-ALIGN', align: 'right' },

                { type: 'heading', text: 'QR Code Sizes', level: 2 },

                { type: 'paragraph', text: 'Small QR (60pt):' },
                { type: 'barcode', format: 'qr', data: 'Small', width: 60, align: 'left' },

                { type: 'paragraph', text: 'Medium QR (100pt):' },
                { type: 'barcode', format: 'qr', data: 'Medium', width: 100, align: 'center' },

                { type: 'paragraph', text: 'Large QR (160pt):' },
                { type: 'barcode', format: 'qr', data: 'Large', width: 160, align: 'right' },

                { type: 'heading', text: 'QR Error Correction Levels', level: 2 },

                { type: 'paragraph', text: 'EC Level L (7% recovery):' },
                { type: 'barcode', format: 'qr', data: 'Error Level L', width: 80, ecLevel: 'L' },

                { type: 'paragraph', text: 'EC Level H (30% recovery):' },
                { type: 'barcode', format: 'qr', data: 'Error Level H', width: 80, ecLevel: 'H' },
            ],
            footerText: 'pdfnative – Barcode Alignment Samples',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'barcode', 'barcode-alignment.pdf'), 'barcode/barcode-alignment.pdf', buildDocumentPDFBytes(params));
    }

    // ── Tagged barcode (PDF/A) ───────────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Tagged Barcodes (PDF/A-2b)',
            blocks: [
                { type: 'heading', text: 'Barcodes in Tagged PDF', level: 1 },
                { type: 'paragraph', text: 'When tagged mode is enabled, barcode blocks are wrapped in /Figure structure elements for accessibility compliance.' },
                { type: 'barcode', format: 'qr', data: 'Tagged QR Code', width: 100, align: 'center' },
                { type: 'barcode', format: 'code128', data: 'TAGGED-128', align: 'center' },
            ],
            footerText: 'pdfnative – Tagged Barcode Sample',
            layout: { tagged: true },
            fontEntries: latinEntries,
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'barcode', 'barcode-tagged.pdf'), 'barcode/barcode-tagged.pdf', buildDocumentPDFBytes(params));
    }
}
