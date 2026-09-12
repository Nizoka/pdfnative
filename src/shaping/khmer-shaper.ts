/**
 * pdfnative — Khmer Mini-Shaper
 * ==============================
 * Pure JS OpenType GSUB + GPOS shaping for the Khmer script (Cambodia).
 * Zero external dependency.
 *
 * Khmer is a USE-class (Universal Shaping Engine) script. This is a pragmatic
 * USE-lite implementation that covers the common cases:
 *   - Coeng (U+17D2) + consonant → subscript consonant (stacked below / behind)
 *   - Pre-base (left-side) vowel reordering — U+17C1 (e), U+17C2 (ae),
 *     U+17C3 (ai) render to the LEFT of their base, so they are emitted first.
 *   - Two-part vowels (U+17BE, U+17BF, U+17C0, U+17C4, U+17C5) are decomposed
 *     into their pre-base + post-base halves.
 *   - GSUB LigatureSubst: coeng-form subscript ligatures when the font provides
 *     them; GPOS MarkToBase for above / below vowel signs and diacritics.
 *
 * Subscripts (v1.8.0). The font keys its subscript forms on the coeng —
 * `coeng + ka` is one glyph, and there is no `ka + coeng + ka` — so the
 * ligature lookup has to be tried at every position in the stack, not only
 * at its head. Anchoring it at the head found nothing and left the cluster
 * as a visible coeng sign with a full-size consonant drawn over the base,
 * which in Khmer is most words.
 *
 * Stacked marks (v1.8.0). A second mark on one base is placed against the
 * first through the font's MarkToMark anchors. Without that both are
 * anchored to the base and drawn in the same place.
 *
 * Known limitations (documented):
 *   - This is not a full USE implementation. Contextual GSUB (LookupType
 *     5/6) is not consumed, so contextual variants are approximated.
 *
 * References:
 *   - Unicode Standard §16.4 Khmer
 *   - OpenType spec: Universal Shaping Engine; Khmer (khmr)
 *   - ISO 15924 script code: Khmr
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { KHMER_START, KHMER_END, KHMER_COENG, containsKhmer } from './script-registry.js';
import { tryLigature } from './gsub-driver.js';
import { positionMarkOnBase, positionMarkOnMark } from './gpos-positioner.js';

// Re-export range constants
export { KHMER_START, KHMER_END, containsKhmer };

/** Coeng — subscript register shifter (U+17D2). */
const COENG = KHMER_COENG; // 0x17D2

/**
 * Decomposition of Khmer two-part dependent vowels into
 * [pre-base (left) part, ...post-base parts].
 */
const TWO_PART_VOWELS: Record<number, number[]> = {
    0x17BE: [0x17C1, 0x17B6], // ើ
    0x17BF: [0x17C1, 0x17B8], // ឿ  (approx: e + y-like)
    0x17C0: [0x17C1, 0x17B9], // ៀ  (approx)
    0x17C4: [0x17C1, 0x17B6], // ោ  (e + aa)
    0x17C5: [0x17C1, 0x17B6], // ៅ  (e + aa-like)
};

/**
 * Khmer character type classification.
 *   0 = consonant (U+1780–U+17A2)
 *   1 = independent vowel / letter (U+17A3–U+17B5)
 *   2 = dependent vowel sign — above (GPOS)
 *   3 = dependent vowel sign — below (GPOS)
 *   4 = dependent vowel sign — pre-base / left
 *   5 = dependent vowel sign — post-base spacing (right)
 *   6 = sign / diacritic (above)
 *   7 = coeng (U+17D2)
 *   9 = digit / symbol / punctuation
 */
function khmerCharType(cp: number): number {
    if (cp === COENG) return 7;
    if (cp >= 0x1780 && cp <= 0x17A2) return 0;
    if (cp >= 0x17A3 && cp <= 0x17B5) return 1;
    // Pre-base vowels (left)
    if (cp === 0x17C1 || cp === 0x17C2 || cp === 0x17C3) return 4;
    // Above vowels
    if (cp === 0x17B7 || cp === 0x17B8 || cp === 0x17B9 || cp === 0x17BA ||
        cp === 0x17BB || cp === 0x17BD) return 2;
    // Below vowels
    if (cp === 0x17BC) return 3;
    // Post-base spacing vowels
    if (cp === 0x17B6 || cp === 0x17C4 || cp === 0x17C5) return 5;
    // Signs / diacritics (above): nikahit, reahmuk, etc.
    if (cp >= 0x17C6 && cp <= 0x17D1) return 6;
    if (cp === 0x17CB || cp === 0x17CD || cp === 0x17CE || cp === 0x17CF ||
        cp === 0x17D0) return 6;
    if (cp === 0x17DD) return 6;
    // Khmer digits + symbols
    if (cp >= 0x17E0 && cp <= 0x17E9) return 9;
    if (cp >= 0x17D4 && cp <= 0x17DC) return 9;
    if (cp >= 0x17F0 && cp <= 0x17F9) return 9;
    return -1;
}

function isConsonant(cp: number): boolean {
    return khmerCharType(cp) === 0;
}

interface KhmerCluster {
    codepoints: number[];
}

/**
 * Build Khmer orthographic clusters, decomposing two-part vowels.
 * A cluster: BaseConsonant (Coeng Consonant)* [vowels] [signs]
 */
