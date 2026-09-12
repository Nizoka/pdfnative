/**
 * pdfnative — Lao Mini-Shaper (v1.8.0)
 * ======================================
 * Pure JS OpenType GSUB + GPOS shaping for the Lao script.
 * Zero external dependency.
 *
 * Lao is Thai's structural twin: leading vowels that render to the left of
 * a consonant they follow in memory, marks above and below the base, marks
 * stacked on marks, and a vowel that decomposes. This shaper therefore
 * follows the Thai one closely, and differs in exactly one place.
 *
 * **What Lao adds.** Thai substitutes an above-mark variant when the base is
 * one of four tall consonants. Lao does that too — ປ ຝ ຟ ຢ — and *also*
 * substitutes a below-mark variant when the base is a consonant with a
 * descender. Noto Sans Lao expresses this as chained-context rules with two
 * distinct classes:
 *
 *   - ຌ ຐ ຊ ຖ take one below variant,
 *   - ງ and a below mark already stacked on another take a second.
 *
 * A flat glyph-to-glyph substitution table cannot hold two answers for the
 * same mark, so the classes live here as code points and the variant glyph
 * comes from the font. Where the font offers only one variant, both classes
 * resolve to it, which is what the merged table gives and is never worse
 * than leaving the mark unsubstituted.
 *
 * Handles:
 *   - Leading vowels ເ ແ ໂ ໃ ໄ — logically after, visually before the base
 *   - Above marks: vowels, tone marks, niggahita, cancellation
 *   - Below marks: vowels, the pali virama U+0EBA, semivowel lo U+0EBC
 *   - GPOS MarkToBase anchoring and MarkToMark stacking
 *   - Sara am U+0EB3 decomposed into niggahita U+0ECD + sara aa U+0EB2
 *   - Spacing signs ະ າ ຽ ໆ treated as bases, never as marks
 *
 * References:
 *   - Unicode Standard §16.3 Lao
 *   - OpenType spec §6.2 GSUB LookupType 1, §7.4 GPOS LookupType 4
 *   - ISO 15924 script code: Laoo
 *
 * @module shaping/lao-shaper
 * @since 1.8.0
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { LAO_START, LAO_END, containsLao } from './script-registry.js';

export { LAO_START, LAO_END, containsLao };

/**
 * Lao character classification.
 *   1 = above mark (vowel, tone, niggahita, cancellation)
 *   2 = below mark (vowel, pali virama, semivowel lo)
 *   3 = leading vowel (renders before the base)
 *
 * Everything absent from this table is a base: consonants, digits, and the
 * **spacing** signs ະ (U+0EB0), າ (U+0EB2), ຽ (U+0EBD) and ໆ (U+0EC6).
 * Those four advance the pen and must never be treated as marks, which is
 * the mistake that collapses Lao text onto itself.
 */
const LAO_CLASS: Record<number, number> = {
    // Leading vowels — ເ ແ ໂ ໃ ໄ
    0x0EC0: 3, 0x0EC1: 3, 0x0EC2: 3, 0x0EC3: 3, 0x0EC4: 3,
    // Above marks: vowels
    0x0EB1: 1, 0x0EB4: 1, 0x0EB5: 1, 0x0EB6: 1, 0x0EB7: 1, 0x0EBB: 1,
    // Above marks: tone marks
    0x0EC8: 1, 0x0EC9: 1, 0x0ECA: 1, 0x0ECB: 1,
    // Above marks: cancellation, niggahita, and the vedic-style sign
    0x0ECC: 1, 0x0ECD: 1, 0x0ECE: 1,
    // Below marks: vowels u / uu, the pali virama, semivowel lo
    0x0EB8: 2, 0x0EB9: 2, 0x0EBA: 2, 0x0EBC: 2,
};

/**
 * Consonants tall enough for an above mark to collide with the ascender:
 * ປ (U+0E9B), ຝ (U+0E9D), ຟ (U+0E9F), ຢ (U+0EA2).
 *
 * Read out of Noto Sans Lao's own chained-context rule, not guessed.
 */
