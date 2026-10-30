import { describe, it, expect } from 'vitest';
import { shapeKhmerText } from '../../src/shaping/khmer-shaper.js';
import { shapeMyanmarText, buildMyanmarClusters } from '../../src/shaping/myanmar-shaper.js';
import { positionMarkOnMark } from '../../src/shaping/gpos-positioner.js';
import { tryLigature } from '../../src/shaping/gsub-driver.js';
import * as notoKhmer from '../../fonts/noto-khmer-data.js';
import * as notoMyanmar from '../../fonts/noto-myanmar-data.js';
import type { FontData, ShapedGlyph } from '../../src/types/pdf-types.js';

// v1.8.0 — three defects these shapers carried against the real fonts.
// The mock-font suites beside this one cannot see them: each defect is about
// what the bundled font actually offers.

const khmer = notoKhmer as unknown as FontData;
const myanmar = notoMyanmar as unknown as FontData;

const advance = (glyphs: ShapedGlyph[], fd: FontData): number =>
    glyphs.reduce((n, g) => n + (g.isZeroAdvance ? 0 : (fd.widths[g.gid] ?? fd.defaultWidth)), 0);

const width = (fd: FontData, gid: number): number => fd.widths[gid] ?? fd.defaultWidth;

describe('Khmer subscripts use the font\'s composed form', () => {
    // The font keys subscripts on the coeng: it has `coeng + ka`, and no
    // `ka + coeng + ka`. Trying the ligature only at the head of the stack
    // found nothing, so the cluster came out as a visible coeng sign plus a
    // full-size consonant drawn over the base.
    const ka = 0x1780, coeng = 0x17D2;

    it('composes coeng + consonant into one glyph', () => {
        const out = shapeKhmerText(String.fromCodePoint(ka, coeng, ka), khmer);
        expect(out).toHaveLength(2);
        const composed = tryLigature([khmer.cmap[coeng], khmer.cmap[ka]], khmer.ligatures);
        expect(composed).not.toBeNull();
        expect(out[1].gid).toBe(composed!.resultGid);
    });

    it('never leaves the bare coeng sign in the output', () => {
        const out = shapeKhmerText(String.fromCodePoint(ka, coeng, ka), khmer);
        expect(out.map(g => g.gid)).not.toContain(khmer.cmap[coeng]);
    });

    it('hangs the subscript off the base without advancing the pen', () => {
        const out = shapeKhmerText(String.fromCodePoint(ka, coeng, ka), khmer);
        expect(out[0].isZeroAdvance).toBe(false);
        expect(out[1].isZeroAdvance).toBe(true);
    });

    it('leaves the cluster the same width as the bare base', () => {
        // A stack occupies one consonant's place on the line, not two.
        const bare = shapeKhmerText(String.fromCodePoint(ka), khmer);
        const stacked = shapeKhmerText(String.fromCodePoint(ka, coeng, ka), khmer);
        expect(advance(stacked, khmer)).toBe(advance(bare, khmer));
    });

    it('composes a two-deep stack into two subscripts', () => {
        const out = shapeKhmerText(String.fromCodePoint(ka, coeng, 0x179A, coeng, 0x1798), khmer);
        expect(out).toHaveLength(3);
        expect(out.slice(1).every(g => g.isZeroAdvance)).toBe(true);
        expect(advance(out, khmer)).toBe(width(khmer, khmer.cmap[ka]));
    });

    it('shapes a real word without a notdef', () => {
        const out = shapeKhmerText('ភាសាខ្មែរ', khmer);
        expect(out.every(g => g.gid > 0)).toBe(true);
    });
});

describe('Khmer stacks a second mark on the first', () => {
    it('lifts the upper mark clear of the lower one', () => {
        // Both were anchored to the base and drawn in the same place.
        const out = shapeKhmerText('កិ់', khmer);
        const marks = out.filter(g => g.isZeroAdvance);
        expect(marks).toHaveLength(2);
        expect(marks[0].dy).not.toBe(marks[1].dy);
    });

    it('reads the offset from the font rather than inventing one', () => {
        const out = shapeKhmerText('កិ់', khmer);
        const marks = out.filter(g => g.isZeroAdvance);
        const offset = positionMarkOnMark(khmer.mark2mark, marks[0].gid, marks[1].gid);
        expect(offset).not.toBeNull();
        expect(marks[1].dy).toBeCloseTo(marks[0].dy + offset!.dy, 6);
    });

    it('still anchors a single mark on its base', () => {
        const out = shapeKhmerText('កិ', khmer);
        expect(out).toHaveLength(2);
        expect(out[1].isZeroAdvance).toBe(true);
        expect(out[1].dy).not.toBe(0);
    });
});

describe('Myanmar kinzi belongs to the syllable that follows it', () => {
    const kinzi = 'င်္';

    it('attaches the kinzi to the next cluster, not its own', () => {
        const clusters = buildMyanmarClusters(kinzi + 'က');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].kinzi).toEqual([0x1004, 0x103A, 0x1039]);
        expect(clusters[0].codepoints).toEqual([0x1000]);
    });

    it('draws it as one mark over the base', () => {
        const out = shapeMyanmarText(kinzi + 'က', myanmar);
        expect(out).toHaveLength(2);
        expect(out[0].gid).toBe(myanmar.cmap[0x1000]);
        expect(out[1].isZeroAdvance).toBe(true);
    });

    it('gives the cluster the width of its base alone', () => {
        // The nga and the virama were each taking horizontal space.
        const out = shapeMyanmarText(kinzi + 'က', myanmar);
        expect(advance(out, myanmar)).toBe(width(myanmar, myanmar.cmap[0x1000]));
    });

    it('works for every letter that can carry a kinzi', () => {
        for (const carrier of [0x1004, 0x101B, 0x105A]) {
            const text = String.fromCodePoint(carrier, 0x103A, 0x1039, 0x1000);
            const out = shapeMyanmarText(text, myanmar);
            expect(out.every(g => g.gid > 0), `U+${carrier.toString(16)}`).toBe(true);
            expect(advance(out, myanmar)).toBe(width(myanmar, myanmar.cmap[0x1000]));
        }
    });

    it('leaves a bare letter + asat alone when no base follows', () => {
        const clusters = buildMyanmarClusters('င်');
        expect(clusters[0].kinzi).toBeNull();
    });
});

