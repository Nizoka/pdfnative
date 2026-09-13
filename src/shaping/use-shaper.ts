/**
 * pdfnative — Universal Shaping Engine shaper (v1.8.0)
 * ======================================================
 * Turns logical-order text into positioned glyphs for any script the
 * {@link module:shaping/use-engine} classifies, using only the font's own
 * tables. One shaper, configured by nothing: every script-specific decision
 * comes from the Unicode-derived cluster categories or from the font.
 *
 * The order of operations is the part that matters, and it is not the order
 * the categories suggest:
 *
 *   1. **Segment** into clusters with the specification's grammar.
 *   2. **Substitute** on the *logical* sequence. Ligatures are matched
 *      before anything moves, because that is the order fonts encode them
 *      in. Noto Sans Tai Tham composes a consonant with the pre-base vowel
 *      that follows it into one wide glyph; reordering the vowel to the
 *      front first would stop the ligature matching and leave the syllable
 *      in pieces. The same table stacks a sakot and its consonant into a
 *      subjoined form, several deep.
 *   3. **Reorder** what is still separate. A pre-base vowel the font had no
 *      composed glyph for moves in front of its base; one that ligated has
 *      already been placed by the designer.
 *   4. **Position** marks against their base, and against each other, from
 *      the GPOS anchors.
 *
 * Advance comes from the font, never from the category: a composed Cham
 * medial is zero-width and a composed Tai Tham syllable is 1867 units wide,
 * and both are reached through the same ligature table.
 *
 * @module shaping/use-shaper
 * @since 1.8.0
 */

import type { FontData, ShapedGlyph } from '../types/pdf-types.js';
import { useCategories, splitUseSyllables, type UseClusterCategory } from './use-engine.js';
import { tryLigature } from './gsub-driver.js';

/** Categories that render before the base and move there when they stay separate. */
const PRE_BASE = /*#__PURE__*/ new Set<UseClusterCategory>(['VPre', 'VMPre', 'MPre']);

/** Categories drawn on the base rather than beside it. */
const MARK = /*#__PURE__*/ new Set<UseClusterCategory>([
    'VAbv', 'VBlw', 'VMAbv', 'VMBlw', 'MAbv', 'MBlw',
    'FAbv', 'FBlw', 'CMAbv', 'CMBlw', 'H', 'HVM', 'IS', 'Sk', 'SUB',
    'SMAbv', 'SMBlw', 'FMAbv', 'FMBlw',
]);

/** One glyph under construction: a gid plus the categories it came from. */
interface Item {
    gid: number;
    /** Category of the first code point that produced it. */
    readonly lead: UseClusterCategory;
    /** True once a ligature has placed this glyph, so it must not move. */
    readonly composed: boolean;
}

/**
 * Shape text through the Universal Shaping Engine.
 *
 * @param str Text in logical order.
 * @param fd  Font supplying cmap, ligatures, mark anchors, widths.
 * @since 1.8.0
 */
export function shapeUseText(str: string, fd: FontData): ShapedGlyph[] {
    const { cmap, ligatures, markAnchors, widths, defaultWidth } = fd;
    const m2m = fd.mark2mark || { mark1Anchors: {}, mark2Classes: {} };
    const out: ShapedGlyph[] = [];

    const cps: number[] = [];
    for (const ch of str) cps.push(ch.codePointAt(0) ?? 0);
    if (cps.length === 0) return out;

    const cats = useCategories(cps);

    const advanceOf = (gid: number): number =>
        (widths[gid] !== undefined ? widths[gid] : defaultWidth);

    const markAnchor = (gid: number): { classIdx: number; x: number; y: number } | null => {
        const a = markAnchors?.marks?.[gid];
        return a ? { classIdx: a[0], x: a[1], y: a[2] } : null;
    };

    const baseAnchor = (gid: number, cls: number): [number, number] | null =>
        markAnchors?.bases?.[gid]?.[cls] ?? null;

    const stackOffset = (m1: number, m2: number): { dx: number; dy: number } | null => {
        const a1 = m2m.mark1Anchors?.[m1];
        const c2 = m2m.mark2Classes?.[m2];
        if (!a1 || !c2) return null;
        const pt = a1[c2[0]];
        return pt ? { dx: pt[0] - c2[1], dy: pt[1] - c2[2] } : null;
    };

    for (const syllable of splitUseSyllables(cps)) {
        // ── 1. Logical-order glyphs ──────────────────────────────────
        const items: Item[] = [];
        for (let i = syllable.start; i < syllable.end; i++) {
            const cp = cps[i] === 0x202F || cps[i] === 0xA0 ? 0x20 : cps[i];
            items.push({ gid: cmap[cp] || 0, lead: cats[i], composed: false });
        }

        // ── 2. Ligatures, on the logical sequence ────────────────────
        const ligated: Item[] = [];
        for (let i = 0; i < items.length;) {
            const match = tryLigature(items.slice(i).map(it => it.gid), ligatures);
            if (match && match.consumed > 1) {
                ligated.push({ gid: match.resultGid, lead: items[i].lead, composed: true });
                i += match.consumed;
            } else {
                ligated.push(items[i]);
                i++;
            }
        }

        // ── 3. Reorder what the font did not compose ─────────────────
        const pre: Item[] = [];
        const rest: Item[] = [];
        for (const it of ligated) {
            if (!it.composed && PRE_BASE.has(it.lead)) pre.push(it);
            else rest.push(it);
        }
        const visual = [...pre, ...rest];

        // ── 4. Position ──────────────────────────────────────────────
        let baseGid = -1;
        let baseAdv = 0;
        let prevMark: { gid: number; dx: number; dy: number } | null = null;

        for (const it of visual) {
            const advance = advanceOf(it.gid);
            // A glyph the font gives no width to is a mark whatever its
            // category says, and a category-mark the font gives width to is
            // a spacing sign. The font is the authority on advance.
            const isMark = advance === 0 || (!it.composed && MARK.has(it.lead));

            if (!isMark) {
                out.push({ gid: it.gid, dx: 0, dy: 0, isZeroAdvance: false });
                baseGid = it.gid;
                baseAdv = advance;
                prevMark = null;
                continue;
            }

            let dx = 0;
            let dy = 0;
            const anchor = markAnchor(it.gid);
            const stack = prevMark ? stackOffset(prevMark.gid, it.gid) : null;
            if (stack && prevMark) {
                dx = prevMark.dx + stack.dx;
                dy = prevMark.dy + stack.dy;
            } else if (anchor && baseGid >= 0) {
                const attach = baseAnchor(baseGid, anchor.classIdx);
                if (attach) {
                    dx = attach[0] - anchor.x - baseAdv;
                    dy = attach[1] - anchor.y;
                }
            }

            out.push({ gid: it.gid, dx, dy, isZeroAdvance: true });
            prevMark = { gid: it.gid, dx, dy };
        }
    }

    return out;
}
