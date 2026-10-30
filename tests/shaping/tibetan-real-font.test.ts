/**
 * Tibetan shaping against the REAL bundled font (Noto Serif Tibetan).
 *
 * Issue #81 (1.8.0): every subjoined consonant and vowel sign came out at
 * (0, 0) — the shaper read only the first anchor class of a mark, never the
 * mark-to-mark table, and no contextual GSUB. The mock-font suite beside this
 * one could not see any of it. Since 1.9.0 the font's own `tibt` layout
 * drives the stacks and `attachMarks()` positions the column; these tests
 * lock the words of the language document on the module the samples embed.
 *
 * Glyph ids are quoted as the module gives them; a Noto update renumbers
 * them and fails here with a readable message.
 */

import { describe, it, expect } from 'vitest';
import type { FontData, ShapedGlyph } from '../../src/types/pdf-types.js';
import { shapeTibetanText } from '../../src/shaping/tibetan-shaper.js';
import { findMarkToBase } from '../../src/shaping/gpos-positioner.js';
import * as tibetan from '../../fonts/noto-tibetan-data.js';

const BO = tibetan as unknown as FontData;
const cps = (s: string): number[] => Array.from(s).map(c => c.codePointAt(0) ?? 0);

function expectCpsCoverInput(shaped: readonly ShapedGlyph[], word: string): void {
    const reported = shaped.flatMap(g => [...(g.cps ?? [])]).sort((a, b) => a - b);
    expect(reported).toEqual(cps(word).sort((a, b) => a - b));
}

describe('Noto Serif Tibetan carries the layout the engine needs', () => {
    it('has a tibt GSUB script with the four shaping features and GDEF marks', () => {
        const scripts = BO.otl?.gsub.scripts ?? {};
        expect(Object.keys(scripts)).toContain('tibt');
        expect(Object.keys(scripts.tibt).sort()).toEqual(['abvs', 'blws', 'calt', 'ccmp']);
        expect(Object.keys(BO.otl?.gsub.lookups ?? {}).length).toBeGreaterThan(1000);
        expect((BO.otl?.gdef?.marks ?? []).length).toBeGreaterThan(0);
    });

    it('anchors a subjoined consonant through its second anchor class (the #81 miss)', () => {
        // Subjoined KA (gid 1358) carries two triples; base KA (gid 6) only
        // has the class of the second one.
        expect(BO.markAnchors?.marks[1358]?.length).toBe(6);
        expect(findMarkToBase(BO.markAnchors, 1358, 6)).not.toBeNull();
    });
});

describe('shapeTibetanText on Noto Serif Tibetan', () => {
    it('ཀྐྱ — head form of KA, then one composed subjoined column anchored below it', () => {
        const word = 'ཀྐྱ';
        const shaped = shapeTibetanText(word, BO);
        expectCpsCoverInput(shaped, word);
        expect(shaped).toHaveLength(2);
        expect(shaped[0]).toMatchObject({ gid: 57, isZeroAdvance: false, cps: [0x0F40] });   // ka.head
        expect(shaped[1]).toMatchObject({ gid: 1451, isZeroAdvance: true, cps: [0x0F90, 0x0FB1] }); // ka.sub + ya.sub, one glyph
        expect(shaped[1].dx).toBeLessThan(0);   // pulled back under the base
        expect(shaped[1].dy).toBeLessThan(0);   // and below it
    });

    it('བསྒྲུབས — the four-letter stack སྒྲུ is one glyph naming its four code points', () => {
        const word = 'བསྒྲུབས';
        const shaped = shapeTibetanText(word, BO);
        expectCpsCoverInput(shaped, word);
        expect(shaped.every(g => g.gid !== 0)).toBe(true);
        expect(shaped).toHaveLength(4);
        expect(shaped[1]).toMatchObject({ gid: 1103, isZeroAdvance: false, cps: [0x0F66, 0x0F92, 0x0FB2, 0x0F74] });
    });

    it('བོད — the vowel sign o is a mark anchored above the base, not left at the pen', () => {
        const shaped = shapeTibetanText('བོད', BO);
        expectCpsCoverInput(shaped, 'བོད');
        expect(shaped).toHaveLength(3);
        expect(shaped[1].isZeroAdvance).toBe(true);
        expect(shaped[1].dx).toBeLessThan(0);
        expect(shaped[1].cps).toEqual([0x0F7C]);
    });

    it('composes base + vowel u and the deep stacks of the language document into single glyphs', () => {
        for (const [word, glyphs] of [['ཀུ', 1], ['སྐད', 2], ['རྒྱ', 1], ['ཧྥ', 1]] as const) {
            const shaped = shapeTibetanText(word, BO);
            expectCpsCoverInput(shaped, word);
            expect(shaped.every(g => g.gid !== 0), word).toBe(true);
            expect(shaped, word).toHaveLength(glyphs);
        }
    });

    it('never emits a notdef for the language document and is deterministic', () => {
        for (const text of ['བསྒྲུབས སྐད རྒྱ', 'བོད ཡིག ཀུ ཀེ', 'བཀྲ་ཤིས་བདེ་ལེགས།', '༡༢༣༤༥ ༢༠༢༦', 'སྒྲ ཨ་ཀ ཧྥ']) {
            const shaped = shapeTibetanText(text, BO);
            expect(shaped.every(g => g.gid !== 0), text).toBe(true);
            expect(shaped.every(g => (g.cps?.length ?? 0) > 0), text).toBe(true);
            expect(shaped).toEqual(shapeTibetanText(text, BO));
        }
    });
});
