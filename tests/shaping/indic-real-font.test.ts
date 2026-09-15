/**
 * Indic shaping against the REAL bundled fonts.
 *
 * Every other shaper suite drives a synthetic font (a linear cmap, no GSUB,
 * no anchors), which is why the 1.8.0 report — reordered ி, a reph drawn on
 * the wrong consonant, an above vowel sign pulled under the baseline, no
 * subjoined Telugu consonants — reached a release with every suite green.
 * These tests lock the words from that report, plus the classic conjuncts,
 * on the modules the samples embed.
 *
 * Glyph ids are quoted with the `post` names of the source fonts
 * (`npx tsx scripts/glyph-names.ts fonts/ttf/<font>.ttf <gid>…`) so a Noto
 * update that renumbers glyphs fails with a readable message.
 */

import { describe, it, expect } from 'vitest';
import type { FontData, ShapedGlyph } from '../../src/types/pdf-types.js';
import { shapeDevanagariText } from '../../src/shaping/devanagari-shaper.js';
import { shapeBengaliText } from '../../src/shaping/bengali-shaper.js';
import { shapeTamilText } from '../../src/shaping/tamil-shaper.js';
import { shapeTeluguText } from '../../src/shaping/telugu-shaper.js';
import { shapeSinhalaText } from '../../src/shaping/sinhala-shaper.js';
import { findMarkToBase } from '../../src/shaping/gpos-positioner.js';
import * as devanagari from '../../fonts/noto-devanagari-data.js';
import * as bengali from '../../fonts/noto-bengali-data.js';
import * as tamil from '../../fonts/noto-tamil-data.js';
import * as telugu from '../../fonts/noto-telugu-data.js';
import * as sinhala from '../../fonts/noto-sinhala-data.js';

const fd = (m: unknown): FontData => m as FontData;
const HI = fd(devanagari), BN = fd(bengali), TA = fd(tamil), TE = fd(telugu), SI = fd(sinhala);

const cps = (s: string): number[] => Array.from(s).map(c => c.codePointAt(0) ?? 0);
const JOINERS = new Set([0x200C, 0x200D]);

/** Index of the first glyph whose source code points include `cp`. */
function indexOfCp(shaped: readonly ShapedGlyph[], cp: number): number {
    return shaped.findIndex(g => g.cps?.includes(cp));
}

/** Every input code point is reported by exactly one glyph (joiners excepted). */
function expectCpsCoverInput(shaped: readonly ShapedGlyph[], word: string): void {
    const reported = shaped.flatMap(g => [...(g.cps ?? [])]).filter(cp => !JOINERS.has(cp)).sort((a, b) => a - b);
    const input = cps(word).filter(cp => !JOINERS.has(cp)).sort((a, b) => a - b);
    expect(reported).toEqual(input);
}

function expectNoNotdef(shaped: readonly ShapedGlyph[]): void {
    expect(shaped.every(g => g.gid !== 0)).toBe(true);
}

describe('Tamil on Noto Sans Tamil', () => {
    it('விலை — ி stays after வ, ை moves before ல (the report\'s "வெலை")', () => {
        const word = 'விலை';
        const shaped = shapeTamilText(word, TA);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped.length).toBe(4);
        expect(shaped[0].cps).toEqual([0x0BB5]);                 // va
        expect(indexOfCp(shaped, 0x0BBF)).toBe(1);               // ivowelsign3tamil, right of va
        expect(indexOfCp(shaped, 0x0BC8)).toBe(2);               // ai, left of la
        expect(shaped[3].cps).toEqual([0x0BB2]);                 // la
        expect(shaped.every(g => !g.isZeroAdvance)).toBe(true);  // all spacing glyphs
    });

    it('தமிழ் — ி follows ம; ழ and its pulli are one glyph', () => {
        const word = 'தமிழ்';
        const shaped = shapeTamilText(word, TA);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped.map(g => g.cps)).toEqual([[0x0BA4], [0x0BAE], [0x0BBF], [0x0BB4, 0x0BCD]]);
        expect(shaped[3].gid).toBe(94);                           // lllaprehalftamil
    });

    it('ரூ — one glyph from the font\'s psts ligature (the report saw a "kanji")', () => {
        const shaped = shapeTamilText('ரூ', TA);
        expect(shaped.map(g => g.gid)).toEqual([141]);            // rauuvowelsigntamil
        expect(shaped[0].cps).toEqual([0x0BB0, 0x0BC2]);
    });

    it('ஸ்ரீ and க்ஷ — akhn conjuncts are single glyphs', () => {
        expect(shapeTamilText('ஸ்ரீ', TA).map(g => g.gid)).toEqual([163]); // shritamil
        expect(shapeTamilText('க்ஷ', TA).map(g => g.gid)).toEqual([76]);  // tchatamil
        expectCpsCoverInput(shapeTamilText('ஸ்ரீ', TA), 'ஸ்ரீ');
    });

    it('கொ — the two-part o splits into ெ before and ா after the base', () => {
        const shaped = shapeTamilText('கொ', TA);
        expect(shaped.length).toBe(3);
        expect(shaped[0].cps).toEqual([0x0BCA]);                  // the composed sign is reported once
        expect(shaped[1].cps).toEqual([0x0B95]);
        expect(shaped[2].cps).toEqual([]);
    });
});

