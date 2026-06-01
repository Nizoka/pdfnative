import { describe, it, expect } from 'vitest';
import { buildKhmerClusters, containsKhmer, shapeKhmerText, KHMER_START, KHMER_END } from '../../src/shaping/khmer-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = KHMER_START; cp <= KHMER_END; cp++) {
        cmap[cp] = cp - KHMER_START + 100;
        widths[cp - KHMER_START + 100] = 600;
    }
    cmap[0x20] = 3; widths[3] = 250;
    return {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 256, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansKhmer', pdfWidthArray: '', ttfBase64: '',
        ...overrides,
    };
}

describe('containsKhmer', () => {
    it('detects Khmer text', () => { expect(containsKhmer('ភាសាខ្មែរ')).toBe(true); });
    it('returns false for ASCII', () => { expect(containsKhmer('Hello')).toBe(false); });
    it('returns false for empty', () => { expect(containsKhmer('')).toBe(false); });
});

describe('buildKhmerClusters', () => {
    it('stacks a coeng + consonant onto the base', () => {
        // Ka (U+1780) + coeng (U+17D2) + Ka
        const clusters = buildKhmerClusters('\u1780\u17D2\u1780');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x1780, 0x17D2, 0x1780]);
    });
    it('decomposes two-part vowel U+17C4', () => {
        const clusters = buildKhmerClusters('\u1780\u17C4');
        const cps = clusters.flatMap((c) => c.codepoints);
        expect(cps).toContain(0x17C1); // pre-base e
    });
});

describe('shapeKhmerText', () => {
    it('produces no .notdef for covered text', () => {
        const shaped = shapeKhmerText('\u1780\u17D2\u1780\u17B6', mockFontData());
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.every((g) => g.gid !== 0)).toBe(true);
    });
    it('emits the pre-base vowel before the base', () => {
        const shaped = shapeKhmerText('\u1780\u17C1', mockFontData());
        const vowelGid = 0x17C1 - KHMER_START + 100;
        const baseGid = 0x1780 - KHMER_START + 100;
        const vIdx = shaped.findIndex((g) => g.gid === vowelGid);
        const bIdx = shaped.findIndex((g) => g.gid === baseGid);
        expect(vIdx).toBeGreaterThanOrEqual(0);
        expect(vIdx).toBeLessThan(bIdx);
    });
    it('returns empty array for empty input', () => {
        expect(shapeKhmerText('', mockFontData())).toEqual([]);
    });
});
