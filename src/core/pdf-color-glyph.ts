/**
 * pdfnative — Colour Glyph Renderer (COLR/CPAL → native PDF)
 * ==========================================================
 * Renders a resolved {@link ColorGlyph} as a native PDF Form XObject: each
 * layer's base-glyph outline is emitted as a vector path and filled with a
 * flat colour or a `/Shading` gradient. No rasterisation, zero dependency.
 *
 *   - Solid layers → `r g b rg … f` (with `/ca` ExtGState for alpha < 1).
 *   - Linear gradients → `/Shading` Type 2 (axial) painted via `sh`,
 *     clipped to the glyph outline.
 *   - Radial gradients → `/Shading` Type 3, likewise.
 *
 * The Form XObject's user space is font units; the caller scales it onto the
 * page with a `cm` and draws it with `Do`.
 *
 * References:
 *   - ISO 32000-1 §8.7.4.5 (Shadings), §7.10.2 (Type 2 functions),
 *     §8.10 (Form XObjects)
 */

import type { Contour } from '../fonts/glyf-outline.js';
import type { ColorGlyph, ColorLayer, ColorStop, CpalColor, LinearGradientPaint, RadialGradientPaint } from '../types/pdf-types.js';

/** A rendered colour glyph ready to be assembled into a Form XObject. */
export interface ColorGlyphForm {
    /** Form XObject content stream (font-unit user space). */
    readonly content: string;
    /** Form BBox `[x0 y0 x1 y1]` in font units. */
    readonly bbox: readonly [number, number, number, number];
    /** Named `/Shading` resources referenced by the content stream. */
    readonly shadings: ReadonlyArray<{ readonly name: string; readonly dict: string }>;
    /** Named `/ExtGState` resources (constant alpha) referenced by content. */
    readonly extGStates: ReadonlyArray<{ readonly name: string; readonly dict: string }>;
}

/** Provider of glyph outlines (decoupled from the font parser for testing). */
export type OutlineProvider = (glyphId: number) => Contour[];

type Mat = readonly [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];

/** Format a number for a PDF content stream: fixed, trimmed, no exponent. */
function n(v: number): string {
    if (!Number.isFinite(v)) return '0';
    if (Number.isInteger(v)) return String(v);
    let s = v.toFixed(3);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
}

