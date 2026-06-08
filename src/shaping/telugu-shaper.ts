/**
 * pdfnative — Telugu Mini-Shaper
 * ================================
 * Pure JS OpenType GSUB + GPOS shaping for Telugu script.
 * Zero external dependency.
 *
 * Handles:
 *   - Syllable cluster building (base + virama-mediated conjuncts / subjoined
 *     consonants — Telugu stacks the dependent consonant below the base)
 *   - GSUB LigatureSubst: conjunct / subjoined-consonant formation
 *     (C + Virama + C → ligature glyph)
 *   - GSUB SingleSubst: contextual glyph substitution
 *   - GPOS MarkToBase: combining-mark positioning (above/below vowel signs,
 *     anusvara, candrabindu, length marks)
 *
 * Telugu is structurally close to Devanagari but:
 *   - has **no reph** (Ra forms a subjoined glyph, not a top mark),
 *   - has **no pre-base matra reordering** — every Telugu vowel sign attaches
 *     to the right of, or above/below, the base (nothing renders to its left),
 *   - has **no nukta**.
 *
 * References:
 *   - Unicode Standard §12.8 Telugu
 *   - OpenType spec: Script-specific shaping for Telugu (tel2 / Indic2)
 *   - ISO 15924 script code: Telu
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { TELUGU_START, TELUGU_END, containsTelugu } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';
import { classifyUseCategory } from './use-lite.js';

// Re-export range constants
export { TELUGU_START, TELUGU_END, containsTelugu };

// ── Telugu character constants ───────────────────────────────────────

/** Virama (halant) — suppresses inherent vowel, joins consonants. */
const VIRAMA = 0x0C4D;

/**
 * Telugu character type classification.
 *   0 = consonant (Ka–Ha + additional)
 *   1 = independent vowel (base character)
 *   2 = dependent vowel sign (matra) — above/below mark (GPOS-positioned)
 *   3 = dependent vowel sign (matra) — below mark
 *   5 = dependent vowel sign (matra) — post-base spacing (right of base)
 *   6 = modifier (candrabindu, anusvara, visarga, length marks above)
 *   7 = virama
 *   9 = number/digit/symbol
 */
function teluguCharType(cp: number): number {
    if (cp === VIRAMA) return 7;
    // Candrabindu (U+0C00), Candrabindu (U+0C01), Anusvara (U+0C02), Visarga (U+0C03)
    if (cp >= 0x0C00 && cp <= 0x0C04) return 6;
    // Independent vowels U+0C05–U+0C14
    if (cp >= 0x0C05 && cp <= 0x0C14) return 1;
    // Avagraha U+0C3D — behaves like an independent letter
    if (cp === 0x0C3D) return 1;
    // Consonants U+0C15–U+0C39
    if (cp >= 0x0C15 && cp <= 0x0C39) return 0;
    // Additional consonants U+0C58–U+0C5A
    if (cp >= 0x0C58 && cp <= 0x0C5A) return 0;
    // Dependent vowel signs — classify by visual position
    if (cp === 0x0C3E) return 5; // ా AA  — right spacing
    if (cp === 0x0C3F) return 2; // ి I   — above
    if (cp === 0x0C40) return 2; // ీ II  — above
    if (cp === 0x0C41) return 5; // ు U   — right spacing
    if (cp === 0x0C42) return 5; // ూ UU  — right spacing
    if (cp === 0x0C43) return 2; // ృ vocalic R — above
    if (cp === 0x0C44) return 2; // ౄ vocalic RR — above
    if (cp === 0x0C46) return 2; // ె E   — above
    if (cp === 0x0C47) return 2; // ే EE  — above
    if (cp === 0x0C48) return 2; // ై AI  — above
    if (cp === 0x0C4A) return 5; // ొ O   — right spacing
    if (cp === 0x0C4B) return 5; // ో OO  — right spacing
    if (cp === 0x0C4C) return 5; // ౌ AU  — right spacing
    // Vowel signs vocalic L / LL (below)
    if (cp === 0x0C62 || cp === 0x0C63) return 3;
    // Length marks (above) U+0C55, U+0C56
    if (cp === 0x0C55 || cp === 0x0C56) return 6;
    // Independent vocalic RR/LL vowels U+0C60–U+0C61
    if (cp === 0x0C60 || cp === 0x0C61) return 1;
    // Telugu digits U+0C66–U+0C6F
    if (cp >= 0x0C66 && cp <= 0x0C6F) return 9;
    // Telugu fraction / weight symbols U+0C78–U+0C7F
    if (cp >= 0x0C78 && cp <= 0x0C7F) return 9;
    return -1;
}

/** Check if a codepoint is a Telugu consonant. */
function isConsonant(cp: number): boolean {
    return teluguCharType(cp) === 0;
}

// ── Cluster building ─────────────────────────────────────────────────

interface TeluguCluster {
    /** Codepoints in logical order. */
    codepoints: number[];
    /** Index of the base consonant within codepoints. */
    baseIndex: number;
}

/**
 * Build syllable clusters from Telugu text.
 * A Telugu syllable: [C + Virama]* C [matras] [modifiers]
 */
