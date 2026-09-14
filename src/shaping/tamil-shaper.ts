/**
 * pdfnative — Tamil Shaper
 * ==========================
 * Pure JS OpenType GSUB + GPOS shaping for Tamil script.
 * Zero external dependency.
 *
 * Since v1.8.0 the shaping itself runs in `indic-engine.ts`: this module
 * owns the Tamil `IndicScriptConfig` (script tags `tml2` / `taml`, no reph,
 * split vowel signs ொ / ோ / ௌ decomposed around the base) and the cluster
 * analyser the tests use. Only ெ ே ை (and the pre-base halves of the split
 * signs) move before the base; ி and ீ stay to the right of their consonant.
 *
 * Handles:
 *   - Syllable cluster building (base + pulli-mediated conjuncts)
 *   - Vowel sign reordering (pre-base matras like ெ, ே, ை move before visual base)
 *   - Split vowel signs: ொ = ெ + ா, ோ = ே + ா, ௌ = ெ + ௗ
 *   - GSUB SingleSubst: contextual glyph substitution
 *   - GPOS MarkToBase: combining mark positioning
 *   - GPOS MarkToMark: stacked marks
 *
 * Tamil is simpler than Bengali: no reph, no nukta, no below-base conjuncts.
 * Only has pulli (virama) for consonant joining and pre-base matra reordering.
 *
 * References:
 *   - Unicode Standard §12.6 Tamil
 *   - OpenType spec: Script-specific shaping for Tamil (Indic2)
 *   - ISO 15924 script code: Taml
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { TAMIL_START, TAMIL_END, containsTamil } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';
import { classifyUseCategory } from './use-lite.js';

// Re-export range constants
export { TAMIL_START, TAMIL_END, containsTamil };

// ── Tamil character constants ────────────────────────────────────────

/** Pulli / Virama — suppresses inherent vowel, joins consonants. */
const PULLI = 0x0BCD;

/**
 * Tamil character type classification.
 *   0 = consonant (Ka–Ha)
 *   1 = independent vowel (base character)
 *   2 = dependent vowel sign (matra) — above
 *   3 = dependent vowel sign (matra) — below (none in Tamil standard but reserved)
 *   4 = dependent vowel sign (matra) — pre-base (reordered left of base)
 *   5 = dependent vowel sign (matra) — post-base (right of base)
 *   6 = modifier (anusvara, visarga, OM)
 *   7 = pulli/virama
 *   9 = number/digit
 */
function tamilCharType(cp: number): number {
    if (cp === PULLI) return 7;
    // Anusvara (U+0B82), Visarga (U+0B83)
    if (cp === 0x0B82 || cp === 0x0B83) return 6;
    // Independent vowels U+0B85–U+0B94
    if (cp >= 0x0B85 && cp <= 0x0B94) return 1;
    // Consonants U+0B95–U+0BB9
    if (cp >= 0x0B95 && cp <= 0x0BB9) return 0;
    // Dependent vowel signs — classify by position
    // Pre-base matras (render left of base): only ெ ே ை and the left half
    // of the two-part signs. ி and ீ sit to the right of the base (Unicode
    // Indic_Positional_Category: Right) — classing ி pre-base was the bug
    // behind "வெலை for விலை" until v1.8.0.
    if (cp === 0x0BC6) return 4; // ெ (e)
    if (cp === 0x0BC7) return 4; // ே (ee)
    if (cp === 0x0BC8) return 4; // ை (ai)
    // Split vowel signs — pre-base component
    if (cp === 0x0BCA) return 4; // ொ (o) = ெ + ா
    if (cp === 0x0BCB) return 4; // ோ (oo) = ே + ா
    if (cp === 0x0BCC) return 4; // ௌ (au) = ெ + ௗ
    // Post-base matras
    if (cp === 0x0BBE) return 5; // ா (aa)
    if (cp === 0x0BBF) return 5; // ி (i)
    if (cp === 0x0BC0) return 5; // ீ (ii)
    // Above-base marks
    if (cp === 0x0BC1 || cp === 0x0BC2) return 2; // ு (u), ூ (uu)
    // Au length mark
    if (cp === 0x0BD7) return 5;
    // Other matras
    if (cp >= 0x0BBE && cp <= 0x0BCC) return 2;
    // Tamil digits
    if (cp >= 0x0BE6 && cp <= 0x0BEF) return 9;
    // Tamil special chars (day, month, etc.)
    if (cp >= 0x0BF0 && cp <= 0x0BFA) return 9;
    // OM U+0BD0
    if (cp === 0x0BD0) return 6;
    return -1;
}

/** Check if a codepoint is a Tamil consonant. */
function isConsonant(cp: number): boolean {
    return tamilCharType(cp) === 0;
}

// ── Cluster building ─────────────────────────────────────────────────

