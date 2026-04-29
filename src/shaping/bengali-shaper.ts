/**
 * pdfnative — Bengali Mini-Shaper
 * =================================
 * Pure JS OpenType GSUB + GPOS shaping for Bengali script.
 * Zero external dependency.
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
import { tryLigature } from './gsub-driver.js';

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
 * Shape a string of Bengali text into an array of positioned glyphs.
 *
 * @param str - Raw Bengali string
 * @param fontData - Font data with cmap, gsub, markAnchors, mark2mark, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeBengaliText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, gsub, ligatures, markAnchors, widths, defaultWidth } = fontData;
    const shaped: ShapedGlyph[] = [];

    function resolveGid(cp: number): number {
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        return cmap[normCp] || 0;
    }

    function resolveGidGsub(cp: number): number {
        const gid = resolveGid(cp);
        if (gsub[gid] !== undefined) return gsub[gid];
        return gid;
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

    function getBaseAnchor(baseGid: number, markClass: number): [number, number] | null {
        const base = markAnchors && markAnchors.bases && markAnchors.bases[baseGid];
        if (!base) return null;
        return base[markClass] ?? null;
    }

    function getMarkAnchor(markGid: number): { classIdx: number; x: number; y: number } | null {
        const mark = markAnchors && markAnchors.marks && markAnchors.marks[markGid];
        if (!mark) return null;
        return { classIdx: mark[0], x: mark[1], y: mark[2] };
    }

    function emitGlyph(gid: number, isZero: boolean, baseGid?: number): void {
        if (isZero && baseGid !== undefined) {
            const markAnchor = getMarkAnchor(gid);
            if (markAnchor) {
                const baseAnchorPt = getBaseAnchor(baseGid, markAnchor.classIdx);
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

    const clusters = buildBengaliClusters(str);

    for (const cluster of clusters) {
        const { codepoints, hasReph, preBaseMatras } = cluster;

        // Determine base glyph index (adjusted for reph)
        const baseStart = hasReph ? 2 : 0;
        let baseGid = 0;

        // Find the effective base consonant GID
        // The base is the last consonant before matras/modifiers
        for (let ci = baseStart; ci < codepoints.length; ci++) {
            const ct = bengaliCharType(codepoints[ci]);
            if (ct === 0) {
                baseGid = resolveGid(codepoints[ci]);
            } else if (ct >= 2) {
                break; // hit matras/modifiers
            }
        }

        // Track split vowel post-base components
        const splitPostComponents: number[] = [];

        // Emit pre-base matras first (before the consonant cluster)
        for (const mIdx of preBaseMatras) {
            if (mIdx < codepoints.length) {
                const mCp = codepoints[mIdx];
                // Split vowel signs: ো (U+09CB) = ে (U+09C7) + া (U+09BE)
                // ৌ (U+09CC) = ে (U+09C7) + ৌ-component (U+09D7)
                if (mCp === 0x09CB) {
                    emitGlyph(resolveGid(0x09C7), false);
                    splitPostComponents.push(0x09BE);
                } else if (mCp === 0x09CC) {
                    emitGlyph(resolveGid(0x09C7), false);
                    splitPostComponents.push(0x09D7);
                } else {
                    emitGlyph(resolveGid(mCp), false);
                }
            }
        }

        // Emit consonant cluster — try ligature matching first
        // Collect the consonant+halant sequence as GIDs for ligature lookup
        const clusterGids: number[] = [];
        const clusterEndIdx: number[] = []; // maps each GID position back to codepoint index
        let matraStart = codepoints.length;
        for (let ci = baseStart; ci < codepoints.length; ci++) {
            const ct = bengaliCharType(codepoints[ci]);
            if (ct === 0 || ct === 7 || ct === 8) {
                clusterGids.push(resolveGid(codepoints[ci]));
                clusterEndIdx.push(ci);
            } else if (ct < 0 || ct === 1 || ct === 9) {
                // Non-Bengali char, independent vowel, or digit — emit directly
                emitGlyph(resolveGid(codepoints[ci]), false);
            } else {
                matraStart = ci;
                break;
            }
        }

        // Try ligature substitution on the full consonant+halant GID sequence
        let ligConsumed = 0;
        const ligResult = tryLig(clusterGids);
        if (ligResult) {
            // Ligature matched — emit single glyph for the entire matched sequence
            emitGlyph(ligResult.resultGid, false);
            baseGid = ligResult.resultGid;
            ligConsumed = ligResult.consumed;

            // Emit any remaining consonant+halant glyphs not consumed by the ligature
            let gi = ligConsumed;
            while (gi < clusterGids.length) {
                const subSeq = clusterGids.slice(gi);
                const subLig = tryLig(subSeq);
                if (subLig) {
                    emitGlyph(subLig.resultGid, false);
                    gi += subLig.consumed;
                } else {
                    // No further ligature — emit individual glyph
                    const origCi = clusterEndIdx[gi];
                    const ct = bengaliCharType(codepoints[origCi]);
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
                const ct = bengaliCharType(cp);
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
            const ct = bengaliCharType(cp);

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

        // Emit reph (Ra + Halant) as above mark on base — placed after base cluster
        if (hasReph) {
            const raGid = resolveGidGsub(RA);
            const halantGid = resolveGid(HALANT);
            // Reph rendered as combining mark above the base
            emitGlyph(raGid, true, baseGid);
            emitGlyph(halantGid, true, baseGid);
        }
    }

    return shaped;
}
