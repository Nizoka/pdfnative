import { describe, it, expect } from 'vitest';
import { buildBengaliClusters, containsBengali, shapeBengaliText, BENGALI_START, BENGALI_END } from '../../src/shaping/bengali-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

// ── Mock FontData ────────────────────────────────────────────────────
function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    // Map Bengali codepoints to sequential GIDs starting at 100
    for (let cp = BENGALI_START; cp <= BENGALI_END; cp++) {
        cmap[cp] = cp - BENGALI_START + 100;
        widths[cp - BENGALI_START + 100] = 600;
    }
    // Space
    cmap[0x20] = 3;
    widths[3] = 250;
    return {
        cmap,
        widths,
        defaultWidth: 500,
        gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 730, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansBengali',
        pdfWidthArray: '',
        ttfBase64: '',
        ...overrides,
    };
}

// ── containsBengali ──────────────────────────────────────────────────

describe('containsBengali', () => {
    it('should return true for Bengali text', () => {
        expect(containsBengali('বাংলা')).toBe(true);
    });

    it('should return false for ASCII text', () => {
        expect(containsBengali('Hello World')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(containsBengali('')).toBe(false);
    });

    it('should detect single Bengali character', () => {
        expect(containsBengali('\u0995')).toBe(true); // Ka
    });

    it('should detect Bengali mixed with Latin', () => {
        expect(containsBengali('Hello বাংলা World')).toBe(true);
    });

    it('should return false for Thai text', () => {
        expect(containsBengali('สวัสดี')).toBe(false);
    });

    it('should return false for Tamil text', () => {
        expect(containsBengali('தமிழ்')).toBe(false);
    });
});

// ── Range constants ──────────────────────────────────────────────────

describe('BENGALI_START / BENGALI_END', () => {
    it('should define correct Unicode range', () => {
        expect(BENGALI_START).toBe(0x0980);
        expect(BENGALI_END).toBe(0x09FF);
    });
});

// ── buildBengaliClusters ─────────────────────────────────────────────

describe('buildBengaliClusters', () => {
    it('should create separate clusters for standalone consonants', () => {
        // ক খ (Ka, Kha) — two separate consonants
        const clusters = buildBengaliClusters('\u0995\u0996');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].codepoints).toContain(0x0995);
        expect(clusters[1].codepoints).toContain(0x0996);
    });

    it('should group consonant + matra into one cluster', () => {
        // কি = Ka + i-matra (0x09BF)
        const clusters = buildBengaliClusters('\u0995\u09BF');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0995);
        expect(clusters[0].codepoints).toContain(0x09BF);
    });

    it('should handle halant-mediated conjunct', () => {
        // ক্ষ = Ka + Halant + Ssa
        const clusters = buildBengaliClusters('\u0995\u09CD\u09B7');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0995); // Ka
        expect(clusters[0].codepoints).toContain(0x09CD); // Halant
        expect(clusters[0].codepoints).toContain(0x09B7); // Ssa
    });

    it('should detect reph (Ra + Halant at start)', () => {
        // র্ক = Ra + Halant + Ka (reph)
        const clusters = buildBengaliClusters('\u09B0\u09CD\u0995');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].hasReph).toBe(true);
    });

    it('should handle independent vowel as base', () => {
        // অ (A)
        const clusters = buildBengaliClusters('\u0985');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0985);
    });

    it('should handle modifier (anusvara) attached to cluster', () => {
        // কং = Ka + Anusvara
        const clusters = buildBengaliClusters('\u0995\u0982');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0982);
    });

    it('should handle nukta', () => {
        // ড়  = Da + Nukta (0x09BC)
        const clusters = buildBengaliClusters('\u09A1\u09BC');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x09BC);
    });

    it('should recognize pre-base matras', () => {
        // কি = Ka + i-matra — 0x09BF is pre-base
        const clusters = buildBengaliClusters('\u0995\u09BF');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].preBaseMatras.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
        expect(buildBengaliClusters('')).toEqual([]);
    });

    it('should handle ASCII characters as individual clusters', () => {
        const clusters = buildBengaliClusters('AB');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].codepoints).toContain(65);
        expect(clusters[1].codepoints).toContain(66);
    });

    it('should handle mixed Bengali and ASCII', () => {
        const clusters = buildBengaliClusters('A\u0995B');
        expect(clusters).toHaveLength(3);
    });

    it('should handle multi-consonant conjunct', () => {
        // ক্ত = Ka + Halant + Ta
        const clusters = buildBengaliClusters('\u0995\u09CD\u09A4');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints.length).toBe(3);
    });

    it('should handle triple conjunct', () => {
        // ক্ষ্ম = Ka + Halant + Ssa + Halant + Ma
        const clusters = buildBengaliClusters('\u0995\u09CD\u09B7\u09CD\u09AE');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints.length).toBe(5);
    });

    it('should handle explicit halant (visible virama) at end of word', () => {
        // ক্ = Ka + Halant (no following consonant)
        const clusters = buildBengaliClusters('\u0995\u09CD');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x09CD);
    });

    it('should handle bengali digits', () => {
        // ০১২ = digits 0-2
        const clusters = buildBengaliClusters('\u09E6\u09E7\u09E8');
        expect(clusters).toHaveLength(3);
    });

    it('should handle split vowel sign o (ো)', () => {
        // কো = Ka + ো (o) = Ka + ে + া conceptually
        const clusters = buildBengaliClusters('\u0995\u09CB');
        expect(clusters).toHaveLength(1);
    });

    it('should handle split vowel sign au (ৌ)', () => {
        // কৌ = Ka + ৌ (au)
        const clusters = buildBengaliClusters('\u0995\u09CC');
        expect(clusters).toHaveLength(1);
    });

    it('should handle space between clusters', () => {
        const clusters = buildBengaliClusters('\u0995 \u0996');
        expect(clusters).toHaveLength(3);
    });
});

