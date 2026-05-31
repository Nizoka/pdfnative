import { describe, it, expect } from 'vitest';
import { buildTeluguClusters, containsTelugu, shapeTeluguText, TELUGU_START, TELUGU_END } from '../../src/shaping/telugu-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

// ── Mock FontData ────────────────────────────────────────────────────
function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    // Map Telugu codepoints to sequential GIDs starting at 100
    for (let cp = TELUGU_START; cp <= TELUGU_END; cp++) {
        cmap[cp] = cp - TELUGU_START + 100;
        widths[cp - TELUGU_START + 100] = 600;
    }
    // Space
    cmap[0x20] = 3;
    widths[3] = 250;
    return {
        cmap,
        widths,
        defaultWidth: 500,
        gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 256, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansTelugu',
        pdfWidthArray: '',
        ttfBase64: '',
        ...overrides,
    };
}

// ── containsTelugu ───────────────────────────────────────────────────

describe('containsTelugu', () => {
    it('should return true for Telugu text', () => {
        expect(containsTelugu('తెలుగు')).toBe(true);
    });

    it('should return false for ASCII text', () => {
        expect(containsTelugu('Hello World')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(containsTelugu('')).toBe(false);
    });

    it('should detect a single Telugu consonant', () => {
        expect(containsTelugu('\u0C15')).toBe(true); // Ka
    });

    it('should detect Telugu mixed with Latin', () => {
        expect(containsTelugu('Hello తెలుగు World')).toBe(true);
    });

    it('should return false for Tamil text', () => {
        expect(containsTelugu('தமிழ்')).toBe(false);
    });

    it('should return false for Devanagari text', () => {
        expect(containsTelugu('नमस्ते')).toBe(false);
    });
});

// ── Range constants ──────────────────────────────────────────────────

describe('TELUGU_START / TELUGU_END', () => {
    it('should define the correct Unicode range', () => {
        expect(TELUGU_START).toBe(0x0C00);
        expect(TELUGU_END).toBe(0x0C7F);
    });
});

// ── buildTeluguClusters ──────────────────────────────────────────────

describe('buildTeluguClusters', () => {
    it('should build one cluster for a single consonant', () => {
        const clusters = buildTeluguClusters('\u0C15'); // Ka
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toEqual([0x0C15]);
    });

    it('should group a consonant with its dependent vowel sign', () => {
        // క + ా (Ka + AA matra)
        const clusters = buildTeluguClusters('\u0C15\u0C3E');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toEqual([0x0C15, 0x0C3E]);
    });

    it('should form a conjunct across a virama (C + virama + C)', () => {
        // క + ్ + ష (Ka + virama + Ssa → kṣa conjunct)
        const clusters = buildTeluguClusters('\u0C15\u0C4D\u0C37');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toEqual([0x0C15, 0x0C4D, 0x0C37]);
    });

    it('should keep an explicit (trailing) virama in its own cluster', () => {
        const clusters = buildTeluguClusters('\u0C15\u0C4D'); // Ka + virama
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toEqual([0x0C15, 0x0C4D]);
    });

    it('should split a word into per-syllable clusters', () => {
        // తెలుగు → త + ె | ల + ు | గ + ు
        const clusters = buildTeluguClusters('తెలుగు');
        expect(clusters.length).toBeGreaterThanOrEqual(3);
    });

    it('should emit non-Telugu characters as standalone clusters', () => {
        const clusters = buildTeluguClusters('A\u0C15');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].codepoints).toEqual([0x41]);
        expect(clusters[1].codepoints).toEqual([0x0C15]);
    });

    it('should drop an orphan ZWJ', () => {
        const clusters = buildTeluguClusters('\u0C15\u200D\u0C16');
        // ZWJ dropped; two consonant clusters remain
        const all = clusters.flatMap((c) => c.codepoints);
        expect(all).not.toContain(0x200D);
    });
});

// ── shapeTeluguText (mock font) ──────────────────────────────────────

describe('shapeTeluguText', () => {
    it('should map a consonant to its glyph id', () => {
        const fd = mockFontData();
        const glyphs = shapeTeluguText('\u0C15', fd); // Ka → gid 100 + (0x15)
        expect(glyphs).toHaveLength(1);
        expect(glyphs[0].gid).toBe(0x0C15 - TELUGU_START + 100);
    });

    it('should never emit a .notdef (gid 0) for valid Telugu words', () => {
        const fd = mockFontData();
        for (const w of ['తెలుగు', 'నమస్తే', 'భారతదేశం', 'క్షి', 'శ్రీ']) {
            const glyphs = shapeTeluguText(w, fd);
            expect(glyphs.length).toBeGreaterThan(0);
            expect(glyphs.every((g) => g.gid !== 0)).toBe(true);
        }
    });

    it('should mark above vowel signs as zero-advance', () => {
        const fd = mockFontData();
        // క + ి (Ka + I — above mark)
        const glyphs = shapeTeluguText('\u0C15\u0C3F', fd);
        const mark = glyphs.find((g) => g.gid === 0x0C3F - TELUGU_START + 100);
        expect(mark).toBeDefined();
        expect(mark!.isZeroAdvance).toBe(true);
    });

    it('should keep right-spacing matras as normal advance', () => {
        const fd = mockFontData();
        // క + ా (Ka + AA — right spacing)
        const glyphs = shapeTeluguText('\u0C15\u0C3E', fd);
        const matra = glyphs.find((g) => g.gid === 0x0C3E - TELUGU_START + 100);
        expect(matra).toBeDefined();
        expect(matra!.isZeroAdvance).toBe(false);
    });

    it('should form a ligature when the font provides one', () => {
        // Ka(gid 100+0x15) + virama(gid 100+0x4D) + Ssa(gid 100+0x37) → ligature gid 900
        const kaGid = 0x0C15 - TELUGU_START + 100;
        const viramaGid = 0x0C4D - TELUGU_START + 100;
        const ssaGid = 0x0C37 - TELUGU_START + 100;
        const fd = mockFontData({ ligatures: { [kaGid]: [[900, viramaGid, ssaGid]] } });
        const glyphs = shapeTeluguText('\u0C15\u0C4D\u0C37', fd);
        expect(glyphs.some((g) => g.gid === 900)).toBe(true);
    });
});
