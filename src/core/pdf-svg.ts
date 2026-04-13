/**
 * pdfnative — SVG Path Rendering
 * ================================
 * Parses SVG path data and basic SVG elements, renders them as
 * PDF path operators using coordinate matrix transformation.
 *
 * Supported SVG path commands: M, L, H, V, C, S, Q, T, A, Z
 * (both absolute and relative variants).
 *
 * Supported SVG elements: path, rect, circle, ellipse, line, polyline, polygon.
 *
 * Quadratic bezier (Q/T) → cubic bezier (C) via De Casteljau.
 * Arc (A) → cubic bezier (C) via endpoint-to-center parameterization (SVG spec F.6).
 *
 * ISO 32000-1 §8.5 Path Construction and Painting.
 * SVG 1.1 §8.3 Path Data.
 */

import { parseColor } from './pdf-color.js';
import type { PdfColor } from '../types/pdf-types.js';

// ── Types ────────────────────────────────────────────────────────────

/** Parsed SVG path segment in absolute coordinates (M, L, C, Z only). */
export interface SvgSegment {
    readonly cmd: 'M' | 'L' | 'C' | 'Z';
    readonly args: readonly number[];
}

/** Options for SVG rendering to PDF operators. */
export interface SvgRenderOptions {
    /** Fill color. Default: black. `'none'` disables fill. */
    readonly fill?: PdfColor | 'none';
    /** Stroke color. Default: none (no stroke). */
    readonly stroke?: PdfColor | 'none';
    /** Stroke width in SVG user units. Default: `1`. */
    readonly strokeWidth?: number;
    /** ViewBox [minX, minY, width, height]. Overrides SVG markup viewBox. */
    readonly viewBox?: readonly [number, number, number, number];
}

// ── Path Tokenizer ───────────────────────────────────────────────────

/** Number of coordinate arguments per SVG path command. */
const ARG_COUNTS: Record<string, number> = {
    M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

/**
 * Tokenize SVG path `d` string into command letters and numbers.
 * Handles comma/space separators and implicit negative-sign separators.
 */
function tokenize(d: string): (string | number)[] {
    const tokens: (string | number)[] = [];
    const len = d.length;
    let i = 0;

    while (i < len) {
        const ch = d.charCodeAt(i);

        // Whitespace (space, tab, LF, CR) and comma
        if (ch === 32 || ch === 44 || ch === 9 || ch === 10 || ch === 13) { i++; continue; }

        // Command letter (A-Z, a-z)
        if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122)) {
            tokens.push(d[i]);
            i++;
            continue;
        }

        // Number: optional sign, digits with optional decimal, optional exponent
        const start = i;
        if (ch === 43 || ch === 45) i++; // + or -
        let hasDot = false;
        while (i < len) {
            const c = d.charCodeAt(i);
            if (c >= 48 && c <= 57) { i++; continue; }
            if (c === 46 && !hasDot) { hasDot = true; i++; continue; }
            break;
        }
        // Exponent
        if (i < len && (d.charCodeAt(i) === 101 || d.charCodeAt(i) === 69)) {
            i++;
            if (i < len && (d.charCodeAt(i) === 43 || d.charCodeAt(i) === 45)) i++;
            while (i < len && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) i++;
        }
        if (i > start) {
            tokens.push(+d.slice(start, i));
        } else {
            i++; // skip unknown character
        }
    }

    return tokens;
}

// ── Arc to Cubic Bezier ──────────────────────────────────────────────

/** Signed angle between two vectors. */
function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
    const sign = (ux * vy - uy * vx) < 0 ? -1 : 1;
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    return sign * Math.acos(Math.max(-1, Math.min(1, dot / len)));
}

