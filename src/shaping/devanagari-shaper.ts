/**
 * pdfnative — Devanagari Shaper
 * ===============================
 * Pure JS OpenType GSUB + GPOS shaping for Devanagari script.
 * Zero external dependency.
 *
 * Since v1.8.0 the shaping itself runs in `indic-engine.ts`: this module
 * owns the Devanagari `IndicScriptConfig` (script tags `dev2` / `deva`,
 * implicit reph placed before post-base matras, below-base forms on both
 * sides of the base, no split vowel signs — ो and ौ are single glyphs in
 * every Noto face) and the cluster analyser the tests and callers use.
 *
 * Handles:
 *   - Syllable cluster building (base + halant-mediated conjuncts)
 *   - Reph detection and reordering (Ra + Halant at start → reph above last base)
 *   - Vowel sign reordering (pre-base matra ि moves before visual base)
 *   - Nukta (U+093C) attachment  to preceding consonant
 *   - GSUB LigatureSubst: conjunct formation (C + Halant + C → ligature glyph)
 *   - GSUB SingleSubst: contextual glyph substitution
 *   - GPOS MarkToBase: combining mark positioning (matras, chandrabindu)
 *
 * References:
 *   - Unicode Standard §12.1 Devanagari
 *   - OpenType spec: Script-specific shaping for Devanagari (dev2)
 *   - ISO 15924 script code: Deva
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { DEVANAGARI_START, DEVANAGARI_END, containsDevanagari } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';
import { classifyUseCategory } from './use-lite.js';

// Re-export range constants
export { DEVANAGARI_START, DEVANAGARI_END, containsDevanagari };

// ── Devanagari character classification ──────────────────────────────

/** Halant / Virama — joins consonants into conjuncts. */
const HALANT = 0x094D;
/** Nukta — modifies preceding consonant. */
const NUKTA = 0x093C;
/** Ra — used for reph formation when followed by halant at syllable start. */
const RA = 0x0930;

/**
 * Devanagari character type classification.
 *   0 = consonant (Ka–Ha)
 *   1 = independent vowel (base character)
 *   2 = dependent vowel sign (matra) — above
 *   3 = dependent vowel sign (matra) — below
 *   4 = dependent vowel sign (matra) — pre-base (reordered left of base)
 *   5 = dependent vowel sign (matra) — post-base (right of base)
 *   6 = modifier (chandrabindu, anusvara, visarga)
 *   7 = halant/virama
 *   8 = nukta
 *   9 = number/digit
 */
function devanagariCharType(cp: number): number {
    if (cp === HALANT) return 7;
    if (cp === NUKTA) return 8;
    // Modifiers: Chandrabindu (U+0901), Anusvara (U+0902), Visarga (U+0903)
    if (cp >= 0x0901 && cp <= 0x0903) return 6;
    // Independent vowels U+0904–U+0914
    if (cp >= 0x0904 && cp <= 0x0914) return 1;
    // Consonants U+0915–U+0939 (Ka to Ha)
    if (cp >= 0x0915 && cp <= 0x0939) return 0;
    // Pre-base matra: ि (short i) U+093F
    if (cp === 0x093F) return 4;
    // Below-base matras: ु (U+0941), ू (U+0942), ृ (U+0943), ॄ (U+0944)
    if (cp >= 0x0941 && cp <= 0x0944) return 3;
    // Post-base matras: ा (U+093E), ी (U+0940)
    if (cp === 0x093E || cp === 0x0940) return 5;
    // Above-base matras: े (U+0947), ै (U+0948)
    if (cp === 0x0947 || cp === 0x0948) return 2;
    // Split vowel matras: ो (U+094B) = े + ा, ौ (U+094C) = े + ौ
    if (cp === 0x094B || cp === 0x094C) return 4;
    // Other dependent vowel signs
    if (cp >= 0x0945 && cp <= 0x094C) return 2;
    // Devanagari digits
    if (cp >= 0x0966 && cp <= 0x096F) return 9;
    // Additional consonants (QA, KHHA, GHHA, ZA, DDDHA, RHA, FA, YYA)
    if (cp >= 0x0958 && cp <= 0x095F) return 0;
    // Avagraha U+093D
    if (cp === 0x093D) return 1;
    // OM U+0950
    if (cp === 0x0950) return 1;
    return -1;
}

/** Check if a codepoint is a Devanagari consonant. */
function isConsonant(cp: number): boolean {
    return devanagariCharType(cp) === 0;
}

// ── Cluster building ─────────────────────────────────────────────────

interface DevanagariCluster {
    /** Codepoints in logical order. */
    codepoints: number[];
    /** Index of the base consonant within codepoints. */
    baseIndex: number;
    /** Whether this syllable starts with Ra + Halant (reph). */
    hasReph: boolean;
    /** Indices of pre-base matra codepoints. */
    preBaseMatras: number[];
}

/**
 * Build syllable clusters from Devanagari text.
 * A Devanagari syllable: [Reph] [C + H]* C [nukta] [matras] [modifiers]
 */
