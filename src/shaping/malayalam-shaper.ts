/**
 * pdfnative — Malayalam Shaper
 * =============================
 * Malayalam on the Indic OpenType engine (v1.9.0). This module owns the
 * Malayalam `IndicScriptConfig`; the shaping itself — syllables, base
 * finding, the font's own `rphf half blwf pstf vatu cjct … pres abvs blws
 * psts haln` features in specification order, final reordering and mark
 * attachment — runs in `indic-engine.ts`, as for the five 1.8.0 scripts.
 *
 * Malayalam has no Ra + virama reph: its reph is the dot reph U+0D4E, a
 * character of its own written before the consonant it sits on and moved
 * right after it (`rephMode: 'logical'`). The chillu letters U+0D7A–U+0D7F
 * are consonants in their own right, the pre-base ra (്ര) comes from the
 * font's `pref`, and ൊ ോ ൌ decompose around the base. Script tags
 * `mlm2` / `mlym`.
 *
 * The golden tests on the bundled Noto Sans Malayalam are in
 * `tests/shaping/indic-real-font.test.ts`; the configuration values follow
 * HarfBuzz's `hb-ot-shaper-indic.cc` (reph mode and position, `blwf` reach).
 *
 * References:
 *   - Unicode Standard §12.9 Malayalam
 *   - OpenType spec: Script-specific shaping for Malayalam (mlm2 / Indic2)
 *   - ISO 15924 script code: Mlym
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { MALAYALAM_START, MALAYALAM_END, containsMalayalam } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';

// Re-export range constants
export { MALAYALAM_START, MALAYALAM_END, containsMalayalam };

/**
 * Malayalam as the Indic engine sees it.
 *
 * @since 1.9.0
 */
export const MALAYALAM_CONFIG: IndicScriptConfig = {
    id: 'malayalam',
    scriptTags: ['mlm2', 'mlym', 'DFLT'],
    consonants: [[0x0D15, 0x0D3A], [0x0D7A, 0x0D7F]],
    virama: 0x0D4D,
    ra: 0x0D30,
    rephMode: 'logical',
    rephPosition: 'afterMain',
    blwfMode: 'preAndPost',
    splitMatras: {
        0x0D4A: [0x0D46, 0x0D3E],  // ൊ = െ + ാ
        0x0D4B: [0x0D47, 0x0D3E],  // ോ = േ + ാ
        0x0D4C: [0x0D46, 0x0D57],  // ൌ = െ + au length mark
    },
};

/**
 * Shape a string of Malayalam text into an array of positioned glyphs.
 *
 * @param str - Raw Malayalam string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 * @since 1.9.0
 */
export function shapeMalayalamText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, MALAYALAM_CONFIG);
}
