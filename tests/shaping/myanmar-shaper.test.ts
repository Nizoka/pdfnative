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

    describe('shapeMyanmarText — ligature substitution', () => {
        // Ka (U+1000) GID = 0x1000 - MYANMAR_START + 100 = 100
        // virama (U+1039) GID = 0x1039 - MYANMAR_START + 100 = 157
        // Kha (U+1001) GID = 0x1001 - MYANMAR_START + 100 = 101
        // Ga (U+1002) GID = 0x1002 - MYANMAR_START + 100 = 102
        const kaGid = 0x1000 - MYANMAR_START + 100;
        const virGid = 0x1039 - MYANMAR_START + 100;
        const khaGid = 0x1001 - MYANMAR_START + 100;
        const gaGid = 0x1002 - MYANMAR_START + 100;

        it('uses a GSUB ligature when the font provides one', () => {
            const font = mockFontData({ ligatures: { [kaGid]: [[500, virGid, khaGid]] } });
            const shaped = shapeMyanmarText('\u1000\u1039\u1001', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
        });

        it('resolves remaining glyphs after ligature match (else sub-branch)', () => {
            // Ka+virama+Kha → 500; lone virama remains without a sub-ligature
            const font = mockFontData({ ligatures: { [kaGid]: [[500, virGid, khaGid]] } });
            const shaped = shapeMyanmarText('\u1000\u1039\u1001\u1039', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.some((g) => g.gid === virGid)).toBe(true);
        });

        it('handles sub-ligature within remaining stack glyphs', () => {
            // Ka+virama+Kha → 500; virama+Ga → 501
            const font = mockFontData({
                ligatures: {
                    [kaGid]: [[500, virGid, khaGid]],
                    [virGid]: [[501, gaGid]],
                },
            });
            const shaped = shapeMyanmarText('\u1000\u1039\u1001\u1039\u1002', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.some((g) => g.gid === 501)).toBe(true);
        });

        it('applies GPOS mark anchors for above vowel signs', () => {
            // vowel i (U+102D, above) GID = 0x102D - MYANMAR_START + 100 = 145
            const vowelGid = 0x102D - MYANMAR_START + 100;
            const font = mockFontData({
                markAnchors: {
                    bases: { [kaGid]: { 0: [500, 900] as [number, number] } },
                    marks: { [vowelGid]: [0, 300, 800] as [number, number, number] },
                },
            });
            const shaped = shapeMyanmarText('\u1000\u102D', font);
            const mark = shaped.find((g) => g.gid === vowelGid);
            expect(mark).toBeDefined();
            expect(mark!.isZeroAdvance).toBe(true);
            expect(mark!.dx).not.toBe(0);
        });

        it('emits e-vowel (U+1031, pre-base type 4) before the base consonant', () => {
            const eGid = 0x1031 - MYANMAR_START + 100;
            const shaped = shapeMyanmarText('\u1000\u1031', mockFontData());
            const eIdx = shaped.findIndex((g) => g.gid === eGid);
            const bIdx = shaped.findIndex((g) => g.gid === kaGid);
            expect(eIdx).toBeGreaterThanOrEqual(0);
            expect(eIdx).toBeLessThan(bIdx);
        });
    });

    describe('buildMyanmarClusters — edge cases', () => {
        it('emits non-Myanmar codepoints as standalone clusters', () => {
            const clusters = buildMyanmarClusters('A\u1000');
            expect(clusters.length).toBe(2);
            expect(clusters[0].codepoints[0]).toBe(0x41);
        });

        it('emits orphan non-consonant codepoints as standalone clusters', () => {
            // A lone virama (type 7) without a preceding consonant
            const clusters = buildMyanmarClusters('\u1039');
            expect(clusters.length).toBe(1);
            expect(clusters[0].codepoints).toContain(0x1039);
        });
    });