export function buildTeluguClusters(str: string): TeluguCluster[] {
    const clusters: TeluguCluster[] = [];
    const cps: number[] = [];

    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = teluguCharType(cp);

        // Zero-width joiners carry no standalone glyph; drop orphans so they
        // never resolve to a .notdef box. (USE-lite classifies joiners.)
        if (classifyUseCategory(cp) === 'ZWJ' || classifyUseCategory(cp) === 'ZWNJ') {
            i++;
            continue;
        }

        // Not a Telugu character — emit as standalone
        if (type < 0 || cp < TELUGU_START || cp > TELUGU_END) {
            clusters.push({ codepoints: [cp], baseIndex: 0 });
            i++;
            continue;
        }

        const syllable: number[] = [];
        let lastConsonantIdx = -1;

        // Consume consonant + virama sequences (C + V + C + V + ... + C)
        while (i < cps.length) {
            const cc = cps[i];
            const ct = teluguCharType(cc);

            if (ct === 0) { // consonant
                lastConsonantIdx = syllable.length;
                syllable.push(cc);
                i++;

                // Virama after consonant — check what follows. A ZWJ/ZWNJ
                // joiner may sit between the virama and the next consonant:
                //   • ZWJ  → request a conjunct form — continue the conjunct.
                //   • ZWNJ → break the conjunct, keep the visible virama.
                if (i < cps.length && cps[i] === VIRAMA) {
                    let j = i + 1;
                    let zwnj = false;
                    if (j < cps.length) {
                        const jc = classifyUseCategory(cps[j]);
                        if (jc === 'ZWJ') { j++; }
                        else if (jc === 'ZWNJ') { j++; zwnj = true; }
                    }
                    if (!zwnj && j < cps.length && isConsonant(cps[j])) {
                        syllable.push(cps[i]); // virama
                        i = j; // skip virama (+ optional ZWJ) → next consonant
                        continue; // consume next consonant
                    } else {
                        // Explicit virama (visible). Any joiner consumed.
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

        // Consume dependent vowel signs (matras) — Telugu does not reorder them.
        while (i < cps.length) {
            const ct = teluguCharType(cps[i]);
            if (ct >= 2 && ct <= 5) {
                syllable.push(cps[i]);
                i++;
            } else {
                break;
            }
        }

        // Consume modifiers (candrabindu, anusvara, visarga, length marks)
        while (i < cps.length && teluguCharType(cps[i]) === 6) {
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

// ── Telugu Shaper ────────────────────────────────────────────────────

/**
 * Shape a string of Telugu text into an array of positioned glyphs.
 *
 * @param str - Raw Telugu string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeTeluguText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, ligatures, markAnchors, widths, defaultWidth } = fontData;
    const shaped: ShapedGlyph[] = [];

    function resolveGid(cp: number): number {
        const normCp = (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
        return cmap[normCp] || 0;
    }

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

    const clusters = buildTeluguClusters(str);

    for (const cluster of clusters) {
        const { codepoints } = cluster;

        // Find the effective base consonant GID
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = teluguCharType(codepoints[ci]);
            if (ct === 0) {
                baseGid = resolveGid(codepoints[ci]);
            } else if (ct >= 2) {
                break;
            }
        }

        // Emit consonant cluster — try ligature matching first.
        const clusterGids: number[] = [];
        const clusterEndIdx: number[] = [];
        let matraStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = teluguCharType(codepoints[ci]);
            if (ct === 0 || ct === 7) {
                clusterGids.push(resolveGid(codepoints[ci]));
                clusterEndIdx.push(ci);
            } else if (ct >= 2) {
                matraStart = ci;
                break;
            } else if (ct < 0 || ct === 1 || ct === 9) {
                // Non-Telugu char, independent vowel, or digit — emit directly
                emitGlyph(resolveGid(codepoints[ci]), false);
            }
        }

        const ligResult = tryLig(clusterGids);
        if (ligResult) {
            emitGlyph(ligResult.resultGid, false);
            baseGid = ligResult.resultGid;

            let gi = ligResult.consumed;
            while (gi < clusterGids.length) {
                const subSeq = clusterGids.slice(gi);
                const subLig = tryLig(subSeq);
                if (subLig) {
                    emitGlyph(subLig.resultGid, false);
                    gi += subLig.consumed;
                } else {
                    const origCi = clusterEndIdx[gi];
                    const ct = teluguCharType(codepoints[origCi]);
                    if (ct === 7) {
                        emitGlyph(clusterGids[gi], true, baseGid);
                    } else {
                        emitGlyph(clusterGids[gi], false);
                    }
                    gi++;
                }
            }
        } else {
            // No ligature match — emit individual consonant + virama glyphs.
            for (let ci = 0; ci < matraStart; ci++) {
                const cp = codepoints[ci];
                const ct = teluguCharType(cp);
                if (ct === 0) {
                    emitGlyph(resolveGid(cp), false);
                } else if (ct === 7) {
                    emitGlyph(resolveGid(cp), true, baseGid);
                }
            }
        }

        // Emit matras and modifiers.
        for (let ci = matraStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = teluguCharType(cp);
            if (ct === 2 || ct === 3) {
                // Above/below mark — GPOS positioned (zero advance).
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 5) {
                // Right-spacing matra — normal advance.
                emitGlyph(resolveGid(cp), false);
            } else if (ct === 6) {
                // Modifiers / length marks — zero-advance marks.
                emitGlyph(resolveGid(cp), true, baseGid);
            } else if (ct === 9) {
                emitGlyph(resolveGid(cp), false);
            } else {
                emitGlyph(resolveGid(cp), false);
            }
        }
    }

    return shaped;
}
