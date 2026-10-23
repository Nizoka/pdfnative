/**
 * pdfnative — Gujarati Shaper
 * ============================
 * Gujarati on the Indic OpenType engine (v1.9.0). This module owns the
 * Gujarati `IndicScriptConfig`; the shaping itself — syllables, base
 * finding, the font's own `rphf half blwf pstf vatu cjct … pres abvs blws
 * psts haln` features in specification order, final reordering and mark
 * attachment — runs in `indic-engine.ts`, as for the five 1.8.0 scripts.
 *
 * Gujarati behaves as Devanagari does: an implicit reph from Ra + virama
 * before a consonant, drawn before the post-base signs; half forms before
 * the base; `blwf` (the rakar) on either side of it; no two-part vowel
 * sign — ો and ૌ are single glyphs. Script tags `gjr2` / `gujr`.
 *
 * The golden tests on the bundled Noto Sans Gujarati are in
 * `tests/shaping/indic-real-font.test.ts`; the configuration values follow
 * HarfBuzz's `hb-ot-shaper-indic.cc` (reph mode and position, `blwf` reach).
 *
 * References:
 *   - Unicode Standard §12.4 Gujarati
 *   - OpenType spec: Script-specific shaping for Gujarati (gjr2 / Indic2)
 *   - ISO 15924 script code: Gujr
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { GUJARATI_START, GUJARATI_END, containsGujarati } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';

// Re-export range constants
export { GUJARATI_START, GUJARATI_END, containsGujarati };

/**
 * Gujarati as the Indic engine sees it.
 *
 * @since 1.9.0
 */
export const GUJARATI_CONFIG: IndicScriptConfig = {
    id: 'gujarati',
    scriptTags: ['gjr2', 'gujr', 'DFLT'],
    consonants: [[0x0A95, 0x0AB9], [0x0AF9, 0x0AF9]],
    virama: 0x0ACD,
    ra: 0x0AB0,
    rephMode: 'implicit',
    rephPosition: 'beforePost',
    blwfMode: 'preAndPost',
    splitMatras: {},
};

/**
 * Shape a string of Gujarati text into an array of positioned glyphs.
 *
 * @param str - Raw Gujarati string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 * @since 1.9.0
 */
export function shapeGujaratiText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, GUJARATI_CONFIG);
}
