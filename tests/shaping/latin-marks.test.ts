/**
 * Latin combining marks (v1.8.0): Yoruba and Igbo tone marks, NFD accents.
 *
 * Runs against the bundled Noto Sans, whose GPOS carries the anchors and
 * whose `ccmp` composes the dotless i, and against a synthetic font for the
 * fallback rules. Glyph ids quote the `post` names of NotoSans-VF.ttf.
 */

import { describe, it, expect } from 'vitest';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import { shapeLatinMarksText } from '../../src/shaping/latin-marks.js';
import { findShaper } from '../../src/shaping/shaper-registry.js';
import { splitTextByFont } from '../../src/shaping/multi-font.js';
import { detectCharLang, detectFallbackLangs } from '../../src/shaping/script-detect.js';
import { containsCombiningMarks, isCombiningMarkCodepoint } from '../../src/shaping/script-registry.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import * as notoVietnamese from '../../fonts/noto-vietnamese-data.js';

const SANS = notoSans as unknown as FontData;
const VI = notoVietnamese as unknown as FontData;

describe('registry dispatch', () => {
    it('sends a Latin run with a combining mark to latin-marks, and nothing else', () => {
        expect(findShaper('Hello')).toBeNull();
        expect(findShaper('é')?.id).toBe('latin-marks');
        expect(findShaper('ẹ́ Yorùbá')?.id).toBe('latin-marks');
        // A mark inside another script's run belongs to that script.
        expect(findShaper('क́')?.id).toBe('devanagari');
    });

    it('classifies the four generic combining-mark blocks', () => {
        expect(isCombiningMarkCodepoint(0x0301)).toBe(true);
        expect(isCombiningMarkCodepoint(0x1AB0)).toBe(true);
        expect(isCombiningMarkCodepoint(0x1DC0)).toBe(true);
        expect(isCombiningMarkCodepoint(0x20D0)).toBe(true);
        expect(isCombiningMarkCodepoint(0x0BBF)).toBe(false); // an Indic vowel sign is not
        expect(containsCombiningMarks('plain')).toBe(false);
    });
});

describe('Yoruba, Igbo and NFD text on Noto Sans', () => {
    it('ẹ́ — the acute attaches through GPOS; ccmp splits ẹ into e + dot below', () => {
        const shaped = shapeLatinMarksText('ẹ́', SANS);
        expect(shaped.map(g => g.gid)).toEqual([72, 2696, 2665]);   // e, dotbelowcomb, acutecomb
        expect(shaped.map(g => g.isZeroAdvance)).toEqual([false, true, true]);
        expect(shaped[0].cps).toEqual([0x1EB9]);
        expect(shaped[2].cps).toEqual([0x0301]);
        expect(shaped[2].dx).not.toBe(0);                            // anchored, not drawn at the pen
    });

    it('ọ̀́ — a second mark stacks on the first through MarkToMark', () => {
        const shaped = shapeLatinMarksText('ọ̀́', SANS);
        expect(shaped.length).toBe(4);
        const grave = shaped[2], acute = shaped[3];
        expect(grave.cps).toEqual([0x0300]);
        expect(acute.cps).toEqual([0x0301]);
        expect(acute.dy).toBeGreaterThan(grave.dy);                  // lifted above the grave
    });

    it('í — ccmp turns i into its dotless form under the mark', () => {
        const shaped = shapeLatinMarksText('í', SANS);
        expect(shaped.map(g => g.gid)).toEqual([1768, 2665]);        // idotless, acutecomb
        expect(shaped[0].cps).toEqual([0x69]);
    });

    it('Hausa hooked letters are plain spacing glyphs', () => {
        const shaped = shapeLatinMarksText('ɓ ƙ', SANS);
        expect(shaped.map(g => g.gid)).toEqual([1042, 3, 873]);      // bhook, space, khook
        expect(shaped.every(g => !g.isZeroAdvance)).toBe(true);
    });
});

describe('fallback without GPOS data', () => {
    function mockFont(): FontData {
        const cmap: Record<number, number> = { 0x65: 10, 0x0301: 20, 0x20: 3 };
        return {
            cmap, widths: { 10: 600, 20: 0, 3: 250 }, defaultWidth: 500, gsub: {},
            metrics: { unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700, numGlyphs: 30, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80 },
            markAnchors: { bases: {}, marks: {} }, mark2mark: { mark1Anchors: {}, mark2Classes: {} },
            fontName: 'Mock', pdfWidthArray: '', ttfBase64: '',
        };
    }

    it('keeps an unanchored mark at the pen with no advance', () => {
        const shaped = shapeLatinMarksText('é', mockFont());
        expect(shaped.map(g => [g.gid, g.isZeroAdvance])).toEqual([[10, false], [20, true]]);
    });
});

describe('font routing', () => {
    it('routes Latin Extended-B, IPA and combining marks to the full Noto Sans', () => {
        expect(detectCharLang(0x0253)).toBe('latin');   // ɓ
        expect(detectCharLang(0x0199)).toBe('latin');   // ƙ
        expect(detectCharLang(0x0301)).toBe('latin');
        expect(detectCharLang(0x01B0)).toBeNull();      // ư keeps its pre-1.8.0 routing (first covering font)
        expect(detectCharLang(0x0B95)).toBe('ta');
        expect(detectCharLang(0x0995)).toBe('bn');
        expect(detectFallbackLangs(['Sannu ƙ'], 'en')).toEqual(new Set(['latin']));
    });

    it('keeps a base and its following mark in one font', () => {
        const entries: FontEntry[] = [
            { fontData: VI, fontRef: '/F3', lang: 'vi' },
            { fontData: SANS, fontRef: '/F4', lang: 'latin' },
        ];
        // The Vietnamese subset has ẹ and U+0301 but no GPOS anchors; Noto
        // Sans can attach the mark, so the pair lands there, in one run.
        const runs = splitTextByFont('ẹ́', entries);
        expect(runs).toHaveLength(1);
        expect(runs[0].entry.fontRef).toBe('/F4');
        // Without a following mark the subset keeps the letter, as before.
        expect(splitTextByFont('ẹ', entries)[0].entry.fontRef).toBe('/F3');
    });
});
