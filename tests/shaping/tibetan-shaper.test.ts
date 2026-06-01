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

    describe('shapeTibetanText — ligature substitution', () => {
        // Ka GID = 0x0F40 - TIBETAN_START + 100 = 164
        // subjoined Ka GID = 0x0F90 - TIBETAN_START + 100 = 244
        // subjoined Kha GID = 0x0F91 - TIBETAN_START + 100 = 245
        // subjoined Ga GID = 0x0F92 - TIBETAN_START + 100 = 246
        const kaGid = 0x0F40 - TIBETAN_START + 100;
        const sKaGid = 0x0F90 - TIBETAN_START + 100;
        const sKhaGid = 0x0F91 - TIBETAN_START + 100;
        const sGaGid = 0x0F92 - TIBETAN_START + 100;

        it('uses a GSUB ligature when the font provides one', () => {
            const font = mockFontData({ ligatures: { [kaGid]: [[500, sKaGid]] } });
            const shaped = shapeTibetanText('\u0F40\u0F90', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
        });

        it('resolves remaining glyphs after a ligature match (else sub-branch)', () => {
            // Ka+subjKa → 500 (consumed=2); remaining subjKha is standalone (no match)
            const font = mockFontData({ ligatures: { [kaGid]: [[500, sKaGid]] } });
            const shaped = shapeTibetanText('\u0F40\u0F90\u0F91', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.some((g) => g.gid === sKhaGid)).toBe(true);
        });

        it('handles sub-ligature within remaining stack glyphs', () => {
            // Ka+subjKa → 500; subjKha+subjGa → 501
            const font = mockFontData({
                ligatures: {
                    [kaGid]: [[500, sKaGid]],
                    [sKhaGid]: [[501, sGaGid]],
                },
            });
            const shaped = shapeTibetanText('\u0F40\u0F90\u0F91\u0F92', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.some((g) => g.gid === 501)).toBe(true);
        });

        it('applies GPOS mark anchors for above vowel signs', () => {
            // vowel i (U+0F72) GID = 0x0F72 - TIBETAN_START + 100 = 214
            const vowelIGid = 0x0F72 - TIBETAN_START + 100;
            const font = mockFontData({
                markAnchors: {
                    bases: { [kaGid]: { 0: [500, 900] as [number, number] } },
                    marks: { [vowelIGid]: [0, 300, 800] as [number, number, number] },
                },
            });
            const shaped = shapeTibetanText('\u0F40\u0F72', font);
            const mark = shaped.find((g) => g.gid === vowelIGid);
            expect(mark).toBeDefined();
            expect(mark!.isZeroAdvance).toBe(true);
            expect(mark!.dx).not.toBe(0); // anchor-computed offset
        });

        it('emits visarga (type 5) as normal-advance glyph after a stack', () => {
            // visarga U+0F7F GID = 0x0F7F - TIBETAN_START + 100 = 227
            const visargaGid = 0x0F7F - TIBETAN_START + 100;
            const shaped = shapeTibetanText('\u0F40\u0F7F', mockFontData());
            const vis = shaped.find((g) => g.gid === visargaGid);
            expect(vis).toBeDefined();
            expect(vis!.isZeroAdvance).toBe(false);
        });
    });

    describe('buildTibetanStacks — edge cases', () => {
        it('emits non-Tibetan codepoints (ASCII) as standalone stacks', () => {
            const stacks = buildTibetanStacks('A\u0F40');
            expect(stacks.length).toBe(2);
            expect(stacks[0].codepoints[0]).toBe(0x41);
        });

        it('emits orphan vowel signs (no preceding head) as standalone stacks', () => {
            // U+0F72 is type 2 (above vowel sign) — no head consonant before it
            const stacks = buildTibetanStacks('\u0F72');
            expect(stacks.length).toBe(1);
            expect(stacks[0].codepoints).toContain(0x0F72);
        });

        it('recognises independent letters (type 1, e.g. OM U+0F00) as stack starters', () => {
            const stacks = buildTibetanStacks('\u0F00');
            expect(stacks.length).toBe(1);
        });
    });
