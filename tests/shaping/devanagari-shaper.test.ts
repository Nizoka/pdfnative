import { describe, it, expect } from 'vitest';
import { buildDevanagariClusters, containsDevanagari, shapeDevanagariText, DEVANAGARI_START, DEVANAGARI_END } from '../../src/shaping/devanagari-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

// ── Mock FontData ────────────────────────────────────────────────────
function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    // Map Devanagari codepoints to sequential GIDs starting at 100
    for (let cp = DEVANAGARI_START; cp <= DEVANAGARI_END; cp++) {
        cmap[cp] = cp - DEVANAGARI_START + 100;
        widths[cp - DEVANAGARI_START + 100] = 600;
    }
    // Space
    cmap[0x20] = 3;
    widths[3] = 250;
    return {
        cmap,
        widths,
        defaultWidth: 500,
        gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 1117, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansDevanagari',
        pdfWidthArray: '',
        ttfBase64: '',
        ...overrides,
    };
}

// Helper: GID for a Devanagari codepoint
function gid(cp: number): number { return cp - DEVANAGARI_START + 100; }

// ── containsDevanagari ───────────────────────────────────────────────

describe('containsDevanagari', () => {
    it('should return true for Devanagari text', () => {
        expect(containsDevanagari('नमस्ते')).toBe(true);
    });

    it('should return false for ASCII text', () => {
        expect(containsDevanagari('Hello World')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(containsDevanagari('')).toBe(false);
    });

    it('should detect single Devanagari character', () => {
        expect(containsDevanagari('\u0915')).toBe(true); // Ka
    });

    it('should detect Devanagari mixed with Latin', () => {
        expect(containsDevanagari('Hello नमस्ते World')).toBe(true);
    });

    it('should return false for Bengali text', () => {
        expect(containsDevanagari('বাংলা')).toBe(false);
    });

    it('should return false for Tamil text', () => {
        expect(containsDevanagari('தமிழ்')).toBe(false);
    });
});

// ── buildDevanagariClusters ──────────────────────────────────────────

describe('buildDevanagariClusters', () => {
    it('should handle single consonant', () => {
        const clusters = buildDevanagariClusters('\u0915'); // Ka
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915]);
        expect(clusters[0].hasReph).toBe(false);
    });

    it('should handle consonant + halant + consonant (conjunct)', () => {
        // Ka + Halant + Ra → conjunct cluster
        const clusters = buildDevanagariClusters('\u0915\u094D\u0930');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x094D, 0x0930]);
    });

    it('should handle triple conjunct C + H + C + H + C', () => {
        // Ka + Halant + Sha + Halant + Ra
        const clusters = buildDevanagariClusters('\u0915\u094D\u0936\u094D\u0930');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x094D, 0x0936, 0x094D, 0x0930]);
    });

    it('should detect reph (Ra + Halant at start)', () => {
        // Ra + Halant + Ka → reph on Ka
        const clusters = buildDevanagariClusters('\u0930\u094D\u0915');
        expect(clusters.length).toBe(1);
        expect(clusters[0].hasReph).toBe(true);
        expect(clusters[0].codepoints).toEqual([0x0930, 0x094D, 0x0915]);
    });

    it('should handle pre-base matra ि (short i)', () => {
        // Ka + ि → cluster with pre-base matra
        const clusters = buildDevanagariClusters('\u0915\u093F');
        expect(clusters.length).toBe(1);
        expect(clusters[0].preBaseMatras.length).toBe(1);
    });

    it('should handle consonant + post-base matra ा (aa)', () => {
        // Ka + ा
        const clusters = buildDevanagariClusters('\u0915\u093E');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x093E]);
    });

    it('should handle consonant + nukta', () => {
        // Ka + Nukta → Ka with nukta dot
        const clusters = buildDevanagariClusters('\u0915\u093C');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x093C]);
    });

    it('should handle explicit halant (visible virama)', () => {
        // Ka + Halant (not followed by consonant) → visible virama
        const clusters = buildDevanagariClusters('\u0915\u094D');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x094D]);
    });

    it('should handle modifiers (anusvara, visarga)', () => {
        // Ka + Anusvara
        const clusters = buildDevanagariClusters('\u0915\u0902');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x0915, 0x0902]);
    });

    it('should separate independent vowels into clusters', () => {
        // Independent vowels are base characters
        const clusters = buildDevanagariClusters('\u0905\u0906'); // A + AA
        expect(clusters.length).toBe(2);
    });

    it('should handle space between consonants', () => {
        const clusters = buildDevanagariClusters('\u0915 \u0916'); // Ka space Kha
        expect(clusters.length).toBe(3);
    });

    it('should handle Devanagari digits', () => {
        const clusters = buildDevanagariClusters('\u0966\u0967'); // 0 + 1
        expect(clusters.length).toBe(2);
    });

    it('should handle split vowel ो (o)', () => {
        // Ka + ो → should have pre-base matra
        const clusters = buildDevanagariClusters('\u0915\u094B');
        expect(clusters.length).toBe(1);
        expect(clusters[0].preBaseMatras.length).toBe(1);
    });
});

// ── shapeDevanagariText ──────────────────────────────────────────────

