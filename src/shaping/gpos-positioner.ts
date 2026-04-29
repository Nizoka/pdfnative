/**
 * pdfnative — GPOS Positioner (shared OpenType mark positioning)
 * ==============================================================
 * Pure-function helpers for GPOS LookupType 4 (MarkToBase) and LookupType 6
 * (MarkToMark), shared by Arabic and Devanagari shapers. Extracted in v1.1.0
 * (issue #25) so that Arabic harakat (U+064B–U+0652) can be anchored on top
 * of their carrier consonants instead of being rendered at offset (0, 0).
 *
 * Anchor tables are pre-baked at font compile time
 * (see `tools/build-font-data.cjs`) as:
 *
 *   markAnchors.marks[markGid] = [classIdx, anchorX, anchorY]   (design units)
 *   markAnchors.bases[baseGid] = { [classIdx]: [anchorX, anchorY] }
 *
 * The PDF text matrix advances by the base glyph's metric width; when a mark
 * follows with `isZeroAdvance: true`, its `(dx, dy)` offset is applied
 * relative to the *end* of the base glyph (post-advance pen position), so
 * we subtract the base advance from the horizontal anchor delta.
 *
 * References:
 *   - OpenType spec: GPOS LookupType 4 (MarkBasePos), LookupType 6 (MarkMarkPos)
 *   - HarfBuzz: hb-ot-layout-gpos-table.hh::MarkBasePosFormat1
 */

import type { FontData } from '../types/pdf-types.js';

type MarkAnchors = NonNullable<FontData['markAnchors']>;
type Mark2Mark = NonNullable<FontData['mark2mark']>;

/** Resolved mark-class anchor on a base glyph (design units). */
export type AnchorPoint = readonly [number, number];

/** Mark glyph anchor including its mark class. */
export interface MarkAnchor {
    readonly classIdx: number;
    readonly x: number;
    readonly y: number;
}

/**
 * Look up the anchor on a base glyph for a given mark class.
 * Returns null when the base has no anchor for that class.
 */
export function getBaseAnchor(
    markAnchors: MarkAnchors | null | undefined,
    baseGid: number,
    markClass: number,
): AnchorPoint | null {
    if (!markAnchors) return null;
    const base = markAnchors.bases[baseGid];
    if (!base) return null;
    return base[markClass] ?? null;
}

/**
 * Look up the anchor + class index for a mark glyph.
 * Returns null when the mark has no entry (treated as unpositioned).
 */
export function getMarkAnchor(
    markAnchors: MarkAnchors | null | undefined,
    markGid: number,
): MarkAnchor | null {
    if (!markAnchors) return null;
    const mark = markAnchors.marks[markGid];
    if (!mark) return null;
    return { classIdx: mark[0], x: mark[1], y: mark[2] };
}

/**
 * Look up the mark1→mark2 anchor for stacked diacritics (e.g. Thai or Arabic
 * vowel + tone). Returns null when no anchor is defined.
 */
export function getMark2MarkAnchor(
    mark2mark: Mark2Mark | null | undefined,
    mark1Gid: number,
    classIdx: number,
): AnchorPoint | null {
    if (!mark2mark) return null;
    const anchors = mark2mark.mark1Anchors[mark1Gid];
    if (!anchors) return null;
    return anchors[classIdx] ?? null;
}

/**
 * Compute the (dx, dy) offset that places a mark's anchor onto the base
 * glyph's anchor, accounting for the base's horizontal advance width.
 *
 *   pen position after base = baseAdv
 *   mark anchor on base     = (baseAnchorX, baseAnchorY)
 *   mark's own anchor       = (markX, markY)
 *
 *   dx = baseAnchorX - markX - baseAdv
 *   dy = baseAnchorY - markY
 *
 * Returns `null` if either anchor is missing — caller should fall back to
 * `(0, 0)` (current pre-v1.1.0 behaviour).
 */
export function positionMarkOnBase(
    markAnchors: MarkAnchors | null | undefined,
    markGid: number,
    baseGid: number,
    baseAdv: number,
): { dx: number; dy: number } | null {
    const mark = getMarkAnchor(markAnchors, markGid);
    if (!mark) return null;
    const base = getBaseAnchor(markAnchors, baseGid, mark.classIdx);
    if (!base) return null;
    return {
        dx: base[0] - mark.x - baseAdv,
        dy: base[1] - mark.y,
    };
}
