import { describe, it, expect } from 'vitest';
import {
    shapeArabicText,
    containsArabic,
    containsHebrew,
    isLamAlef,
    ARABIC_START,
    ARABIC_END,
    HEBREW_START,
    HEBREW_END,
} from '../../src/shaping/arabic-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

/** Minimal mock FontData for Arabic shaping tests. */
function makeMockArabicFontData(): FontData {
    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 100, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 600, 800], capHeight: 700, stemV: 50 },
        fontName: 'TestArabicFont',
        cmap: {
            // Base Arabic letters
            0x0627: 1,  // ALEF
            0x0628: 2,  // BA
            0x062A: 3,  // TA
            0x062B: 4,  // THA
            0x0633: 5,  // SEEN
            0x0644: 6,  // LAM
            0x0645: 7,  // MEEM
            0x0646: 8,  // NOON
            0x064B: 9,  // FATHATAN (haraka)
            0x20: 10,   // Space
            // Arabic Presentation Forms B — positional forms
            0xFE8D: 1,  // ALEF isolated (same as base)
            0xFE8E: 11, // ALEF final
            0xFE8F: 2,  // BA isolated (same as base)
            0xFE90: 22, // BA final
            0xFE91: 20, // BA initial
            0xFE92: 21, // BA medial
            0xFE95: 3,  // TA isolated (same as base)
            0xFE96: 25, // TA final
            0xFE97: 23, // TA initial
            0xFE98: 24, // TA medial
            0xFEDD: 6,  // LAM isolated (same as base)
            0xFEDE: 28, // LAM final
            0xFEDF: 26, // LAM initial
            0xFEE0: 27, // LAM medial
            // Lam-Alef ligature presentation forms
            0xFEFB: 30, // Lam-Alef isolated
            0xFEFC: 31, // Lam-Alef final
        },
        defaultWidth: 500,
        widths: { 1: 600, 2: 500, 3: 500, 4: 500, 5: 550, 6: 400, 7: 500, 8: 500, 9: 0, 10: 250, 11: 600, 20: 500, 21: 500, 22: 500, 23: 500, 24: 500, 25: 500, 26: 400, 27: 400, 28: 400, 30: 800, 31: 800 },
        pdfWidthArray: '1 [600] 2 [500 500 500 550 400 500 500 0 250]',
        ttfBase64: 'AAAAAAAAAA==',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
}

// ── Constants ────────────────────────────────────────────────────────

describe('Arabic constants', () => {
    it('should define correct Arabic range', () => {
        expect(ARABIC_START).toBe(0x0600);
        expect(ARABIC_END).toBe(0x06FF);
    });

    it('should define correct Hebrew range', () => {
        expect(HEBREW_START).toBe(0x0590);
        expect(HEBREW_END).toBe(0x05FF);
    });
});

// ── containsArabic ──────────────────────────────────────────────────

describe('containsArabic', () => {
    it('should detect Arabic text', () => {
        expect(containsArabic('\u0645\u0631\u062D\u0628\u0627')).toBe(true); // مرحبا
    });

    it('should return false for Latin text', () => {
        expect(containsArabic('Hello World')).toBe(false);
    });

    it('should return false for empty text', () => {
        expect(containsArabic('')).toBe(false);
    });

    it('should detect Arabic in mixed text', () => {
        expect(containsArabic('Hello \u0645\u0631\u062D\u0628\u0627')).toBe(true);
    });

    it('should detect Arabic Presentation Forms', () => {
        expect(containsArabic('\uFE8D')).toBe(true); // Arabic Presentation Form
    });
});

// ── containsHebrew ──────────────────────────────────────────────────

describe('containsHebrew', () => {
    it('should detect Hebrew text', () => {
        expect(containsHebrew('\u05E9\u05DC\u05D5\u05DD')).toBe(true); // שלום
    });

    it('should return false for Latin text', () => {
        expect(containsHebrew('Hello')).toBe(false);
    });

    it('should return false for empty text', () => {
        expect(containsHebrew('')).toBe(false);
    });

    it('should return false for Arabic text', () => {
        expect(containsHebrew('\u0645\u0631\u062D\u0628\u0627')).toBe(false);
    });
});

