import { describe, it, expect } from 'vitest';
import { shapeUseText } from '../../src/shaping/use-shaper.js';
import { splitUseSyllables, useCategories } from '../../src/shaping/use-engine.js';
import {
    containsTaiTham, containsNewTaiLue, containsTaiLe, containsCham,
    isTaiThamCodepoint, isNewTaiLueCodepoint, isTaiLeCodepoint, isChamCodepoint,
    containsThai, containsMyanmar,
    TAI_THAM_START, TAI_THAM_END, NEW_TAI_LUE_START, NEW_TAI_LUE_END,
    TAI_LE_START, TAI_LE_END, CHAM_START, CHAM_END,
} from '../../src/shaping/script-registry.js';
import { findShaper, SCRIPT_SHAPERS } from '../../src/shaping/shaper-registry.js';
import { needsUnicodeFont, detectFallbackLangs, detectCharLang } from '../../src/shaping/script-detect.js';
import * as notoTaiTham from '../../fonts/noto-taitham-data.js';
import * as notoNewTaiLue from '../../fonts/noto-newtailue-data.js';
import * as notoTaiLe from '../../fonts/noto-taile-data.js';
import * as notoCham from '../../fonts/noto-cham-data.js';
import type { FontData } from '../../src/types/pdf-types.js';

// v1.8.0 — Tai Tham, New Tai Lue, Tai Le and Cham.

const taiTham = notoTaiTham as unknown as FontData;
const newTaiLue = notoNewTaiLue as unknown as FontData;
const taiLe = notoTaiLe as unknown as FontData;
const cham = notoCham as unknown as FontData;

const cps = (s: string): number[] => Array.from(s).map(c => c.codePointAt(0)!);

describe('script ranges', () => {
    it('matches the Unicode blocks', () => {
        expect([TAI_THAM_START, TAI_THAM_END]).toEqual([0x1A20, 0x1AAF]);
        expect([NEW_TAI_LUE_START, NEW_TAI_LUE_END]).toEqual([0x1980, 0x19DF]);
        expect([TAI_LE_START, TAI_LE_END]).toEqual([0x1950, 0x197F]);
        expect([CHAM_START, CHAM_END]).toEqual([0xAA00, 0xAA5F]);
    });

    it('gives each script its own codepoints and no other', () => {
        const cases: [string, (cp: number) => boolean, number][] = [
            ['Tai Tham', isTaiThamCodepoint, 0x1A20],
            ['New Tai Lue', isNewTaiLueCodepoint, 0x1980],
            ['Tai Le', isTaiLeCodepoint, 0x1950],
            ['Cham', isChamCodepoint, 0xAA00],
        ];
        for (const [name, predicate, mine] of cases) {
            expect(predicate(mine), name).toBe(true);
            for (const [other, , theirs] of cases) {
                if (other !== name) expect(predicate(theirs), `${name} claims ${other}`).toBe(false);
            }
        }
    });

    it('does not collide with the neighbouring blocks', () => {
        // Tai Le ends at U+197F and New Tai Lue starts at U+1980.
        expect(isTaiLeCodepoint(0x197F)).toBe(true);
        expect(isNewTaiLueCodepoint(0x197F)).toBe(false);
        expect(isNewTaiLueCodepoint(0x1980)).toBe(true);
        // Cham ends at U+AA5F, Myanmar Extended-A starts at U+AA60.
        expect(isChamCodepoint(0xAA5F)).toBe(true);
        expect(isChamCodepoint(0xAA60)).toBe(false);
        expect(containsMyanmar('ꩠ')).toBe(true);
        expect(containsCham('ꩠ')).toBe(false);
    });

    it('detects each script in a string', () => {
        expect(containsTaiTham('ᨠᩮ')).toBe(true);
        expect(containsNewTaiLue('ᦀᦱ')).toBe(true);
        expect(containsTaiLe('ᥐᥥ')).toBe(true);
        expect(containsCham('ꨀꨪ')).toBe(true);
        for (const fn of [containsTaiTham, containsNewTaiLue, containsTaiLe, containsCham]) {
            expect(fn('Hello')).toBe(false);
            expect(fn('')).toBe(false);
            expect(fn('ก')).toBe(false); // Thai
        }
        expect(containsThai('ᨠ')).toBe(false);
    });
});