describe('shapeDevanagariText', () => {
    it('should shape single consonant', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915', fd); // Ka
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(gid(0x0915));
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should shape space', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText(' ', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3); // space GID
    });

    it('should shape NBSP as space', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u00A0', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3);
    });

    it('should shape consonant + halant without ligature', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u094D', fd); // Ka + Halant
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915));
        expect(shaped[1].gid).toBe(gid(0x094D));
    });

    it('should shape consonant + post-base matra', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u093E', fd); // Ka + aa
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915)); // Ka
        expect(shaped[1].gid).toBe(gid(0x093E)); // aa matra
        expect(shaped[1].isZeroAdvance).toBe(false); // post-base = normal advance
    });

    it('should shape consonant + pre-base matra ि', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u093F', fd); // Ka + i
        // Pre-base matra should be emitted before the consonant
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x093F)); // i matra (pre-base)
        expect(shaped[1].gid).toBe(gid(0x0915)); // Ka
    });

    it('should shape conjunct with ligature', () => {
        const kaGid = gid(0x0915);
        const halantGid = gid(0x094D);
        const raGid = gid(0x0930);
        const ligGid = 800;
        const fd = mockFontData({
            ligatures: {
                [kaGid]: [[ligGid, halantGid, raGid]], // Ka + Halant + Ra → ligature
            },
            widths: { ...mockFontData().widths, [ligGid]: 700 },
        });
        const shaped = shapeDevanagariText('\u0915\u094D\u0930', fd); // Ka+Halant+Ra
        // Should produce single ligature glyph
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(ligGid);
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should fall back to individual glyphs without ligature', () => {
        const fd = mockFontData(); // no ligatures
        const shaped = shapeDevanagariText('\u0915\u094D\u0930', fd); // Ka+Halant+Ra
        expect(shaped.length).toBe(3);
        expect(shaped[0].gid).toBe(gid(0x0915)); // Ka
        expect(shaped[1].gid).toBe(gid(0x094D)); // Halant
        expect(shaped[2].gid).toBe(gid(0x0930)); // Ra
    });

    it('should shape reph (Ra + Halant + Ka)', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0930\u094D\u0915', fd);
        // Reph should be emitted as zero-advance mark after base Ka
        expect(shaped.length >= 2).toBe(true);
        // First shaped glyph should be reph (Ra form, zero-advance)
        expect(shaped[0].isZeroAdvance).toBe(true);
        // Second should be the base Ka
        expect(shaped[1].gid).toBe(gid(0x0915));
    });

    it('should shape consonant + nukta', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u093C', fd); // Ka + Nukta
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915));
        expect(shaped[1].gid).toBe(gid(0x093C));
        expect(shaped[1].isZeroAdvance).toBe(true);
    });

    it('should shape consonant + anusvara', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u0902', fd); // Ka + Anusvara
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915));
        expect(shaped[1].gid).toBe(gid(0x0902));
        expect(shaped[1].isZeroAdvance).toBe(true);
    });

    it('should shape Devanagari digit', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0966', fd); // Digit 0
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(gid(0x0966));
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should shape multiple words with spaces', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915 \u0916', fd); // Ka space Kha
        expect(shaped.length).toBe(3);
    });

    it('should apply GPOS mark positioning when anchors present', () => {
        const kaGid = gid(0x0915);
        const iMatraGid = gid(0x093F);
        const fd = mockFontData({
            markAnchors: {
                bases: { [kaGid]: { 0: [300, 500] } },
                marks: { [iMatraGid]: [0, 200, 400] }, // classIdx=0, x=200, y=400
            },
        });
        const shaped = shapeDevanagariText('\u0915\u093F', fd);
        // Pre-base matra first, then consonant
        // The matra is pre-base so it's emitted before the consonant
        expect(shaped[0].gid).toBe(iMatraGid);
        expect(shaped[1].gid).toBe(kaGid);
    });

    it('should handle split vowel ो (e + aa)', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u094B', fd); // Ka + ो
        // Should split: े (pre) + Ka + ा (post)
        expect(shaped.length).toBe(3);
        expect(shaped[0].gid).toBe(gid(0x0947)); // े pre-base
        expect(shaped[1].gid).toBe(gid(0x0915)); // Ka
        expect(shaped[2].gid).toBe(gid(0x093E)); // ा post-base
    });

    it('should handle partial ligature match with remainder', () => {
        const kaGid = gid(0x0915);
        const halantGid = gid(0x094D);
        const raGid = gid(0x0930);
        const ligGid = 800;
        const fd = mockFontData({
            ligatures: {
                [kaGid]: [[ligGid, halantGid, raGid]], // Ka+H+Ra = ligature
            },
        });
        // Ka + Halant + Ra + Halant + Ta → ligature + Halant + Ta
        const shaped = shapeDevanagariText('\u0915\u094D\u0930\u094D\u0924', fd);
        expect(shaped[0].gid).toBe(ligGid); // Ka+H+Ra ligature
        expect(shaped.length).toBe(3); // ligature + halant + Ta
    });

    it('should return empty array for empty string', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('', fd);
        expect(shaped.length).toBe(0);
    });

    it('should handle independent vowel', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0905', fd); // A
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(gid(0x0905));
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should handle below-base matra ु (u)', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u0941', fd); // Ka + u
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915)); // Ka
        expect(shaped[1].gid).toBe(gid(0x0941)); // u matra
        expect(shaped[1].isZeroAdvance).toBe(true); // below-base = zero-advance
    });

    it('should handle above-base matra े (e)', () => {
        const fd = mockFontData();
        const shaped = shapeDevanagariText('\u0915\u0947', fd); // Ka + e
        expect(shaped.length).toBe(2);
        expect(shaped[0].gid).toBe(gid(0x0915)); // Ka
        expect(shaped[1].gid).toBe(gid(0x0947)); // e matra
        expect(shaped[1].isZeroAdvance).toBe(true); // above-base = zero-advance
    });
});
