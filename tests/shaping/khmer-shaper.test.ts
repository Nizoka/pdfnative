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

    describe('shapeKhmerText — ligature substitution', () => {
        // Ka (U+1780) GID = 0x1780 - KHMER_START + 100 = 100
        // coeng (U+17D2) GID = 0x17D2 - KHMER_START + 100 = 242
        // Kha (U+1781) GID = 0x1781 - KHMER_START + 100 = 101
        // Ga (U+1782) GID = 0x1782 - KHMER_START + 100 = 102
        const kaGid = 0x1780 - KHMER_START + 100;
        const coengGid = 0x17D2 - KHMER_START + 100;
        const khaGid = 0x1781 - KHMER_START + 100;
        const gaGid = 0x1782 - KHMER_START + 100;

        it('uses a GSUB ligature when the font provides one', () => {
            const font = mockFontData({ ligatures: { [kaGid]: [[500, coengGid, khaGid]] } });
            const shaped = shapeKhmerText('\u1780\u17D2\u1781', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
        });

        it('resolves remaining glyphs after ligature match (else sub-branch)', () => {
            // Ka+coeng+Kha → 500; trailing coeng has no sub-ligature
            const font = mockFontData({ ligatures: { [kaGid]: [[500, coengGid, khaGid]] } });
            const shaped = shapeKhmerText('\u1780\u17D2\u1781\u17D2', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.length).toBeGreaterThan(1);
        });

        it('handles sub-ligature within remaining stack glyphs', () => {
            // Ka+coeng+Kha → 500; coeng+Ga → 501
            const font = mockFontData({
                ligatures: {
                    [kaGid]: [[500, coengGid, khaGid]],
                    [coengGid]: [[501, gaGid]],
                },
            });
            const shaped = shapeKhmerText('\u1780\u17D2\u1781\u17D2\u1782', font);
            expect(shaped.some((g) => g.gid === 500)).toBe(true);
            expect(shaped.some((g) => g.gid === 501)).toBe(true);
        });

        it('applies GPOS mark anchors for above vowel signs', () => {
            // vowel e (U+17C1) GID = 0x17C1 - KHMER_START + 100 = 129
            const eGid = 0x17C1 - KHMER_START + 100;
            const font = mockFontData({
                markAnchors: {
                    bases: { [kaGid]: { 0: [500, 900] as [number, number] } },
                    marks: { [eGid]: [0, 300, 800] as [number, number, number] },
                },
            });
            // Pre-base e is emitted first; but we still verify the mark anchor path
            // by testing a post-base vowel (ct===2/3/6) with anchor data
            // niahit U+17C6 (above, ct=2) GID = 0x17C6 - KHMER_START + 100 = 134
            const niahitGid = 0x17C6 - KHMER_START + 100;
            const font2 = mockFontData({
                markAnchors: {
                    bases: { [kaGid]: { 0: [500, 900] as [number, number] } },
                    marks: { [niahitGid]: [0, 300, 800] as [number, number, number] },
                },
            });
            const shaped = shapeKhmerText('\u1780\u17C6', font2);
            const mark = shaped.find((g) => g.gid === niahitGid);
            expect(mark).toBeDefined();
            expect(mark!.isZeroAdvance).toBe(true);
            expect(mark!.dx).not.toBe(0);
        });

        it('emits Khmer digits as normal-advance glyphs', () => {
            // Khmer digit 0 = U+17E0 GID = 0x17E0 - KHMER_START + 100 = 228
            const shaped = shapeKhmerText('\u17E0', mockFontData());
            expect(shaped.length).toBe(1);
            expect(shaped[0].isZeroAdvance).toBe(false);
        });
    });

    describe('buildKhmerClusters — edge cases', () => {
        it('emits non-Khmer codepoints (ASCII) as standalone clusters', () => {
            const clusters = buildKhmerClusters('A\u1780');
            expect(clusters.length).toBe(2);
            expect(clusters[0].codepoints[0]).toBe(0x41);
        });

        it('decomposes two-part vowel U+17C5 (oi)', () => {
            // U+17C5 → pre-base U+17C1 inserted before the base
            const clusters = buildKhmerClusters('\u1780\u17C5');
            const cps = clusters.flatMap((c) => c.codepoints);
            expect(cps).toContain(0x17C1);
        });
    });
