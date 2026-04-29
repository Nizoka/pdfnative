/**
 * Tests for PDF/A Latin embedding (Phase 1 / v1.1.0 — issue #28).
 *
 * Demonstrates the public API path: bundle Noto Sans VF (OFL-1.1) as a font
 * entry and pass it through `PdfParams.fontEntries` / `DocumentParams.fontEntries`.
 * The existing pdf-builder + pdf-document pipelines already emit FontFile2 +
 * CIDFontType2 + Identity-H + ToUnicode CMap for embedded fonts, so this
 * combination produces a fully PDF/A-conforming output without bypassing the
 * 14 standard non-embedded fonts.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';
import * as notoSansData from '../../fonts/noto-sans-data.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

const latinFontEntry: FontEntry = {
    fontRef: '/F1',
    fontData: notoSansData as unknown as FontData,
};

describe('PDF/A Latin font embedding (issue #28)', () => {
    it('embeds Noto Sans for Latin text in PDF/A-2b mode', () => {
        const pdf = buildDocumentPDF({
            title: 'PDF/A Latin embedding',
            blocks: [
                { type: 'paragraph', text: 'The quick brown fox jumps over the lazy dog.' },
                { type: 'heading', level: 1, text: 'Embedded font ensures PDF/A conformance' },
            ],
            footerText: 'pdfnative',
            fontEntries: [latinFontEntry],
        }, { tagged: 'pdfa2b' });

        // Sanity: text rendered
        expect(pdf).toContain('PDF/A Latin embedding');
        // Embedded font path: FontFile2 + CIDFontType2 + Identity-H + ToUnicode
        expect(pdf).toContain('/FontFile2');
        expect(pdf).toContain('/CIDFontType2');
        expect(pdf).toContain('/Identity-H');
        expect(pdf).toContain('/ToUnicode');
        // PDF/A markers
        expect(pdf).toContain('/MarkInfo');
        expect(pdf).toContain('pdfaid:part');
    });

    it('produces valid PDF in PDF/A-1b mode with Latin font', () => {
        const pdf = buildDocumentPDF({
            title: 'PDF/A-1b Latin',
            blocks: [{ type: 'paragraph', text: 'Plain ASCII text.' }],
            footerText: 'pdfnative',
            fontEntries: [latinFontEntry],
        }, { tagged: 'pdfa1b' });

        expect(pdf).toMatch(/^%PDF-1\.4/);
        expect(pdf).toContain('<pdfaid:part>1</pdfaid:part>');
        expect(pdf).toContain('/FontFile2');
    });

    it('supports unicode characters via Identity-H encoding', () => {
        const pdf = buildDocumentPDF({
            title: 'Unicode Latin sample',
            blocks: [
                { type: 'paragraph', text: 'Café résumé naïve façade — €1.00' },
                { type: 'paragraph', text: 'Polish: zażółć gęślą jaźń' },
            ],
            footerText: 'pdfnative',
            fontEntries: [latinFontEntry],
        }, { tagged: 'pdfa2b' });

        expect(pdf).toContain('Identity-H');
        // ToUnicode CMap stream should map glyph IDs back to Unicode codepoints
        expect(pdf).toContain('/ToUnicode');
        expect(pdf).toContain('CIDInit');
        expect(pdf).toContain('beginbfchar');
    });

    it('exposes Noto Sans metrics for width measurement', () => {
        expect(notoSansData.metrics.unitsPerEm).toBe(1000);
        expect(notoSansData.metrics.numGlyphs).toBeGreaterThan(4000);
        expect(Object.keys(notoSansData.cmap).length).toBeGreaterThan(3000);
        // Common Latin codepoints are mapped
        expect(notoSansData.cmap[0x41]).toBeGreaterThan(0); // 'A'
        expect(notoSansData.cmap[0x61]).toBeGreaterThan(0); // 'a'
        // Latin-1 supplement
        expect(notoSansData.cmap[0xE9]).toBeGreaterThan(0); // 'é'
    });
});
