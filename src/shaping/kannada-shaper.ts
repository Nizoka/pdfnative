/**
 * pdfnative — Kannada Shaper
 * ===========================
 * Kannada on the Indic OpenType engine (v1.9.0). This module owns the
 * Kannada `IndicScriptConfig`; the shaping itself — syllables, base
 * finding, the font's own `rphf half blwf pstf vatu cjct … pres abvs blws
 * psts haln` features in specification order, final reordering and mark
 * attachment — runs in `indic-engine.ts`, as for the five 1.8.0 scripts.
 *
 * Kannada stacks the consonants after the base below it (`blwf` after the
 * base only, like Telugu), writes the reph after every vowel sign, and
 * decomposes its two-part vowel signs — the first part of ೊ ೋ ೇ ೈ ೀ is an
 * ABOVE sign, not a pre-base one, so each part takes the class the UCD
 * gives it. Script tags `knd2` / `knda`.
 *
 * The golden tests on the bundled Noto Sans Kannada are in
 * `tests/shaping/indic-real-font.test.ts`; the configuration values follow
 * HarfBuzz's `hb-ot-shaper-indic.cc` (reph mode and position, `blwf` reach).
 *
 * References:
 *   - Unicode Standard §12.8 Kannada
 *   - OpenType spec: Script-specific shaping for Kannada (knd2 / Indic2)
 *   - ISO 15924 script code: Knda
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { KANNADA_START, KANNADA_END, containsKannada } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';

// Re-export range constants
export { KANNADA_START, KANNADA_END, containsKannada };

/**
 * Kannada as the Indic engine sees it.
 *
 * @since 1.9.0
 */
export const KANNADA_CONFIG: IndicScriptConfig = {
    id: 'kannada',
    scriptTags: ['knd2', 'knda', 'DFLT'],
    consonants: [[0x0C95, 0x0CB9], [0x0CDE, 0x0CDE]],
    virama: 0x0CCD,
    ra: 0x0CB0,
    rephMode: 'implicit',
    rephPosition: 'afterPost',
    blwfMode: 'postOnly',
    splitMatras: {
        0x0CC0: [0x0CBF, 0x0CD5],          // ೀ = ಿ + length mark
        0x0CC7: [0x0CC6, 0x0CD5],          // ೇ = ೆ + length mark
        0x0CC8: [0x0CC6, 0x0CD6],          // ೈ = ೆ + ai length mark
        0x0CCA: [0x0CC6, 0x0CC2],          // ೊ = ೆ + ೂ
        0x0CCB: [0x0CC6, 0x0CC2, 0x0CD5],  // ೋ = ೆ + ೂ + length mark
    },
    // HarfBuzz `gen-indic-table.py`: every above and below sign, and a right
    // sign outside U+0CC3–U+0CD6 (ಾ ು ೂ), sits before the subjoined
    // consonants; ೃ ೄ and the length marks come after them.
    matraBeforeSub: (cp: number): boolean => cp === 0x0CC6 || cp === 0x0CCC || cp < 0x0CC3 || cp > 0x0CD6,
};

/**
 * Shape a string of Kannada text into an array of positioned glyphs.
 *
 * @param str - Raw Kannada string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 * @since 1.9.0
 */
export function shapeKannadaText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, KANNADA_CONFIG);
}
