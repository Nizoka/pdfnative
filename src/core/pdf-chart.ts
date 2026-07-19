/**
 * pdfnative — Native vector charts (v1.6.0)
 * ============================================
 * Renders {@link ChartBlock}s as pure PDF path operators — rectangles, line
 * segments and cubic-Bézier arcs — with zero dependencies and no rasterisation.
 * Bar / horizontal-bar / line charts support multiple series; pie / donut take
 * a single series. All text (title, axis labels, legend, slice percentages)
 * flows through the standard encoding pipeline, so CJK / RTL / emoji labels
 * shape correctly.
 *
 * @module core/pdf-chart
 */

import type { ChartBlock, ChartSeries } from '../types/pdf-document-types.js';
import type { EncodingContext } from '../types/pdf-types.js';
import type { PdfColor } from '../types/pdf-types.js';
import { parseColor } from './pdf-color.js';
import { txt, fmtNum } from './pdf-text.js';
import { helveticaWidth } from '../fonts/encoding.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import type { TagContext } from './pdf-renderers.js';

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 460;
const DEFAULT_HEIGHT = 240;
const TITLE_SIZE = 12;
const LABEL_SIZE = 8;
const LEGEND_SIZE = 9;
const AXIS_GAP = 6;
const BLOCK_GAP = 8;
const MAX_POINTS = 10_000;

/** Brand-neutral categorical palette (deterministic). */
const PALETTE: readonly string[] = [
    '#4e79a7', '#f28e2b', '#59a14f', '#e15759',
    '#76b7b2', '#edc948', '#b07aa1', '#ff9da7',
];

// ── Public: height estimate (pagination) ─────────────────────────────

/** Total footprint of a chart block (title + plot + axis labels + legend). */
export function estimateChartHeight(block: ChartBlock): number {
    const plotH = block.height ?? DEFAULT_HEIGHT;
    const titleH = block.title ? TITLE_SIZE + 8 : 0;
    const axisH = block.chartType === 'pie' || block.chartType === 'donut' ? 0 : LABEL_SIZE + AXIS_GAP + 4;
    const legendH = resolveLegend(block) ? LEGEND_SIZE + 10 : 0;
    return titleH + plotH + axisH + legendH + BLOCK_GAP;
}

function resolveLegend(block: ChartBlock): boolean {
    if (block.legend === 'none') return false;
    if (block.legend === 'bottom') return true;
    // Default: legend for multi-series or pie/donut.
    return block.series.length > 1 || block.chartType === 'pie' || block.chartType === 'donut';
}

// ── Validation ───────────────────────────────────────────────────────

function validate(block: ChartBlock): void {
    if (!Array.isArray(block.series) || block.series.length === 0) {
        throw new Error('chart: at least one data series is required');
    }
    const isPie = block.chartType === 'pie' || block.chartType === 'donut';
    if (isPie && block.series.length !== 1) {
        throw new Error('chart: pie/donut charts take exactly one series');
    }
    const catCount = block.categories?.length;
    let total = 0;
    for (const s of block.series) {
        if (!Array.isArray(s.values) || s.values.length === 0) {
            throw new Error(`chart: series "${s.label}" has no values`);
        }
        for (const v of s.values) {
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                throw new Error(`chart: series "${s.label}" contains a non-finite value`);
            }
            if (isPie && v < 0) throw new Error('chart: pie/donut values must be non-negative');
        }
        if (catCount !== undefined && s.values.length !== catCount) {
            throw new Error(`chart: series "${s.label}" length (${s.values.length}) does not match categories (${catCount})`);
        }
        total += s.values.length;
    }
    if (total > MAX_POINTS) {
        throw new Error(`chart: too many data points (${total} > ${MAX_POINTS})`);
    }
}

// ── "Nice" axis ticks ────────────────────────────────────────────────

/** Compute rounded tick bounds/step covering [min, max] (1/2/5×10ⁿ). */
export function niceTicks(min: number, max: number, target = 5): { lo: number; hi: number; step: number } {
    if (min === max) { max = min + 1; if (min > 0) min = 0; }
    if (min > 0) min = 0;               // bar/line baseline at zero when all positive
    if (max < 0) max = 0;
    const range = max - min || 1;
    const rawStep = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = niceNorm * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    return { lo, hi, step };
}

function formatTick(v: number): string {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
    return Number.isInteger(v) ? String(v) : Number(v.toFixed(2)).toString();
}

// ── Colours ──────────────────────────────────────────────────────────

function seriesColor(block: ChartBlock, index: number, s?: ChartSeries): string {
    const explicit = s?.color ?? block.colors?.[index];
    return parseColor(explicit ?? (PALETTE[index % PALETTE.length] as PdfColor));
}

