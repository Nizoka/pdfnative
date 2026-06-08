import { describe, it, expect } from 'vitest';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

/**
 * Mock FontData whose cmap covers the precomposed é (U+00E9) but NOT the
 * combining acute accent (U+0301). This lets us prove that NFC normalization
 * collapses a decomposed `e` + combining-acute sequence into the single
 * precomposed glyph the font actually carries.
 */
function makeMockFontData(): FontData {
    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        // 0x65 = e, 0xE9 = é (precomposed). No 0x301 (combining acute).
        cmap: { 0x65: 1, 0xe9: 2 },
        defaultWidth: 500,
        widths: { 1: 500, 2: 500 },
        pdfWidthArray: '1 [500] 2 [500]',
        ttfBase64: 'AAAAAAAAAA==',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
}

function makeFontEntry(): FontEntry {
    return {
        lang: 'latin',
        fontRef: '/F1',
        fontData: makeMockFontData(),
    } as FontEntry;
}

const DECOMPOSED = 'e\u0301'; // e + combining acute = "é" (NFD form)
const COMPOSED = '\u00e9'; // precomposed "é" (NFC form)

describe('createEncodingContext — Unicode normalization', () => {
    it('defaults to no normalization (byte-identical output)', () => {
        const a = createEncodingContext([makeFontEntry()]);
        const b = createEncodingContext([makeFontEntry()], false, false);
        expect(a.ps(COMPOSED)).toBe(b.ps(COMPOSED));
        // Decomposed input is left untouched when normalize is off.
        expect(a.ps(DECOMPOSED)).not.toBe(a.ps(COMPOSED));
    });

    it('NFC composes decomposed sequences to match precomposed glyphs', () => {
        const enc = createEncodingContext([makeFontEntry()], false, 'NFC');
        // Under NFC the decomposed and precomposed inputs encode identically.
        expect(enc.ps(DECOMPOSED)).toBe(enc.ps(COMPOSED));
    });

    it('NFD decomposes precomposed input', () => {
        const enc = createEncodingContext([makeFontEntry()], false, 'NFD');
        expect(enc.ps(COMPOSED)).toBe(enc.ps(DECOMPOSED));
    });

    it('normalizes Latin-mode (no fontEntries) width + ps', () => {
        const enc = createEncodingContext([], false, 'NFC');
        // Composed é is WinAnsi-encodable; the decomposed form composes under NFC.
        expect(enc.ps(DECOMPOSED)).toBe(enc.ps(COMPOSED));
        expect(enc.tw(DECOMPOSED, 10)).toBe(enc.tw(COMPOSED, 10));
    });
});