/** Convert a single arc segment (≤90°) to a cubic bezier. */
function arcSegToCubic(
    cx: number, cy: number,
    rx: number, ry: number,
    cosPhi: number, sinPhi: number,
    t1: number, t2: number,
): readonly number[] {
    const alpha = 4 / 3 * Math.tan((t2 - t1) / 4);
    const c1 = Math.cos(t1), s1 = Math.sin(t1);
    const c2 = Math.cos(t2), s2 = Math.sin(t2);

    return [
        cosPhi * rx * (c1 - alpha * s1) - sinPhi * ry * (s1 + alpha * c1) + cx,
        sinPhi * rx * (c1 - alpha * s1) + cosPhi * ry * (s1 + alpha * c1) + cy,
        cosPhi * rx * (c2 + alpha * s2) - sinPhi * ry * (s2 - alpha * c2) + cx,
        sinPhi * rx * (c2 + alpha * s2) + cosPhi * ry * (s2 - alpha * c2) + cy,
        cosPhi * rx * c2 - sinPhi * ry * s2 + cx,
        sinPhi * rx * c2 + cosPhi * ry * s2 + cy,
    ];
}

/**
 * Convert SVG arc endpoint parameterization to cubic bezier curves.
 * Implements SVG 1.1 Appendix F.6 (F.6.2 out-of-range corrections,
 * F.6.5 endpoint-to-center conversion, F.6.6 arc segment generation).
 * Splits arcs >90° into multiple cubic segments for accuracy.
 */
function arcToCubic(
    x1: number, y1: number,
    x2: number, y2: number,
    rxIn: number, ryIn: number,
    angle: number, largeArc: number, sweep: number,
): readonly (readonly number[])[] {
    const phi = angle * Math.PI / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Step 1: compute x1', y1'
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // Step 2: compute cx', cy'
    let rx = rxIn, ry = ryIn;
    let rxSq = rx * rx, rySq = ry * ry;
    const x1pSq = x1p * x1p, y1pSq = y1p * y1p;

    // Ensure radii are large enough
    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rx *= s; ry *= s;
        rxSq = rx * rx; rySq = ry * ry;
    }

    const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
    const den = rxSq * y1pSq + rySq * x1pSq;
    const sq = Math.max(0, num / den);
    const sign = (largeArc === sweep) ? -1 : 1;
    const cxp = sign * Math.sqrt(sq) * (rx * y1p / ry);
    const cyp = sign * Math.sqrt(sq) * -(ry * x1p / rx);

    // Step 3: compute cx, cy
    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    // Step 4: compute θ1 and dθ
    const t1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = vectorAngle(
        (x1p - cxp) / rx, (y1p - cyp) / ry,
        (-x1p - cxp) / rx, (-y1p - cyp) / ry,
    );
    if (sweep === 0 && dt > 0) dt -= 2 * Math.PI;
    if (sweep === 1 && dt < 0) dt += 2 * Math.PI;

    // Split into segments ≤ 90°
    const segCount = Math.ceil(Math.abs(dt) / (Math.PI / 2));
    const segAngle = dt / segCount;
    const result: (readonly number[])[] = [];
    let t = t1;
    for (let i = 0; i < segCount; i++) {
        result.push(arcSegToCubic(cx, cy, rx, ry, cosPhi, sinPhi, t, t + segAngle));
        t += segAngle;
    }
    return result;
}

// ── Path Parser ──────────────────────────────────────────────────────

/**
 * Parse SVG path `d` string into normalized absolute-coordinate segments.
 *
 * All output segments use only M, L, C, Z commands:
 * - Relative commands → absolute
 * - H/V → L (expanded to full x,y coordinates)
 * - S → C (reflected control point)
 * - Q/T → C (quadratic-to-cubic via De Casteljau)
 * - A → C sequence (arc approximation via cubic beziers)
 *
 * @param d - SVG path `d` attribute string
 * @returns Normalized path segments in absolute coordinates
 */