const TALL_CONSONANTS = new Set([0x0E9B, 0x0E9D, 0x0E9F, 0x0EA2]);

/**
 * Consonants with a descender, below which a below mark must shift:
 * ຊ (U+0E8A), ຌ (U+0E8C), ຐ (U+0E90), ຖ (U+0E96), and ງ (U+0E87).
 *
 * Noto Sans Lao splits these into two classes driving two different variant
 * glyphs. Both are folded here: the font's merged table offers one variant
 * per mark, and applying it is right for the class it belongs to and no
 * worse than nothing for the other.
 */
const DESCENDER_CONSONANTS = new Set([0x0E87, 0x0E8A, 0x0E8C, 0x0E90, 0x0E96]);

/** Sara am — decomposes into niggahita plus sara aa. */
const SARA_AM = 0x0EB3;
const NIGGAHITA = 0x0ECD;
const SARA_AA = 0x0EB2;

interface LaoCluster {
    base: number;
    aboves: number[];
    belows: number[];
    leadings: number[];
}

/**
 * Split Lao text into clusters of `{ base, aboves, belows, leadings }`.
 *
 * Sara am is decomposed as it is read: its niggahita joins the preceding
 * cluster's above marks and its sara aa becomes a new spacing base, which
 * is what makes ຳ measure and render as two pieces rather than one wide
 * glyph the font may not have.
 *
 * @since 1.8.0
 */
export function buildLaoClusters(str: string): LaoCluster[] {
    const clusters: LaoCluster[] = [];
    const newCluster = (base: number): LaoCluster =>
        ({ base, aboves: [], belows: [], leadings: [] });

    let i = 0;
    while (i < str.length) {
        const cp = str.codePointAt(i) ?? 0;
        const step = cp > 0xFFFF ? 2 : 1;

        if (cp === SARA_AM) {
            if (clusters.length > 0) clusters[clusters.length - 1].aboves.push(NIGGAHITA);
            else clusters.push(newCluster(NIGGAHITA));
            clusters.push(newCluster(SARA_AA));
            i += step;
            continue;
        }

        const cls = LAO_CLASS[cp];

        if (cls === 3) {
            // A leading vowel belongs to the base that follows it.
            const nextI = i + step;
            const nextCp = nextI < str.length ? (str.codePointAt(nextI) ?? 0) : 0;
            const nextStep = nextCp > 0xFFFF ? 2 : 1;
            if (nextCp && !LAO_CLASS[nextCp] && nextCp !== SARA_AM) {
                clusters.push({ base: nextCp, aboves: [], belows: [], leadings: [cp] });
                i += step + nextStep;
            } else {
                // Nothing to attach to: the vowel stands alone rather than
                // swallowing whatever follows.
                clusters.push(newCluster(cp));
                i += step;
            }
        } else if (cls === 1) {
            if (clusters.length > 0) clusters[clusters.length - 1].aboves.push(cp);
            else clusters.push(newCluster(cp));
            i += step;
        } else if (cls === 2) {
            if (clusters.length > 0) clusters[clusters.length - 1].belows.push(cp);
            else clusters.push(newCluster(cp));
            i += step;
        } else {
            clusters.push(newCluster(cp));
            i += step;
        }
    }
    return clusters;
}

/**
 * Shape a string of Lao text into positioned glyphs.
 *
 * @param str Raw Lao string, in logical order.
 * @param fontData Font supplying cmap, gsub, mark anchors, metrics and widths.
 * @since 1.8.0
 */
