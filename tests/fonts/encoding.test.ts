import { describe, it, expect } from 'vitest';
import {
    toWinAnsi, pdfString, truncate, helveticaWidth,
} from '../../src/fonts/encoding.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { txt } from '../../src/core/pdf-text.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import * as hebrewMod from '../../fonts/noto-hebrew-data.js';
import * as arabicMod from '../../fonts/noto-arabic-data.js';

function makeRealHebrewFontData(): FontData {
    return {
        metrics: hebrewMod.metrics, fontName: hebrewMod.fontName,
        cmap: hebrewMod.cmap, defaultWidth: hebrewMod.defaultWidth,
        widths: hebrewMod.widths, gsub: hebrewMod.gsub,
        markAnchors: hebrewMod.markAnchors as FontData['markAnchors'],
        mark2mark: hebrewMod.mark2mark as FontData['mark2mark'],
        pdfWidthArray: '', ttfBase64: '',
    };
}

function makeRealArabicFontData(): FontData {
    return {
        metrics: arabicMod.metrics, fontName: arabicMod.fontName,
        cmap: arabicMod.cmap, defaultWidth: arabicMod.defaultWidth,
        widths: arabicMod.widths, gsub: arabicMod.gsub,
        markAnchors: arabicMod.markAnchors as FontData['markAnchors'],
        mark2mark: arabicMod.mark2mark as FontData['mark2mark'],
        pdfWidthArray: '', ttfBase64: '',
    };
}

describe('toWinAnsi', () => {
    it('should pass through ASCII text', () => {
        expect(toWinAnsi('Hello World')).toBe('Hello World');
    });

    it('should pass through Latin-1 accented chars', () => {
        expect(toWinAnsi('café')).toBe('café');
    });

    it('should map euro sign to 0x80', () => {
        expect(toWinAnsi('\u20AC')).toBe('\x80');
    });

    it('should map en-dash to 0x96', () => {
        expect(toWinAnsi('\u2013')).toBe('\x96');
    });

    it('should map em-dash to 0x97', () => {
        expect(toWinAnsi('\u2014')).toBe('\x97');
    });

    it('should map smart quotes', () => {
        expect(toWinAnsi('\u2018')).toBe('\x91'); // left single
        expect(toWinAnsi('\u2019')).toBe('\x92'); // right single
        expect(toWinAnsi('\u201C')).toBe('\x93'); // left double
        expect(toWinAnsi('\u201D')).toBe('\x94'); // right double
    });

    it('should map ellipsis to 0x85', () => {
        expect(toWinAnsi('\u2026')).toBe('\x85');
    });

    it('should map bullet to 0x95 (CP1252)', () => {
        // Regression: bullet rendered as '?' prior to v1.0.1
        expect(toWinAnsi('\u2022')).toBe('\x95');
        expect(toWinAnsi('• item')).toBe('\x95 item');
    });

    it('should map CP1252 0x80–0x9F punctuation and symbols', () => {
        expect(toWinAnsi('\u201A')).toBe('\x82'); // ‚
        expect(toWinAnsi('\u0192')).toBe('\x83'); // ƒ
        expect(toWinAnsi('\u201E')).toBe('\x84'); // „
        expect(toWinAnsi('\u2020')).toBe('\x86'); // †
        expect(toWinAnsi('\u2021')).toBe('\x87'); // ‡
        expect(toWinAnsi('\u02C6')).toBe('\x88'); // ˆ
        expect(toWinAnsi('\u2030')).toBe('\x89'); // ‰
        expect(toWinAnsi('\u2039')).toBe('\x8B'); // ‹
        expect(toWinAnsi('\u203A')).toBe('\x9B'); // ›
        expect(toWinAnsi('\u02DC')).toBe('\x98'); // ˜
        expect(toWinAnsi('\u2122')).toBe('\x99'); // ™
    });

    it('should map CP1252 European latin letters (Š Œ Ž š œ ž Ÿ)', () => {
        expect(toWinAnsi('\u0160')).toBe('\x8A'); // Š
        expect(toWinAnsi('\u0152')).toBe('\x8C'); // Œ
        expect(toWinAnsi('\u017D')).toBe('\x8E'); // Ž
        expect(toWinAnsi('\u0161')).toBe('\x9A'); // š
        expect(toWinAnsi('\u0153')).toBe('\x9C'); // œ
        expect(toWinAnsi('\u017E')).toBe('\x9E'); // ž
        expect(toWinAnsi('\u0178')).toBe('\x9F'); // Ÿ
    });

    it('should pass through NBSP as WinAnsi 0xA0', () => {
        // 0xA0 is a valid WinAnsi character (non-breaking space), passed through
        expect(toWinAnsi('\u00A0')).toBe('\xA0');
    });

    it('should convert narrow NBSP to space', () => {
        expect(toWinAnsi('\u202F')).toBe(' ');
    });

    it('should convert tabs and newlines to space', () => {
        expect(toWinAnsi('\t')).toBe(' ');
        expect(toWinAnsi('\n')).toBe(' ');
        expect(toWinAnsi('\r')).toBe(' ');
    });

    it('should replace unmappable characters with ?', () => {
        expect(toWinAnsi('\u0E01')).toBe('?'); // Thai ko kai
    });

    it('should handle empty string', () => {
        expect(toWinAnsi('')).toBe('');
    });

    it('should skip control characters below 0x20', () => {
        expect(toWinAnsi('\x01\x02\x03')).toBe('');
    });
});

