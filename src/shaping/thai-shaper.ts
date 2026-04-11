/**
 * pdfnative — Thai Mini-Shaper
 * =============================
 * Pure JS OpenType GSUB + GPOS shaping for Thai script.
 * Zero external dependency.
 *
 * Handles:
 *   - GSUB SingleSubst: tall consonant → short variant (ป ฝ ฟ ฬ)
 *   - GPOS MarkToBase: above/below vowels + tone marks anchoring
 *   - GPOS MarkToMark: stacking marks (tone above vowel)
 *   - Sara Am (U+0E33) decomposition → nikhahit + sara aa
 *
 * References:
 *   - Unicode Standard §16.4 Thai
 *   - OpenType spec §6.2 GSUB LookupType 1, §7.4 GPOS LookupType 4
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { THAI_START, THAI_END, containsThai } from './script-registry.js';

// Re-export range constants for backward compatibility
export { THAI_START, THAI_END, containsThai };

/**
 * Thai character classification by combining class.
 *   0 = consonant / base
 *   1 = above vowel / tone (renders above base)
 *   2 = below vowel (renders below base)
 *   3 = leading vowel (renders before base, zero-width)
 *   4 = following vowel (renders after base at x-advance)
 */
const THAI_CLASS: Record<number, number> = {
    // Leading vowels
    0x0E40: 3, 0x0E41: 3, 0x0E42: 3, 0x0E43: 3, 0x0E44: 3,
    // Above-base marks: above vowels
    0x0E31: 1, 0x0E34: 1, 0x0E35: 1, 0x0E36: 1, 0x0E37: 1,
    0x0E47: 1, 0x0E4D: 1, 0x0E4E: 1,
    // Above-base marks: tone marks
    0x0E48: 1, 0x0E49: 1, 0x0E4A: 1, 0x0E4B: 1,
    // Below-base marks: below vowels
    0x0E38: 2, 0x0E39: 2, 0x0E3A: 2,
    // Thanthakhat (cancellation mark) — above
    0x0E4C: 1,
};

/**
 * Tall consonants whose ascender may clash with above marks.
 * ป (U+0E1B), ฝ (U+0E1D), ฟ (U+0E1F), ฬ (U+0E2C)
 */
const TALL_CONSONANTS = new Set([0x0E1B, 0x0E1D, 0x0E1F, 0x0E2C]);

// ── Interface for cluster ────────────────────────────────────────────

interface ThaiCluster {
    base: number;
    aboves: number[];
    belows: number[];
    leadings: number[];
}

// ── Cluster Builder ──────────────────────────────────────────────────

/**
 * Build text clusters: each cluster = { base, aboves, belows, leadings }.
 * Sara Am (U+0E33) is decomposed into Nikhahit (U+0E4D) + Sara Aa (U+0E32).
 *
 * @param str - Input Thai text string
 * @returns Array of Thai clusters for shaping
 */
export function buildThaiClusters(str: string): ThaiCluster[] {
    const clusters: ThaiCluster[] = [];
    let i = 0;
    while (i < str.length) {
        const cp = str.codePointAt(i) ?? 0;
        const step = cp > 0xFFFF ? 2 : 1;

        // Sara Am decomposition — U+0E33 → U+0E4D (nikhahit) + U+0E32 (sara aa)
        if (cp === 0x0E33) {
            if (clusters.length > 0) {
                clusters[clusters.length - 1].aboves.push(0x0E4D);
            } else {
                clusters.push({ base: 0x0E4D, aboves: [], belows: [], leadings: [] });
            }
            clusters.push({ base: 0x0E32, aboves: [], belows: [], leadings: [] });
            i += step;
            continue;
        }

        const cls = THAI_CLASS[cp];

        if (cls === 3) {
            // Leading vowel — belongs to the NEXT base consonant
            const nextI = i + step;
            const nextCp = nextI < str.length ? (str.codePointAt(nextI) ?? 0) : 0;
            const nextStep = nextCp > 0xFFFF ? 2 : 1;
            if (nextCp && !THAI_CLASS[nextCp]) {
                clusters.push({ base: nextCp, aboves: [], belows: [], leadings: [cp] });
                i += step + nextStep;
            } else {
                clusters.push({ base: cp, aboves: [], belows: [], leadings: [] });
                i += step;
            }
        } else if (!cls || cls === 4) {
            clusters.push({ base: cp, aboves: [], belows: [], leadings: [] });
            i += step;
        } else if (cls === 1) {
            if (clusters.length > 0) clusters[clusters.length - 1].aboves.push(cp);
            else clusters.push({ base: cp, aboves: [], belows: [], leadings: [] });
            i += step;
        } else if (cls === 2) {
            if (clusters.length > 0) clusters[clusters.length - 1].belows.push(cp);
            else clusters.push({ base: cp, aboves: [], belows: [], leadings: [] });
            i += step;
        } else {
            i += step;
        }
    }
    return clusters;
}

