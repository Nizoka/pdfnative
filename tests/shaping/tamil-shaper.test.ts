import { describe, it, expect } from 'vitest';
import { buildTamilClusters, containsTamil, shapeTamilText, TAMIL_START, TAMIL_END } from '../../src/shaping/tamil-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

// ── Mock FontData ────────────────────────────────────────────────────
function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    // Map Tamil codepoints to sequential GIDs starting at 100
    for (let cp = TAMIL_START; cp <= TAMIL_END; cp++) {
        cmap[cp] = cp - TAMIL_START + 100;
        widths[cp - TAMIL_START + 100] = 600;
    }
    // Space
    cmap[0x20] = 3;
    widths[3] = 250;
    return {
        cmap,
        widths,
        defaultWidth: 500,
        gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 576, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansTamil',
        pdfWidthArray: '',
        ttfBase64: '',
        ...overrides,
    };
}

// ── containsTamil ────────────────────────────────────────────────────

describe('containsTamil', () => {
    it('should return true for Tamil text', () => {
        expect(containsTamil('தமிழ்')).toBe(true);
    });

    it('should return false for ASCII text', () => {
        expect(containsTamil('Hello World')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(containsTamil('')).toBe(false);
    });

    it('should detect single Tamil consonant', () => {
        expect(containsTamil('\u0B95')).toBe(true); // Ka
    });

    it('should detect Tamil mixed with Latin', () => {
        expect(containsTamil('Hello தமிழ் World')).toBe(true);
    });

    it('should return false for Bengali text', () => {
        expect(containsTamil('বাংলা')).toBe(false);
    });

    it('should return false for Thai text', () => {
        expect(containsTamil('สวัสดี')).toBe(false);
    });
});

// ── Range constants ──────────────────────────────────────────────────

describe('TAMIL_START / TAMIL_END', () => {
    it('should define correct Unicode range', () => {
        expect(TAMIL_START).toBe(0x0B80);
        expect(TAMIL_END).toBe(0x0BFF);
    });
});

// ── buildTamilClusters ───────────────────────────────────────────────

describe('buildTamilClusters', () => {
    it('should create separate clusters for standalone consonants', () => {
        // க ங (Ka, Nga)
        const clusters = buildTamilClusters('\u0B95\u0B99');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].codepoints).toContain(0x0B95);
        expect(clusters[1].codepoints).toContain(0x0B99);
    });

    it('should group consonant + matra into one cluster', () => {
        // கா = Ka + aa-matra (0x0BBE)
        const clusters = buildTamilClusters('\u0B95\u0BBE');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0B95);
        expect(clusters[0].codepoints).toContain(0x0BBE);
    });

    it('should handle pulli-mediated conjunct', () => {
        // க்ஷ = Ka + Pulli + Ssa (0x0BB7)
        const clusters = buildTamilClusters('\u0B95\u0BCD\u0BB7');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0B95);
        expect(clusters[0].codepoints).toContain(0x0BCD); // Pulli
        expect(clusters[0].codepoints).toContain(0x0BB7);
    });

    it('should handle independent vowel as base', () => {
        // அ (A)
        const clusters = buildTamilClusters('\u0B85');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0B85);
    });

    it('should handle modifier (anusvara/visarga)', () => {
        // கஃ = Ka + Visarga
        const clusters = buildTamilClusters('\u0B95\u0B83');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0B83);
    });

    it('should recognize pre-base matras', () => {
        // கி = Ka + i-matra (0x0BBF) — pre-base
        const clusters = buildTamilClusters('\u0B95\u0BBF');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].preBaseMatras.length).toBeGreaterThan(0);
    });

    it('should handle pre-base e-matra', () => {
        // கெ = Ka + e-matra (0x0BC6) — pre-base
        const clusters = buildTamilClusters('\u0B95\u0BC6');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].preBaseMatras.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
        expect(buildTamilClusters('')).toEqual([]);
    });

    it('should handle ASCII characters as individual clusters', () => {
        const clusters = buildTamilClusters('AB');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].codepoints).toContain(65);
    });

    it('should handle mixed Tamil and ASCII', () => {
        const clusters = buildTamilClusters('A\u0B95B');
        expect(clusters).toHaveLength(3);
    });

    it('should handle explicit pulli at end of word', () => {
        // க் = Ka + Pulli (no following consonant — visible virama)
        const clusters = buildTamilClusters('\u0B95\u0BCD');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].codepoints).toContain(0x0BCD);
    });

    it('should handle Tamil digits', () => {
        const clusters = buildTamilClusters('\u0BE6\u0BE7\u0BE8'); // ௦௧௨
        expect(clusters).toHaveLength(3);
    });

    it('should handle split vowel sign o (ொ)', () => {
        // கொ = Ka + ொ (o)
        const clusters = buildTamilClusters('\u0B95\u0BCA');
        expect(clusters).toHaveLength(1);
    });

    it('should handle split vowel sign oo (ோ)', () => {
        // கோ = Ka + ோ (oo)
        const clusters = buildTamilClusters('\u0B95\u0BCB');
        expect(clusters).toHaveLength(1);
    });

    it('should handle split vowel sign au (ௌ)', () => {
        // கௌ = Ka + ௌ (au)
        const clusters = buildTamilClusters('\u0B95\u0BCC');
        expect(clusters).toHaveLength(1);
    });

    it('should handle space between clusters', () => {
        const clusters = buildTamilClusters('\u0B95 \u0B99');
        expect(clusters).toHaveLength(3);
    });

    it('should handle ai-matra as pre-base', () => {
        // கை = Ka + ai-matra (0x0BC8) — pre-base
        const clusters = buildTamilClusters('\u0B95\u0BC8');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].preBaseMatras.length).toBeGreaterThan(0);
    });

    it('should handle ee-matra as pre-base', () => {
        // கே = Ka + ee-matra (0x0BC7) — pre-base
        const clusters = buildTamilClusters('\u0B95\u0BC7');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].preBaseMatras.length).toBeGreaterThan(0);
    });
});

