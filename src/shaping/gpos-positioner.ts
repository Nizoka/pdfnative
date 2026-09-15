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
 *   markAnchors.marks[markGid] = [classIdx, anchorX, anchorY, …]   (design units;
 *                                one triple per GPOS subtable covering the mark — v1.8.0)
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

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';

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

/**
 * Offset of one mark relative to the mark it sits on, from the font's
 * MarkToMark table (GPOS LookupType 6).
 *
 * Without this, a second mark on the same base is anchored to the base just
 * as the first one was, and the two are drawn in the same place. A Khmer
 * vowel sign with a bantoc over it, or a Thai vowel with a tone mark, needs
 * the upper mark lifted clear of the lower one — which is what the font's
 * mark-to-mark anchors describe.
 *
 * Returns `null` when the font has no anchor for the pair, so the caller can
 * fall back to anchoring on the base.
 *
 * @param prevMarkGid The mark already placed, which this one stacks onto.
 * @param markGid     The mark being placed.
 * @since 1.8.0
 */
export function positionMarkOnMark(
    mark2mark: Mark2Mark | null | undefined,
    prevMarkGid: number,
    markGid: number,
): { dx: number; dy: number } | null {
    if (!mark2mark) return null;
    const attaching = mark2mark.mark2Classes[markGid];
    if (!attaching) return null;
    // One triple per subtable covering the mark (v1.8.0); the first whose
    // class the lower mark carries an anchor for wins.
    for (let t = 0; t + 2 < attaching.length; t += 3) {
        const anchor = getMark2MarkAnchor(mark2mark, prevMarkGid, attaching[t]);
        if (anchor) return { dx: anchor[0] - attaching[t + 1], dy: anchor[1] - attaching[t + 2] };
    }
    return null;
}

/**
 * The mark-to-base attachment of `markGid` on `baseGid`, trying every
 * subtable triple the mark carries (v1.8.0) — a font anchors the same vowel
 * sign on plain consonants in one subtable and on conjunct ligatures in
 * another, and only one of the two classes exists on a given base.
 *
 * Returns the base and mark anchor points, or `null` when no subtable
 * covers the pair.
 *
 * @since 1.8.0
 */
export function findMarkToBase(
    markAnchors: MarkAnchors | null | undefined,
    markGid: number,
    baseGid: number,
): { readonly base: AnchorPoint; readonly mark: AnchorPoint } | null {
    if (!markAnchors) return null;
    const mark = markAnchors.marks[markGid];
    const base = markAnchors.bases[baseGid];
    if (!mark || !base) return null;
    for (let t = 0; t + 2 < mark.length; t += 3) {
        const anchor = base[mark[t]];
        if (anchor) return { base: anchor, mark: [mark[t + 1], mark[t + 2]] };
    }
    return null;
}

/** One glyph handed to {@link attachMarks}: its id, whether it is a mark, and the code points behind it. */
export interface AttachItem {
    readonly gid: number;
    readonly isMark: boolean;
    readonly cps?: readonly number[];
    /**
     * When the font has no anchor for this mark, keep the glyph's own advance
     * if it has one (the font's GDEF called it a mark, so its width is what
     * the designer meant). Without GDEF the class came from the character,
     * and an unanchored mark sits at the pen with no advance, as before.
     */
    readonly keepAdvance?: boolean;
}

/**
 * Position a visual-order glyph sequence: every mark attaches to the nearest
 * preceding non-mark glyph through the font's MarkToBase anchors, or to the
 * mark placed just before it through MarkToMark when the font stacks the
 * pair. A mark the font has no anchor for keeps its own advance when it has
 * one (a spacing vowel sign drawn beside the base) and sits at the pen
 * position when it has none.
 *
 * The offsets follow the renderer's contract: a zero-advance glyph is drawn
 * relative to the pen after every spacing glyph before it, so `dx` subtracts
 * the advance accumulated since the base's origin.
 *
 * @since 1.8.0
 */
export function attachMarks(items: readonly AttachItem[], fontData: FontData): ShapedGlyph[] {
    const { widths, defaultWidth, markAnchors, mark2mark } = fontData;
    const out: ShapedGlyph[] = [];
    let baseGid = -1;
    let advSinceBase = 0;
    let prev: { gid: number; dx: number; dy: number } | null = null;

    for (const item of items) {
        const adv = widths[item.gid] !== undefined ? widths[item.gid] : defaultWidth;
        if (!item.isMark) {
            out.push({ gid: item.gid, dx: 0, dy: 0, isZeroAdvance: false, cps: item.cps });
            baseGid = item.gid;
            advSinceBase = adv;
            prev = null;
            continue;
        }
        let placed: { dx: number; dy: number } | null = null;
        if (prev) {
            const stacked = positionMarkOnMark(mark2mark, prev.gid, item.gid);
            if (stacked) placed = { dx: prev.dx + stacked.dx, dy: prev.dy + stacked.dy };
        }
        if (!placed && baseGid >= 0) {
            const found = findMarkToBase(markAnchors, item.gid, baseGid);
            if (found) placed = { dx: found.base[0] - found.mark[0] - advSinceBase, dy: found.base[1] - found.mark[1] };
        }
        if (placed) {
            out.push({ gid: item.gid, dx: placed.dx, dy: placed.dy, isZeroAdvance: true, cps: item.cps });
            prev = { gid: item.gid, dx: placed.dx, dy: placed.dy };
        } else if (adv === 0 || !item.keepAdvance) {
            out.push({ gid: item.gid, dx: 0, dy: 0, isZeroAdvance: true, cps: item.cps });
        } else {
            out.push({ gid: item.gid, dx: 0, dy: 0, isZeroAdvance: false, cps: item.cps });
            advSinceBase += adv;
            prev = null;
        }
    }
    return out;
}
