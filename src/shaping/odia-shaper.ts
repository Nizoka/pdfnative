/**
 * pdfnative — Odia Shaper
 * ========================
 * Odia on the Indic OpenType engine (v1.9.0). This module owns the
 * Odia `IndicScriptConfig`; the shaping itself — syllables, base
 * finding, the font's own `rphf half blwf pstf vatu cjct … pres abvs blws
 * psts haln` features in specification order, final reordering and mark
 * attachment — runs in `indic-engine.ts`, as for the five 1.8.0 scripts.
 *
 * Odia (the Oriya block) writes an implicit reph right after the base
 * consonant, forms its conjuncts and the ya-phala through the font's
 * `blwf` / `pstf`, and decomposes ୈ ୋ ୌ around the base with the
 * pre-base part େ in front. Script tags `ory2` / `orya`.
 *
 * The golden tests on the bundled Noto Sans Oriya are in
 * `tests/shaping/indic-real-font.test.ts`; the configuration values follow
 * HarfBuzz's `hb-ot-shaper-indic.cc` (reph mode and position, `blwf` reach).
 *
 * References:
 *   - Unicode Standard §12.6 Oriya
 *   - OpenType spec: Script-specific shaping for Odia (ory2 / Indic2)
 *   - ISO 15924 script code: Orya
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { ODIA_START, ODIA_END, containsOdia } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';

// Re-export range constants
export { ODIA_START, ODIA_END, containsOdia };

/**
 * Odia as the Indic engine sees it.
 *
 * @since 1.9.0
 */
export const ODIA_CONFIG: IndicScriptConfig = {
    id: 'odia',
    scriptTags: ['ory2', 'orya', 'DFLT'],
    consonants: [[0x0B15, 0x0B39], [0x0B5C, 0x0B5D], [0x0B5F, 0x0B5F], [0x0B71, 0x0B71]],
    virama: 0x0B4D,
    ra: 0x0B30,
    rephMode: 'implicit',
    rephPosition: 'afterMain',
    blwfMode: 'preAndPost',
    splitMatras: {
        0x0B48: [0x0B47, 0x0B56],  // ୈ = େ + ai length mark
        0x0B4B: [0x0B47, 0x0B3E],  // ୋ = େ + ା
        0x0B4C: [0x0B47, 0x0B57],  // ୌ = େ + au length mark
    },
};

/**
 * Shape a string of Odia text into an array of positioned glyphs.
 *
 * @param str - Raw Odia string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 * @since 1.9.0
 */
export function shapeOdiaText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, ODIA_CONFIG);
}
