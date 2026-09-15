/**
 * pdfnative — Sinhala Shaper
 * ============================
 * Pure JS OpenType GSUB + GPOS shaping for the Sinhala script (Sri Lanka).
 * Zero external dependency.
 *
 * Since v1.8.0 the shaping itself runs in `indic-engine.ts`: this module
 * owns the Sinhala `IndicScriptConfig` (script tag `sinh`, explicit reph,
 * conjuncts only through ZWJ, the two-part vowel signs decomposed around
 * the base) and the cluster analyser the tests use.
 *
 * Handles:
 *   - Syllable cluster building (base + al-lakuna-mediated conjuncts)
 *   - GSUB LigatureSubst: conjunct / touching-form ligatures
 *     (C + Al-lakuna + ZWJ + Ya/Ra → yansaya / rakaaransaya, C+C conjuncts)
 *   - Pre-base (left-side) vowel reordering — the kombuva family
 *     (U+0DD9 / U+0DDB and the left half of the two-part vowels U+0DDA,
 *     U+0DDC, U+0DDD, U+0DDE) renders to the LEFT of its base consonant, so
 *     the shaper emits that glyph BEFORE the base in visual order.
 *   - Two-part dependent vowels are decomposed into their left + right halves.
 *   - GPOS MarkToBase: above / below pilla positioning.
 *
 * Known limitations (documented):
 *   - Complex multi-consonant stacks beyond the font's pre-baked ligature
 *     table fall back to sequential base + al-lakuna rendering.
 *   - GSUB MultipleSubst (LookupType 2) is not consumed; two-part vowels are
 *     instead decomposed by this shaper's own table.
 *
 * References:
 *   - Unicode Standard §13.2 Sinhala
 *   - OpenType spec: Script-specific shaping for Sinhala (sinh)
 *   - ISO 15924 script code: Sinh
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { SINHALA_START, SINHALA_END, SINHALA_VIRAMA, containsSinhala } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';
import { classifyUseCategory } from './use-lite.js';

// Re-export range constants
export { SINHALA_START, SINHALA_END, containsSinhala };

/** Al-lakuna (virama / hal kirima) — suppresses inherent vowel. */
const VIRAMA = SINHALA_VIRAMA; // 0x0DCA

/**
 * Decomposition table for Sinhala two-part dependent vowels into
 * [pre-base (left) part, ...post-base parts]. The left part is the kombuva
 * (U+0DD9) which always renders to the left of the base.
 */
const TWO_PART_VOWELS: Record<number, number[]> = {
    0x0DDA: [0x0DD9, 0x0DCA], // ේ  (ee)
    0x0DDC: [0x0DD9, 0x0DCF], // ො  (o)
    0x0DDD: [0x0DD9, 0x0DCF, 0x0DCA], // ෝ  (oo)
    0x0DDE: [0x0DD9, 0x0DDF], // ෞ  (au)
};

/**
 * Sinhala character type classification.
 *   0 = consonant
 *   1 = independent vowel (base)
 *   2 = dependent vowel sign — above (GPOS)
 *   3 = dependent vowel sign — below (GPOS)
 *   4 = dependent vowel sign — pre-base / left (reordered before base)
 *   5 = dependent vowel sign — post-base spacing (right of base)
 *   6 = modifier (anusvara / visarga, above)
 *   7 = virama (al-lakuna)
 *   9 = digit / symbol
 */
function sinhalaCharType(cp: number): number {
    if (cp === VIRAMA) return 7;
    // Anusvara / Visarga / Candrabindu modifiers
    if (cp >= 0x0D82 && cp <= 0x0D84) return 6;
    // Independent vowels
    if (cp >= 0x0D85 && cp <= 0x0D96) return 1;
    // Consonants
    if (cp >= 0x0D9A && cp <= 0x0DC6) return 0;
    // Dependent vowel signs
    if (cp === 0x0DCF) return 5; // aela-pilla (right)
    if (cp === 0x0DD0 || cp === 0x0DD1) return 5; // right
    if (cp === 0x0DD2 || cp === 0x0DD3) return 2; // is-pilla (above)
    if (cp === 0x0DD4 || cp === 0x0DD6) return 3; // paa-pilla (below)
    if (cp === 0x0DD8) return 5; // gaetta-pilla (right)
    if (cp === 0x0DD9 || cp === 0x0DDB) return 4; // kombuva (pre-base / left)
    if (cp === 0x0DDF) return 5; // gayanukitta (right)
    if (cp === 0x0DF2 || cp === 0x0DF3) return 5; // right
    // Sinhala Lith digits
    if (cp >= 0x0DE6 && cp <= 0x0DEF) return 9;
    return -1;
}