// ── Thai Shaper ──────────────────────────────────────────────────────

/**
 * Shape a string of Thai text into an array of positioned glyphs.
 *
 * @param str - Raw Thai string
 * @param fontData - Font data with cmap, gsub, markAnchors, mark2mark, metrics, widths
 * @returns Array of positioned glyphs
 */
export function shapeThaiText(str: string, fontData: FontData): ShapedGlyph[] {
    const { cmap, gsub, markAnchors, widths, defaultWidth } = fontData;
    const m2m = fontData.mark2mark || { mark1Anchors: {}, mark2Classes: {} };
    const shaped: ShapedGlyph[] = [];

    function normCp(cp: number): number {
        return (cp === 0x202F || cp === 0xA0) ? 0x20 : cp;
    }

    function resolveGid(cp: number, applyGsub = false): number {
        const baseGid = cmap[normCp(cp)] || 0;
        if (applyGsub && gsub[baseGid] !== undefined) return gsub[baseGid];
        return baseGid;
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

    function getMark2MarkOffset(mark1Gid: number, mark2Gid: number): { dx: number; dy: number } | null {
        const m1Anchor = m2m.mark1Anchors && m2m.mark1Anchors[mark1Gid];
        const m2Class = m2m.mark2Classes && m2m.mark2Classes[mark2Gid];
        if (!m1Anchor || !m2Class) return null;
        const classIdx = m2Class[0];
        const m1Pt = m1Anchor[classIdx];
        if (!m1Pt) return null;
        return { dx: m1Pt[0] - m2Class[1], dy: m1Pt[1] - m2Class[2] };
    }

    function resolveMarkGid(markCp: number, applyGsub: boolean): number {
        const gid = cmap[markCp] || 0;
        if (applyGsub && gsub[gid] !== undefined) return gsub[gid];
        return gid;
    }

    const clusters = buildThaiClusters(str);

    for (const cluster of clusters) {
        const hasAbove = cluster.aboves.length > 0;
        const hasBelow = cluster.belows.length > 0;

        const baseGid = resolveGid(cluster.base, hasAbove || hasBelow);
        const baseAdv = getAdv(baseGid);
        const isTallBase = TALL_CONSONANTS.has(cluster.base);

        // Leading vowels
        for (const lvCp of cluster.leadings) {
            const lvGid = cmap[lvCp] || 0;
            shaped.push({ gid: lvGid, dx: 0, dy: 0, isZeroAdvance: false });
        }

        // Base glyph
        shaped.push({ gid: baseGid, dx: 0, dy: 0, isZeroAdvance: false });

        // Above marks with Mark-to-Mark stacking
        let prevAboveMarkGid: number | null = null;
        let prevAboveMarkDx = 0;
        let prevAboveMarkDy = 0;
        for (let ai = 0; ai < cluster.aboves.length; ai++) {
            const abvCp = cluster.aboves[ai];
            const markGid = resolveMarkGid(abvCp, isTallBase);
            const markAnchor = getMarkAnchor(markGid);
            let dx = 0;
            let dy = 0;

            if (ai > 0 && prevAboveMarkGid !== null) {
                const m2mOffset = getMark2MarkOffset(prevAboveMarkGid, markGid);
                if (m2mOffset) {
                    dx = prevAboveMarkDx + m2mOffset.dx;
                    dy = prevAboveMarkDy + m2mOffset.dy;
                } else if (markAnchor) {
                    const baseAnchor = getBaseAnchor(baseGid, markAnchor.classIdx);
                    if (baseAnchor) {
                        dx = baseAnchor[0] - markAnchor.x - baseAdv;
                        dy = baseAnchor[1] - markAnchor.y;
                    }
                }
            } else {
                if (markAnchor) {
                    const baseAnchor = getBaseAnchor(baseGid, markAnchor.classIdx);
                    if (baseAnchor) {
                        dx = baseAnchor[0] - markAnchor.x - baseAdv;
                        dy = baseAnchor[1] - markAnchor.y;
                    }
                }
            }

            shaped.push({ gid: markGid, dx, dy, isZeroAdvance: true });
            prevAboveMarkGid = markGid;
            prevAboveMarkDx = dx;
            prevAboveMarkDy = dy;
        }

        // Below marks
        for (const blwCp of cluster.belows) {
            const markGid = cmap[blwCp] || 0;
            const markAnchor = getMarkAnchor(markGid);
            let dx = 0;
            let dy = 0;

            if (markAnchor) {
                const baseAnchor = getBaseAnchor(baseGid, markAnchor.classIdx);
                if (baseAnchor) {
                    dx = baseAnchor[0] - markAnchor.x - baseAdv;
                    dy = baseAnchor[1] - markAnchor.y;
                }
            }

            shaped.push({ gid: markGid, dx, dy, isZeroAdvance: true });
        }
    }

    return shaped;
}

// containsThai is re-exported from script-registry above
