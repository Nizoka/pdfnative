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
