/**
 * pdfnative — Devanagari Mini-Shaper
 * ====================================
 * Pure JS OpenType GSUB + GPOS shaping for Devanagari script.
 * Zero external dependency.
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
import { tryLigature } from './gsub-driver.js';
import { getBaseAnchor, getMarkAnchor } from './gpos-positioner.js';

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

                // Halant after consonant — check if followed by another consonant
                if (i < cps.length && cps[i] === HALANT) {
                    if (i + 1 < cps.length && isConsonant(cps[i + 1])) {
                        syllable.push(cps[i]); // halant
                        i++;
                        continue; // consume next consonant
                    } else {
                        // Explicit halant (visible virama) — end of consonant sequence
                        syllable.push(cps[i]);
                        i++;
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
 * Shape a string of Devanagari text into an array of positioned glyphs.
 *
 * @param str - Raw Devanagari string
 * @param fontData - Font data with cmap, gsub, ligatures, markAnchors, widths
 * @returns Array of positioned glyphs
 */
export function shapeDevanagariText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, gsub, ligatures, markAnchors, widths, defaultWidth } = fontData;
    const shaped: ShapedGlyph[] = [];

    function resolveGid(cp: number): number {
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        return cmap[normCp] || 0;
    }

    /**
     * Try to match a GID sequence against the GSUB ligature table.
     * Delegates to the shared driver in `gsub-driver.ts` (v1.1.0).
     */
    function tryLig(gids: number[]) {
        return tryLigature(gids, ligatures);
    }

    function getAdv(gid: number): number {
        return widths[gid] !== undefined ? widths[gid] : defaultWidth;
    }

    function emitGlyph(gid: number, isZero: boolean, baseGid?: number): void {
        if (isZero && baseGid !== undefined) {
            const markAnchor = getMarkAnchor(markAnchors, gid);
            if (markAnchor) {
                const baseAnchorPt = getBaseAnchor(markAnchors, baseGid, markAnchor.classIdx);
                if (baseAnchorPt) {
                    const baseAdv = getAdv(baseGid);
                    shaped.push({
                        gid, dx: baseAnchorPt[0] - markAnchor.x - baseAdv,
                        dy: baseAnchorPt[1] - markAnchor.y, isZeroAdvance: true,
                    });
                    return;
                }
            }
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: true });
        } else {
            shaped.push({ gid, dx: 0, dy: 0, isZeroAdvance: false });
        }
    }

    const clusters = buildDevanagariClusters(str);

    for (const cluster of clusters) {
        const { codepoints, hasReph, preBaseMatras } = cluster;

        // Determine base glyph index (adjusted for reph)
        const baseStart = hasReph ? 2 : 0;
        let baseGid = 0;

        // Find the effective base consonant GID
        for (let ci = baseStart; ci < codepoints.length; ci++) {
            const ct = devanagariCharType(codepoints[ci]);
            if (ct === 0) {
                baseGid = resolveGid(codepoints[ci]);
            } else if (ct >= 2) {
                break;
            }
        }

        // Track split vowel post-base components
        const splitPostComponents: number[] = [];

        // Emit pre-base matras first (before the consonant cluster)
        for (const mIdx of preBaseMatras) {
            if (mIdx < codepoints.length) {
                const mCp = codepoints[mIdx];
                // Split vowel signs: ो (U+094B) = े (U+0947) + ा (U+093E)
                // ौ (U+094C) = े (U+0947) + ौ-component
                if (mCp === 0x094B) {
                    emitGlyph(resolveGid(0x0947), false);
                    splitPostComponents.push(0x093E);
                } else if (mCp === 0x094C) {
                    emitGlyph(resolveGid(0x0947), false);
                    splitPostComponents.push(0x094C);
                } else {
                    emitGlyph(resolveGid(mCp), false);
                }
            }
        }

        // Emit reph (Ra + Halant) — positioned as zero-advance mark above base
        if (hasReph) {
            // Reph pair: try GSUB for reph form
            const raGid = resolveGid(RA);
            const halantGid = resolveGid(HALANT);
            const rephLig = tryLig([raGid, halantGid]);
            if (rephLig) {
                emitGlyph(rephLig.resultGid, true, baseGid);
            } else {
                const raGsubbed = gsub[raGid] !== undefined ? gsub[raGid] : raGid;
                emitGlyph(raGsubbed, true, baseGid);
            }
        }

        // Emit consonant cluster — try ligature matching first
        const clusterGids: number[] = [];
        const clusterEndIdx: number[] = [];
        let matraStart = codepoints.length;
        for (let ci = baseStart; ci < codepoints.length; ci++) {
            const ct = devanagariCharType(codepoints[ci]);
            if (ct === 0 || ct === 7 || ct === 8) {
                clusterGids.push(resolveGid(codepoints[ci]));
                clusterEndIdx.push(ci);
            } else if (ct < 0 || ct === 1 || ct === 9) {
                // Non-Devanagari char, independent vowel, or digit — emit directly
                emitGlyph(resolveGid(codepoints[ci]), false);
            } else {
                matraStart = ci;
                break;
            }
        }

        // Try ligature substitution on the full consonant+halant GID sequence
        const ligResult = tryLig(clusterGids);
        if (ligResult) {
            emitGlyph(ligResult.resultGid, false);
            baseGid = ligResult.resultGid;

            // Emit remaining unconsumed glyphs
            let gi = ligResult.consumed;
            while (gi < clusterGids.length) {
                const subSeq = clusterGids.slice(gi);
                const subLig = tryLig(subSeq);
                if (subLig) {
                    emitGlyph(subLig.resultGid, false);
                    gi += subLig.consumed;
                } else {
                    const origCi = clusterEndIdx[gi];
                    const ct = devanagariCharType(codepoints[origCi]);
                    if (ct === 7) {
                        emitGlyph(clusterGids[gi], true, baseGid);
                    } else {
                        emitGlyph(clusterGids[gi], false);
                    }
                    gi++;
                }
            }
        } else {
            // No ligature match — emit individual consonant+halant glyphs
            for (let ci = baseStart; ci < matraStart; ci++) {
                const cp = codepoints[ci];
                const ct = devanagariCharType(cp);
                if (ct === 0) {
                    emitGlyph(resolveGid(cp), false);
                } else if (ct === 7) {
                    emitGlyph(resolveGid(cp), true, baseGid);
                } else if (ct === 8) {
                    emitGlyph(resolveGid(cp), true, baseGid);
                }
            }
        }

        // Emit matras and modifiers
        for (let ci = matraStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = devanagariCharType(cp);

            // Skip pre-base matras (already emitted above)
            if (ct === 4) continue;

            if (ct === 2 || ct === 3) {
                // Above/below mark — GPOS positioned
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 5) {
                // Post-base matra — normal advance
                emitGlyph(resolveGid(cp), false);
            } else if (ct === 6) {
                // Modifiers — zero-advance marks
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 9) {
                // Digit — normal advance
                emitGlyph(resolveGid(cp), false);
            } else {
                emitGlyph(resolveGid(cp), false);
            }
        }

        // Emit split vowel post-base components
        for (const postCp of splitPostComponents) {
            emitGlyph(resolveGid(postCp), false);
        }
    }

    return shaped;
}