describe('Devanagari on Noto Sans Devanagari', () => {
    it('हिन्दी — ि reordered before ह, न् takes its half form', () => {
        const word = 'हिन्दी';
        const shaped = shapeDevanagariText(word, HI);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(indexOfCp(shaped, 0x093F)).toBe(0);
        expect(shaped[1].cps).toEqual([0x0939]);
        expect(shaped[2].cps).toEqual([0x0928, 0x094D]);           // uni0928094D (half na)
        expect(shaped[2].gid).toBe(245);
    });

    it('प्रदर्शन — the reph sits after श as a zero-advance mark (the report\'s "प्रदशन")', () => {
        const word = 'प्रदर्शन';
        const shaped = shapeDevanagariText(word, HI);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped[0].gid).toBe(309);                          // uni092A094D0930 (pra)
        const sha = shaped.findIndex(g => g.cps?.[0] === 0x0936);
        const reph = shaped.findIndex(g => g.cps?.length === 2 && g.cps[0] === 0x0930 && g.cps[1] === 0x094D);
        expect(sha).toBeGreaterThan(0);
        expect(reph).toBe(sha + 1);
        expect(shaped[reph].isZeroAdvance).toBe(true);
        expect(shaped[reph].gid).toBe(506);                       // uni0930094D (reph)
        expect(findMarkToBase(HI.markAnchors, 506, shaped[sha].gid)).not.toBeNull();
    });

    it('दस्तावेज़ — े rides on व at its designed height, ज़ carries its nukta (the report\'s "दस्तावज़")', () => {
        const word = 'दस्तावेज़';
        const shaped = shapeDevanagariText(word, HI);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        const va = shaped.findIndex(g => g.cps?.[0] === 0x0935);
        const e = indexOfCp(shaped, 0x0947);
        expect(e).toBe(va + 1);
        expect(shaped[e].isZeroAdvance).toBe(true);
        expect(shaped[e].dy).toBeGreaterThanOrEqual(0);          // was -611 before 1.8.0
        expect(findMarkToBase(HI.markAnchors, shaped[e].gid, shaped[va].gid)).not.toBeNull();
        expect(shaped[shaped.length - 1].cps).toEqual([0x091C, 0x093C]);
        expect(shaped[shaped.length - 1].gid).toBe(224);          // uni095B
        expect(shaped[1].gid).toBe(256);                          // uni0938094D (half sa)
    });

    it('क्ष, द्य, क्र — akhn and rkrf conjuncts are single glyphs', () => {
        expect(shapeDevanagariText('क्ष', HI).map(g => g.gid)).toEqual([90]);
        expect(shapeDevanagariText('द्य', HI).map(g => g.gid)).toEqual([453]);   // uni0926094D092F
        expect(shapeDevanagariText('क्र', HI).map(g => g.gid)).toEqual([295]);
    });

    it('र्कि — ि first, then क, then the reph (folded into the ि arm by the font)', () => {
        const shaped = shapeDevanagariText('र्कि', HI);
        expect(shaped.length).toBe(3);
        expect(shaped[0].cps).toEqual([0x093F]);                  // uni093F0930094D.04, the ि that carries the reph
        expect(shaped[1].cps).toEqual([0x0915]);
        expect(shaped[2].cps).toEqual([0x0930, 0x094D]);          // NullMark: the reph glyph the font blanked
        expect(shaped[2].isZeroAdvance).toBe(true);
    });

    it('ड्गि — a halant no half form absorbed keeps ि after it', () => {
        const shaped = shapeDevanagariText('ड्गि', HI);
        expect(shaped.map(g => g.cps)).toEqual([[0x0921], [0x094D], [0x093F], [0x0917]]);
        expect(shaped[1].isZeroAdvance).toBe(true);
    });

    it('को — ो is one glyph', () => {
        expect(shapeDevanagariText('को', HI).map(g => g.cps)).toEqual([[0x0915], [0x094B]]);
    });
});

