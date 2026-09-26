/**
 * Diagram geometry analysis — pure, no browser, no file system
 * =============================================================
 * The documentation diagrams under `docs/assets/*.svg` are written by hand.
 * `scripts/verify-diagrams.ts` renders each one in a headless Chromium,
 * collects the rendered geometry (text bounding boxes, rectangles, sampled
 * stroke points — all in the root SVG coordinate system) and hands it here.
 *
 * Rules:
 *   overflow             a text leaves the smallest rectangle containing its
 *                        centre (horizontal padding `padding`, vertical 2 user units)
 *   straddle             a text crosses the edge of another rectangle it is
 *                        neither inside nor nested with
 *   box-overlap          two rectangles overlap without one containing the other
 *   text-overlap         two text boxes intersect
 *   stroke-through-text  a visible part of a line or path crosses a text box —
 *                        a stroke segment painted over by a later opaque
 *                        rectangle (a label pill on a connector) is hidden
 *
 * Exemptions (deliberate designs, declared in the SVG, never inferred):
 *   - any element carrying `data-overlap="intentional"` (a strikethrough, a
 *     group label pill set astride its group's border);
 *   - a text drawn with a halo (`paint-order="stroke"`), which stays legible
 *     over a line by construction;
 *   - the full-canvas background rectangle.
 */

export interface GeometryBox {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    /** Declared with `data-overlap="intentional"` (on the element or an ancestor). */
    readonly intentional?: boolean;
    /** Paint order in the document (later paints over earlier). */
    readonly order?: number;
    /** Filled opaquely enough to hide what was painted before it. */
    readonly opaque?: boolean;
}

export interface GeometryText extends GeometryBox {
    /** The rendered string, for the report. */
    readonly label: string;
    /** Drawn with a halo (`paint-order` starting with `stroke`). */
    readonly halo?: boolean;
}

export interface GeometryStroke {
    readonly tag: string;
    readonly points: readonly { readonly x: number; readonly y: number }[];
    readonly intentional?: boolean;
    /** Paint order in the document. */
    readonly order?: number;
}

export interface DiagramGeometry {
    readonly width: number;
    readonly height: number;
    readonly texts: readonly GeometryText[];
    readonly rects: readonly GeometryBox[];
    readonly strokes: readonly GeometryStroke[];
}

export type DiagramFindingKind = 'overflow' | 'straddle' | 'box-overlap' | 'text-overlap' | 'stroke-through-text';

export interface DiagramFinding {
    readonly kind: DiagramFindingKind;
    readonly message: string;
}

export interface AnalyseOptions {
    /** Minimum horizontal clearance between a text and its box edge (user units). Default 4. */
    readonly padding?: number;
}

const right = (b: GeometryBox): number => b.x + b.w;
const bottom = (b: GeometryBox): number => b.y + b.h;
const round = (n: number): string => (Math.round(n * 10) / 10).toString();
const describe = (b: GeometryBox): string => `box@${round(b.x)},${round(b.y)} ${round(b.w)}x${round(b.h)}`;
const quote = (t: GeometryText): string => `"${t.label.length > 60 ? t.label.slice(0, 57) + '…' : t.label}"`;

function contains(outer: GeometryBox, inner: GeometryBox): boolean {
    return inner.x >= outer.x && right(inner) <= right(outer) && inner.y >= outer.y && bottom(inner) <= bottom(outer);
}

/** Overlap extents on both axes (negative when apart). */
function intersection(a: GeometryBox, b: GeometryBox): { readonly dx: number; readonly dy: number } {
    return {
        dx: Math.min(right(a), right(b)) - Math.max(a.x, b.x),
        dy: Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y),
    };
}

function containerOf(t: GeometryText, rects: readonly GeometryBox[]): GeometryBox | undefined {
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    let best: GeometryBox | undefined;
    for (const r of rects) {
        if (cx < r.x || cx > right(r) || cy < r.y || cy > bottom(r)) continue;
        if (!best || r.w * r.h < best.w * best.h) best = r;
    }
    return best;
}

/** Analyse one rendered diagram; an empty array means the geometry is clean. */
export function analyseDiagram(geometry: DiagramGeometry, options: AnalyseOptions = {}): DiagramFinding[] {
    const padding = options.padding ?? 4;
    const findings: DiagramFinding[] = [];
    const rects = geometry.rects.filter(
        (r) => !(r.w >= geometry.width - 10 && r.h >= geometry.height - 10),
    );
    const texts = geometry.texts.filter((t) => t.label.trim() !== '' && t.w > 0 && t.h > 0);

    for (const t of texts) {
        const box = containerOf(t, rects);
        if (box) {
            const excess = Math.max(box.x + padding - t.x, right(t) - (right(box) - padding), box.y + 2 - t.y, bottom(t) - (bottom(box) - 2));
            if (excess > 0.5 && !t.intentional) {
                findings.push({ kind: 'overflow', message: `${quote(t)} leaves ${describe(box)} by ${round(excess)}` });
            }
        }
        if (t.intentional || box?.intentional) continue;
        for (const r of rects) {
            if (r === box || r.intentional) continue;
            if (box && contains(r, box)) continue; // an enclosing group
            const { dx, dy } = intersection(t, r);
            if (dx > 1 && dy > 1 && !contains(r, t)) {
                findings.push({ kind: 'straddle', message: `${quote(t)} crosses the edge of ${describe(r)} (${round(dx)}x${round(dy)})` });
            }
        }
    }

    for (const [i, a] of rects.entries()) {
        for (const b of rects.slice(i + 1)) {
            if (a.intentional || b.intentional || contains(a, b) || contains(b, a)) continue;
            const { dx, dy } = intersection(a, b);
            if (dx > 1 && dy > 1) findings.push({ kind: 'box-overlap', message: `${describe(a)} overlaps ${describe(b)} (${round(dx)}x${round(dy)})` });
        }
    }

    for (const [i, a] of texts.entries()) {
        for (const b of texts.slice(i + 1)) {
            if (a.intentional || b.intentional) continue;
            const { dx, dy } = intersection(a, b);
            if (dx > 1 && dy > 1) findings.push({ kind: 'text-overlap', message: `${quote(a)} overlaps ${quote(b)}` });
        }
    }

    const covers = geometry.rects.filter((r) => r.opaque === true && r.order !== undefined);
    for (const s of geometry.strokes) {
        if (s.intentional) continue;
        const order = s.order;
        const visible = order === undefined
            ? s.points
            : s.points.filter((p) => !covers.some((r) => (r.order ?? -1) > order && p.x >= r.x && p.x <= right(r) && p.y >= r.y && p.y <= bottom(r)));
        for (const t of texts) {
            if (t.halo || t.intentional) continue;
            const hit = visible.some((p) => p.x > t.x + 1 && p.x < right(t) - 1 && p.y > t.y + 2 && p.y < bottom(t) - 2);
            if (hit) findings.push({ kind: 'stroke-through-text', message: `a ${s.tag} crosses ${quote(t)}` });
        }
    }
    return findings;
}