// ── shapeTamilText ───────────────────────────────────────────────────

describe('shapeTamilText', () => {
    it('should return glyphs for simple consonant', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95', fd); // Ka
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.some(g => g.gid !== 0)).toBe(true);
    });

    it('should return positioned glyphs for consonant + matra', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0BBE', fd); // Ka + aa-matra
        expect(shaped.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle pre-base matra reordering', () => {
        const fd = mockFontData();
        // கி = Ka + i-matra (0x0BBF pre-base, should appear before Ka visually)
        const shaped = shapeTamilText('\u0B95\u0BBF', fd);
        expect(shaped.length).toBeGreaterThanOrEqual(2);
        const matraGid = fd.cmap[0x0BBF];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle split vowel o (ொ = ெ + ா)', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0BCA', fd); // Ka + o-matra
        // Should produce at least 3 glyphs: pre-base ெ, Ka, post-base ா
        expect(shaped.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle split vowel oo (ோ = ே + ா)', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0BCB', fd); // Ka + oo-matra
        expect(shaped.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle split vowel au (ௌ = ெ + ௗ)', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0BCC', fd); // Ka + au-matra
        expect(shaped.length).toBeGreaterThanOrEqual(3);
    });

    it('should handle pulli-mediated conjunct', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0BCD\u0BB7', fd); // Ka + Pulli + Ssa
        expect(shaped.length).toBeGreaterThan(0);
    });

    it('should mark combining marks as zero-advance', () => {
        const fd = mockFontData();
        // கு = Ka + u-matra (0x0BC1, above mark should be zero-advance)
        const shaped = shapeTamilText('\u0B95\u0BC1', fd);
        const zeroAdv = shaped.filter(g => g.isZeroAdvance);
        expect(zeroAdv.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
        const fd = mockFontData();
        expect(shapeTamilText('', fd)).toEqual([]);
    });

    it('should handle space character', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText(' ', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3); // space GID
    });

    it('should handle NBSP as space', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u00A0', fd);
        expect(shaped.length).toBe(1);
        expect(shaped[0].gid).toBe(3);
    });

    it('should handle independent vowel', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B85', fd); // A
        expect(shaped.length).toBe(1);
        expect(shaped[0].isZeroAdvance).toBe(false);
    });

    it('should produce non-zero GIDs for Tamil text', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('தமிழ்', fd);
        expect(shaped.length).toBeGreaterThan(0);
        const nonZero = shaped.filter(g => g.gid !== 0);
        expect(nonZero.length).toBeGreaterThan(0);
    });

    it('should handle digit sequences', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0BE6\u0BE7\u0BE8', fd); // ௦௧௨
        expect(shaped).toHaveLength(3);
        for (const g of shaped) {
            expect(g.isZeroAdvance).toBe(false);
        }
    });

    it('should apply GPOS mark-to-base when anchors exist', () => {
        const kaGid = 0x0B95 - TAMIL_START + 100;
        const matraGid = 0x0BC1 - TAMIL_START + 100; // u-matra
        const fd = mockFontData({
            markAnchors: {
                bases: { [kaGid]: { 0: [300, 600] } },
                marks: { [matraGid]: [0, 100, 200] },
            },
        });
        const shaped = shapeTamilText('\u0B95\u0BC1', fd);
        const mark = shaped.find(g => g.gid === matraGid);
        expect(mark).toBeDefined();
        expect(mark!.isZeroAdvance).toBe(true);
        expect(mark!.dx).not.toBe(0);
    });

    it('should handle multiple words with spaces', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95 \u0B99', fd);
        expect(shaped.length).toBe(3);
    });

    it('should handle e-matra as pre-base', () => {
        const fd = mockFontData();
        // கெ = Ka + e-matra (0x0BC6, pre-base)
        const shaped = shapeTamilText('\u0B95\u0BC6', fd);
        const matraGid = fd.cmap[0x0BC6];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle ee-matra as pre-base', () => {
        const fd = mockFontData();
        // கே = Ka + ee-matra (0x0BC7, pre-base)
        const shaped = shapeTamilText('\u0B95\u0BC7', fd);
        const matraGid = fd.cmap[0x0BC7];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle ai-matra as pre-base', () => {
        const fd = mockFontData();
        // கை = Ka + ai-matra (0x0BC8, pre-base)
        const shaped = shapeTamilText('\u0B95\u0BC8', fd);
        const matraGid = fd.cmap[0x0BC8];
        expect(shaped[0].gid).toBe(matraGid);
    });

    it('should handle long text without crashing', () => {
        const fd = mockFontData();
        const text = '\u0B95\u0BBE\u0BB0\u0BCD\u0BA4'.repeat(100);
        const shaped = shapeTamilText(text, fd);
        expect(shaped.length).toBeGreaterThan(0);
    });

    it('should handle GSUB substitution', () => {
        const kaGid = 0x0B95 - TAMIL_START + 100;
        const fd = mockFontData({ gsub: { [kaGid]: 500 } });
        // When pulli follows with another consonant, GSUB should apply
        const shaped = shapeTamilText('\u0B95\u0BCD\u0BB7', fd);
        expect(shaped.length).toBeGreaterThan(0);
    });

    it('should handle visarga modifier', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0B95\u0B83', fd);
        const zeroAdv = shaped.filter(g => g.isZeroAdvance);
        expect(zeroAdv.length).toBeGreaterThan(0);
    });

    it('should handle OM character', () => {
        const fd = mockFontData();
        const shaped = shapeTamilText('\u0BD0', fd);
        expect(shaped.length).toBe(1);
    });
});
