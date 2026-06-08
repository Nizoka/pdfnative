/**
 * pdfnative — Sinhala Mini-Shaper
 * ================================
 * Pure JS OpenType GSUB + GPOS shaping for the Sinhala script (Sri Lanka).
 * Zero external dependency.
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
import { tryLigature } from './gsub-driver.js';
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

/**
 * Shape a string of Sinhala text into an array of positioned glyphs.
 *
 * @param str - Raw Sinhala string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeSinhalaText(str: string, fontData: FontData): ShapedGlyph[] {
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

    const clusters = buildSinhalaClusters(str);

    for (const cluster of clusters) {
        const { codepoints } = cluster;

        // Resolve effective base GID.
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = sinhalaCharType(codepoints[ci]);
            if (ct === 0) { baseGid = resolveGid(codepoints[ci]); }
            else if (ct >= 2 && ct !== 7) { break; }
        }

        // Emit any pre-base (left) vowels FIRST.
        for (let ci = 0; ci < codepoints.length; ci++) {
            if (sinhalaCharType(codepoints[ci]) === 4) {
                emitGlyph(resolveGid(codepoints[ci]), false);
            }
        }

        // Build consonant + virama (+ ZWJ) cluster for ligature matching.
        const clusterGids: number[] = [];
        const clusterEndIdx: number[] = [];
        let matraStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = sinhalaCharType(cp);
            if (ct === 0 || ct === 7 || cp === 0x200D) {
                clusterGids.push(resolveGid(cp));
                clusterEndIdx.push(ci);
            } else if (ct >= 2 && ct <= 6) {
                matraStart = ci;
                break;
            } else if (ct < 0 || ct === 1 || ct === 9) {
                emitGlyph(resolveGid(cp), false);
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
                    const ct = sinhalaCharType(codepoints[origCi]);
                    if (ct === 7) emitGlyph(clusterGids[gi], true, baseGid);
                    else emitGlyph(clusterGids[gi], false);
                    gi++;
                }
            }
        } else {
            for (let ci = 0; ci < matraStart; ci++) {
                const cp = codepoints[ci];
                const ct = sinhalaCharType(cp);
                if (ct === 0) emitGlyph(resolveGid(cp), false);
                else if (ct === 7) emitGlyph(resolveGid(cp), true, baseGid);
                else if (cp === 0x200D) { /* ZWJ — already consumed by ligature attempt */ }
            }
        }

        // Emit remaining (above / below / post-base) vowels and modifiers.
        // Pre-base (type 4) vowels were already emitted before the base.
        for (let ci = matraStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = sinhalaCharType(cp);
            if (ct === 2 || ct === 3 || ct === 6) emitGlyph(resolveGid(cp), true, baseGid);
            else if (ct === 5) emitGlyph(resolveGid(cp), false);
            else if (ct === 4) { /* already emitted pre-base */ }
            else emitGlyph(resolveGid(cp), false);
        }
    }

    return shaped;
}