interface TamilCluster {
    /** Codepoints in logical order. */
    codepoints: number[];
    /** Index of the base consonant within codepoints. */
    baseIndex: number;
    /** Indices of pre-base matra codepoints. */
    preBaseMatras: number[];
}

/**
 * Build syllable clusters from Tamil text.
 * A Tamil syllable: [C + Pulli]* C [matras] [modifiers]
 */
export function buildTamilClusters(str: string): TamilCluster[] {
    const clusters: TamilCluster[] = [];
    const cps: number[] = [];

    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = tamilCharType(cp);

        // Zero-width joiners carry no standalone glyph; drop orphans so they
        // never resolve to a .notdef box. (USE-lite classifies joiners.)
        if (classifyUseCategory(cp) === 'ZWJ' || classifyUseCategory(cp) === 'ZWNJ') {
            i++;
            continue;
        }

        // Not a Tamil character — emit as standalone
        if (type < 0 || cp < TAMIL_START || cp > TAMIL_END) {
            clusters.push({ codepoints: [cp], baseIndex: 0, preBaseMatras: [] });
            i++;
            continue;
        }

        const syllable: number[] = [];
        let lastConsonantIdx = -1;
        const preMatras: number[] = [];

        // Consume consonant + pulli sequences
        while (i < cps.length) {
            const cc = cps[i];
            const ct = tamilCharType(cc);

            if (ct === 0) { // consonant
                lastConsonantIdx = syllable.length;
                syllable.push(cc);
                i++;

                // Pulli after consonant — check what follows. A ZWJ/ZWNJ
                // joiner may sit between the pulli and the next consonant:
                //   • ZWJ  → request a conjunct form — continue the conjunct.
                //   • ZWNJ → break the conjunct, keep the visible pulli.
                if (i < cps.length && cps[i] === PULLI) {
                    let j = i + 1;
                    let zwnj = false;
                    if (j < cps.length) {
                        const jc = classifyUseCategory(cps[j]);
                        if (jc === 'ZWJ') { j++; }
                        else if (jc === 'ZWNJ') { j++; zwnj = true; }
                    }
                    if (!zwnj && j < cps.length && isConsonant(cps[j])) {
                        syllable.push(cps[i]); // pulli
                        i = j; // skip pulli (+ optional ZWJ) → next consonant
                        continue; // consume next consonant
                    } else {
                        // Explicit pulli (visible virama). Any joiner consumed.
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

        // Consume dependent vowel signs (matras)
        while (i < cps.length) {
            const ct = tamilCharType(cps[i]);
            if (ct >= 2 && ct <= 5) {
                if (ct === 4) {
                    preMatras.push(syllable.length);
                }
                syllable.push(cps[i]);
                i++;
            } else {
                break;
            }
        }

        // Consume modifiers
        while (i < cps.length && tamilCharType(cps[i]) === 6) {
            syllable.push(cps[i]);
            i++;
        }

        if (syllable.length === 0) {
            syllable.push(cps[i] ?? 0x20);
            i++;
        }

        clusters.push({
            codepoints: syllable,
            baseIndex: baseIdx,
            preBaseMatras: preMatras,
        });
    }

    return clusters;
}

// ── Tamil Shaper ─────────────────────────────────────────────────────

/**
 * Tamil as the Indic engine sees it: no reph, no below-base forms; the
 * pre-base vowel signs ெ ே ை move before the base and the two-part signs
 * ொ ோ ௌ split into their left and right halves. ி and ீ stay to the right
 * of the base — Unicode puts them there, and so does every Tamil hand.
 *
 * @since 1.8.0
 */
export const TAMIL_CONFIG: IndicScriptConfig = {
    id: 'tamil',
    scriptTags: ['tml2', 'taml', 'DFLT'],
    consonants: [[0x0B95, 0x0BB9]],
    virama: PULLI,
    ra: 0x0BB0,
    rephMode: 'none',
    rephPosition: 'afterPost',
    blwfMode: 'preAndPost',
    splitMatras: {
        0x0BCA: [0x0BC6, 0x0BBE], // ொ = ெ + ா
        0x0BCB: [0x0BC7, 0x0BBE], // ோ = ே + ா
        0x0BCC: [0x0BC6, 0x0BD7], // ௌ = ெ + ௗ
    },
};

/**
 * Shape a string of Tamil text into an array of positioned glyphs.
 *
 * Since v1.8.0 the work is done by the shared Indic engine over the font's
 * per-feature OpenType tables (`FontData.otl`): the `akhn` conjuncts
 * (க்ஷ, ஸ்ரீ), the `haln` pulli forms and the `psts` vowel ligatures
 * (ரூ) all come from the font. See `indic-engine.ts`.
 *
 * @param str - Raw Tamil string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 */
export function shapeTamilText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, TAMIL_CONFIG);
}
