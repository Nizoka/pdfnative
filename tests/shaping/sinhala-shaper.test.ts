import { describe, it, expect } from 'vitest';
import { buildSinhalaClusters, containsSinhala, shapeSinhalaText, SINHALA_START, SINHALA_END } from '../../src/shaping/sinhala-shaper.js';
import type { FontData } from '../../src/types/pdf-types.js';

function mockFontData(overrides?: Partial<FontData>): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = SINHALA_START; cp <= SINHALA_END; cp++) {
        cmap[cp] = cp - SINHALA_START + 100;
        widths[cp - SINHALA_START + 100] = 600;
    }
    cmap[0x20] = 3; widths[3] = 250;
    cmap[0x200D] = 4; widths[4] = 0;
    return {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 256, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
        markAnchors: { bases: {}, marks: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        fontName: 'NotoSansSinhala', pdfWidthArray: '', ttfBase64: '',
        ...overrides,
    };
}

describe('containsSinhala', () => {
    it('detects Sinhala text', () => { expect(containsSinhala('ආයුබෝවන්')).toBe(true); });
    it('returns false for ASCII', () => { expect(containsSinhala('Hello')).toBe(false); });
    it('returns false for empty', () => { expect(containsSinhala('')).toBe(false); });
    it('returns false for Tamil', () => { expect(containsSinhala('தமிழ்')).toBe(false); });
});

describe('buildSinhalaClusters', () => {
    it('builds a single cluster for a consonant + vowel', () => {
        const clusters = buildSinhalaClusters('\u0D9A\u0DCF'); // Ka + aa
        expect(clusters.length).toBe(1);
        expect(clusters[0].codepoints).toContain(0x0D9A);
    });
    it('decomposes two-part vowels (U+0DDD)', () => {
        const clusters = buildSinhalaClusters('\u0D9A\u0DDD'); // Ka + oo
        // U+0DDD decomposes to U+0DD9 (pre-base) + U+0DCF + U+0DCA
        const cps = clusters.flatMap((c) => c.codepoints);
        expect(cps).toContain(0x0DD9);
        expect(cps).toContain(0x0DCF);
    });
    it('keeps conjuncts together across virama', () => {
        const clusters = buildSinhalaClusters('\u0D9A\u0DCA\u0D9A'); // Ka virama Ka
        expect(clusters.length).toBe(1);
    });
});

describe('shapeSinhalaText', () => {
    it('produces no .notdef for covered text', () => {
        const shaped = shapeSinhalaText('\u0D9A\u0DCF', mockFontData());
        expect(shaped.length).toBeGreaterThan(0);
        expect(shaped.every((g) => g.gid !== 0)).toBe(true);
    });
    it('emits the pre-base kombuva before the base', () => {
        // U+0DD9 (kombuva) is pre-base/left; it must be emitted first.
        const shaped = shapeSinhalaText('\u0D9A\u0DD9', mockFontData());
        const kombuvaGid = 0x0DD9 - SINHALA_START + 100;
        const baseGid = 0x0D9A - SINHALA_START + 100;
        const kIdx = shaped.findIndex((g) => g.gid === kombuvaGid);
        const bIdx = shaped.findIndex((g) => g.gid === baseGid);
        expect(kIdx).toBeGreaterThanOrEqual(0);
        expect(bIdx).toBeGreaterThanOrEqual(0);
        expect(kIdx).toBeLessThan(bIdx);
    });
    it('returns empty array for empty input', () => {
        expect(shapeSinhalaText('', mockFontData())).toEqual([]);
    });
});