describe('font routing', () => {
    it('requires an embedded font for all four', () => {
        for (const lang of ['nod', 'khb', 'tdd', 'cjm']) {
            expect(needsUnicodeFont(lang), lang).toBe(true);
        }
    });

    it('maps a codepoint to its ISO 639-3 language code', () => {
        expect(detectCharLang(0x1A20)).toBe('nod');
        expect(detectCharLang(0x1980)).toBe('khb');
        expect(detectCharLang(0x1950)).toBe('tdd');
        expect(detectCharLang(0xAA00)).toBe('cjm');
    });

    it('asks for the right fallback font inside other text', () => {
        const needed = detectFallbackLangs(['Hello ᨠᦀᥐꨀ'], 'en');
        expect([...needed].sort()).toEqual(['cjm', 'khb', 'nod', 'tdd']);
    });
});

describe('shaper registry', () => {
    it('routes the two complex scripts to the engine', () => {
        expect(findShaper('ᨠᩮ')?.id).toBe('taitham');
        expect(findShaper('ꨀꨯ')?.id).toBe('cham');
    });

    it('leaves the two spacing scripts unshaped', () => {
        // New Tai Lue and Tai Le write vowels and tones as spacing letters,
        // so they take the plain per-codepoint path like Greek or Georgian.
        expect(findShaper('ᦀᦱ')).toBeNull();
        expect(findShaper('ᥐᥥ')).toBeNull();
        expect(SCRIPT_SHAPERS.some(s => s.id === 'newtailue' || s.id === 'taile')).toBe(false);
    });
});

describe('bundled fonts', () => {
    // Assigned ranges only: U+196E and U+196F are reserved inside the Tai Le
    // block, and a font is not missing what Unicode has not defined.
    const coverage: [string, FontData, [number, number][]][] = [
        ['Tai Tham', taiTham, [[0x1A20, 0x1A5E], [0x1A60, 0x1A7C], [0x1A7F, 0x1A89], [0x1A90, 0x1A99]]],
        ['New Tai Lue', newTaiLue, [[0x1980, 0x19AB], [0x19B0, 0x19C9], [0x19D0, 0x19DA]]],
        ['Tai Le', taiLe, [[0x1950, 0x196D], [0x1970, 0x1974]]],
        ['Cham', cham, [[0xAA00, 0xAA36], [0xAA40, 0xAA4D], [0xAA50, 0xAA59]]],
    ];

    it('covers every assigned codepoint of each block', () => {
        for (const [name, fd, ranges] of coverage) {
            for (const [from, to] of ranges) {
                for (let cp = from; cp <= to; cp++) {
                    expect(fd.cmap[cp], `${name} U+${cp.toString(16).toUpperCase()}`).toBeGreaterThan(0);
                }
            }
        }
    });

    it('gives the spacing scripts no combining marks of their own', () => {
        // The claim that these two need no shaper rests on this.
        for (const [name, fd, ranges] of coverage.slice(1, 3)) {
            for (const [from, to] of ranges) {
                for (let cp = from; cp <= to; cp++) {
                    expect(fd.markAnchors?.marks[fd.cmap[cp]], `${name} U+${cp.toString(16).toUpperCase()}`)
                        .toBeUndefined();
                }
            }
        }
    });

    it('gives the complex scripts the tables the engine needs', () => {
        expect(Object.keys(taiTham.ligatures ?? {}).length).toBeGreaterThan(50);
        expect(Object.keys(cham.ligatures ?? {}).length).toBeGreaterThan(5);
        expect(Object.keys(cham.markAnchors?.marks ?? {}).length).toBeGreaterThan(10);
    });
});

