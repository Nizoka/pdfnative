import { describe, it, expect } from 'vitest';
import {
    useCategory, useCategories, splitUseSyllables, reorderUseCluster,
    USE_UNICODE_VERSION,
} from '../../src/shaping/use-engine.js';
import { USE_CATEGORIES, USE_RANGES } from '../../src/shaping/use-data.js';

// v1.8.0 — the data-driven Universal Shaping Engine.

const cps = (s: string): number[] => Array.from(s).map(c => c.codePointAt(0)!);
const types = (s: string): string[] => splitUseSyllables(cps(s)).map(x => x.type);
const visual = (s: string): string => {
    const c = cps(s);
    return reorderUseCluster(c).map(i => String.fromCodePoint(c[i])).join('');
};

describe('use-data table', () => {
    it('declares the Unicode release it was derived from', () => {
        expect(USE_UNICODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('is sorted and non-overlapping, so binary search is valid', () => {
        let previousEnd = -1;
        for (let i = 0; i < USE_RANGES.length; i += 3) {
            const start = USE_RANGES[i];
            const end = USE_RANGES[i + 1];
            expect(start).toBeGreaterThan(previousEnd);
            expect(end).toBeGreaterThanOrEqual(start);
            previousEnd = end;
        }
    });

    it('indexes every range into a named category', () => {
        for (let i = 2; i < USE_RANGES.length; i += 3) {
            expect(USE_CATEGORIES[USE_RANGES[i]]).toBeTypeOf('string');
        }
    });

    it('never stores the default category, which would double its size', () => {
        expect(USE_CATEGORIES).not.toContain('O');
    });

    it('covers a plausible number of code points', () => {
        const covered = Array.from(
            { length: USE_RANGES.length / 3 },
            (_, i) => USE_RANGES[i * 3 + 1] - USE_RANGES[i * 3] + 1,
        ).reduce((a, b) => a + b, 0);
        expect(covered).toBeGreaterThan(10_000);
    });
});

describe('useCategory', () => {
    it('classifies the characters each script turns on', () => {
        // Every expectation here is the UCD's own answer, not a guess: the
        // generator asserts exactly one category matches per code point.
        expect(useCategory(0x17D2)).toBe('IS');    // Khmer coeng
        expect(useCategory(0x17CC)).toBe('FAbv');  // Khmer robat
        expect(useCategory(0x17C1)).toBe('VPre');  // Khmer vowel e
        expect(useCategory(0x1039)).toBe('IS');    // Myanmar virama
        expect(useCategory(0x103A)).toBe('VAbv');  // Myanmar asat (a pure killer)
        expect(useCategory(0x103C)).toBe('MPre');  // Myanmar medial ra
        expect(useCategory(0x0DCA)).toBe('HVM');   // Sinhala al-lakuna
        expect(useCategory(0x094D)).toBe('H');     // Devanagari virama
        expect(useCategory(0x093F)).toBe('VPre');  // Devanagari matra i
        expect(useCategory(0x0930)).toBe('B');     // Devanagari ra
    });

    it('applies the Microsoft overrides, not just the raw UCD', () => {
        // U+0F71 is Vowel_Dependent in the UCD; the override reassigns it to
        // Nukta so it sorts before an above-vowel.
        expect(useCategory(0x0F71)).toBe('CMBlw');
    });

    it('distinguishes the two joiners', () => {
        expect(useCategory(0x200C)).toBe('ZWNJ');
        expect(useCategory(0x200D)).toBe('CGJ');
    });

    it('returns the default for scripts owned by a dedicated shaper', () => {
        expect(useCategory(0x0E01)).toBe('O'); // Thai
        expect(useCategory(0x0641)).toBe('O'); // Arabic
        expect(useCategory(0x0EA1)).toBe('O'); // Lao
    });

    it('returns the default outside the table', () => {
        expect(useCategory(0x0041)).toBe('O');
        expect(useCategory(0)).toBe('O');
        expect(useCategory(0x10FFFF)).toBe('O');
    });

    it('classifies a sequence in one pass', () => {
        expect(useCategories(cps('कि'))).toEqual(['B', 'VPre']);
        expect(useCategories([])).toEqual([]);
    });
});

describe('splitUseSyllables', () => {
    it('returns nothing for empty input', () => {
        expect(splitUseSyllables([])).toEqual([]);
    });

    it('covers the input exactly once, with no gaps or overlaps', () => {
        for (const text of ['ភាសាខ្មែរ', 'မြန်မာ', 'සිංහල', 'नमस्ते', 'བོད་སྐད', 'abc']) {
            const input = cps(text);
            const syllables = splitUseSyllables(input);
            expect(syllables[0].start).toBe(0);
            expect(syllables[syllables.length - 1].end).toBe(input.length);
            for (let i = 1; i < syllables.length; i++) {
                expect(syllables[i].start).toBe(syllables[i - 1].end);
            }
        }
    });

    it('always advances, even on input the grammar cannot explain', () => {
        // A bare mark with no base: the grammar has no cluster for it, and an
        // engine that returned a zero-length match here would never finish.
        const orphan = splitUseSyllables([0x093F, 0x094D]);
        expect(orphan.length).toBeGreaterThan(0);
        expect(orphan[orphan.length - 1].end).toBe(2);
    });

    it('keeps a Khmer coeng stack in one cluster', () => {
        // ខ + coeng + ម + vowel e — a subscript stack, not four clusters.
        const syllables = splitUseSyllables(cps('ខ្មែ'));
        expect(syllables).toHaveLength(1);
        expect(syllables[0].type).toBe('standard');
    });

    it('keeps a Devanagari conjunct in one cluster', () => {
        expect(splitUseSyllables(cps('स्ते'))).toHaveLength(1);
    });

    it('breaks a Khmer word at each base', () => {
        expect(types('ភាសា')).toEqual(['standard', 'standard']);
    });

    it('recognises a virama-terminated cluster', () => {
        // Khmer base followed by a dangling coeng.
        expect(types('ក្')).toEqual(['virama_terminated']);
    });

    it('recognises a numeral cluster', () => {
        // Brahmi number joiner between two Brahmi numbers.
        expect(types('\u{11052}\u{1107F}\u{11052}')).toEqual(['numeral']);
    });

    it('treats plain Latin as one symbol cluster per character', () => {
        expect(types('ab')).toEqual(['symbol', 'symbol']);
    });

    it('takes the longest match when two alternatives both fit', () => {
        // "base + coeng + base" is a standard cluster; stopping at the coeng
        // would also be a legal virama-terminated cluster, but shorter.
        const syllables = splitUseSyllables(cps('ក្ម'));
        expect(syllables).toHaveLength(1);
        expect(syllables[0].type).toBe('standard');
        expect(syllables[0].end).toBe(3);
    });

    it('absorbs a trailing ZWNJ into its cluster', () => {
        const withJoiner = splitUseSyllables(cps('क‌'));
        expect(withJoiner).toHaveLength(1);
        expect(withJoiner[0].end).toBe(2);
    });
});

describe('reorderUseCluster', () => {
    it('moves a pre-base vowel in front of its base', () => {
        expect(visual('कि')).toBe('िक');
        expect(visual('ខែ')).toBe('ែខ');
    });

    it('moves a pre-base medial in front of its base', () => {
        expect(visual('မြ')).toBe('ြမ');
    });

    it('moves repha to the end of its cluster', () => {
        // Malayalam chillu-style repha: logically first, drawn over the last
        // consonant of the cluster.
        const cluster = [0x0D4E, 0x0D15]; // repha + ka
        expect(useCategory(0x0D4E)).toBe('R');
        expect(reorderUseCluster(cluster)).toEqual([1, 0]);
    });

    it('leaves a cluster with nothing to move untouched', () => {
        expect(visual('नम')).toBe('नम');
        expect(visual('abc')).toBe('abc');
    });

    it('keeps several pre-base marks in their relative order', () => {
        const cluster = [0x0D15, 0x17C1, 0x17C2]; // base + two pre-base vowels
        expect(reorderUseCluster(cluster)).toEqual([1, 2, 0]);
    });

    it('returns an index per code point, losing nothing', () => {
        for (const text of ['ភាសាខ្មែរ', 'मराठी', 'မြန်မာ']) {
            const input = cps(text);
            const order = reorderUseCluster(input);
            expect(order).toHaveLength(input.length);
            expect([...order].sort((a, b) => a - b)).toEqual(input.map((_, i) => i));
        }
    });

    it('handles an empty cluster', () => {
        expect(reorderUseCluster([])).toEqual([]);
    });
});