describe('Bengali on Noto Sans Bengali', () => {
    it('কর্ম — the reph lands after ম', () => {
        const word = 'কর্ম';
        const shaped = shapeBengaliText(word, BN);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped.map(g => g.cps)).toEqual([[0x0995], [0x09AE], [0x09B0, 0x09CD]]);
        expect(shaped[2].isZeroAdvance).toBe(true);
        expect(shaped[2].gid).toBe(132);                          // uni09B009CD
    });

    it('ক্ষ — one akhn glyph; ব্য — ya-phala; প্র — ra-phala', () => {
        expect(shapeBengaliText('ক্ষ', BN).map(g => g.gid)).toEqual([135]);
        const bya = shapeBengaliText('ব্য', BN);
        expect(bya.map(g => g.cps)).toEqual([[0x09AC], [0x09CD, 0x09AF]]);
        expect(bya[1].gid).toBe(133);                              // uni09AF.pstf
        const pro = shapeBengaliText('প্র', BN);
        expect(pro[pro.length - 1].isZeroAdvance).toBe(true);     // raphalabeng.alt02 on the half pa
        expectCpsCoverInput(pro, 'প্র');
    });

    it('কি and কো — pre-base signs move before ক, the two-part ো splits', () => {
        expect(shapeBengaliText('কি', BN).map(g => g.cps)).toEqual([[0x09BF], [0x0995]]);
        expect(shapeBengaliText('কো', BN).map(g => g.cps)).toEqual([[0x09CB], [0x0995], []]);
    });
});

describe('Telugu on Noto Sans Telugu', () => {
    it('ప్రదర్శన — ర and శ take their subjoined forms below the base (the report\'s missing vattu)', () => {
        const word = 'ప్రదర్శన';
        const shaped = shapeTeluguText(word, TE);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped[0].cps).toEqual([0x0C2A]);
        expect(shaped[1].cps).toEqual([0x0C4D, 0x0C30]);           // parasubscripttelu
        expect(shaped[1].isZeroAdvance).toBe(true);
        expect(shaped[4].cps).toEqual([0x0C4D, 0x0C36]);           // shapostscripttelu
        expect(shaped.some(g => g.cps?.length === 2 && g.cps[0] === 0x0C30 && g.cps[1] === 0x0C4D)).toBe(false); // no reph
    });

    it('క్ష and పత్రం — conjunct and subjoined ra keep every code point', () => {
        expect(shapeTeluguText('క్ష', TE).map(g => g.gid)).toEqual([110]);
        const word = 'పత్రం';
        const shaped = shapeTeluguText(word, TE);
        expectCpsCoverInput(shaped, word);
        expect(shaped[2].cps).toEqual([0x0C4D, 0x0C30]);           // tarasubscripttelu
        expect(shaped[2].isZeroAdvance).toBe(true);
    });
});

describe('Sinhala on Noto Sans Sinhala', () => {
    it('ශ්‍රී — rakaransaya through al-lakuna + ZWJ, then the is-pilla', () => {
        const word = 'ශ්‍රී';
        const shaped = shapeSinhalaText(word, SI);
        expectNoNotdef(shaped);
        expectCpsCoverInput(shaped, word);
        expect(shaped.length).toBe(3);
        expect(shaped[0].cps).toEqual([0x0DC1]);
        expect(shaped[1].cps).toContain(0x0DBB);
        expect(shaped[1].isZeroAdvance).toBe(true);
        expect(shaped[2].cps).toEqual([0x0DD3]);
        expect(shaped[2].isZeroAdvance).toBe(true);
    });

    it('කො and ක්ක — the kombuva moves left; no conjunct without a ZWJ', () => {
        expect(shapeSinhalaText('කො', SI).map(g => g.cps)).toEqual([[0x0DDC], [0x0D9A], []]);
        const shaped = shapeSinhalaText('ක්ක', SI);
        expect(shaped.map(g => g.cps)).toEqual([[0x0D9A, 0x0DCA], [0x0D9A]]);
    });
});
