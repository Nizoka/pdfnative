import { describe, it, expect } from 'vitest';
import { splitTextByFont } from '../../src/shaping/multi-font.js';
import type { FontEntry, FontData } from '../../src/types/pdf-types.js';

function makeFontData(cmapEntries: Record<number, number>): FontData {
    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 100, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestFont',
        cmap: cmapEntries,
        defaultWidth: 500,
        widths: {},
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
}

describe('splitTextByFont', () => {
    it('should return empty array for empty string', () => {
        const entry: FontEntry = { fontData: makeFontData({ 65: 1 }), fontRef: '/F3' };
        expect(splitTextByFont('', [entry])).toEqual([]);
    });

    it('should return empty array for empty fontEntries', () => {
        expect(splitTextByFont('Hello', [])).toEqual([]);
    });

    it('should return single run for single font', () => {
        const entry: FontEntry = { fontData: makeFontData({ 65: 1, 66: 2 }), fontRef: '/F3' };
        const runs = splitTextByFont('AB', [entry]);
        expect(runs).toHaveLength(1);
        expect(runs[0].text).toBe('AB');
        expect(runs[0].entry).toBe(entry);
    });

    it('should split text at script boundaries', () => {
        const latinFont: FontEntry = {
            fontData: makeFontData({ 65: 1, 66: 2, 32: 3 }), // A, B, space
            fontRef: '/F3',
        };
        const thaiFont: FontEntry = {
            fontData: makeFontData({ 0x0E01: 10, 0x0E02: 11 }), // ko kai, kho khai
            fontRef: '/F4',
        };

        const runs = splitTextByFont('AB\u0E01\u0E02', [latinFont, thaiFont]);
        expect(runs.length).toBe(2);
        expect(runs[0].text).toBe('AB');
        expect(runs[0].entry).toBe(latinFont);
        expect(runs[1].text).toBe('\u0E01\u0E02');
        expect(runs[1].entry).toBe(thaiFont);
    });

    it('should apply continuation bias (stay with current font)', () => {
        // Both fonts cover space (0x20), but continuation bias should keep current font
        const fontA: FontEntry = {
            fontData: makeFontData({ 65: 1, 32: 3 }),
            fontRef: '/F3',
        };
        const fontB: FontEntry = {
            fontData: makeFontData({ 66: 2, 32: 4 }),
            fontRef: '/F4',
        };

        const runs = splitTextByFont('A B', [fontA, fontB]);
        // "A " should be one run (font A covers both A and space)
        // "B" should be another run (font B only)
        expect(runs.length).toBe(2);
        expect(runs[0].text).toBe('A ');
        expect(runs[0].entry).toBe(fontA);
        expect(runs[1].text).toBe('B');
        expect(runs[1].entry).toBe(fontB);
    });

    it('should fallback to primary font for uncovered characters', () => {
        const primary: FontEntry = {
            fontData: makeFontData({ 65: 1 }),
            fontRef: '/F3',
        };
        const secondary: FontEntry = {
            fontData: makeFontData({ 66: 2 }),
            fontRef: '/F4',
        };

        const runs = splitTextByFont('A\u9999B', [primary, secondary]); // 香 not in either
        // The uncovered char should fall back to primary
        expect(runs.some(r => r.entry === primary)).toBe(true);
    });

    it('should normalize NBSP to space for cmap lookup', () => {
        const entry: FontEntry = {
            fontData: makeFontData({ 32: 3, 65: 1 }), // space mapped
            fontRef: '/F3',
        };
        const runs = splitTextByFont('A\u00A0', [entry]);
        expect(runs).toHaveLength(1);
        expect(runs[0].text).toBe('A\u00A0');
    });

    it('should prefer script-specific font over broad-coverage font', () => {
        // Simulate: JP font covers Greek + Latin, Greek font covers Greek + Latin
        // Greek chars should go to the Greek font, not JP
        const jpFont: FontEntry = {
            fontData: makeFontData({ 0x0391: 50, 0x03B1: 51, 65: 1, 32: 3 }), // Greek alpha, A, space
            fontRef: '/F4',
            lang: 'ja',
        };
        const greekFont: FontEntry = {
            fontData: makeFontData({ 0x0391: 60, 0x03B1: 61, 65: 2, 32: 4 }), // Greek alpha, A, space
            fontRef: '/F7',
            lang: 'el',
        };

        const runs = splitTextByFont('\u0391\u03B1', [jpFont, greekFont]);
        expect(runs).toHaveLength(1);
        expect(runs[0].entry).toBe(greekFont);
        expect(runs[0].text).toBe('\u0391\u03B1');
    });

    it('should use continuation bias for Latin chars between script-specific runs', () => {
        // Greek font covers Greek + Latin, JP font covers Greek + Latin
        // "Αα test" → Greek chars go to Greek font, Latin "test" stays with Greek via continuation
        const jpFont: FontEntry = {
            fontData: makeFontData({ 0x0391: 50, 0x03B1: 51, 65: 1, 32: 3, 116: 10, 101: 11, 115: 12 }), // A, space, t, e, s
            fontRef: '/F4',
            lang: 'ja',
        };
        const greekFont: FontEntry = {
            fontData: makeFontData({ 0x0391: 60, 0x03B1: 61, 65: 2, 32: 4, 116: 20, 101: 21, 115: 22 }), // A, space, t, e, s
            fontRef: '/F7',
            lang: 'el',
        };

        const runs = splitTextByFont('\u0391\u03B1 test', [jpFont, greekFont]);
        // All should stay in Greek font (script-aware for Greek chars, continuation for Latin)
        expect(runs).toHaveLength(1);
        expect(runs[0].entry).toBe(greekFont);
    });

    it('should correctly split Vietnamese text from Thai in multi-font mode', () => {
        // Thai font covers Latin + Thai, Vietnamese font covers Latin + Vietnamese
        // "Giao dịch" → "Giao d" starts with Thai (continuation bias), "ịch" switches to Vietnamese
        // But with script-aware: ị (U+1ECB) → Vietnamese, then continuation keeps Vietnamese
        const thaiFont: FontEntry = {
            fontData: makeFontData({ 71: 1, 105: 2, 97: 3, 111: 4, 32: 5, 100: 6, 99: 7, 104: 8 }), // G,i,a,o,space,d,c,h
            fontRef: '/F3',
            lang: 'th',
        };
        const viFont: FontEntry = {
            fontData: makeFontData({ 71: 10, 105: 11, 97: 12, 111: 13, 32: 14, 100: 15, 0x1ECB: 16, 99: 17, 104: 18 }), // G,i,a,o,space,d,ị,c,h
            fontRef: '/F10',
            lang: 'vi',
        };

        const runs = splitTextByFont('Giao d\u1ECBch', [thaiFont, viFont]);
        // ị (U+1ECB) should route to Vietnamese font
        const viRun = runs.find(r => r.entry === viFont);
        expect(viRun).toBeDefined();
        expect(viRun!.text).toContain('\u1ECB');
    });
});