// ── shapeBengaliText ─────────────────────────────────────────────────

describe('shapeBengaliText', () => {
    it('should return glyphs for simple consonant', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u0995', fd); // Ka
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.some(g => g.gid !== 0)).toBe(true);
    });

    it('should return positioned glyphs for consonant + matra', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u0995\u09BE', fd); // Ka + aa-matra
        expect(shaped.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle pre-base matra reordering', () => {
        const fd = mockFontData();
        // কি = Ka + i-matra (0x09BF is pre-base, should appear before Ka visually)
        const shaped = shapeBengaliText('\u0995\u09BF', fd);
        expect(shaped.length).toBeGreaterThanOrEqual(2);
        // The first glyph should be the pre-base matra (reordered before base)
        const matraGid = fd.cmap[0x09BF];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle split vowel o (ো = ে + া)', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u0995\u09CB', fd); // Ka + o-matra
        // Should produce at least 3 glyphs: pre-base ে, Ka, post-base া
        expect(shaped.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle split vowel au (ৌ)', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u0995\u09CC', fd); // Ka + au-matra
        expect(shaped.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle halant-mediated conjunct with GSUB', () => {
        // When GSUB maps a GID, the substituted form should be used
        const kaGid = 100; // Ka = 0x0995 - 0x0980 + 100
        const fd = mockFontData({ gsub: { [kaGid]: 500 } });
        const shaped = shapeBengaliText('\u0995\u09CD\u09B7', fd); // Ka + Halant + Ssa
        // At least one glyph should be present
        expect(shaped.length).toBeGreaterThan(0);
    });

    it('should mark combining marks as zero-advance', () => {
        const fd = mockFontData();
        // কু = Ka + u-matra (above, should be zero-advance)
        const shaped = shapeBengaliText('\u0995\u09C1', fd);
        const zeroAdv = shaped.filter(g => g.isZeroAdvance);
        expect(zeroAdv.length).toBeGreaterThan(0);
    });

    it('should handle reph emission', () => {
        const fd = mockFontData();
        // র্ক = Ra + Halant + Ka (reph over Ka)
        const shaped = shapeBengaliText('\u09B0\u09CD\u0995', fd);
        expect(shaped.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty string', () => {
        const fd = mockFontData();
        expect(shapeBengaliText('', fd)).toEqual([]);
    });

    it('should handle space character', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText(' ', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3); // space GID
    });

    it('should handle NBSP as space', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u00A0', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3); // mapped to space
    });

    it('should handle independent vowel', () => {
        const fd = mockFontData();
        // অ (A)
        const shaped = shapeBengaliText('\u0985', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should produce non-zero GIDs for Bengali text', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('বাংলা', fd);
        expect(shaped.length).toBeGreaterThan(0);
        // At least some non-zero GIDs
        const nonZero = shaped.filter(g => g.gid !== 0);
        expect(nonZero.length).toBeGreaterThan(0);
    });

    it('should handle digit sequences', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u09E6\u09E7\u09E8', fd); // ০১২
        expect(shaped).toHaveLength(3);
        for (const g of shaped) {
            expect(g.isZeroAdvance).toBe(false);
        }
    });

    it('should apply GPOS mark-to-base when anchors exist', () => {
        const kaGid = 0x0995 - BENGALI_START + 100;
        const matraGid = 0x09C1 - BENGALI_START + 100; // u-matra
        const fd = mockFontData({
            markAnchors: {
                bases: { [kaGid]: { 0: [300, 600] } },
                marks: { [matraGid]: [0, 100, 200] },
            },
        });
        const shaped = shapeBengaliText('\u0995\u09C1', fd);
        const mark = shaped.find(g => g.gid === matraGid);
        expect(mark).toBeDefined();
        expect(mark!.isZeroAdvance).toBe(true);
        // dx/dy should be computed from anchor offsets
        expect(mark!.dx).not.toBe(0);
    });

    it('should handle multiple words with spaces', () => {
        const fd = mockFontData();
        const shaped = shapeBengaliText('\u0995 \u0996', fd); // Ka space Kha
        expect(shaped.length).toBe(3);
    });

    it('should handle e-matra as pre-base', () => {
        const fd = mockFontData();
        // কে = Ka + e-matra (0x09C7, pre-base)
        const shaped = shapeBengaliText('\u0995\u09C7', fd);
        const matraGid = fd.cmap[0x09C7];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle ai-matra as pre-base', () => {
        const fd = mockFontData();
        // কৈ = Ka + ai-matra (0x09C8, pre-base)
        const shaped = shapeBengaliText('\u0995\u09C8', fd);
        const matraGid = fd.cmap[0x09C8];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle long text without crashing', () => {
        const fd = mockFontData();
        const text = '\u0995\u09BE\u09B0\u09CD\u09A4'.repeat(100);
        const shaped = shapeBengaliText(text, fd);
        expect(shaped.length).toBeGreaterThan(0);
    });

    // ── Ligature conjunct tests ──────────────────────────────────────

    it('should substitute conjunct via ligature table', () => {
        const kaGid = 0x0995 - BENGALI_START + 100;
        const halantGid = 0x09CD - BENGALI_START + 100;
        const raGid = 0x09B0 - BENGALI_START + 100;
        const ligGid = 700;
        const fd = mockFontData({
            ligatures: {
                [kaGid]: [[ligGid, halantGid, raGid]],
            },
            widths: { ...mockFontData().widths, [ligGid]: 800 },
        });
        // ক্র = Ka + Halant + Ra → should produce single ligature glyph
        const shaped = shapeBengaliText('\u0995\u09CD\u09B0', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(ligGid);
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should fall back to individual glyphs without ligature data', () => {
        const fd = mockFontData(); // no ligatures
        // ক্র = Ka + Halant + Ra → no ligature match → individual glyphs
        const shaped = shapeBengaliText('\u0995\u09CD\u09B0', fd);
        expect(shaped.length).toBe(3);
    });

    it('should handle partial ligature with remaining glyphs', () => {
        const kaGid = 0x0995 - BENGALI_START + 100;
        const halantGid = 0x09CD - BENGALI_START + 100;
        const raGid = 0x09B0 - BENGALI_START + 100;
        const ligGid = 700;
        const fd = mockFontData({
            ligatures: {
                [kaGid]: [[ligGid, halantGid, raGid]], // Ka+H+Ra
            },
        });
        // Ka + Halant + Ra + Halant + Ta → ligature + Halant(zero-advance) + Ta
        const shaped = shapeBengaliText('\u0995\u09CD\u09B0\u09CD\u09A4', fd);
        expect(shaped[0].gid).toBe(ligGid);
        expect(shaped.length).toBe(3);
    });
});