function isConsonant(cp: number): boolean {
    return sinhalaCharType(cp) === 0;
}

interface SinhalaCluster {
    codepoints: number[];
    baseIndex: number;
}

/**
 * Build syllable clusters from Sinhala text, decomposing two-part vowels.
 * A Sinhala syllable: [C + Al-lakuna]* C [vowel signs] [modifiers]
 */
export function buildSinhalaClusters(str: string): SinhalaCluster[] {
    const clusters: SinhalaCluster[] = [];
    const cps: number[] = [];

    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        // Decompose two-part vowels up front.
        const decomp = TWO_PART_VOWELS[cp];
        if (decomp) {
            for (const d of decomp) cps.push(d);
        } else {
            cps.push(cp);
        }
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = sinhalaCharType(cp);

        if (classifyUseCategory(cp) === 'ZWNJ') { i++; continue; }
        // ZWJ is significant for touching forms — keep it in the cluster below.

        if (type < 0 || cp < SINHALA_START || cp > SINHALA_END) {
            clusters.push({ codepoints: [cp], baseIndex: 0 });
            i++;
            continue;
        }

        const syllable: number[] = [];
        let lastConsonantIdx = -1;

        // Consume consonant + (al-lakuna [+ ZWJ]) sequences.
        while (i < cps.length) {
            const cc = cps[i];
            const ct = sinhalaCharType(cc);
            if (ct === 0) {
                lastConsonantIdx = syllable.length;
                syllable.push(cc);
                i++;
                if (i < cps.length && cps[i] === VIRAMA) {
                    let j = i + 1;
                    let zwnj = false;
                    let zwj = false;
                    if (j < cps.length) {
                        const jc = classifyUseCategory(cps[j]);
                        if (jc === 'ZWJ') { j++; zwj = true; }
                        else if (jc === 'ZWNJ') { j++; zwnj = true; }
                    }
                    if (!zwnj && j < cps.length && isConsonant(cps[j])) {
                        syllable.push(cps[i]); // virama
                        if (zwj) syllable.push(0x200D); // keep ZWJ for ligature lookups
                        i = j;
                        continue;
                    } else {
                        syllable.push(cps[i]);
                        i = j;
                        break;
                    }
                }
                break;
            } else {
                break;
            }
        }

        const baseIdx = lastConsonantIdx >= 0 ? lastConsonantIdx : 0;

        // Consume dependent vowel signs (pre-base, above, below, post-base).
        while (i < cps.length) {
            const ct = sinhalaCharType(cps[i]);
            if (ct >= 2 && ct <= 5) {
                syllable.push(cps[i]);
                i++;
            } else {
                break;
            }
        }

        // Consume modifiers.
        while (i < cps.length && sinhalaCharType(cps[i]) === 6) {
            syllable.push(cps[i]);
            i++;
        }

        if (syllable.length === 0) {
            syllable.push(cps[i] ?? 0x20);
            i++;
        }

        clusters.push({ codepoints: syllable, baseIndex: baseIdx });
    }

    return clusters;
}

// ── Sinhala Shaper ───────────────────────────────────────────────────

/**
 * Sinhala as the Indic engine sees it: consonants join only across
 * al-lakuna + ZWJ (yansaya, rakaransaya, touching forms), a reph only
 * through an explicit Ra + al-lakuna + ZWJ, and the two-part vowel signs
 * split into the kombuva plus their right half.
 *
 * @since 1.8.0
 */
export const SINHALA_CONFIG: IndicScriptConfig = {
    id: 'sinhala',
    scriptTags: ['sinh', 'DFLT'],
    consonants: [[0x0D9A, 0x0DC6]],
    virama: VIRAMA,
    ra: 0x0DBB,
    rephMode: 'explicit',
    rephPosition: 'afterPost',
    blwfMode: 'postOnly',
    splitMatras: TWO_PART_VOWELS,
    conjunctsNeedZwj: true,
};

/**
 * Shape a string of Sinhala text into an array of positioned glyphs.
 *
 * Since v1.8.0 the work is done by the shared Indic engine over the font's
 * per-feature OpenType tables (`FontData.otl`). See `indic-engine.ts`.
 *
 * @param str - Raw Sinhala string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 */
export function shapeSinhalaText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, SINHALA_CONFIG);
}