export function parseSvgPath(d: string): SvgSegment[] {
    const tokens = tokenize(d);
    const segments: SvgSegment[] = [];

    let curX = 0, curY = 0;
    let startX = 0, startY = 0;
    let lastCmd = '';
    let lastCx = 0, lastCy = 0; // last control point for S/T reflection

    let i = 0;
    let cmd = '';
    let rel = false;

    while (i < tokens.length) {
        const tok = tokens[i];

        if (typeof tok === 'string') {
            cmd = tok;
            rel = cmd === cmd.toLowerCase();
            i++;

            if (cmd === 'Z' || cmd === 'z') {
                segments.push({ cmd: 'Z', args: [] });
                curX = startX; curY = startY;
                lastCmd = 'Z';
                lastCx = curX; lastCy = curY;
                continue;
            }
        } else {
            // Implicit repeated command: M becomes L after first pair
            if (cmd === 'M') cmd = 'L';
            else if (cmd === 'm') { cmd = 'l'; rel = true; }
        }

        const upper = cmd.toUpperCase();
        const cnt = ARG_COUNTS[upper];
        if (cnt === undefined) { i++; continue; }

        // Collect arguments
        const args: number[] = [];
        for (let j = 0; j < cnt && i < tokens.length; j++) {
            if (typeof tokens[i] !== 'number') break;
            args.push(tokens[i] as number);
            i++;
        }
        if (args.length < cnt) break;

        switch (upper) {
            case 'M': {
                const x = rel ? curX + args[0] : args[0];
                const y = rel ? curY + args[1] : args[1];
                segments.push({ cmd: 'M', args: [x, y] });
                curX = x; curY = y;
                startX = x; startY = y;
                lastCx = x; lastCy = y;
                break;
            }
            case 'L': {
                const x = rel ? curX + args[0] : args[0];
                const y = rel ? curY + args[1] : args[1];
                segments.push({ cmd: 'L', args: [x, y] });
                curX = x; curY = y;
                lastCx = x; lastCy = y;
                break;
            }
            case 'H': {
                const x = rel ? curX + args[0] : args[0];
                segments.push({ cmd: 'L', args: [x, curY] });
                curX = x;
                lastCx = x; lastCy = curY;
                break;
            }
            case 'V': {
                const y = rel ? curY + args[0] : args[0];
                segments.push({ cmd: 'L', args: [curX, y] });
                curY = y;
                lastCx = curX; lastCy = y;
                break;
            }
            case 'C': {
                const x1 = rel ? curX + args[0] : args[0];
                const y1 = rel ? curY + args[1] : args[1];
                const x2 = rel ? curX + args[2] : args[2];
                const y2 = rel ? curY + args[3] : args[3];
                const x = rel ? curX + args[4] : args[4];
                const y = rel ? curY + args[5] : args[5];
                segments.push({ cmd: 'C', args: [x1, y1, x2, y2, x, y] });
                lastCx = x2; lastCy = y2;
                curX = x; curY = y;
                break;
            }
            case 'S': {
                // Smooth cubic: reflect last control point from previous C/S
                const cx1 = (lastCmd === 'C' || lastCmd === 'S') ? 2 * curX - lastCx : curX;
                const cy1 = (lastCmd === 'C' || lastCmd === 'S') ? 2 * curY - lastCy : curY;
                const x2 = rel ? curX + args[0] : args[0];
                const y2 = rel ? curY + args[1] : args[1];
                const x = rel ? curX + args[2] : args[2];
                const y = rel ? curY + args[3] : args[3];
                segments.push({ cmd: 'C', args: [cx1, cy1, x2, y2, x, y] });
                lastCx = x2; lastCy = y2;
                curX = x; curY = y;
                break;
            }
            case 'Q': {
                // Quadratic → cubic: CP1 = P0 + 2/3*(Q-P0), CP2 = P1 + 2/3*(Q-P1)
                const qx = rel ? curX + args[0] : args[0];
                const qy = rel ? curY + args[1] : args[1];
                const x = rel ? curX + args[2] : args[2];
                const y = rel ? curY + args[3] : args[3];
                segments.push({ cmd: 'C', args: [
                    curX + 2 / 3 * (qx - curX), curY + 2 / 3 * (qy - curY),
                    x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y),
                    x, y,
                ] });
                lastCx = qx; lastCy = qy;
                curX = x; curY = y;
                break;
            }
            case 'T': {
                // Smooth quadratic: reflect last Q control point
                const qx = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * curX - lastCx : curX;
                const qy = (lastCmd === 'Q' || lastCmd === 'T') ? 2 * curY - lastCy : curY;
                const x = rel ? curX + args[0] : args[0];
                const y = rel ? curY + args[1] : args[1];
                segments.push({ cmd: 'C', args: [
                    curX + 2 / 3 * (qx - curX), curY + 2 / 3 * (qy - curY),
                    x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y),
                    x, y,
                ] });
                lastCx = qx; lastCy = qy;
                curX = x; curY = y;
                break;
            }
            case 'A': {
                const rxv = Math.abs(args[0]);
                const ryv = Math.abs(args[1]);
                const ang = args[2];
                const la = args[3] ? 1 : 0;
                const sw = args[4] ? 1 : 0;
                const x = rel ? curX + args[5] : args[5];
                const y = rel ? curY + args[6] : args[6];

                if ((curX === x && curY === y) || rxv === 0 || ryv === 0) {
                    segments.push({ cmd: 'L', args: [x, y] });
                } else {
                    for (const seg of arcToCubic(curX, curY, x, y, rxv, ryv, ang, la, sw)) {
                        segments.push({ cmd: 'C', args: seg });
                    }
                }
                curX = x; curY = y;
                lastCx = x; lastCy = y;
                break;
            }
        }

        lastCmd = upper;
    }

    return segments;
}

