/**
 * CLIP COMPACTION — build-time only
 * =================================
 * Shrinks the clip sets the COLR parser attaches to masked colour-glyph
 * layers, without changing the area they clip to.
 *
 * The parser is faithful: a COLRv1 structural mask becomes the union of every
 * outline in the mask subtree. For Noto's flags that union is the whole flag
 * artwork — up to 1 640 outlines — and the content stream would repeat all of
 * them just to say "only inside the flag". Nearly all are redundant: the
 * stars sit inside the disc, the disc inside the diamond, the diamond inside
 * the field. Measured across Noto Color Emoji, dropping outlines that add
 * nothing to the union keeps 408 of 18 789, a median of one per mask.
 *
 * Containment is decided on a raster, so it is guarded twice: an outline is
 * dropped only when it adds no covered cell at `resolution` per side of the
 * mask's bounding box, and when every vertex of it lies within one cell of
 * the union kept so far. What can escape both is a sliver thinner than a
 * cell — at the default 1 024 cells, under a thousandth of the em — clipped
 * out of a shading drawn over it.
 *
 * This lives in the build scripts, not in the parser: `parseColrCpal` stays
 * an exact reading of the font for callers who use it directly.
 */

import { extractGlyphContours, type GlyfFont } from '../../src/fonts/glyf-outline.js';
import type { ClipOutline, ColorGlyph, ColorLayer } from '../../src/types/pdf-types.js';

type Point = readonly [number, number];
type Box = readonly [number, number, number, number];

/** Flatten an outline's quadratic contours into polygons, in layer space. */
function polygons(glyf: GlyfFont, outline: ClipOutline): Point[][] {
    const m = outline.transform ?? [1, 0, 0, 1, 0, 0];
    const at = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const out: Point[][] = [];
    for (const contour of extractGlyphContours(glyf, outline.glyphId)) {
        const n = contour.length;
        if (n < 2) continue;
        let s = contour.findIndex(p => p.onCurve);
        let cx: number, cy: number;
        if (s < 0) {
            cx = (contour[0].x + contour[n - 1].x) / 2;
            cy = (contour[0].y + contour[n - 1].y) / 2;
            s = 0;
        } else {
            cx = contour[s].x;
            cy = contour[s].y;
        }
        const poly: Point[] = [at(cx, cy)];
        let i = 1;
        while (i <= n) {
            const p = contour[(s + i) % n];
            if (p.onCurve) {
                cx = p.x; cy = p.y;
                poly.push(at(cx, cy));
                i++;
                continue;
            }
            const q = contour[(s + i + 1) % n];
            const ex = q.onCurve ? q.x : (p.x + q.x) / 2;
            const ey = q.onCurve ? q.y : (p.y + q.y) / 2;
            for (const t of [0.25, 0.5, 0.75, 1]) {
                const u = 1 - t;
                poly.push(at(u * u * cx + 2 * u * t * p.x + t * t * ex, u * u * cy + 2 * u * t * p.y + t * t * ey));
            }
            cx = ex; cy = ey;
            i += q.onCurve ? 2 : 1;
        }
        out.push(poly);
    }
    return out;
}

/** Absolute filled area, by the shoelace formula — only used to order outlines. */
function area(polys: readonly Point[][]): number {
    let total = 0;
    for (const poly of polys) {
        let a = 0;
        for (let k = 0; k < poly.length; k++) {
            const [x1, y1] = poly[k];
            const [x2, y2] = poly[(k + 1) % poly.length];
            a += x1 * y2 - x2 * y1;
        }
        total += Math.abs(a) / 2;
    }
    return total;
}

/**
 * Scanline-fill `polys` with the nonzero rule into a `res × res` grid over
 * `box`, visiting only the rows and columns the polygons span. Returns how
 * many cells were not already set; writes them when `commit` is true.
 */