export function buildDevanagariClusters(str: string): DevanagariCluster[] {
    const clusters: DevanagariCluster[] = [];
    const cps: number[] = [];

    // Collect codepoints
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = devanagariCharType(cp);

        // Zero-width joiners carry no standalone glyph. An orphan ZWJ/ZWNJ
        // (one not consumed by the conjunct logic below) is dropped so it
        // never resolves to a .notdef box. (USE-lite is the classification
        // authority for joiners.)
        if (classifyUseCategory(cp) === 'ZWJ' || classifyUseCategory(cp) === 'ZWNJ') {
            i++;
            continue;
        }

        // Not a Devanagari character — emit as standalone
        if (type < 0 || cp < DEVANAGARI_START || cp > DEVANAGARI_END) {
            clusters.push({ codepoints: [cp], baseIndex: 0, hasReph: false, preBaseMatras: [] });
            i++;
            continue;
        }

        // Start of a syllable
        const syllable: number[] = [];
        let hasReph = false;
        const preMatras: number[] = [];

        // Check for reph: Ra + Halant at start followed by a consonant
        if (isConsonant(cp) && cp === RA && i + 2 < cps.length &&
            cps[i + 1] === HALANT && isConsonant(cps[i + 2])) {
            hasReph = true;
            syllable.push(cp, cps[i + 1]); // Ra + Halant
            i += 2;
        }

        // Consume consonant + halant sequences (C + H + C + H + ... + C)
        let lastConsonantIdx = -1;
        while (i < cps.length) {
            const cc = cps[i];
            const ct = devanagariCharType(cc);

            if (ct === 0) { // consonant
                lastConsonantIdx = syllable.length;
                syllable.push(cc);
                i++;

                // Nukta after consonant
                if (i < cps.length && cps[i] === NUKTA) {
                    syllable.push(cps[i]);
                    i++;
                }

                // Halant after consonant — check what follows. A ZWJ/ZWNJ
                // joiner may sit between the halant and the next consonant:
                //   • ZWJ  → request a half / conjunct form (Marathi eyelash-ra
                //            when the consonant is Ra) — continue the conjunct.
                //   • ZWNJ → break the conjunct, keep the visible virama.
                if (i < cps.length && cps[i] === HALANT) {
                    let j = i + 1;
                    let zwnj = false;
                    if (j < cps.length) {
                        const jc = classifyUseCategory(cps[j]);
                        if (jc === 'ZWJ') { j++; }
                        else if (jc === 'ZWNJ') { j++; zwnj = true; }
                    }
                    if (!zwnj && j < cps.length && isConsonant(cps[j])) {
                        syllable.push(cps[i]); // halant
                        i = j; // skip halant (+ optional ZWJ) → next consonant
                        continue; // consume next consonant
                    } else {
                        // Explicit halant (visible virama) — end of consonant
                        // sequence. Any ZWJ/ZWNJ joiner is consumed silently.
                        syllable.push(cps[i]);
                        i = j;
                        break;
                    }
                }
                break; // no halant → end of consonant sequence
            } else {
                break; // not a consonant
            }
        }

        const baseIdx = lastConsonantIdx >= 0 ? lastConsonantIdx : 0;

        // Consume dependent vowel signs (matras)
        while (i < cps.length) {
            const ct = devanagariCharType(cps[i]);
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

        // Consume modifiers (chandrabindu, anusvara, visarga)
        while (i < cps.length && devanagariCharType(cps[i]) === 6) {
            syllable.push(cps[i]);
            i++;
        }

        // If syllable is empty (standalone vowel, digit, etc.)
        if (syllable.length === 0) {
            syllable.push(cps[i] ?? 0x20);
            i++;
        }

        clusters.push({
            codepoints: syllable,
            baseIndex: hasReph ? baseIdx + 2 : baseIdx,
            hasReph,
            preBaseMatras: preMatras,
        });
    }

    return clusters;
}

// ── Devanagari Shaper ────────────────────────────────────────────────

/**
 * Devanagari as the Indic engine sees it: an implicit reph (Ra + virama at
 * the head of a syllable) that lands before the post-base vowel signs;
 * `blwf` may reach a consonant on either side of the base; no two-part
 * vowel sign to decompose — U+094B ो and U+094C ौ are single glyphs.
 *
 * @since 1.8.0
 */
export const DEVANAGARI_CONFIG: IndicScriptConfig = {
    id: 'devanagari',
    scriptTags: ['dev2', 'deva', 'DFLT'],
    consonants: [[0x0915, 0x0939], [0x0958, 0x095F], [0x0979, 0x097F]],
    virama: HALANT,
    ra: RA,
    rephMode: 'implicit',
    rephPosition: 'beforePost',
    blwfMode: 'preAndPost',
    splitMatras: {},
};

/**
 * Shape a string of Devanagari text into an array of positioned glyphs.
 *
 * Since v1.8.0 the work is done by the shared Indic engine over the font's
 * per-feature OpenType tables (`FontData.otl`): syllable analysis from the
 * UCD, base finding, reph and pre-base vowel reordering, the `rphf`, `half`,
 * `blwf`, `akhn` and presentation stages in specification order, then GPOS
 * mark attachment. See `indic-engine.ts`.
 *
 * @param str - Raw Devanagari string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 */
export function shapeDevanagariText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, DEVANAGARI_CONFIG);
}
