/**
 * pdfnative — Bengali Shaper
 * ============================
 * Pure JS OpenType GSUB + GPOS shaping for Bengali script.
 * Zero external dependency.
 *
 * Since v1.8.0 the shaping itself runs in `indic-engine.ts`: this module
 * owns the Bengali `IndicScriptConfig` (script tags `bng2` / `beng`,
 * implicit reph placed after the subjoined forms, split vowel signs ো / ৌ
 * decomposed around the base) and the cluster analyser the tests use.
 *
 * Handles:
 *   - Syllable cluster building (base + halant-mediated conjuncts)
 *   - Reph detection and reordering (Ra + Halant at start → reph above last base)
 *   - Vowel sign reordering (pre-base matras like ি move before visual base)
 *   - Nukta (U+09BC) attachment to preceding consonant
 *   - GSUB SingleSubst: contextual glyph substitution
 *   - GPOS MarkToBase: combining mark positioning (vowel signs, chandrabindu)
 *   - GPOS MarkToMark: stacked marks
 *
 * References:
 *   - Unicode Standard §12.2 Bengali
 *   - OpenType spec: Script-specific shaping for Bengali (Indic2)
 *   - ISO 15924 script code: Beng
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { BENGALI_START, BENGALI_END, containsBengali } from './script-registry.js';
import { shapeIndicText, type IndicScriptConfig } from './indic-engine.js';
import { classifyUseCategory } from './use-lite.js';

// Re-export range constants
export { BENGALI_START, BENGALI_END, containsBengali };

// ── Bengali character classification ─────────────────────────────────

/** Halant / Virama — joins consonants into conjuncts. */
const HALANT = 0x09CD;
/** Nukta — modifies preceding consonant. */
const NUKTA = 0x09BC;
/** Ra — used for reph formation when followed by halant at syllable start. */
const RA = 0x09B0;

/**
 * Bengali character type classification.
 *   0 = consonant (Ka–Ha, Ya, Ra etc.)
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
function bengaliCharType(cp: number): number {
    if (cp === HALANT) return 7;
    if (cp === NUKTA) return 8;
    // Modifiers
    if (cp >= 0x0981 && cp <= 0x0983) return 6;
    // Independent vowels U+0985–U+0994
    if (cp >= 0x0985 && cp <= 0x0994) return 1;
    // Consonants U+0995–U+09B9 (Ka to Ha)
    if (cp >= 0x0995 && cp <= 0x09B9) return 0;
    // Dependent vowel signs — classify by position
    // Pre-base matras (render left of base)
    if (cp === 0x09BF) return 4; // ি (i)
    if (cp === 0x09C7) return 4; // ে (e)
    if (cp === 0x09C8) return 4; // ৈ (ai)
    // Below-base matras
    if (cp === 0x09C1 || cp === 0x09C2 || cp === 0x09C3 || cp === 0x09C4) return 3;
    // Above-base matras
    if (cp === 0x09BE) return 5; // া (aa) — post-base
    if (cp === 0x09C0) return 5; // ী (ii) — post-base
    // Split vowel signs: ো (o) = ে + া, ৌ (au) = ে + ৌ
    if (cp === 0x09CB) return 4; // ো — pre-base component
    if (cp === 0x09CC) return 4; // ৌ — pre-base component
    // Other dependent vowel signs
    if (cp >= 0x09BE && cp <= 0x09CC) return 2;
    // Au length mark
    if (cp === 0x09D7) return 5;
    // Bengali digits
    if (cp >= 0x09E6 && cp <= 0x09EF) return 9;
    // Ya-phalaa, Ra-phalaa (secondary forms are consonants)
    if (cp === 0x09DF) return 0; // YYA
    // Avagraha U+09BD
    if (cp === 0x09BD) return 1;
    // Khanda Ta U+09CE
    if (cp === 0x09CE) return 0;
    return -1;
}

/** Check if a codepoint is a Bengali consonant. */
function isConsonant(cp: number): boolean {
    return bengaliCharType(cp) === 0;
}

// ── Cluster building ─────────────────────────────────────────────────

interface BengaliCluster {
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
 * Build syllable clusters from Bengali text.
 * A Bengali syllable: [Reph] [C + H]* C [nukta] [matras] [modifiers]
 */
export function buildBengaliClusters(str: string): BengaliCluster[] {
    const clusters: BengaliCluster[] = [];
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
        const type = bengaliCharType(cp);

        // Zero-width joiners carry no standalone glyph. An orphan ZWJ/ZWNJ
        // (one not consumed by the conjunct logic below) is dropped so it
        // never resolves to a .notdef box. (USE-lite is the classification
        // authority for joiners.)
        if (classifyUseCategory(cp) === 'ZWJ' || classifyUseCategory(cp) === 'ZWNJ') {
            i++;
            continue;
        }

        // Not a Bengali character — emit as standalone
        if (type < 0 || cp < BENGALI_START || cp > BENGALI_END) {
            clusters.push({ codepoints: [cp], baseIndex: 0, hasReph: false, preBaseMatras: [] });
            i++;
            continue;
        }

        // Start of a syllable
        const syllable: number[] = [];
        let baseIdx = 0;
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
            const ct = bengaliCharType(cc);

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
                //   • ZWJ  → request a subjoined / half form (e.g. ya-phalaa
                //            when the next consonant is Ya) — continue conjunct.
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

        baseIdx = lastConsonantIdx >= 0 ? lastConsonantIdx : 0;

        // Consume dependent vowel signs (matras)
        while (i < cps.length) {
            const ct = bengaliCharType(cps[i]);
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
        while (i < cps.length && bengaliCharType(cps[i]) === 6) {
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
            baseIndex: hasReph ? baseIdx + 2 : baseIdx, // Adjust for reph prefix
            hasReph,
            preBaseMatras: preMatras,
        });
    }

    return clusters;
}

// ── Bengali Shaper ───────────────────────────────────────────────────

/**
 * Bengali as the Indic engine sees it: an implicit reph that lands after
 * the subjoined consonants and before every vowel sign; the two-part vowel
 * signs ো and ৌ split into ে plus their right half.
 *
 * @since 1.8.0
 */
export const BENGALI_CONFIG: IndicScriptConfig = {
    id: 'bengali',
    scriptTags: ['bng2', 'beng', 'DFLT'],
    consonants: [[0x0995, 0x09B9], [0x09CE, 0x09CE], [0x09DC, 0x09DF], [0x09F0, 0x09F1]],
    virama: HALANT,
    ra: RA,
    rephMode: 'implicit',
    rephPosition: 'afterSub',
    blwfMode: 'preAndPost',
    splitMatras: {
        0x09CB: [0x09C7, 0x09BE], // ো = ে + া
        0x09CC: [0x09C7, 0x09D7], // ৌ = ে + ৗ
    },
};

/**
 * Shape a string of Bengali text into an array of positioned glyphs.
 *
 * Since v1.8.0 the work is done by the shared Indic engine over the font's
 * per-feature OpenType tables (`FontData.otl`). See `indic-engine.ts`.
 *
 * @param str - Raw Bengali string
 * @param fontData - Font data with cmap, otl, markAnchors, widths
 * @returns Array of positioned glyphs in visual order
 */
export function shapeBengaliText(str: string, fontData: FontData): ShapedGlyph[] {
    return shapeIndicText(str, fontData, BENGALI_CONFIG);
}