describe('Myanmar subjoined stacks use the font\'s composed form', () => {
    it('composes virama + consonant into one glyph', () => {
        const out = shapeMyanmarText('က္က', myanmar);
        expect(out).toHaveLength(2);
        const composed = tryLigature([myanmar.cmap[0x1039], myanmar.cmap[0x1000]], myanmar.ligatures);
        expect(out[1].gid).toBe(composed!.resultGid);
    });

    it('gives the stack one consonant\'s width', () => {
        const out = shapeMyanmarText('က္က', myanmar);
        expect(advance(out, myanmar)).toBe(width(myanmar, myanmar.cmap[0x1000]));
    });
});

describe('Khmer two-part vowels draw their own right piece (1.9.0, C24)', () => {
    const KM = notoKhmer as unknown as FontData;
    const shape = (s: string): ShapedGlyph[] => shapeKhmerText(s, KM);
    const gids = (s: string): number[] => shape(s).map(g => g.gid);

    it('ើ is េ before the base and the anchored above mark ី after it (the font\'s abvf single of its presentation form)', () => {
        const shaped = shape('ដើ');
        expect(shaped.map(g => g.gid)).toEqual([131, 60, 109]);     // uni17C1, da, uni17B8 (via gsub 121 → 109)
        expect(shaped[2].isZeroAdvance).toBe(true);
        expect(shaped[2].dy).not.toBe(0);
        expect(shaped[2].cps).toEqual([0x17BE]);
        expect(gids('តើ')).toEqual([131, 65, 109]);
        expect(gids('ដើម្បី')).toEqual([131, 60, 109, 76, 210, 109]);
    });

    it('ៅ ឿ ៀ take the hooks of their own right pieces, ោ keeps ា', () => {
        expect(gids('ទៅ')).toEqual([131, 67, 136]);                 // uni17C5.right, not ា
        expect(gids('ក្តៅ')).toEqual([131, 49, 204, 136]);
        expect(gids('ឿ')).toEqual([131, 123]);                     // uni17BF.right1
        expect(gids('រៀន')).toEqual([131, 78, 127, 69]);            // uni17C0.right1
        expect(gids('ដោយ')).toEqual([131, 60, 104, 77]);            // ោ → ា, unchanged
        expect(gids('ខ្មោច')).toEqual([131, 50, 216, 104, 54]);
        for (const word of ['ទៅ', 'រៀន', 'សៀវភៅ', 'ដើម្បី']) {
            const reported = shape(word).flatMap(g => [...(g.cps ?? [])]);
            expect(reported.every(cp => cp !== 0)).toBe(true);
            expect(shape(word).every(g => g.gid !== 0)).toBe(true);
        }
    });
});

describe('Myanmar pre-base order and the medial ra inside a medial stack (1.9.0, C23)', () => {
    const MY = notoMyanmar as unknown as FontData;
    const gids = (s: string): number[] => shapeMyanmarText(s, MY).map(g => g.gid);

    it('ကြေ and မြေ — the e-vowel is drawn first, then the medial ra, then the base (HarfBuzz VPre before PRE_C)', () => {
        expect(gids('ကြေ')).toEqual([372, 47, 4]);   // _e, medial_ra, ka
        expect(gids('မြေ')).toEqual([372, 47, 29]);
    });

    it('ကြွေ and မြွေ — medial ra followed by medial wa stays one cluster, the wa on the base', () => {
        expect(buildMyanmarClusters('ကြွေ').map(c => c.codepoints.length)).toEqual([4]);
        expect(gids('ကြွေ')).toEqual([372, 47, 4, 48]);
        expect(gids('ကြွေး')).toEqual([372, 47, 4, 48, 379]);
        const shaped = shapeMyanmarText('မြွေ', MY);
        expect(shaped.map(g => g.gid)).toEqual([372, 47, 29, 48]);
        expect(shaped[3].isZeroAdvance).toBe(true);
    });

    it('ကျေး and မြန်မာ — a cluster without the ra, and the sample word, are unchanged', () => {
        expect(gids('ကျေး')).toEqual([372, 4, 382, 379]);
        expect(gids('မြန်မာ')).toEqual([47, 29, 24, 381, 29, 368]);
    });
});

describe('what the fixes deliberately leave alone', () => {
    it('keeps a plain consonant untouched', () => {
        expect(shapeKhmerText('ក', khmer)).toHaveLength(1);
        expect(shapeMyanmarText('က', myanmar)).toHaveLength(1);
    });

    it('keeps Khmer digits spacing', () => {
        const out = shapeKhmerText('០១២', khmer);
        expect(out).toHaveLength(3);
        expect(out.every(g => !g.isZeroAdvance)).toBe(true);
    });

    it('keeps the pre-base vowel in front of its base', () => {
        const out = shapeKhmerText('កេ', khmer);
        expect(out[0].gid).toBe(khmer.cmap[0x17C1]);
        expect(out[1].gid).toBe(khmer.cmap[0x1780]);
    });
});