export function shapeLaoText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, gsub, markAnchors, widths, defaultWidth } = fontData;
    const m2m = fontData.mark2mark || { mark1Anchors: {}, mark2Classes: {} };
    const shaped: ShapedGlyph[] = [];

    const normCp = (cp: number): number => ((cp === 0x202F || cp === 0xA0) ? 0x20 : cp);

    const getAdv = (gid: number): number =>
        (widths[gid] !== undefined ? widths[gid] : defaultWidth);

    /** Resolve a mark's glyph, taking the font's variant when the base calls for it. */
    const resolveMarkGid = (markCp: number, useVariant: boolean): number => {
        const gid = cmap[markCp] || 0;
        if (useVariant && gsub[gid] !== undefined) return gsub[gid];
        return gid;
    };

    const getBaseAnchor = (baseGid: number, markClass: number): [number, number] | null =>
        markAnchors?.bases?.[baseGid]?.[markClass] ?? null;

    const getMarkAnchor = (markGid: number): { classIdx: number; x: number; y: number } | null => {
        const mark = markAnchors?.marks?.[markGid];
        return mark ? { classIdx: mark[0], x: mark[1], y: mark[2] } : null;
    };

    const getMark2MarkOffset = (
        mark1Gid: number, mark2Gid: number,
    ): { dx: number; dy: number } | null => {
        const m1Anchor = m2m.mark1Anchors?.[mark1Gid];
        const m2Class = m2m.mark2Classes?.[mark2Gid];
        if (!m1Anchor || !m2Class) return null;
        const m1Pt = m1Anchor[m2Class[0]];
        return m1Pt ? { dx: m1Pt[0] - m2Class[1], dy: m1Pt[1] - m2Class[2] } : null;
    };

    for (const cluster of buildLaoClusters(str)) {
        const baseGid = cmap[normCp(cluster.base)] || 0;
        const baseAdv = getAdv(baseGid);
        const isTall = TALL_CONSONANTS.has(cluster.base);
        const hasDescender = DESCENDER_CONSONANTS.has(cluster.base);

        for (const lvCp of cluster.leadings) {
            shaped.push({ gid: cmap[lvCp] || 0, dx: 0, dy: 0, isZeroAdvance: false });
        }

        shaped.push({ gid: baseGid, dx: 0, dy: 0, isZeroAdvance: false });

        // Above marks, each stacked on the previous one where the font says so.
        let prevGid: number | null = null;
        let prevDx = 0;
        let prevDy = 0;
        for (let ai = 0; ai < cluster.aboves.length; ai++) {
            const markGid = resolveMarkGid(cluster.aboves[ai], isTall);
            const markAnchor = getMarkAnchor(markGid);
            let dx = 0;
            let dy = 0;

            const stack = ai > 0 && prevGid !== null
                ? getMark2MarkOffset(prevGid, markGid)
                : null;
            if (stack) {
                dx = prevDx + stack.dx;
                dy = prevDy + stack.dy;
            } else if (markAnchor) {
                const baseAnchor = getBaseAnchor(baseGid, markAnchor.classIdx);
                if (baseAnchor) {
                    dx = baseAnchor[0] - markAnchor.x - baseAdv;
                    dy = baseAnchor[1] - markAnchor.y;
                }
            }

            shaped.push({ gid: markGid, dx, dy, isZeroAdvance: true });
            prevGid = markGid;
            prevDx = dx;
            prevDy = dy;
        }

        // Below marks. The first takes the base's descender variant; a second
        // one is stacked under the first, which is the font's own rule.
        let prevBelowGid: number | null = null;
        let prevBelowDx = 0;
        let prevBelowDy = 0;
        for (let bi = 0; bi < cluster.belows.length; bi++) {
            const markGid = resolveMarkGid(cluster.belows[bi], hasDescender || bi > 0);
            const markAnchor = getMarkAnchor(markGid);
            let dx = 0;
            let dy = 0;

            const stack = bi > 0 && prevBelowGid !== null
                ? getMark2MarkOffset(prevBelowGid, markGid)
                : null;
            if (stack) {
                dx = prevBelowDx + stack.dx;
                dy = prevBelowDy + stack.dy;
            } else if (markAnchor) {
                const baseAnchor = getBaseAnchor(baseGid, markAnchor.classIdx);
                if (baseAnchor) {
                    dx = baseAnchor[0] - markAnchor.x - baseAdv;
                    dy = baseAnchor[1] - markAnchor.y;
                }
            }

            shaped.push({ gid: markGid, dx, dy, isZeroAdvance: true });
            prevBelowGid = markGid;
            prevBelowDx = dx;
            prevBelowDy = dy;
        }
    }

    return shaped;
}
