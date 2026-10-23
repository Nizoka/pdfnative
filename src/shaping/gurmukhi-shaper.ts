/**
 * pdfnative — Gurmukhi Shaper
 * ============================
 * Gurmukhi on the Indic OpenType engine (v1.9.0). This module owns the
 * Gurmukhi `IndicScriptConfig`; the shaping itself — syllables, base
 * finding, the font's own `rphf half blwf pstf vatu cjct … pres abvs blws
 * psts haln` features in specification order, final reordering and mark
 * attachment — runs in `indic-engine.ts`, as for the five 1.8.0 scripts.
 *
 * Gurmukhi (Punjabi) forms its conjuncts with subjoined ਹ ਰ ਵ through the
 * font's `blwf`, carries tippi, bindi and addak as above signs and the
 * yakash (U+0A75) as a medial consonant that rides on its letter like a
 * nukta; a reph, when a font declares one, lands right after the base,
 * before the subjoined consonants. Script tags `gur2` / `guru`.
 *
 * The golden tests on the bundled Noto Sans Gurmukhi are in
 * `tests/shaping/indic-real-font.test.ts`; the configuration values follow
 * HarfBuzz's `hb-ot-shaper-indic.cc` (reph mode and position, `blwf` reach).
 *
 * References:
 *   - Unicode Standard §12.3 Gurmukhi
 *   - OpenType spec: Script-specific shaping for Gurmukhi (gur2 / Indic2)
 *   - ISO 15924 script code: Guru
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { GURMUKHI_START, GURMUKHI_END, containsGurmukhi } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';

// Re-export range constants
export { GURMUKHI_START, GURMUKHI_END, containsGurmukhi };

/**
 * Gurmukhi as the Indic engine sees it.
 *
 * @since 1.9.0
 */
export const GURMUKHI_CONFIG: IndicScriptConfig = {
    id: 'gurmukhi',
    scriptTags: ['gur2', 'guru', 'DFLT'],
    consonants: [[0x0A15, 0x0A39], [0x0A59, 0x0A5E]],
    virama: 0x0A4D,
    ra: 0x0A30,
    rephMode: 'implicit',
    rephPosition: 'beforeSub',
    blwfMode: 'preAndPost',
    splitMatras: {},
};

/**
 * Shape a string of Gurmukhi text into an array of positioned glyphs.
 *
 * @param str - Raw Gurmukhi string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 * @since 1.9.0
 */
export function shapeGurmukhiText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, GURMUKHI_CONFIG);
}