// ── isLamAlef ────────────────────────────────────────────────────────

describe('isLamAlef', () => {
    it('should detect Lam + Alef ligature', () => {
        expect(isLamAlef(0x0644, 0x0627)).toBe(true);
    });

    it('should detect Lam + Alef with Hamza Above', () => {
        expect(isLamAlef(0x0644, 0x0623)).toBe(true);
    });

    it('should detect Lam + Alef with Hamza Below', () => {
        expect(isLamAlef(0x0644, 0x0625)).toBe(true);
    });

    it('should detect Lam + Alef with Madda', () => {
        expect(isLamAlef(0x0644, 0x0622)).toBe(true);
    });

    it('should not detect non-Lam first character', () => {
        expect(isLamAlef(0x0628, 0x0627)).toBe(false);
    });

    it('should not detect non-Alef second character', () => {
        expect(isLamAlef(0x0644, 0x0628)).toBe(false);
    });
});

// ── shapeArabicText ──────────────────────────────────────────────────

describe('shapeArabicText', () => {
    const fd = makeMockArabicFontData();

    it('should return empty array for empty string', () => {
        expect(shapeArabicText('', fd)).toEqual([]);
    });

    it('should produce glyphs from Arabic text', () => {
        // بسم (ba seen meem)
        const glyphs = shapeArabicText('\u0628\u0633\u0645', fd);
        expect(glyphs.length).toBe(3);
        // Each glyph should have a gid
        for (const g of glyphs) {
            expect(g.gid).toBeGreaterThanOrEqual(0);
        }
    });

    it('should apply positional forms via presentation forms', () => {
        // بت (BA + TA) — BA should be init, TA should be fina
        const glyphs = shapeArabicText('\u0628\u062A', fd);
        expect(glyphs.length).toBe(2);
        // BA initial form should be gid 20 (from presentation form cmap)
        expect(glyphs[0].gid).toBe(20);
        // TA final form should be gid 25 (from presentation form cmap)
        expect(glyphs[1].gid).toBe(25);
    });

    it('should detect isolated form for single letter', () => {
        // Single ALEF — should be isolated (no GSUB sub for isol → keeps base gid)
        const glyphs = shapeArabicText('\u0627', fd);
        expect(glyphs.length).toBe(1);
        expect(glyphs[0].gid).toBe(1); // Base ALEF gid
    });

    it('should handle harakat as zero-advance marks', () => {
        // BA + FATHATAN
        const glyphs = shapeArabicText('\u0628\u064B', fd);
        expect(glyphs.length).toBe(2);
        // FATHATAN should be zero advance (transparent / NSM)
        expect(glyphs[1].isZeroAdvance).toBe(true);
    });

    it('should attempt Lam-Alef ligature', () => {
        // LAM + ALEF → ligature
        const glyphs = shapeArabicText('\u0644\u0627', fd);
        // Should produce 1 glyph (ligature) instead of 2
        expect(glyphs.length).toBe(1);
        expect(glyphs[0].gid).toBe(30); // Lam-Alef ligature gid
    });

    it('should fall back to separate glyphs when ligature not in cmap', () => {
        // Use font without Lam-Alef ligature presentation forms
        const fdNoLig: FontData = {
            ...fd,
            cmap: { ...fd.cmap },
        };
        delete (fdNoLig.cmap as Record<number, number>)[0xFEFB];
        delete (fdNoLig.cmap as Record<number, number>)[0xFEFC];

        const glyphs = shapeArabicText('\u0644\u0627', fdNoLig);
        expect(glyphs.length).toBe(2);
    });

    it('should handle three-letter word with medial form', () => {
        // بلت (BA + LAM + TA) — BA init, LAM medial, TA final
        const glyphs = shapeArabicText('\u0628\u0644\u062A', fd);
        expect(glyphs.length).toBe(3);
        expect(glyphs[0].gid).toBe(20); // BA initial
        expect(glyphs[1].gid).toBe(27); // LAM medial
        expect(glyphs[2].gid).toBe(25); // TA final
    });
});