// ── SVG Element Parsing ──────────────────────────────────────────────

/** Parsed SVG element with path data and per-element styles. */
interface ParsedElement {
    readonly pathData: string;
    readonly fill?: string;
    readonly stroke?: string;
    readonly strokeWidth?: number;
}

/** Minimal CSS named color map (SVG/CSS3 basic colors → hex). */
const CSS_COLORS: Record<string, string> = {
    black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000',
    blue: '#0000FF', yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF',
    orange: '#FFA500', purple: '#800080', gray: '#808080', grey: '#808080',
    lime: '#00FF00', maroon: '#800000', navy: '#000080', olive: '#808000',
    teal: '#008080', aqua: '#00FFFF', fuchsia: '#FF00FF', silver: '#C0C0C0',
};

/** Normalize an SVG color attribute value to a format parseColor() accepts. */
function normalizeSvgColor(color: string): string {
    const lower = color.toLowerCase();
    return CSS_COLORS[lower] ?? color;
}

/** Extract a named attribute from an SVG element attribute string. */
function getAttr(attrs: string, name: string): string | undefined {
    const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
    const m = attrs.match(re);
    return m?.[1];
}

/** Extract a numeric attribute (default 0). */
function getNum(attrs: string, name: string, def = 0): number {
    const v = getAttr(attrs, name);
    return v !== undefined ? +v : def;
}