function tx(m: Mat, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** sRGB 0–255 channel → PDF 0–1 component string. */
function ch(v: number): string {
    return n(Math.max(0, Math.min(1, v / 255)));
}

/**
 * Convert a set of TrueType quadratic contours into PDF path operators
 * (cubic Béziers), applying matrix `m`. Each contour is closed (`h`).
 */
export function contoursToPath(contours: Contour[], m: Mat = ID): string {
    const ops: string[] = [];
    for (const contour of contours) {
        if (contour.length === 0) continue;

        // Normalise so the walk starts on an on-curve point.
        const pts = contour.slice();
        let startIdx = pts.findIndex((p) => p.onCurve);
        let start: [number, number];
        if (startIdx < 0) {
            // All off-curve: synthesise an on-curve midpoint between pt0 and pt1.
            const a = pts[0], b = pts[pts.length - 1];
            start = [(a.x + b.x) / 2, (a.y + b.y) / 2];
            startIdx = 0;
        } else {
            start = [pts[startIdx].x, pts[startIdx].y];
        }

        const [sx, sy] = tx(m, start[0], start[1]);
        ops.push(`${n(sx)} ${n(sy)} m`);

        const len = pts.length;
        let curX = start[0], curY = start[1];
        let i = 1;
        while (i <= len) {
            const p = pts[(startIdx + i) % len];
            if (p.onCurve) {
                const [px, py] = tx(m, p.x, p.y);
                ops.push(`${n(px)} ${n(py)} l`);
                curX = p.x; curY = p.y;
                i++;
            } else {
                // Quadratic control point p; find the following on-curve end.
                const next = pts[(startIdx + i + 1) % len];
                let endX: number, endY: number;
                let consumed: number;
                if (next.onCurve) {
                    endX = next.x; endY = next.y; consumed = 2;
                } else {
                    // Implied on-curve midpoint between two off-curve points.
                    endX = (p.x + next.x) / 2; endY = (p.y + next.y) / 2; consumed = 1;
                }
                // Quadratic (curX,curY) – control p – (endX,endY) → cubic.
                const c1x = curX + (2 / 3) * (p.x - curX);
                const c1y = curY + (2 / 3) * (p.y - curY);
                const c2x = endX + (2 / 3) * (p.x - endX);
                const c2y = endY + (2 / 3) * (p.y - endY);
                const [a1, b1] = tx(m, c1x, c1y);
                const [a2, b2] = tx(m, c2x, c2y);
                const [ex, ey] = tx(m, endX, endY);
                ops.push(`${n(a1)} ${n(b1)} ${n(a2)} ${n(b2)} ${n(ex)} ${n(ey)} c`);
                curX = endX; curY = endY;
                i += consumed;
            }
        }
        ops.push('h');
    }
    return ops.join('\n');
}

/** Build a `/Function` dict interpolating the gradient's colour stops. */
function buildGradientFunction(stops: readonly ColorStop[]): string {
    const sorted = stops.slice().sort((a, b) => a.offset - b.offset);
    if (sorted.length === 0) return '<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 0 0] /N 1 >>';
    if (sorted.length === 1) {
        const c = sorted[0].color;
        return `<< /FunctionType 2 /Domain [0 1] /C0 [${ch(c[0])} ${ch(c[1])} ${ch(c[2])}] /C1 [${ch(c[0])} ${ch(c[1])} ${ch(c[2])}] /N 1 >>`;
    }
    if (sorted.length === 2) {
        const a = sorted[0].color, b = sorted[1].color;
        return `<< /FunctionType 2 /Domain [0 1] /C0 [${ch(a[0])} ${ch(a[1])} ${ch(a[2])}] /C1 [${ch(b[0])} ${ch(b[1])} ${ch(b[2])}] /N 1 >>`;
    }
    // Stitching function (Type 3) over consecutive Type 2 segments.
    const subFns: string[] = [];
    const bounds: string[] = [];
    const encode: string[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i].color, b = sorted[i + 1].color;
        subFns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${ch(a[0])} ${ch(a[1])} ${ch(a[2])}] /C1 [${ch(b[0])} ${ch(b[1])} ${ch(b[2])}] /N 1 >>`);
        encode.push('0 1');
        if (i > 0) bounds.push(n(Math.max(0, Math.min(1, sorted[i].offset))));
    }
    return `<< /FunctionType 3 /Domain [0 1] /Functions [${subFns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`;
}

function extendFlags(extend: string): string {
    // PDF /Extend supports only pad-style clamping; repeat/reflect approximate as pad.
    return extend === 'pad' ? '[true true]' : '[true true]';
}

function linearShadingDict(p: LinearGradientPaint, m: Mat): string {
    const [x0, y0] = tx(m, p.p0[0], p.p0[1]);
    const [x1, y1] = tx(m, p.p1[0], p.p1[1]);
    return `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${n(x0)} ${n(y0)} ${n(x1)} ${n(y1)}] /Function ${buildGradientFunction(p.stops)} /Extend ${extendFlags(p.extend)} >>`;
}

function radialShadingDict(p: RadialGradientPaint, m: Mat): string {
    const [x0, y0] = tx(m, p.c0[0], p.c0[1]);
    const [x1, y1] = tx(m, p.c1[0], p.c1[1]);
    const sx = Math.hypot(m[0], m[1]); const sy = Math.hypot(m[2], m[3]);
    const s = (sx + sy) / 2 || 1;
    return `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [${n(x0)} ${n(y0)} ${n(p.r0 * s)} ${n(x1)} ${n(y1)} ${n(p.r1 * s)}] /Function ${buildGradientFunction(p.stops)} /Extend ${extendFlags(p.extend)} >>`;
}

/**
 * Render a colour glyph into a {@link ColorGlyphForm}.
 *
 * @param glyph    - Resolved colour glyph (ordered layers).
 * @param outlines - Provides the contours for a given base glyph id.
 * @param unitsPerEm - Font units per em (defines the BBox).
 */
export function renderColorGlyph(
    glyph: ColorGlyph,
    outlines: OutlineProvider,
    unitsPerEm: number,
): ColorGlyphForm {
    const body: string[] = [];
    const shadings: { name: string; dict: string }[] = [];
    const extGStates: { name: string; dict: string }[] = [];
    const alphaMap = new Map<number, string>();

    let shadingIdx = 0;

    for (const layer of glyph.layers as ColorLayer[]) {
        const m: Mat = layer.transform ?? ID;
        const contours = outlines(layer.glyphId);
        if (contours.length === 0) continue;
        const path = contoursToPath(contours, m);

        if (layer.paint.kind === 'solid') {
            const c: CpalColor = layer.paint.color;
            const alpha = c[3] / 255;
            body.push('q');
            if (alpha < 0.999) {
                let gs = alphaMap.get(c[3]);
                if (!gs) {
                    gs = `GsA${alphaMap.size}`;
                    alphaMap.set(c[3], gs);
                    extGStates.push({ name: gs, dict: `<< /ca ${n(alpha)} /CA ${n(alpha)} >>` });
                }
                body.push(`/${gs} gs`);
            }
            body.push(`${ch(c[0])} ${ch(c[1])} ${ch(c[2])} rg`);
            body.push(path);
            body.push('f');
            body.push('Q');
        } else {
            const name = `Sh${shadingIdx++}`;
            const dict = layer.paint.kind === 'linear'
                ? linearShadingDict(layer.paint, m)
                : radialShadingDict(layer.paint, m);
            shadings.push({ name, dict });
            body.push('q');
            body.push(path);
            body.push('W n'); // clip to the outline
            body.push(`/${name} sh`);
            body.push('Q');
        }
    }

    return {
        content: body.join('\n'),
        bbox: [0, 0, unitsPerEm, unitsPerEm],
        shadings,
        extGStates,
    };
}