describe('shapeUseText — Tai Tham', () => {
    const shape = (s: string) => shapeUseText(s, taiTham);

    it('shapes nothing from nothing', () => {
        expect(shape('')).toEqual([]);
    });

    it('never emits a notdef for well-formed text', () => {
        for (const text of ['ᨠ', 'ᨠᩮ', 'ᨠ᩠ᨠ', 'ᨲᩢ᩠ᩅ']) {
            expect(shape(text).every(g => g.gid > 0), text).toBe(true);
        }
    });

    it('composes a base with its pre-base vowel into one glyph', () => {
        // The font draws them together, so reordering first would stop the
        // ligature matching and leave the syllable in pieces.
        expect(shape('ᨠᩮ')).toHaveLength(1);
        expect(shape('ᨾᩮ')).toHaveLength(1);
    });

    it('stacks a consonant under its base through the sakot', () => {
        const stacked = shape('ᨠ᩠ᨠ');
        expect(stacked).toHaveLength(2);
        expect(stacked[0].isZeroAdvance).toBe(false);
        expect(stacked[1].isZeroAdvance).toBe(true);
    });

    it('keeps a sakot stack inside one cluster', () => {
        expect(splitUseSyllables(cps('ᨠ᩠ᨠ'))).toHaveLength(1);
    });

    it('anchors an above vowel without advancing the pen', () => {
        const [, mark] = shape('ᨠᩥ');
        expect(mark.isZeroAdvance).toBe(true);
    });

    it('gives a post-base vowel its own advance', () => {
        const [, vowel] = shape('ᨠᩣ');
        expect(vowel.isZeroAdvance).toBe(false);
    });

    it('is deterministic', () => {
        expect(shape('ᨲᩢ᩠ᩅ')).toEqual(shape('ᨲᩢ᩠ᩅ'));
    });
});

describe('shapeUseText — Cham', () => {
    const shape = (s: string) => shapeUseText(s, cham);

    it('never emits a notdef for well-formed text', () => {
        for (const text of ['ꨀ', 'ꨀꨯ', 'ꨀꨵꨶ', 'ꨀꩌ']) {
            expect(shape(text).every(g => g.gid > 0), text).toBe(true);
        }
    });

    it('moves a pre-base vowel in front of its base', () => {
        const out = shape('ꨀꨯ');
        expect(out).toHaveLength(2);
        expect(out[0].gid).toBe(cham.cmap[0xAA2F]);
        expect(out[1].gid).toBe(cham.cmap[0xAA00]);
    });

    it('composes two medial consonants into one mark', () => {
        const out = shape('ꨀꨵꨶ');
        expect(out).toHaveLength(2);
        expect(out[1].isZeroAdvance).toBe(true);
    });

    it('anchors an above vowel away from the origin', () => {
        const [, mark] = shape('ꨀꨪ');
        expect(mark.isZeroAdvance).toBe(true);
        expect(mark.dx === 0 && mark.dy === 0).toBe(false);
    });

    it('draws a final consonant on the base rather than beside it', () => {
        const [, final] = shape('ꨀꩌ');
        expect(final.isZeroAdvance).toBe(true);
    });

    it('classifies the pre-base vowels as the engine expects', () => {
        expect(useCategories([0xAA2F, 0xAA30])).toEqual(['VPre', 'VPre']);
    });

    it('is deterministic', () => {
        expect(shape('ꨀꨯꨵ')).toEqual(shape('ꨀꨯꨵ'));
    });
});

describe('the spacing scripts encode without a shaper', () => {
    it('maps New Tai Lue text straight through the cmap', () => {
        for (const cp of cps('ᦀᦱᦖᦱ')) {
            expect(newTaiLue.cmap[cp]).toBeGreaterThan(0);
        }
    });

    it('maps Tai Le text straight through the cmap', () => {
        for (const cp of cps('ᥖᥦᥰᥒᥭ')) {
            expect(taiLe.cmap[cp]).toBeGreaterThan(0);
        }
    });

    it('gives every Tai Le tone letter a real advance', () => {
        // Spacing modifier letters, not marks: a zero advance would stack them.
        for (let cp = 0x1970; cp <= 0x1974; cp++) {
            const gid = taiLe.cmap[cp];
            const width = taiLe.widths[gid] ?? taiLe.defaultWidth;
            expect(width, `U+${cp.toString(16).toUpperCase()}`).toBeGreaterThan(0);
        }
    });

    it('gives every New Tai Lue vowel a real advance', () => {
        for (let cp = 0x19B0; cp <= 0x19BB; cp++) {
            const gid = newTaiLue.cmap[cp];
            const width = newTaiLue.widths[gid] ?? newTaiLue.defaultWidth;
            expect(width, `U+${cp.toString(16).toUpperCase()}`).toBeGreaterThan(0);
        }
    });
});