/** Convert SVG `<rect>` to path data (handles rounded corners). */
function rectToPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
    if (w <= 0 || h <= 0) return '';
    if (rx <= 0 && ry <= 0) {
        return `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
    }
    const r = Math.min(rx || ry, w / 2);
    const s = Math.min(ry || rx, h / 2);
    return `M${x + r} ${y}L${x + w - r} ${y}A${r} ${s} 0 0 1 ${x + w} ${y + s}` +
        `L${x + w} ${y + h - s}A${r} ${s} 0 0 1 ${x + w - r} ${y + h}` +
        `L${x + r} ${y + h}A${r} ${s} 0 0 1 ${x} ${y + h - s}` +
        `L${x} ${y + s}A${r} ${s} 0 0 1 ${x + r} ${y}Z`;
}

/** Convert SVG `<ellipse>` (or `<circle>`) to path data. */
function ellipseToPath(cx: number, cy: number, rx: number, ry: number): string {
    if (rx <= 0 || ry <= 0) return '';
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}` +
        `A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

/** Convert SVG `<polyline>` or `<polygon>` points to path data. */
function polyToPath(points: string, close: boolean): string {
    const nums = points.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
    if (!nums || nums.length < 4) return '';
    const parts = [`M${nums[0]} ${nums[1]}`];
    for (let i = 2; i + 1 < nums.length; i += 2) {
        parts.push(`L${nums[i]} ${nums[i + 1]}`);
    }
    if (close) parts.push('Z');
    return parts.join('');
}

/**
 * Parse basic SVG markup into path data and per-element styles.
 * Extracts viewBox from root `<svg>` element.
 * Handles: path, rect, circle, ellipse, line, polyline, polygon.
 */
function parseSvgMarkup(svg: string): {
    elements: ParsedElement[];
    viewBox?: readonly [number, number, number, number];
} {
    // Extract viewBox
    const vbMatch = svg.match(/viewBox\s*=\s*"([^"]*)"/i);
    let viewBox: readonly [number, number, number, number] | undefined;
    if (vbMatch) {
        const p = vbMatch[1].trim().split(/[\s,]+/).map(Number);
        if (p.length === 4 && p.every(n => !isNaN(n))) {
            viewBox = [p[0], p[1], p[2], p[3]] as const;
        }
    }

    const elements: ParsedElement[] = [];
    const elemRe = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*?)\/?>/gi;
    let m: RegExpExecArray | null;

    while ((m = elemRe.exec(svg)) !== null) {
        const tag = m[1].toLowerCase();
        const a = m[2];

        let pathData = '';
        switch (tag) {
            case 'path':
                pathData = getAttr(a, 'd') ?? '';
                break;
            case 'rect':
                pathData = rectToPath(
                    getNum(a, 'x'), getNum(a, 'y'),
                    getNum(a, 'width'), getNum(a, 'height'),
                    getNum(a, 'rx'), getNum(a, 'ry'),
                );
                break;
            case 'circle':
                pathData = ellipseToPath(getNum(a, 'cx'), getNum(a, 'cy'), getNum(a, 'r'), getNum(a, 'r'));
                break;
            case 'ellipse':
                pathData = ellipseToPath(getNum(a, 'cx'), getNum(a, 'cy'), getNum(a, 'rx'), getNum(a, 'ry'));
                break;
            case 'line':
                pathData = `M${getNum(a, 'x1')} ${getNum(a, 'y1')}L${getNum(a, 'x2')} ${getNum(a, 'y2')}`;
                break;
            case 'polyline':
                pathData = polyToPath(getAttr(a, 'points') ?? '', false);
                break;
            case 'polygon':
                pathData = polyToPath(getAttr(a, 'points') ?? '', true);
                break;
        }

        if (pathData) {
            const fill = getAttr(a, 'fill');
            const stroke = getAttr(a, 'stroke');
            const sw = getAttr(a, 'stroke-width');
            elements.push({
                pathData,
                fill: fill ? normalizeSvgColor(fill) : undefined,
                stroke: stroke ? normalizeSvgColor(stroke) : undefined,
                strokeWidth: sw !== undefined ? +sw : undefined,
            });
        }
    }

    return { elements, viewBox };
}

// ── PDF Operator Generation ──────────────────────────────────────────

/** Format number for PDF operators (2 decimal places). */
const fn = (n: number): string => n.toFixed(2);

/** Resolve color value: 'none' → null, PdfColor → RGB string, undefined → fallback. */
function resolveColor(color: string | undefined, fallback: string | null): string | null {
    if (color === 'none') return null;
    if (color !== undefined) return parseColor(color as PdfColor);
    return fallback;
}

/**
 * Build PDF path operators for a set of parsed segments with specified colors.
 * Wraps in q/Q for graphics state isolation.
 */
function buildPathOps(
    segments: readonly SvgSegment[],
    fillRgb: string | null,
    strokeRgb: string | null,
    strokeWidth: number,
): string {
    const ops: string[] = ['q'];

    if (fillRgb) ops.push(`${fillRgb} rg`);
    if (strokeRgb) {
        ops.push(`${strokeRgb} RG`);
        ops.push(`${fn(strokeWidth)} w`);
    }

    for (const seg of segments) {
        switch (seg.cmd) {
            case 'M':
                ops.push(`${fn(seg.args[0])} ${fn(seg.args[1])} m`);
                break;
            case 'L':
                ops.push(`${fn(seg.args[0])} ${fn(seg.args[1])} l`);
                break;
            case 'C':
                ops.push(`${fn(seg.args[0])} ${fn(seg.args[1])} ${fn(seg.args[2])} ${fn(seg.args[3])} ${fn(seg.args[4])} ${fn(seg.args[5])} c`);
                break;
            case 'Z':
                ops.push('h');
                break;
        }
    }

    // Paint operation: fill+stroke, fill-only, stroke-only, or end path
    const paint = fillRgb && strokeRgb ? 'B' : fillRgb ? 'f' : strokeRgb ? 'S' : 'n';
    ops.push(paint);
    ops.push('Q');

    return ops.join('\n');
}

/**
 * Render SVG content as PDF path operators.
 *
 * Accepts either:
 * - A raw SVG path `d` attribute (e.g. `"M10 10 L90 10 L90 90 Z"`)
 * - SVG markup containing supported elements (path, rect, circle, etc.)
 *
 * Uses a PDF coordinate matrix (cm operator) to transform from
 * SVG coordinate system (Y-down, origin at top-left) to
 * PDF coordinate system (Y-up, origin at bottom-left).
 *
 * @param data - SVG path data or SVG markup string
 * @param x - PDF X position (left edge of rendering area)
 * @param y - PDF Y position (top edge, Y increases upward)
 * @param w - Display width in points
 * @param h - Display height in points
 * @param options - Fill, stroke, viewBox options
 * @returns PDF content stream operators string
 */
export function renderSvg(
    data: string,
    x: number, y: number,
    w: number, h: number,
    options?: SvgRenderOptions,
): string {
    if (!data || w <= 0 || h <= 0) return '';

    const isSvgMarkup = data.trimStart().charAt(0) === '<';

    // Resolve viewBox and elements
    let vb: readonly [number, number, number, number];
    let elements: ParsedElement[];

    if (isSvgMarkup) {
        const parsed = parseSvgMarkup(data);
        vb = options?.viewBox ?? parsed.viewBox ?? [0, 0, w, h];
        elements = parsed.elements;
    } else {
        vb = options?.viewBox ?? [0, 0, w, h];
        elements = [{ pathData: data }];
    }

    if (elements.length === 0 || vb[2] <= 0 || vb[3] <= 0) return '';

    // Coordinate transform matrix: SVG (Y-down) → PDF (Y-up)
    // [a 0 0 d e f] where a = scaleX, d = -scaleY (Y-flip), e/f = translation
    const sx = w / vb[2];
    const sy = h / vb[3];
    const cmOp = `${fn(sx)} 0 0 ${fn(-sy)} ${fn(x - vb[0] * sx)} ${fn(y + vb[1] * sy)} cm`;

    // Default colors: fill=black, stroke=none (SVG defaults)
    const defaultFill = resolveColor(options?.fill as string | undefined, '0 0 0');
    const defaultStroke = resolveColor(options?.stroke as string | undefined, null);
    const defaultSw = options?.strokeWidth ?? 1;

    // Build operators: outer q/Q for CM, inner q/Q per element for colors
    const allOps: string[] = ['q', cmOp];

    for (const elem of elements) {
        const segments = parseSvgPath(elem.pathData);
        if (segments.length === 0) continue;

        const fillRgb = resolveColor(elem.fill, defaultFill);
        const strokeRgb = resolveColor(elem.stroke, defaultStroke);
        const sw = elem.strokeWidth ?? defaultSw;

        allOps.push(buildPathOps(segments, fillRgb, strokeRgb, sw));
    }

    allOps.push('Q');
    return allOps.join('\n');
}
