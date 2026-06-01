import { describe, it, expect } from 'vitest';
import { buildMyanmarClusters, containsMyanmar, shapeMyanmarText, MYANMAR_START, MYANMAR_END } from '../../src/shaping/myanmar-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = MYANMAR_START; cp <= MYANMAR_END; cp++) {
        cmap[cp] = cp - MYANMAR_START + 100;
        widths[cp - MYANMAR_START + 100] = 600;
    }
    cmap[0x20] = 3; widths[3] = 250;
    return {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 256, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansMyanmar', pdfWidthArray: '', ttfBase64: '',
        ...overrides,
    };
}

describe('containsMyanmar', () => {
    it('detects Myanmar text', () => { expect(containsMyanmar('မြန်မာစာ')).toBe(true); });
    it('returns false for ASCII', () => { expect(containsMyanmar('Hello')).toBe(false); });
    it('returns false for empty', () => { expect(containsMyanmar('')).toBe(false); });
});

describe('buildMyanmarClusters', () => {
    it('stacks a virama + consonant onto the base', () => {
        // Ka (U+1000) + virama (U+1039) + Ka
        const clusters = buildMyanmarClusters('\u1000\u1039\u1000');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toEqual([0x1000, 0x1039, 0x1000]);
    });
    it('keeps medials in the base cluster', () => {
        // Ka + medial ya (U+103B)
        const clusters = buildMyanmarClusters('\u1000\u103B');
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toContain(0x103B);
    });
});

describe('shapeMyanmarText', () => {
    it('produces no .notdef for covered text', () => {
        const shaped = shapeMyanmarText('\u1000\u103B\u102C', mockFontData());
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.every((g) => g.gid !== 0)).toBe(true);
    });
    it('emits medial ra (pre-base) before the base', () => {
        // Ka (U+1000) + medial ra (U+103C) — ra renders to the left.
        const shaped = shapeMyanmarText('\u1000\u103C', mockFontData());
        const raGid = 0x103C - MYANMAR_START + 100;
        const baseGid = 0x1000 - MYANMAR_START + 100;
        const rIdx = shaped.findIndex((g) => g.gid === raGid);
        const bIdx = shaped.findIndex((g) => g.gid === baseGid);
        expect(rIdx).toBeGreaterThanOrEqual(0);
        expect(rIdx).toBeLessThan(bIdx);
    });
    it('returns empty array for empty input', () => {
        expect(shapeMyanmarText('', mockFontData())).toEqual([]);
    });
});