export function buildKhmerClusters(str: string): KhmerCluster[] {
    const clusters: KhmerCluster[] = [];
    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const decomp = TWO_PART_VOWELS[cp];
        if (decomp) { for (const d of decomp) cps.push(d); }
        else cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    let i = 0;
    while (i < cps.length) {
        const cp = cps[i];
        const type = khmerCharType(cp);

        if (type < 0 || cp < KHMER_START || cp > KHMER_END) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        if (type !== 0 && type !== 1) {
            clusters.push({ codepoints: [cp] });
            i++;
            continue;
        }

        const cluster: number[] = [cp];
        i++;
        // Consume coeng + consonant pairs.
        while (i < cps.length && cps[i] === COENG) {
            if (i + 1 < cps.length && isConsonant(cps[i + 1])) {
                cluster.push(cps[i]);     // coeng
                cluster.push(cps[i + 1]); // subscript consonant
                i += 2;
            } else {
                cluster.push(cps[i]);
                i++;
                break;
            }
        }
        // Consume vowels and signs.
        while (i < cps.length) {
            const ct = khmerCharType(cps[i]);
            if (ct >= 2 && ct <= 6) { cluster.push(cps[i]); i++; }
            else break;
        }
        clusters.push({ codepoints: cluster });
    }
    return clusters;
}

/**
 * Shape a string of Khmer text into an array of positioned glyphs.
 *
 * @param str - Raw Khmer string
 * @param fontData - Font data with cmap, ligatures, markAnchors, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeKhmerText(str: string, fontData: FontData): ShapedGlyph[] {
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

    /**
     * Place a mark, stacking it on the previous mark of the same cluster when
     * the font carries a mark-to-mark anchor for the pair. Without that, two
     * marks on one base are both anchored to the base and land on top of each
     * other. Returns the placed mark so the next one can stack on it.
     */
    function emitMark(
        gid: number,
        baseGid: number,
        prev: { gid: number; dx: number; dy: number } | null,
    ): { gid: number; dx: number; dy: number } {
        const stacked = prev ? positionMarkOnMark(fontData.mark2mark, prev.gid, gid) : null;
        if (stacked && prev) {
            const placed = { gid, dx: prev.dx + stacked.dx, dy: prev.dy + stacked.dy };
            shaped.push({ gid, dx: placed.dx, dy: placed.dy, isZeroAdvance: true });
            return placed;
        }
        const onBase = positionMarkOnBase(markAnchors, gid, baseGid, getAdv(baseGid));
        const dx = onBase ? onBase.dx : 0;
        const dy = onBase ? onBase.dy : 0;
        shaped.push({ gid, dx, dy, isZeroAdvance: true });
        return { gid, dx, dy };
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

    const clusters = buildKhmerClusters(str);

    for (const cluster of clusters) {
        const { codepoints } = cluster;

        // Resolve base GID (first consonant / independent letter).
        let baseGid = 0;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const ct = khmerCharType(codepoints[ci]);
            if (ct === 0 || ct === 1) { baseGid = resolveGid(codepoints[ci]); break; }
        }

        // Emit pre-base (left) vowels first.
        for (let ci = 0; ci < codepoints.length; ci++) {
            if (khmerCharType(codepoints[ci]) === 4) emitGlyph(resolveGid(codepoints[ci]), false);
        }

        // Build base + coeng-consonant GID run for ligature lookup.
        const stackGids: number[] = [];
        const stackEndIdx: number[] = [];
        let markStart = codepoints.length;
        for (let ci = 0; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = khmerCharType(cp);
            if (ct === 0 || ct === 1 || ct === 7) {
                stackGids.push(resolveGid(cp));
                stackEndIdx.push(ci);
            } else if (ct >= 2 && ct <= 6) {
                markStart = ci;
                break;
            } else {
                emitGlyph(resolveGid(cp), false);
            }
        }

        // Compose the stack, trying a ligature at EVERY position rather than
        // only at the start. The font keys its subscript forms on the coeng
        // — `coeng + ka` is one glyph, and there is no `ka + coeng + ka` —
        // so a lookup anchored at index 0 finds nothing and the cluster
        // falls apart into a visible coeng sign with a full-size consonant
        // drawn on top of the base. Subscripts are the common case in Khmer,
        // so this was most words.
        let gi = 0;
        let first = true;
        while (gi < stackGids.length) {
            const lig = tryLig(stackGids.slice(gi));
            const gid = lig ? lig.resultGid : stackGids[gi];
            if (first) {
                emitGlyph(gid, false);
                if (lig) baseGid = gid;
                first = false;
            } else {
                // Everything after the base hangs off it, coeng sign and
                // subscript consonant alike.
                emitGlyph(gid, true, baseGid);
            }
            gi += lig ? lig.consumed : 1;
        }

        // Emit remaining vowels and signs (pre-base already done), stacking
        // each mark on the one before it where the font says how.
        let prevMark: { gid: number; dx: number; dy: number } | null = null;
        for (let ci = markStart; ci < codepoints.length; ci++) {
            const cp = codepoints[ci];
            const ct = khmerCharType(cp);
            if (ct === 2 || ct === 3 || ct === 6) {
                prevMark = emitMark(resolveGid(cp), baseGid, prevMark);
            } else if (ct === 5) { emitGlyph(resolveGid(cp), false); prevMark = null; }
            else if (ct === 4) { /* already emitted pre-base */ }
            else { emitGlyph(resolveGid(cp), false); prevMark = null; }
        }
    }

    return shaped;
}