// ── Rendering entry point ────────────────────────────────────────────

/**
 * Render a chart block. Mirrors the other block renderers: consumes the top
 * `y`, returns the PDF operators and the new `y`.
 */
export function renderChartBlock(
    block: ChartBlock,
    y: number,
    mgL: number,
    cw: number,
    enc: EncodingContext,
    tagCtx?: TagContext,
    documentChildren?: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    validate(block);

    const width = Math.min(block.width ?? DEFAULT_WIDTH, cw);
    const plotH = block.height ?? DEFAULT_HEIGHT;
    let bx = mgL;
    if (block.align === 'center') bx = mgL + (cw - width) / 2;
    else if (block.align === 'right') bx = mgL + cw - width;

    const body: string[] = [];
    let cursor = y;

    // Title.
    if (block.title) {
        cursor -= TITLE_SIZE;
        body.push(txt(block.title, bx, cursor, '/F2', TITLE_SIZE, enc));
        cursor -= 8;
    }

    const isPie = block.chartType === 'pie' || block.chartType === 'donut';
    const legend = resolveLegend(block);

    if (isPie) {
        body.push(...renderPie(block, bx, cursor, width, plotH, enc));
    } else {
        body.push(...renderCartesian(block, bx, cursor, width, plotH, enc));
    }
    cursor -= plotH;
    if (!isPie) cursor -= LABEL_SIZE + AXIS_GAP + 4;

    // Legend.
    if (legend) {
        cursor -= LEGEND_SIZE + 4;
        body.push(...renderLegend(block, bx, cursor, width, enc));
        cursor -= 6;
    }

    // Wrap for tagged PDF as a /Figure with /Alt.
    const ops: string[] = [];
    if (tagCtx?.tagged) {
        const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        const alt = block.altText ?? autoAlt(block);
        const altHex = Array.from(alt).map(c => (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join('');
        ops.push(`/Figure << /MCID ${mcid} /Alt <FEFF${altHex}> >> BDC`);
        ops.push(...body);
        ops.push('EMC');
        documentChildren?.push({ type: 'Figure', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
    } else {
        ops.push(...body);
    }

    return { ops, y: y - estimateChartHeight(block) };
}

function autoAlt(block: ChartBlock): string {
    const kind = block.chartType;
    const cats = block.categories?.length ?? block.series[0].values.length;
    return `${kind} chart: ${block.series.length} series, ${cats} ${cats === 1 ? 'category' : 'categories'}`;
}

// ── Cartesian (bar / barH / line) ────────────────────────────────────

function renderCartesian(
    block: ChartBlock, bx: number, top: number, width: number, plotH: number, enc: EncodingContext,
): string[] {
    const ops: string[] = [];
    const horizontal = block.chartType === 'barH';

    // Value range across all series.
    let dataMin = Infinity, dataMax = -Infinity;
    for (const s of block.series) for (const v of s.values) { dataMin = Math.min(dataMin, v); dataMax = Math.max(dataMax, v); }
    const axisMin = block.axis?.yMin;
    const axisMax = block.axis?.yMax;
    const ticks = niceTicks(axisMin ?? dataMin, axisMax ?? dataMax, block.axis?.ticks ?? 5);
    const lo = axisMin ?? ticks.lo;
    const hi = axisMax ?? ticks.hi;
    const span = hi - lo || 1;

    const catCount = block.categories?.length ?? block.series[0].values.length;
    const labels = block.categories ?? Array.from({ length: catCount }, (_, i) => String(i + 1));

    // Plot rectangle: leave a gutter for axis labels.
    const gutter = 34;
    const plotX = bx + gutter;
    const plotW = width - gutter;
    const plotTop = top;
    const plotBottom = top - plotH;

    // Gridlines + value-axis tick labels.
    const drawGrid = block.axis?.grid ?? true;
    ops.push('0.85 0.85 0.85 RG', '0.5 w');
    for (let t = ticks.lo; t <= hi + 1e-9; t += ticks.step) {
        if (t < lo - 1e-9) continue;
        const frac = (t - lo) / span;
        if (horizontal) {
            const x = plotX + frac * plotW;
            if (drawGrid) ops.push(`${fmtNum(x)} ${fmtNum(plotBottom)} m ${fmtNum(x)} ${fmtNum(plotTop)} l S`);
            ops.push('0 0 0 rg', txtCentered(formatTick(t), x, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc), '');
        } else {
            const yv = plotBottom + frac * plotH;
            if (drawGrid) ops.push(`${fmtNum(plotX)} ${fmtNum(yv)} m ${fmtNum(plotX + plotW)} ${fmtNum(yv)} l S`);
            ops.push('0 0 0 rg', txtRightAligned(formatTick(t), plotX - 4, yv - LABEL_SIZE / 2 + 1, LABEL_SIZE, enc));
        }
    }

    // Axes.
    ops.push('0.4 0.4 0.4 RG', '0.8 w');
    ops.push(`${fmtNum(plotX)} ${fmtNum(plotBottom)} m ${fmtNum(plotX)} ${fmtNum(plotTop)} l S`);
    ops.push(`${fmtNum(plotX)} ${fmtNum(plotBottom)} m ${fmtNum(plotX + plotW)} ${fmtNum(plotBottom)} l S`);

    const zeroFrac = (0 - lo) / span;

    if (block.chartType === 'line') {
        // Category positions centred in equal slots.
        const slot = plotW / catCount;
        block.series.forEach((s, si) => {
            const color = seriesColor(block, si, s);
            ops.push(`${color} RG`, '1.5 w');
            let path = '';
            s.values.forEach((v, ci) => {
                const x = plotX + slot * (ci + 0.5);
                const yv = plotBottom + ((v - lo) / span) * plotH;
                path += `${ci === 0 ? '' : ' '}${fmtNum(x)} ${fmtNum(yv)} ${ci === 0 ? 'm' : 'l'}`;
            });
            ops.push(`${path} S`);
            if (block.markers) {
                ops.push(`${color} rg`);
                s.values.forEach((v, ci) => {
                    const x = plotX + slot * (ci + 0.5);
                    const yv = plotBottom + ((v - lo) / span) * plotH;
                    ops.push(circleFill(x, yv, 2.2));
                });
            }
        });
        // Category labels.
        ops.push('0 0 0 rg');
        labels.forEach((lab, ci) => {
            const x = plotX + slot * (ci + 0.5);
            ops.push(txtCentered(lab, x, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc));
        });
    } else if (horizontal) {
        // Horizontal grouped bars.
        const slot = plotH / catCount;
        const nSeries = block.series.length;
        const barH = (slot * 0.7) / nSeries;
        labels.forEach((lab, ci) => {
            const slotTop = plotTop - slot * ci;
            block.series.forEach((s, si) => {
                const v = s.values[ci];
                const x0 = plotX + zeroFrac * plotW;
                const x1 = plotX + ((v - lo) / span) * plotW;
                const yb = slotTop - slot * 0.15 - barH * si;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(Math.min(x0, x1))} ${fmtNum(yb - barH)} ${fmtNum(Math.abs(x1 - x0))} ${fmtNum(barH)} re f`);
            });
            ops.push('0 0 0 rg', txtRightAligned(lab, plotX - 4, slotTop - slot / 2 - LABEL_SIZE / 2, LABEL_SIZE, enc));
        });
    } else {
        // Vertical grouped bars.
        const slot = plotW / catCount;
        const nSeries = block.series.length;
        const barW = (slot * 0.7) / nSeries;
        const zeroY = plotBottom + zeroFrac * plotH;
        labels.forEach((lab, ci) => {
            const slotX = plotX + slot * ci;
            block.series.forEach((s, si) => {
                const v = s.values[ci];
                const yv = plotBottom + ((v - lo) / span) * plotH;
                const xb = slotX + slot * 0.15 + barW * si;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(xb)} ${fmtNum(Math.min(zeroY, yv))} ${fmtNum(barW)} ${fmtNum(Math.abs(yv - zeroY))} re f`);
            });
            ops.push('0 0 0 rg', txtCentered(lab, slotX + slot / 2, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc));
        });
    }

    return ops.filter(Boolean);
}

// ── Pie / donut ──────────────────────────────────────────────────────

function renderPie(
    block: ChartBlock, bx: number, top: number, width: number, plotH: number, enc: EncodingContext,
): string[] {
    const ops: string[] = [];
    const values = block.series[0].values;
    const labels = block.categories ?? values.map((_, i) => String(i + 1));
    const total = values.reduce((a, b) => a + b, 0) || 1;

    const cx = bx + width / 2;
    const cy = top - plotH / 2;
    const radius = Math.min(width, plotH) / 2 - 4;
    const innerR = block.chartType === 'donut' ? radius * 0.55 : 0;

    let angle = Math.PI / 2; // start at 12 o'clock
    values.forEach((v, i) => {
        const sweep = (v / total) * Math.PI * 2;
        const end = angle - sweep; // clockwise
        ops.push(`${seriesColor(block, i)} rg`);
        ops.push(wedgePath(cx, cy, radius, innerR, angle, end));
        ops.push('f');
        // Percentage label at the slice mid-angle.
        if (v / total >= 0.05) {
            const mid = (angle + end) / 2;
            const lr = innerR > 0 ? (radius + innerR) / 2 : radius * 0.6;
            const lx = cx + Math.cos(mid) * lr;
            const ly = cy + Math.sin(mid) * lr;
            ops.push('1 1 1 rg', txtCentered(`${Math.round((v / total) * 100)}%`, lx, ly - LABEL_SIZE / 2, LABEL_SIZE, enc));
        }
        angle = end;
    });
    // Reference labels unused here; the legend carries series names.
    void labels;
    return ops.filter(Boolean);
}

/** Build a pie/donut wedge path (outer arc + optional inner arc). */
function wedgePath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
    const parts: string[] = [];
    if (rInner <= 0) {
        parts.push(`${fmtNum(cx)} ${fmtNum(cy)} m`);
        parts.push(`${fmtNum(cx + Math.cos(a0) * rOuter)} ${fmtNum(cy + Math.sin(a0) * rOuter)} l`);
        parts.push(arcBeziers(cx, cy, rOuter, a0, a1));
        parts.push('h');
    } else {
        parts.push(`${fmtNum(cx + Math.cos(a0) * rOuter)} ${fmtNum(cy + Math.sin(a0) * rOuter)} m`);
        parts.push(arcBeziers(cx, cy, rOuter, a0, a1));
        parts.push(`${fmtNum(cx + Math.cos(a1) * rInner)} ${fmtNum(cy + Math.sin(a1) * rInner)} l`);
        parts.push(arcBeziers(cx, cy, rInner, a1, a0));
        parts.push('h');
    }
    return parts.join(' ');
}

/** Approximate an arc (a0→a1, may be either direction) with cubic Béziers. */
function arcBeziers(cx: number, cy: number, r: number, a0: number, a1: number): string {
    const segments = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    const delta = (a1 - a0) / segments;
    const k = (4 / 3) * Math.tan(delta / 4);
    let out = '';
    let ang = a0;
    for (let i = 0; i < segments; i++) {
        const next = ang + delta;
        const x1 = cx + Math.cos(ang) * r;
        const y1 = cy + Math.sin(ang) * r;
        const x2 = cx + Math.cos(next) * r;
        const y2 = cy + Math.sin(next) * r;
        const c1x = x1 - k * r * Math.sin(ang);
        const c1y = y1 + k * r * Math.cos(ang);
        const c2x = x2 + k * r * Math.sin(next);
        const c2y = y2 - k * r * Math.cos(next);
        out += ` ${fmtNum(c1x)} ${fmtNum(c1y)} ${fmtNum(c2x)} ${fmtNum(c2y)} ${fmtNum(x2)} ${fmtNum(y2)} c`;
        ang = next;
    }
    return out.trim();
}

function circleFill(cx: number, cy: number, r: number): string {
    return `${wedgePath(cx, cy, r, 0, Math.PI / 2, Math.PI / 2 - Math.PI * 2)} f`;
}

// ── Legend ───────────────────────────────────────────────────────────

function renderLegend(
    block: ChartBlock, bx: number, y: number, width: number, enc: EncodingContext,
): string[] {
    const ops: string[] = [];
    const isPie = block.chartType === 'pie' || block.chartType === 'donut';
    const entries = isPie
        ? (block.categories ?? block.series[0].values.map((_, i) => String(i + 1)))
        : block.series.map(s => s.label);

    // Lay out left-to-right, wrapping is not needed for the common case.
    const sw = 9; // swatch size
    const gap = 6;
    let x = bx;
    entries.forEach((label, i) => {
        const color = seriesColor(block, i, isPie ? undefined : block.series[i]);
        ops.push(`${color} rg`, `${fmtNum(x)} ${fmtNum(y)} ${sw} ${sw} re f`);
        x += sw + 3;
        ops.push('0 0 0 rg', txt(label, x, y, '/F1', LEGEND_SIZE, enc));
        x += helveticaWidth(label, LEGEND_SIZE) + gap * 2;
        if (x > bx + width - 40 && i < entries.length - 1) { x = bx; y -= LEGEND_SIZE + 4; }
    });
    return ops;
}

// ── Small text helpers ───────────────────────────────────────────────

function txtCentered(str: string, cx: number, y: number, sz: number, enc: EncodingContext): string {
    const w = enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(str, sz);
    return txt(str, cx - w / 2, y, '/F1', sz, enc);
}

function txtRightAligned(str: string, rightX: number, y: number, sz: number, enc: EncodingContext): string {
    const w = enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(str, sz);
    return txt(str, rightX - w, y, '/F1', sz, enc);
}
