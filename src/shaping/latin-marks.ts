/**
 * pdfnative — Latin combining-mark shaper
 * ========================================
 * Positions the generic combining diacritical marks (U+0300–036F and the
 * three extension blocks) on the letters that precede them, through the
 * registered font's GPOS anchors — the tone marks of Yoruba and Igbo on
 * their dotted vowels (ẹ́ ọ̀ ị́ ụ̀), the accents of any NFD Latin text, the
 * marks Greek and Cyrillic borrow — and stacks a second mark on the first
 * through the font's MarkToMark anchors (ọ̃́).
 *
 * Before v1.8.0 a run holding a combining mark took the plain per-codepoint
 * path: the mark was drawn at the pen, on top of the following letter.
 * No bundled sample contained one, which is why nobody noticed and why
 * this shaper is byte-neutral for every existing document: the registry
 * reaches it only for a run that contains such a mark.
 *
 * Pipeline: cmap → the font's `ccmp` composition (Noto Sans replaces `i`
 * before a mark by its dotless form) → mark attachment. No reordering:
 * Latin marks follow their base in logical order already.
 *
 * @module shaping/latin-marks
 * @since 1.8.0
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { isCombiningMarkCodepoint, containsCombiningMarks } from './script-registry.js';
import { attachMarks, type AttachItem } from './gpos-positioner.js';
import { applyGsubFeatures } from './indic-engine.js';

export { containsCombiningMarks };

/** Script tags the font may file its Latin composition rules under. */
const LATIN_SCRIPT_TAGS = ['latn', 'DFLT'];

/**
 * Shape a Latin (or Greek, or Cyrillic) run that carries combining marks.
 *
 * @param str - Text in logical order
 * @param fontData - A registered font's data; `markAnchors` and `mark2mark`
 *   drive the placement, `otl` the composition
 * @returns Positioned glyphs, marks as zero-advance glyphs after their base
 * @since 1.8.0
 */
export function shapeLatinMarksText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap } = fontData;
    const gidOf = (cp: number): number => cmap[(cp === 0x202F || cp === 0xA0) ? 0x20 : cp] || 0;

    const glyphs: { gid: number; cps: number[] }[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        i += cp > 0xFFFF ? 2 : 1;
        glyphs.push({ gid: gidOf(cp), cps: [cp] });
    }

    const composed = applyGsubFeatures(glyphs, fontData, LATIN_SCRIPT_TAGS, ['ccmp']);

    // A mark is what the font's GDEF says, else what Unicode says of the
    // code point the glyph stands for.
    const gdef = fontData.otl?.gdef;
    const isGdefMark = (gid: number): boolean => {
        if (!gdef) return false;
        for (const [a, b] of gdef.marks) if (gid >= a && gid <= b) return true;
        return false;
    };
    const items: AttachItem[] = composed.map(g => ({
        gid: g.gid,
        isMark: gdef ? isGdefMark(g.gid) : g.cps.every(isCombiningMarkCodepoint),
        cps: g.cps,
        keepAdvance: gdef !== undefined,
    }));
    return attachMarks(items, fontData);
}