describe('pdfString', () => {
    it('should wrap text in parentheses', () => {
        expect(pdfString('Hello')).toBe('(Hello)');
    });

    it('should escape backslashes', () => {
        expect(pdfString('a\\b')).toBe('(a\\\\b)');
    });

    it('should escape parentheses', () => {
        expect(pdfString('(test)')).toBe('(\\(test\\))');
    });

    it('should handle empty string', () => {
        expect(pdfString('')).toBe('()');
    });

    it('should handle combined escaping', () => {
        expect(pdfString('a\\(b)')).toBe('(a\\\\\\(b\\))');
    });
});

describe('truncate', () => {
    it('should return string unchanged if within max', () => {
        expect(truncate('Hello', 10)).toBe('Hello');
    });

    it('should truncate and add .. if over max', () => {
        expect(truncate('Hello World', 7)).toBe('Hello..');
    });

    it('should handle exact max length', () => {
        expect(truncate('Hello', 5)).toBe('Hello');
    });

    it('should handle empty string', () => {
        expect(truncate('', 10)).toBe('');
    });

    it('should handle null-ish', () => {
        expect(truncate(undefined as unknown as string, 10)).toBe('');
    });

    it('should return .. for max=1 (negative slice guard)', () => {
        expect(truncate('Hello', 1)).toBe('..');
    });

    it('should return .. for max=0', () => {
        expect(truncate('Hello', 0)).toBe('..');
    });

    it('should return .. for max=2 with long input', () => {
        expect(truncate('Hello', 2)).toBe('..');
    });

    it('should return H.. for max=3', () => {
        expect(truncate('Hello', 3)).toBe('H..');
    });
});

describe('helveticaWidth', () => {
    it('should return positive width for text', () => {
        expect(helveticaWidth('Hello', 10)).toBeGreaterThan(0);
    });

    it('should return 0 for empty string', () => {
        expect(helveticaWidth('', 10)).toBe(0);
    });

    it('should scale linearly with font size', () => {
        const w10 = helveticaWidth('ABC', 10);
        const w20 = helveticaWidth('ABC', 20);
        expect(w20).toBeCloseTo(w10 * 2, 5);
    });

    it('should handle digits', () => {
        expect(helveticaWidth('123', 10)).toBeGreaterThan(0);
    });

    it('should handle spaces', () => {
        const withSpace = helveticaWidth('A B', 10);
        const without = helveticaWidth('AB', 10);
        expect(withSpace).toBeGreaterThan(without);
    });

    it('should use correct width for em-dash (U+2014)', () => {
        // Em-dash is 1000 design units in Helvetica
        const w = helveticaWidth('\u2014', 10);
        expect(w).toBeCloseTo(10.0, 2); // 1000 * 10 / 1000 = 10
    });

    it('should use correct width for en-dash (U+2013)', () => {
        // En-dash is 556 design units in Helvetica
        const w = helveticaWidth('\u2013', 10);
        expect(w).toBeCloseTo(5.56, 2); // 556 * 10 / 1000 = 5.56
    });

    it('should use correct width for ellipsis (U+2026)', () => {
        // Ellipsis is 1000 design units in Helvetica
        const w = helveticaWidth('\u2026', 10);
        expect(w).toBeCloseTo(10.0, 2);
    });

    it('should use correct width for curly quotes', () => {
        // Single quotes: 222 design units
        const w1 = helveticaWidth('\u2018', 10);
        expect(w1).toBeCloseTo(2.22, 2);
        // Double quotes: 333 design units
        const w2 = helveticaWidth('\u201C', 10);
        expect(w2).toBeCloseTo(3.33, 2);
    });
});

