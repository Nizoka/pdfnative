import { describe, it, expect } from 'vitest';
import { buildTibetanStacks, containsTibetan, shapeTibetanText, TIBETAN_START, TIBETAN_END } from '../../src/shaping/tibetan-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = TIBETAN_START; cp <= TIBETAN_END; cp++) {
        cmap[cp] = cp - TIBETAN_START + 100;
        widths[cp - TIBETAN_START + 100] = 600;
    }
    cmap[0x20] = 3; widths[3] = 250;
    return {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 256, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSerifTibetan', pdfWidthArray: '', ttfBase64: '',
        ...overrides,
    };
}

describe('containsTibetan', () => {
    it('detects Tibetan text', () => { expect(containsTibetan('བོད་སྐད')).toBe(true); });
    it('returns false for ASCII', () => { expect(containsTibetan('Hello')).toBe(false); });
    it('returns false for empty', () => { expect(containsTibetan('')).toBe(false); });
});

describe('buildTibetanStacks', () => {
    it('stacks subjoined consonants with the head', () => {
        // Ka (U+0F40) + subjoined Ka (U+0F90)
        const stacks = buildTibetanStacks('\u0F40\u0F90');
        expect(stacks.length).toBe(1);
        expect(stacks[0].codepoints).toEqual([0x0F40, 0x0F90]);
    });
    it('separates two independent head consonants', () => {
        const stacks = buildTibetanStacks('\u0F40\u0F41');
        expect(stacks.length).toBe(2);
    });
});

describe('shapeTibetanText', () => {
    it('produces no .notdef for covered text', () => {
        const shaped = shapeTibetanText('\u0F40\u0F90\u0F72', mockFontData());
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.every((g) => g.gid !== 0)).toBe(true);
    });
    it('marks subjoined consonants as zero-advance', () => {
        const shaped = shapeTibetanText('\u0F40\u0F90', mockFontData());
        // The subjoined consonant should be a zero-advance (stacked) glyph.
        expect(shaped.some((g) => g.isZeroAdvance)).toBe(true);
    });
    it('returns empty array for empty input', () => {
        expect(shapeTibetanText('', mockFontData())).toEqual([]);
    });
});
