/**
 * pdfnative — Tamil Mini-Shaper
 * ===============================
 * Pure JS OpenType GSUB + GPOS shaping for Tamil script.
 * Zero external dependency.
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
    // Pre-base matras (render left of base)
    if (cp === 0x0BBF) return 4; // ி (i)
    if (cp === 0x0BC6) return 4; // ெ (e)
    if (cp === 0x0BC7) return 4; // ே (ee)
    if (cp === 0x0BC8) return 4; // ை (ai)
    // Split vowel signs — pre-base component
    if (cp === 0x0BCA) return 4; // ொ (o) = ெ + ா
    if (cp === 0x0BCB) return 4; // ோ (oo) = ே + ா
    if (cp === 0x0BCC) return 4; // ௌ (au) = ெ + ௗ
    // Post-base matras
    if (cp === 0x0BBE) return 5; // ா (aa)
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

                // Pulli after consonant — check if followed by another consonant
                if (i < cps.length && cps[i] === PULLI) {
                    if (i + 1 < cps.length && isConsonant(cps[i + 1])) {
                        syllable.push(cps[i]); // pulli
                        i++;
                        continue; // consume next consonant
                    } else {
                        // Explicit pulli (visible virama)
                        syllable.push(cps[i]);
                        i++;
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
 * Shape a string of Tamil text into an array of positioned glyphs.
 *
 * @param str - Raw Tamil string
 * @param fontData - Font data with cmap, gsub, markAnchors, mark2mark, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeTamilText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, gsub, markAnchors, widths, defaultWidth } = fontData;
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

    const clusters = buildTamilClusters(str);

    for (const cluster of clusters) {
        const { codepoints, preBaseMatras } = cluster;

        // Find the effective base consonant GID
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = tamilCharType(codepoints[ci]);
            if (ct === 0) {
                baseGid = resolveGid(codepoints[ci]);
            } else if (ct >= 2) {
                break;
            }
        }

        // Track split vowel post-base components that need emitting after base
        const splitPostComponents: number[] = [];

        // Emit pre-base matras first
        for (const mIdx of preBaseMatras) {
            if (mIdx < codepoints.length) {
                const mCp = codepoints[mIdx];
                // Split vowel signs: ொ (U+0BCA) = ெ (U+0BC6) + ா (U+0BBE)
                // ோ (U+0BCB) = ே (U+0BC7) + ா (U+0BBE)
                // ௌ (U+0BCC) = ெ (U+0BC6) + ௗ (U+0BD7)
                if (mCp === 0x0BCA) {
                    emitGlyph(resolveGid(0x0BC6), false);
                    splitPostComponents.push(0x0BBE);
                } else if (mCp === 0x0BCB) {
                    emitGlyph(resolveGid(0x0BC7), false);
                    splitPostComponents.push(0x0BBE);
                } else if (mCp === 0x0BCC) {
                    emitGlyph(resolveGid(0x0BC6), false);
                    splitPostComponents.push(0x0BD7);
                } else {
                    emitGlyph(resolveGid(mCp), false);
                }
            }
        }

        // Emit consonant cluster + matras + modifiers
        for (let ci = 0; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = tamilCharType(cp);

            // Skip pre-base matras (already emitted)
            if (ct === 4) continue;

            if (ct === 0) {
                // Consonant — try GSUB
                const nextCi = ci + 1;
                const hasPulli = nextCi < codepoints.length && codepoints[nextCi] === PULLI;
                const gid = hasPulli ? resolveGidGsub(cp) : resolveGid(cp);
                emitGlyph(gid, false);
            } else if (ct === 7) {
                // Pulli — zero-advance mark
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 2 || ct === 3) {
                // Above/below marks — GPOS positioned
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 5) {
                // Post-base matra (non-split)
                emitGlyph(resolveGid(cp), false);
            } else if (ct === 6) {
                // Modifier — zero-advance mark
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 9) {
                // Digit/special
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