describe('createEncodingContext', () => {
    describe('Latin mode (no fontEntries)', () => {
        const enc = createEncodingContext([]);

        it('should set isUnicode to false', () => {
            expect(enc.isUnicode).toBe(false);
        });

        it('should use /F1 and /F2 for Helvetica', () => {
            expect(enc.f1).toBe('/F1');
            expect(enc.f2).toBe('/F2');
        });

        it('should encode text as PDF string literal', () => {
            expect(enc.ps('Hello')).toBe('(Hello)');
        });

        it('should calculate width using Helvetica metrics', () => {
            expect(enc.tw('ABC', 10)).toBeGreaterThan(0);
        });
    });

    describe('Unicode mode (with fontEntries)', () => {
        const mockFontData: FontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 10, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
            fontName: 'TestFont',
            cmap: { 65: 1, 66: 2, 32: 3 },
            defaultWidth: 500,
            widths: { 1: 600, 2: 700, 3: 250 },
            pdfWidthArray: '1 [600] 2 [700] 3 [250]',
            ttfBase64: '',
            gsub: {},
            markAnchors: null,
            mark2mark: null,
        };
        const fontEntries: FontEntry[] = [{ fontData: mockFontData, fontRef: '/F3', lang: 'test' }];

        it('should set isUnicode to true', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.isUnicode).toBe(true);
        });

        it('should use font entry ref for f1 and f2', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.f1).toBe('/F3');
            expect(enc.f2).toBe('/F3');
        });

        it('should encode text as hex string', () => {
            const enc = createEncodingContext(fontEntries);
            const result = enc.ps('AB');
            expect(result).toMatch(/^<[0-9A-F]+>$/);
            expect(result).toContain('0001'); // GID 1 for 'A'
            expect(result).toContain('0002'); // GID 2 for 'B'
        });

        it('should produce text runs', () => {
            const enc = createEncodingContext(fontEntries);
            const runs = enc.textRuns('AB', 10);
            expect(runs.length).toBeGreaterThan(0);
            expect(runs[0].fontRef).toBe('/F3');
            expect(runs[0].widthPt).toBeGreaterThan(0);
        });

        it('should track used glyph IDs', () => {
            const enc = createEncodingContext(fontEntries);
            enc.ps('A');
            const gids = enc.getUsedGids!();
            expect(gids.get('/F3')!.has(1)).toBe(true);
        });

        it('should handle NBSP normalization', () => {
            const enc = createEncodingContext(fontEntries);
            // NBSP (0xA0) should be normalized to space (0x20 → GID 3)
            enc.ps('\u00A0');
            const gids = enc.getUsedGids!();
            expect(gids.get('/F3')!.has(3)).toBe(true);
        });

        it('should calculate width via textRuns', () => {
            const enc = createEncodingContext(fontEntries);
            const w = enc.tw('AB', 10);
            // A=600, B=700. Total design width = 1300, scale = 10/1000 = 0.01
            expect(w).toBeCloseTo(13, 5);
        });

        it('should return 0 width for empty string', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.tw('', 10)).toBe(0);
        });

        it('should return empty hex for empty ps()', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.ps('')).toBe('<>');
        });

        it('should return empty array for empty textRuns()', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.textRuns('', 10)).toEqual([]);
        });

        it('should handle narrow NBSP normalization in textRuns', () => {
            const enc = createEncodingContext(fontEntries);
            // 0x202F → 0x20 → GID 3 (space)
            const runs = enc.textRuns('\u202F', 10);
            expect(runs.length).toBe(1);
            expect(runs[0].hexStr).toContain('0003'); // space GID
        });

        it('should handle narrow NBSP normalization in ps()', () => {
            const enc = createEncodingContext(fontEntries);
            const result = enc.ps('\u202F');
            expect(result).toContain('0003'); // space GID
        });

        it('should use GID 0 for unmapped characters', () => {
            const enc = createEncodingContext(fontEntries);
            const runs = enc.textRuns('\u9999', 10); // not in cmap
            expect(runs.length).toBe(1);
            expect(runs[0].hexStr).toContain('0000');
        });

        it('should expose fontData from primary entry', () => {
            const enc = createEncodingContext(fontEntries);
            expect(enc.fontData).toBe(mockFontData);
        });
    });

    describe('Unicode mode with Thai text', () => {
        const thaiFont: FontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 20, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
            fontName: 'ThaiFont',
            cmap: { 0x0E01: 10, 0x0E02: 11, 0x0E31: 12, 32: 5 },
            defaultWidth: 500,
            widths: { 10: 600, 11: 600, 12: 0, 5: 250 },
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
            markAnchors: null,
            mark2mark: null,
        };
        const thaiFontEntries: FontEntry[] = [{ fontData: thaiFont, fontRef: '/F4', lang: 'th' }];

        it('textRuns should return shaped data for Thai text', () => {
            const enc = createEncodingContext(thaiFontEntries);
            const runs = enc.textRuns('\u0E01\u0E02', 10);
            expect(runs.length).toBe(1);
            expect(runs[0].shaped).not.toBeNull();
            expect(runs[0].shaped!.length).toBeGreaterThan(0);
            expect(runs[0].hexStr).toBeNull();
        });

        it('textRuns should compute width for Thai shaped glyphs', () => {
            const enc = createEncodingContext(thaiFontEntries);
            const runs = enc.textRuns('\u0E01', 10);
            // GID 10, width 600, scale 10/1000 = 6.0
            expect(runs[0].widthPt).toBeCloseTo(6.0, 2);
        });

        it('textRuns should skip zero-advance marks in width', () => {
            const enc = createEncodingContext(thaiFontEntries);
            // กั — base + above vowel (isZeroAdvance=true → not counted in width)
            const runs = enc.textRuns('\u0E01\u0E31', 10);
            expect(runs[0].shaped!.length).toBe(2);
            // Only base glyph contributes to width
            expect(runs[0].widthPt).toBeCloseTo(6.0, 2);
        });

        it('ps should return shaped hex for Thai text', () => {
            const enc = createEncodingContext(thaiFontEntries);
            const result = enc.ps('\u0E01');
            expect(result).toMatch(/^<[0-9A-F]+>$/);
            expect(result).toContain('000A'); // GID 10
        });

        it('ps should track glyph IDs for Thai text', () => {
            const enc = createEncodingContext(thaiFontEntries);
            enc.ps('\u0E01');
            const gids = enc.getUsedGids!();
            expect(gids.get('/F4')!.has(10)).toBe(true);
        });
    });

    describe('Unicode mode with Arabic text (BiDi)', () => {
        // Minimal Arabic font mock with GSUB positional forms
        const arabicFont: FontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 30, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
            fontName: 'ArabicFont',
            cmap: {
                0x0645: 20, // meem
                0x0631: 21, // ra
                0x062D: 22, // ha
                0x0628: 23, // ba
                0x0627: 24, // alef
                32: 5,
            },
            defaultWidth: 500,
            widths: { 20: 600, 21: 400, 22: 500, 23: 500, 24: 300, 5: 250 },
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
            markAnchors: null,
            mark2mark: null,
        };
        const arabicEntries: FontEntry[] = [{ fontData: arabicFont, fontRef: '/F5', lang: 'ar' }];

        it('textRuns should return shaped data for Arabic text', () => {
            const enc = createEncodingContext(arabicEntries);
            const runs = enc.textRuns('\u0645\u0631\u062D\u0628\u0627', 10);
            expect(runs.length).toBeGreaterThan(0);
            // Should be shaped output (reverse of logical order for RTL)
            expect(runs[0].shaped).not.toBeNull();
        });

        it('textRuns should produce non-zero width for Arabic', () => {
            const enc = createEncodingContext(arabicEntries);
            const runs = enc.textRuns('\u0645\u0631', 10);
            expect(runs.length).toBe(1);
            expect(runs[0].widthPt).toBeGreaterThan(0);
        });

        it('ps should produce hex string for Arabic text', () => {
            const enc = createEncodingContext(arabicEntries);
            const result = enc.ps('\u0645\u0631');
            expect(result).toMatch(/^<[0-9A-F]+>$/);
        });

        it('ps should track glyph IDs for Arabic text', () => {
            const enc = createEncodingContext(arabicEntries);
            enc.ps('\u0645\u0631');
            const gids = enc.getUsedGids!();
            expect(gids.get('/F5')!.size).toBeGreaterThan(0);
        });
    });

    describe('Unicode mode with Hebrew text (BiDi)', () => {
        const hebrewFont: FontData = {
            metrics: { unitsPerEm: 1000, numGlyphs: 30, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
            fontName: 'HebrewFont',
            cmap: {
                0x05E9: 30, // shin
                0x05DC: 31, // lamed
                0x05D5: 32, // vav
                0x05DD: 33, // mem-final
                32: 5,
            },
            defaultWidth: 500,
            widths: { 30: 600, 31: 400, 32: 300, 33: 500, 5: 250 },
            pdfWidthArray: '',
            ttfBase64: '',
            gsub: {},
            markAnchors: null,
            mark2mark: null,
        };
        const hebrewEntries: FontEntry[] = [{ fontData: hebrewFont, fontRef: '/F6', lang: 'he' }];

        it('textRuns should reverse Hebrew glyphs for visual order', () => {
            const enc = createEncodingContext(hebrewEntries);
            // "שלום" in logical order, should be reversed for visual
            const runs = enc.textRuns('\u05E9\u05DC\u05D5\u05DD', 10);
            expect(runs.length).toBe(1);
            expect(runs[0].hexStr).not.toBeNull();
            // First glyph in hex should be mem-final (GID 33 = 0021), not shin
            // BiDi reversal: שלום → םולש (visual order: mem-final first)
            const hex = runs[0].hexStr!;
            expect(hex.startsWith('<0021')).toBe(true); // mem-final GID 33 = 0x0021
        });

        it('ps should produce reversed hex for Hebrew text', () => {
            const enc = createEncodingContext(hebrewEntries);
            const result = enc.ps('\u05E9\u05DC\u05D5\u05DD');
            // Should start with mem-final (GID 33 = 0x0021)
            expect(result.startsWith('<0021')).toBe(true);
        });

        it('textRuns should compute correct width for Hebrew', () => {
            const enc = createEncodingContext(hebrewEntries);
            const runs = enc.textRuns('\u05E9\u05DC', 10);
            // shin=600 + lamed=400 = 1000 design units, scale 10/1000 = 10pt
            expect(runs[0].widthPt).toBeCloseTo(10.0, 2);
        });
    });

    describe('RTL title rendering — Helvetica continuation + run order', () => {
        it('should not split English words with CID space runs', () => {
            const fd = makeRealHebrewFontData();
            const fontEntries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'he' }];
            const enc = createEncodingContext(fontEntries);

            const runs = enc.textRuns('\u05D4\u05D0\u05DC\u05E4\u05D1\u05D9\u05EA \u05D4\u05E2\u05D1\u05E8\u05D9 \u2013 Hebrew Alphabet Coverage', 16);

            // English text should be ONE Helvetica run, not split by CID space runs
            const englishRun = runs.find(r => r.fontRef === '/F1' && r.text.includes('Hebrew') && r.text.includes('Alphabet'));
            expect(englishRun).toBeDefined();
            expect(englishRun!.text).toBe('Hebrew Alphabet Coverage');
        });

        it('should produce correct PDF operators with English first for RTL title', () => {
            const fd = makeRealHebrewFontData();
            const fontEntries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'he' }];
            const enc = createEncodingContext(fontEntries);

            const pdfOps = txt('\u05D4\u05D0\u05DC\u05E4\u05D1\u05D9\u05EA \u05D4\u05E2\u05D1\u05E8\u05D9 \u2013 Hebrew Alphabet Coverage', 36, 700, enc.f2, 16, enc);

            // First BT...ET block should use /F1 (Helvetica for English)
            const firstBT = pdfOps.split('\n')[0];
            expect(firstBT).toContain('/F1');
            expect(firstBT).toContain('(Hebrew Alphabet Coverage)');
        });

        it('should extract en-dash from Arabic shaped run to Helvetica', () => {
            const fd = makeRealArabicFontData();
            const fontEntries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'ar' }];
            const enc = createEncodingContext(fontEntries);

            const runs = enc.textRuns('\u0627\u0644\u0623\u0628\u062C\u062F\u064A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u2013 Arabic Script Coverage', 16);

            // En-dash should be in Helvetica (/F1), not in CIDFont
            const enDashRun = runs.find(r => r.text.includes('\u2013'));
            expect(enDashRun).toBeDefined();
            expect(enDashRun!.fontRef).toBe('/F1');
        });
    });
});