function fill(polys: readonly Point[][], grid: Uint8Array, box: Box, res: number, commit: boolean): number {
    const [x0, y0, x1, y1] = box;
    const sx = (x1 - x0) / res || 1;
    const sy = (y1 - y0) / res || 1;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (const poly of polys) for (const [x, y] of poly) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
    }
    const r0 = Math.max(0, Math.floor((minY - y0) / sy));
    const r1 = Math.min(res - 1, Math.ceil((maxY - y0) / sy));
    const c0 = Math.max(0, Math.floor((minX - x0) / sx));
    const c1 = Math.min(res - 1, Math.ceil((maxX - x0) / sx));
    let adds = 0;
    const hits: [number, number][] = [];
    for (let r = r0; r <= r1; r++) {
        const y = y0 + (r + 0.5) * sy;
        hits.length = 0;
        for (const poly of polys) {
            for (let k = 0; k < poly.length; k++) {
                const [ax, ay] = poly[k];
                const [bx, by] = poly[(k + 1) % poly.length];
                if ((ay <= y && by > y) || (by <= y && ay > y)) {
                    hits.push([ax + (y - ay) * (bx - ax) / (by - ay), by > ay ? 1 : -1]);
                }
            }
        }
        hits.sort((a, b) => a[0] - b[0]);
        let wind = 0;
        let h = 0;
        for (let c = c0; c <= c1; c++) {
            const x = x0 + (c + 0.5) * sx;
            while (h < hits.length && hits[h][0] < x) wind += hits[h++][1];
            if (wind === 0) continue;
            const cell = r * res + c;
            if (grid[cell]) continue;
            adds++;
            if (commit) grid[cell] = 1;
        }
    }
    return adds;
}

/** Whether every vertex lies within one cell of a covered cell. */
function verticesCovered(polys: readonly Point[][], grid: Uint8Array, box: Box, res: number): boolean {
    const [x0, y0, x1, y1] = box;
    const sx = (x1 - x0) / res || 1;
    const sy = (y1 - y0) / res || 1;
    for (const poly of polys) {
        for (const [x, y] of poly) {
            const r = Math.min(res - 1, Math.max(0, Math.floor((y - y0) / sy)));
            const c = Math.min(res - 1, Math.max(0, Math.floor((x - x0) / sx)));
            let near = false;
            for (let dr = -1; dr <= 1 && !near; dr++) {
                for (let dc = -1; dc <= 1 && !near; dc++) {
                    const rr = r + dr, cc = c + dc;
                    if (rr >= 0 && rr < res && cc >= 0 && cc < res && grid[rr * res + cc]) near = true;
                }
            }
            if (!near) return false;
        }
    }
    return true;
}

/**
 * The outlines of a clip set that contribute to its union, largest first,
 * in their original relative order.
 */
export function pruneClipSet(set: readonly ClipOutline[], glyf: GlyfFont, resolution = 1024): ClipOutline[] {
    if (set.length <= 1) return [...set];
    const shapes = set.map(outline => ({ outline, polys: polygons(glyf, outline) }));
    const all = shapes.flatMap(s => s.polys.flat());
    if (all.length === 0) return [...set];
    const box: Box = [
        Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])),
        Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1])),
    ];
    const order = shapes.map((s, i) => ({ i, a: area(s.polys) })).sort((p, q) => q.a - p.a || p.i - q.i);
    const union = new Uint8Array(resolution * resolution);
    const keep = new Set<number>();
    for (const { i } of order) {
        const { polys } = shapes[i];
        if (polys.length === 0) continue;
        const adds = fill(polys, union, box, resolution, false);
        if (adds === 0 && verticesCovered(polys, union, box, resolution)) continue;
        fill(polys, union, box, resolution, true);
        keep.add(i);
    }
    return set.filter((_, i) => keep.has(i));
}

/**
 * A colour glyph with each distinct clip set pruned once. Layers sharing a
 * clip set keep sharing the pruned result.
 */
export function compactClips(glyph: ColorGlyph, glyf: GlyfFont, resolution = 1024): ColorGlyph {
    if (!glyph.layers.some(l => l.clip)) return glyph;
    const pruned = new Map<readonly ClipOutline[], ClipOutline[]>();
    const layers: ColorLayer[] = glyph.layers.map(layer => {
        if (!layer.clip) return layer;
        const clip = layer.clip.map(set => {
            let result = pruned.get(set);
            if (!result) {
                result = pruneClipSet(set, glyf, resolution);
                pruned.set(set, result);
            }
            return result;
        });
        return { ...layer, clip };
    });
    return { layers };
}
