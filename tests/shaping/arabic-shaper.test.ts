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

    it('should treat mid-word ALEF as right-joining: final form, then a break', () => {
        // BA + ALEF + TA: ALEF joins the preceding BA (fina) but never the
        // following TA, so TA must be ISOLATED, not final. A former
        // 0x0626-0x0628 joining range swept ALEF into dual-joining, which
        // broke every word with a non-final alef.
        const glyphs = shapeArabicText('بات', fd);
        expect(glyphs.length).toBe(3);
        expect(glyphs[0].gid).toBe(20); // BA initial
        expect(glyphs[1].gid).toBe(11); // ALEF FINAL (FE8E) - joined to BA
        expect(glyphs[2].gid).toBe(3);  // TA ISOLATED - alef does not join left
    });

    it('should give the letter after a word-initial ALEF an initial form', () => {
        // ALEF + LAM + TA: ALEF isolated, LAM INITIAL (not medial), TA final
        // - the definite-article shape.
        const glyphs = shapeArabicText('الت', fd);
        expect(glyphs.length).toBe(3);
        expect(glyphs[0].gid).toBe(1);  // ALEF isolated (nothing precedes)
        expect(glyphs[1].gid).toBe(26); // LAM INITIAL - alef never joins left
        expect(glyphs[2].gid).toBe(25); // TA final
    });
});

// ── Persian / extended-Arabic joining (real bundled font, v1.7.0) ────

describe('Persian shaping with the bundled Noto Naskh Arabic font', async () => {
    const notoArabic = (await import('../../fonts/noto-arabic-data.js')) as unknown as FontData;
    const cmap = notoArabic.cmap;

    /** Presentation-form gid helper: the form's gid straight from the cmap. */
    const form = (cp: number): number => cmap[cp];

    it('bundles all Persian presentation forms', () => {
        for (const cp of [
            0xFB56, 0xFB57, 0xFB58, 0xFB59, // peh
            0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D, // tcheh
            0xFB8A, 0xFB8B,                 // jeh
            0xFB8E, 0xFB8F, 0xFB90, 0xFB91, // keheh
            0xFB92, 0xFB93, 0xFB94, 0xFB95, // gaf
            0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF, // farsi yeh
        ]) {
            expect(cmap[cp], `U+${cp.toString(16).toUpperCase()} missing from font`).toBeDefined();
        }
    });

    it('joins FARSI YEH inside "qymt" (price)', () => {
        // QAF + FARSI YEH + MEEM + TEH -> init, MEDIAL yeh, medi, fina.
        const glyphs = shapeArabicText('قیمت', notoArabic);
        expect(glyphs.map(g => g.gid)).toEqual([
            form(0xFED7), // qaf initial
            form(0xFBFF), // farsi yeh MEDIAL - was isolated before v1.7.0
            form(0xFEE4), // meem medial
            form(0xFE96), // teh final
        ]);
    });

    it('joins FARSI YEH inside "rial"', () => {
        // REH + FARSI YEH + ALEF + LAM: reh isolated (right-joiner at word
        // start), yeh INITIAL, alef FINAL, lam isolated after the alef break.
        const glyphs = shapeArabicText('ریال', notoArabic);
        expect(glyphs.map(g => g.gid)).toEqual([
            form(0xFEAD), // reh isolated
            form(0xFBFE), // farsi yeh INITIAL
            form(0xFE8E), // alef FINAL - joined to the yeh
            form(0xFEDD), // lam ISOLATED - alef never joins left
        ]);
    });

    it('shapes "sal" (year) with a final alef and isolated lam', () => {
        const glyphs = shapeArabicText('سال', notoArabic);
        expect(glyphs.map(g => g.gid)).toEqual([
            form(0xFEB3), // seen initial
            form(0xFE8E), // alef FINAL - rendered bare before v1.7.0
            form(0xFEDD), // lam ISOLATED
        ]);
    });

    it('joins PEH and GAF: "pedar" (father) and "gol" (flower)', () => {
        const pedar = shapeArabicText('پدر', notoArabic);
        expect(pedar.map(g => g.gid)).toEqual([
            form(0xFB58), // peh INITIAL - was isolated (class U) before v1.7.0
            form(0xFEAA), // dal final
            form(0xFEAD), // reh isolated
        ]);
        const gol = shapeArabicText('گل', notoArabic);
        expect(gol.map(g => g.gid)).toEqual([
            form(0xFB94), // gaf initial
            form(0xFEDE), // lam final
        ]);
    });

    it('joins TCHEH: "chai" (tea)', () => {
        const glyphs = shapeArabicText('چای', notoArabic);
        expect(glyphs.map(g => g.gid)).toEqual([
            form(0xFB7C), // tcheh INITIAL
            form(0xFE8E), // alef final
            form(0xFBFC), // farsi yeh isolated (after the alef break)
        ]);
    });

    it('shapes "assalam" with an initial lam after the article alef', () => {
        // ALEF + LAM + SEEN + LAM + ALEF + MEEM: the second LAM + ALEF pair
        // ligates (lam-alef final), the first LAM must be INITIAL, and the
        // final MEEM stands isolated after the ligature's alef break.
        const glyphs = shapeArabicText('السلام', notoArabic);
        expect(glyphs.map(g => g.gid)).toEqual([
            form(0xFE8D), // alef isolated
            form(0xFEDF), // lam INITIAL - was medial before v1.7.0
            form(0xFEB4), // seen medial
            form(0xFEFC), // lam-alef FINAL ligature
            form(0xFEE1), // meem isolated
        ]);
    });
});
