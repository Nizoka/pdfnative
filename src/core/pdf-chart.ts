/**
 * pdfnative — Native vector charts (v1.6.0, extended v1.7.0)
 * ============================================
 * Renders {@link ChartBlock}s as pure PDF path operators — rectangles, line
 * segments and cubic-Bézier arcs — with zero dependencies and no rasterisation.
 * Bar / horizontal-bar / line charts support multiple series; pie / donut take
 * a single series. v1.7.0 adds stacked bars, area, scatter, a secondary right
 * axis, log and time scales, per-point data labels, and x-label collision
 * handling (auto stride + rotation). All text (title, axis labels, legend,
 * slice percentages) flows through the standard encoding pipeline, so
 * CJK / RTL / emoji labels shape correctly.
 *
 * Determinism: time-axis ticks are computed and formatted exclusively with
 * UTC getters — never `Intl` or the host time zone — so output bytes are
 * identical across machines. Area fills mix the series colour toward white
 * instead of using transparency (`/ExtGState` alpha is forbidden in
 * PDF/A-1b).
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
    const axisH = block.chartType === 'pie' || block.chartType === 'donut' ? 0 : xLabelBandHeight(block);
    const legendH = resolveLegend(block) ? LEGEND_SIZE + 10 : 0;
    return titleH + plotH + axisH + legendH + BLOCK_GAP;
}

/**
 * Height of the x-axis label band below the plot. Equals the historical
 * `LABEL_SIZE + AXIS_GAP + 4` unless labels are rotated, in which case the
 * band grows by the projected label extent (measured with the Helvetica
 * metric as a font-independent approximation, capped at 72pt) so pagination
 * and the legend position stay consistent with the drawn labels.
 */
function xLabelBandHeight(block: ChartBlock): number {
    const base = LABEL_SIZE + AXIS_GAP + 4;
    const rot = block.labelRotation ?? 0;
    if (rot <= 0) return base;
    const labels = block.categories ?? [];
    let maxW = 0;
    for (const lab of labels) maxW = Math.max(maxW, helveticaWidth(lab, LABEL_SIZE));
    const rad = (rot * Math.PI) / 180;
    const extent = maxW * Math.sin(rad) + LABEL_SIZE * Math.cos(rad);
    return Math.max(base, Math.min(72, extent + AXIS_GAP + 4));
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
    const isScatter = block.chartType === 'scatter';
    const xType = block.xAxis?.type ?? (isScatter ? 'linear' : 'category');
    const positional = xType !== 'category';
    if (positional && !(isScatter || block.chartType === 'line' || block.chartType === 'area')) {
        throw new Error(`chart: xAxis.type '${xType}' applies only to line/area/scatter charts`);
    }
    if (isScatter && !positional) {
        throw new Error("chart: scatter charts need a positional x-axis ('linear' or 'time') — xAxis.type 'category' is not supported");
    }
    if (isScatter && (block.labelStride !== undefined || block.labelRotation !== undefined)) {
        throw new Error('chart: labelStride/labelRotation apply to category axes only');
    }
    if (block.labelStride !== undefined
        && (!Number.isInteger(block.labelStride) || block.labelStride < 1)) {
        throw new Error('chart: labelStride must be an integer >= 1');
    }
    if (block.labelRotation !== undefined
        && (!Number.isFinite(block.labelRotation) || block.labelRotation < 0 || block.labelRotation > 90)) {
        throw new Error('chart: labelRotation must be between 0 and 90 degrees');
    }
    const hasRight = block.series.some(s => s.yAxis === 'right');
    if (hasRight && isPie) throw new Error('chart: yAxis binding applies to cartesian charts only');
    if (block.axis?.scale === 'log' || block.axis2?.scale === 'log') {
        const stacked = block.chartType === 'stackedBar' || block.chartType === 'stackedBarH';
        if (stacked) throw new Error('chart: log scale cannot be combined with stacked charts');
    }
    const checkLogPositive = (axis: 'left' | 'right', scale?: 'linear' | 'log', yMin?: number, yMax?: number): void => {
        if (scale !== 'log') return;
        if ((yMin !== undefined && yMin <= 0) || (yMax !== undefined && yMax <= 0)) {
            throw new Error('chart: log-scale axis bounds must be > 0');
        }
        for (const s of block.series) {
            if ((s.yAxis ?? 'left') !== axis) continue;
            for (const v of s.values) {
                if (v <= 0) throw new Error(`chart: series "${s.label}" has non-positive values on a log axis`);
            }
        }
    };
    checkLogPositive('left', block.axis?.scale, block.axis?.yMin, block.axis?.yMax);
    checkLogPositive('right', block.axis2?.scale, block.axis2?.yMin, block.axis2?.yMax);
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
        if (catCount !== undefined && !positional && s.values.length !== catCount) {
            throw new Error(`chart: series "${s.label}" length (${s.values.length}) does not match categories (${catCount})`);
        }
        if (positional) {
            if (!s.xValues) {
                throw new Error(`chart: series "${s.label}" needs xValues for xAxis.type '${xType}'`);
            }
            if (s.xValues.length !== s.values.length) {
                throw new Error(`chart: series "${s.label}" xValues length (${s.xValues.length}) does not match values (${s.values.length})`);
            }
            for (const x of s.xValues) parseXValue(x, xType, s.label);
        }
        total += s.values.length;
    }
    if (total > MAX_POINTS) {
        throw new Error(`chart: too many data points (${total} > ${MAX_POINTS})`);
    }
}

/** Parse an x position: numbers pass through, strings must be ISO-8601 dates. */
function parseXValue(x: number | string, xType: string, seriesLabel: string): number {
    if (typeof x === 'number') {
        if (!Number.isFinite(x)) throw new Error(`chart: series "${seriesLabel}" contains a non-finite x value`);
        return x;
    }
    // Determinism: ECMA-262 parses an offset-less date-TIME form in the host
    // local time zone (date-only forms are UTC). Normalize such strings to
    // UTC so output bytes are identical across machines, as the module
    // header promises.
    const normalized = /T\d{2}/.test(x) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(x) ? `${x}Z` : x;
    const t = Date.parse(normalized);
    if (Number.isNaN(t)) {
        throw new Error(`chart: series "${seriesLabel}" x value "${x}" is not a parseable ISO-8601 date`);
    }
    if (xType !== 'time') {
        throw new Error(`chart: series "${seriesLabel}" uses date strings — set xAxis.type to 'time'`);
    }
    return t;
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

// ── Value scales (linear / log) ──────────────────────────────────────

/** Resolved value axis: bounds, position fraction, and tick values. */
interface ValueScale {
    readonly lo: number;
    readonly hi: number;
    frac01(v: number): number;
    tickList(): number[];
}

interface ValueAxisOptions {
    readonly yMin?: number;
    readonly yMax?: number;
    readonly ticks?: number;
    readonly scale?: 'linear' | 'log';
}

/**
 * Linear scale — reproduces the historical tick computation exactly
 * (same `niceTicks` bounds and the same float accumulation), so charts
 * that only use the linear axis render byte-identically to v1.6.0.
 */
function makeLinearScale(dataMin: number, dataMax: number, axis?: ValueAxisOptions): ValueScale {
    const t = niceTicks(axis?.yMin ?? dataMin, axis?.yMax ?? dataMax, axis?.ticks ?? 5);
    const lo = axis?.yMin ?? t.lo;
    const hi = axis?.yMax ?? t.hi;
    const span = hi - lo || 1;
    return {
        lo, hi,
        frac01: (v: number): number => Math.max(0, Math.min(1, (v - lo) / span)),
        tickList: (): number[] => {
            const out: number[] = [];
            for (let tv = t.lo; tv <= hi + 1e-9; tv += t.step) {
                if (tv < lo - 1e-9) continue;
                out.push(tv);
            }
            return out;
        },
    };
}

/** Log₁₀ scale: decade ticks, with 2× / 5× minors when the span is short. */
function makeLogScale(dataMin: number, dataMax: number, axis?: ValueAxisOptions): ValueScale {
    const lo = axis?.yMin ?? Math.pow(10, Math.floor(Math.log10(dataMin)));
    const hi = axis?.yMax ?? Math.pow(10, Math.ceil(Math.log10(Math.max(dataMax, dataMin))));
    if (!(lo > 0) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new Error('chart: log-scale axis requires positive data — bind a series with positive values to this axis or set yMin/yMax > 0');
    }
    const llo = Math.log10(lo);
    const lhi = Math.log10(hi);
    const span = lhi - llo || 1;
    return {
        lo, hi,
        frac01: (v: number): number => v <= 0 ? 0 : Math.max(0, Math.min(1, (Math.log10(v) - llo) / span)),
        tickList: (): number[] => {
            const out: number[] = [];
            const withMinors = span <= 2.5;
            for (let d = Math.floor(llo); d <= Math.ceil(lhi); d++) {
                for (const m of withMinors ? [1, 2, 5] : [1]) {
                    const tv = m * Math.pow(10, d);
                    if (tv >= lo * (1 - 1e-9) && tv <= hi * (1 + 1e-9)) out.push(tv);
                }
            }
            return out;
        },
    };
}

function makeValueScale(dataMin: number, dataMax: number, axis?: ValueAxisOptions): ValueScale {
    return axis?.scale === 'log' ? makeLogScale(dataMin, dataMax, axis) : makeLinearScale(dataMin, dataMax, axis);
}

// ── X scales (linear / time) ─────────────────────────────────────────

interface XTick { readonly v: number; readonly label: string }

interface XScale {
    frac01(x: number): number;
    tickList(): XTick[];
}

/** Rounded bounds/step without the zero-baseline clamp (x axes only). */
function niceRange(min: number, max: number, target: number): { lo: number; hi: number; step: number } {
    if (min === max) max = min + 1;
    const range = max - min;
    const rawStep = range / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    const step = niceNorm * mag;
    return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

function makeLinearXScale(min: number, max: number, target: number): XScale {
    const r = niceRange(min, max, target);
    const span = r.hi - r.lo || 1;
    return {
        frac01: (x: number): number => Math.max(0, Math.min(1, (x - r.lo) / span)),
        tickList: (): XTick[] => {
            const out: XTick[] = [];
            for (let tv = r.lo; tv <= r.hi + 1e-9; tv += r.step) out.push({ v: tv, label: formatTick(tv) });
            return out;
        },
    };
}

const MS_SECOND = 1000;
const MS_MINUTE = 60 * MS_SECOND;
const MS_HOUR = 60 * MS_MINUTE;
const MS_DAY = 24 * MS_HOUR;
/** Sub-month tick steps (fixed length in milliseconds). */
const TIME_STEPS: readonly number[] = [
    MS_SECOND, 5 * MS_SECOND, 15 * MS_SECOND, 30 * MS_SECOND,
    MS_MINUTE, 5 * MS_MINUTE, 15 * MS_MINUTE, 30 * MS_MINUTE,
    MS_HOUR, 3 * MS_HOUR, 6 * MS_HOUR, 12 * MS_HOUR,
    MS_DAY, 2 * MS_DAY, 7 * MS_DAY, 14 * MS_DAY,
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Format a UTC instant for a given tick step (never Intl / local TZ). */
function formatTimeTick(t: number, stepMs: number): string {
    const d = new Date(t);
    if (stepMs >= 365 * MS_DAY) return String(d.getUTCFullYear());
    if (stepMs >= 28 * MS_DAY) return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    if (stepMs >= MS_DAY) return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    if (stepMs >= MS_MINUTE) return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * Time scale (UTC): fixed-length steps up to two weeks, then calendar
 * month/year steps aligned on UTC boundaries. Bounds are the raw data
 * (or explicit min/max) — the range is not nice-rounded.
 */
function makeTimeXScale(min: number, max: number, target: number): XScale {
    const span = max - min || 1;
    const frac01 = (x: number): number => Math.max(0, Math.min(1, (x - min) / span));
    for (const step of TIME_STEPS) {
        if (span / step <= target) {
            return {
                frac01,
                tickList: (): XTick[] => {
                    const out: XTick[] = [];
                    for (let tv = Math.ceil(min / step) * step; tv <= max + 1; tv += step) {
                        out.push({ v: tv, label: formatTimeTick(tv, step) });
                    }
                    return out;
                },
            };
        }
    }
    // Month steps aligned on UTC month starts.
    for (const months of [1, 2, 3, 6]) {
        if (span / (30 * MS_DAY * months) <= target) {
            return {
                frac01,
                tickList: (): XTick[] => {
                    const out: XTick[] = [];
                    const d0 = new Date(min);
                    const y = d0.getUTCFullYear();
                    let m = d0.getUTCMonth();
                    if (Date.UTC(y, m, 1) < min) m += 1;
                    m = Math.ceil(m / months) * months;
                    for (;;) {
                        const tv = Date.UTC(y, m, 1);
                        if (tv > max) break;
                        if (tv >= min) out.push({ v: tv, label: formatTimeTick(tv, 28 * MS_DAY) });
                        m += months;
                    }
                    return out;
                },
            };
        }
    }
    // Year steps: 1, 2, 5, 10, 20, 50, …
    let yStep = 1;
    while (span / (365 * MS_DAY * yStep) > target) {
        yStep = yStep === 1 ? 2 : yStep === 2 ? 5 : yStep * 2;
    }
    return {
        frac01,
        tickList: (): XTick[] => {
            const out: XTick[] = [];
            let y = Math.ceil(new Date(min).getUTCFullYear() / yStep) * yStep;
            for (;;) {
                const tv = Date.UTC(y, 0, 1);
                if (tv > max) break;
                if (tv >= min) out.push({ v: tv, label: formatTimeTick(tv, 365 * MS_DAY) });
                y += yStep;
            }
            return out;
        },
    };
}

// ── Data labels ──────────────────────────────────────────────────────

function fmtDataLabel(v: number, opt: ChartBlock['dataLabels']): string {
    if (typeof opt === 'object' && opt !== null) {
        const decimals = opt.decimals ?? (Number.isInteger(v) ? 0 : 1);
        return `${opt.prefix ?? ''}${v.toFixed(decimals)}${opt.suffix ?? ''}`;
    }
    return formatTick(v);
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
    if (!isPie) cursor -= xLabelBandHeight(block);

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

// ── Cartesian (bar / barH / line / stacked / area / scatter) ─────────

/** Mix an "R G B" operator colour toward white (0 = unchanged, 1 = white). */
function mixTowardWhite(rgb: string, amount: number): string {
    return rgb.split(' ')
        .map(c => fmtNum(Number(c) + (1 - Number(c)) * amount))
        .join(' ');
}

/**
 * Smallest label stride at which measured category labels no longer
 * overlap (issue #67): 1 when every label fits its slot. Explicit
 * `labelStride` wins; rotation defeats horizontal overlap on its own.
 */
function resolveStride(
    block: ChartBlock, labels: readonly string[], slot: number, enc: EncodingContext,
): number {
    if (block.labelStride !== undefined) return block.labelStride;
    if ((block.labelRotation ?? 0) > 0) return 1;
    let maxW = 0;
    for (const lab of labels) {
        const w = enc.isUnicode ? enc.tw(lab, LABEL_SIZE) : helveticaWidth(lab, LABEL_SIZE);
        maxW = Math.max(maxW, w);
    }
    return Math.max(1, Math.ceil((maxW + 4) / slot));
}

/**
 * A rotated category label: counter-clockwise by `deg`, right-aligned so
 * the text ends at its tick and reads upward toward it (same text-matrix
 * math as the watermark renderer). The `cm` transform wraps the standard
 * `txt()` output, so multi-run CJK/RTL/emoji labels rotate as one unit.
 */
function txtRotatedTick(
    str: string, x: number, y: number, sz: number, enc: EncodingContext, deg: number,
): string {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const w = enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(str, sz);
    return `q ${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} ${fmtNum(x)} ${fmtNum(y)} cm ${txt(str, -w, 0, '/F1', sz, enc)} Q`;
}

function renderCartesian(
    block: ChartBlock, bx: number, top: number, width: number, plotH: number, enc: EncodingContext,
): string[] {
    const ops: string[] = [];
    const kind = block.chartType;
    const horizontal = kind === 'barH' || kind === 'stackedBarH';
    const stacked = kind === 'stackedBar' || kind === 'stackedBarH';
    const isScatter = kind === 'scatter';
    const xType = block.xAxis?.type ?? (isScatter ? 'linear' : 'category');
    const positional = xType !== 'category';
    const rightSeries = block.series.filter(s => s.yAxis === 'right');
    const hasRightAxis = rightSeries.length > 0;
    const dataLabels = block.dataLabels === true || (typeof block.dataLabels === 'object' && block.dataLabels !== null)
        ? block.dataLabels : undefined;

    // Value range per axis. Stacked charts range over per-category positive
    // and negative running totals; everything else over the raw values.
    let dataMin = Infinity, dataMax = -Infinity;
    let dataMin2 = Infinity, dataMax2 = -Infinity;
    if (stacked) {
        const n = block.series[0].values.length;
        for (let ci = 0; ci < n; ci++) {
            let pos = 0, neg = 0;
            for (const s of block.series) {
                const v = s.values[ci] ?? 0;
                if (v >= 0) pos += v; else neg += v;
            }
            dataMin = Math.min(dataMin, neg);
            dataMax = Math.max(dataMax, pos);
        }
    } else {
        for (const s of block.series) {
            const isRight = s.yAxis === 'right';
            for (const v of s.values) {
                if (isRight) { dataMin2 = Math.min(dataMin2, v); dataMax2 = Math.max(dataMax2, v); }
                else { dataMin = Math.min(dataMin, v); dataMax = Math.max(dataMax, v); }
            }
        }
        if (dataMin === Infinity) { dataMin = 0; dataMax = 1; } // all series bound right
    }
    const scale = makeValueScale(dataMin, dataMax, block.axis);
    const scale2 = hasRightAxis ? makeValueScale(dataMin2, dataMax2, block.axis2) : null;
    const scaleFor = (s: ChartSeries): ValueScale => (s.yAxis === 'right' && scale2 ? scale2 : scale);

    const catCount = block.categories?.length ?? block.series[0].values.length;
    const labels = block.categories ?? Array.from({ length: catCount }, (_, i) => String(i + 1));

    // Plot rectangle: leave a gutter for axis labels (right gutter only
    // when a secondary axis is present — keeps v1.6.0 geometry otherwise).
    const gutter = 34;
    const plotX = bx + gutter;
    const plotW = width - gutter - (hasRightAxis ? gutter : 0);
    const plotTop = top;
    const plotBottom = top - plotH;

    // X scale for positional (linear/time) axes.
    let xScale: XScale | null = null;
    if (positional) {
        let xMin = Infinity, xMax = -Infinity;
        for (const s of block.series) {
            for (const x of s.xValues ?? []) {
                const t = parseXValue(x, xType, s.label);
                xMin = Math.min(xMin, t);
                xMax = Math.max(xMax, t);
            }
        }
        if (block.xAxis?.min !== undefined) xMin = parseXValue(block.xAxis.min, xType, 'xAxis.min');
        if (block.xAxis?.max !== undefined) xMax = parseXValue(block.xAxis.max, xType, 'xAxis.max');
        const target = block.xAxis?.ticks ?? 5;
        xScale = xType === 'time' ? makeTimeXScale(xMin, xMax, target) : makeLinearXScale(xMin, xMax, target);
    }

    // Gridlines + value-axis tick labels.
    const drawGrid = block.axis?.grid ?? true;
    ops.push('0.85 0.85 0.85 RG', '0.5 w');
    for (const t of scale.tickList()) {
        const frac = scale.frac01(t);
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
    // Secondary-axis tick labels (right side, no grid — avoids clutter).
    if (scale2 && !horizontal) {
        ops.push('0 0 0 rg');
        for (const t of scale2.tickList()) {
            const yv = plotBottom + scale2.frac01(t) * plotH;
            ops.push(txt(formatTick(t), plotX + plotW + 4, yv - LABEL_SIZE / 2 + 1, '/F1', LABEL_SIZE, enc));
        }
    }
    // X-axis gridlines + tick labels for positional axes.
    if (xScale) {
        const drawXGrid = block.xAxis?.grid ?? false;
        for (const tick of xScale.tickList()) {
            const x = plotX + xScale.frac01(tick.v) * plotW;
            if (drawXGrid) ops.push('0.85 0.85 0.85 RG', '0.5 w', `${fmtNum(x)} ${fmtNum(plotBottom)} m ${fmtNum(x)} ${fmtNum(plotTop)} l S`);
            ops.push('0 0 0 rg', txtCentered(tick.label, x, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc));
        }
    }

    // Axes.
    ops.push('0.4 0.4 0.4 RG', '0.8 w');
    ops.push(`${fmtNum(plotX)} ${fmtNum(plotBottom)} m ${fmtNum(plotX)} ${fmtNum(plotTop)} l S`);
    ops.push(`${fmtNum(plotX)} ${fmtNum(plotBottom)} m ${fmtNum(plotX + plotW)} ${fmtNum(plotBottom)} l S`);
    if (scale2 && !horizontal) {
        ops.push(`${fmtNum(plotX + plotW)} ${fmtNum(plotBottom)} m ${fmtNum(plotX + plotW)} ${fmtNum(plotTop)} l S`);
    }

    // Fraction of a value along the primary axis, clamped to [0, 1] so an
    // explicit yMin/yMax that excludes part of the data never draws outside
    // the plot.
    const frac01 = (v: number): number => scale.frac01(v);
    const zeroFrac = frac01(0);

    // Per-point data labels, emitted after the geometry of each branch.
    const pointLabel = (v: number, x: number, yv: number): string => {
        const yLab = v >= 0
            ? Math.min(yv + 2, plotTop - LABEL_SIZE - 1)
            : Math.max(yv - LABEL_SIZE - 2, plotBottom + 1);
        return txtCentered(fmtDataLabel(v, dataLabels), x, yLab, LABEL_SIZE, enc);
    };

    if (isScatter) {
        // Scatter: points positioned by xValues on a linear/time x-axis.
        block.series.forEach((s, si) => {
            const sc = scaleFor(s);
            ops.push(`${seriesColor(block, si, s)} rg`);
            s.values.forEach((v, ci) => {
                const xv = parseXValue((s.xValues ?? [])[ci], xType, s.label);
                const x = plotX + (xScale as XScale).frac01(xv) * plotW;
                const yv = plotBottom + sc.frac01(v) * plotH;
                ops.push(circleFill(x, yv, 2.2));
            });
            if (dataLabels) {
                ops.push('0 0 0 rg');
                s.values.forEach((v, ci) => {
                    const xv = parseXValue((s.xValues ?? [])[ci], xType, s.label);
                    const x = plotX + (xScale as XScale).frac01(xv) * plotW;
                    const yv = plotBottom + sc.frac01(v) * plotH;
                    ops.push(pointLabel(v, x, yv));
                });
            }
        });
    } else if (kind === 'line' || kind === 'area') {
        // Category positions centred in equal slots (or xValues positions).
        const slot = plotW / catCount;
        const xAt = (s: ChartSeries, ci: number): number => {
            if (xScale && s.xValues) return plotX + xScale.frac01(parseXValue(s.xValues[ci], xType, s.label)) * plotW;
            return plotX + slot * (ci + 0.5);
        };
        block.series.forEach((s, si) => {
            const color = seriesColor(block, si, s);
            const sc = scaleFor(s);
            const sFrac = (v: number): number => sc.frac01(v);
            if (kind === 'area') {
                // Filled polygon down to the zero baseline; the fill mixes the
                // series colour 35% toward white (no /ExtGState transparency —
                // PDF/A-1b forbids it), stroked with the full colour on top.
                const zeroY = plotBottom + sc.frac01(0) * plotH;
                let poly = '';
                s.values.forEach((v, ci) => {
                    const x = xAt(s, ci);
                    const yv = plotBottom + sFrac(v) * plotH;
                    poly += `${ci === 0 ? '' : ' '}${fmtNum(x)} ${fmtNum(yv)} ${ci === 0 ? 'm' : 'l'}`;
                });
                const xLast = xAt(s, s.values.length - 1);
                const xFirst = xAt(s, 0);
                ops.push(`${mixTowardWhite(color, 0.35)} rg`);
                ops.push(`${poly} ${fmtNum(xLast)} ${fmtNum(zeroY)} l ${fmtNum(xFirst)} ${fmtNum(zeroY)} l h f`);
            }
            ops.push(`${color} RG`, '1.5 w');
            let path = '';
            s.values.forEach((v, ci) => {
                const x = xAt(s, ci);
                const yv = plotBottom + sFrac(v) * plotH;
                path += `${ci === 0 ? '' : ' '}${fmtNum(x)} ${fmtNum(yv)} ${ci === 0 ? 'm' : 'l'}`;
            });
            ops.push(`${path} S`);
            if (block.markers) {
                ops.push(`${color} rg`);
                s.values.forEach((v, ci) => {
                    const x = xAt(s, ci);
                    const yv = plotBottom + sFrac(v) * plotH;
                    ops.push(circleFill(x, yv, 2.2));
                });
            }
            if (dataLabels) {
                ops.push('0 0 0 rg');
                s.values.forEach((v, ci) => {
                    const x = xAt(s, ci);
                    const yv = plotBottom + sFrac(v) * plotH;
                    ops.push(pointLabel(v, x, yv));
                });
            }
        });
        // Category labels (skipped when a positional x-axis draws its own).
        if (!xScale) {
            ops.push('0 0 0 rg');
            emitCategoryLabels(ops, block, labels, plotX, slot, plotBottom, enc);
        }
    } else if (horizontal && stacked) {
        // Horizontal stacked bars: one bar per category, segments run from
        // the running total, positives rightward and negatives leftward.
        const slot = plotH / catCount;
        const barH = slot * 0.7;
        labels.forEach((lab, ci) => {
            const slotTop = plotTop - slot * ci;
            const yb = slotTop - slot * 0.15;
            let pos = 0, neg = 0;
            block.series.forEach((s, si) => {
                const v = s.values[ci];
                const from = v >= 0 ? pos : neg;
                const to = from + v;
                if (v >= 0) pos = to; else neg = to;
                const x0 = plotX + frac01(from) * plotW;
                const x1 = plotX + frac01(to) * plotW;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(Math.min(x0, x1))} ${fmtNum(yb - barH)} ${fmtNum(Math.abs(x1 - x0))} ${fmtNum(barH)} re f`);
                if (dataLabels && Math.abs(x1 - x0) >= helveticaWidth(fmtDataLabel(v, dataLabels), LABEL_SIZE) + 4) {
                    ops.push('1 1 1 rg', txtCentered(fmtDataLabel(v, dataLabels), (x0 + x1) / 2, yb - barH / 2 - LABEL_SIZE / 2 + 1, LABEL_SIZE, enc));
                }
            });
            ops.push('0 0 0 rg', txtRightAligned(lab, plotX - 4, slotTop - slot / 2 - LABEL_SIZE / 2, LABEL_SIZE, enc));
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
                const x1 = plotX + frac01(v) * plotW;
                const yb = slotTop - slot * 0.15 - barH * si;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(Math.min(x0, x1))} ${fmtNum(yb - barH)} ${fmtNum(Math.abs(x1 - x0))} ${fmtNum(barH)} re f`);
                if (dataLabels) {
                    const lx = Math.max(x0, x1) + 3 + helveticaWidth(fmtDataLabel(v, dataLabels), LABEL_SIZE) / 2;
                    ops.push('0 0 0 rg', txtCentered(fmtDataLabel(v, dataLabels), Math.min(lx, plotX + plotW - 2), yb - barH / 2 - LABEL_SIZE / 2 + 1, LABEL_SIZE, enc));
                }
            });
            ops.push('0 0 0 rg', txtRightAligned(lab, plotX - 4, slotTop - slot / 2 - LABEL_SIZE / 2, LABEL_SIZE, enc));
        });
    } else if (stacked) {
        // Vertical stacked bars.
        const slot = plotW / catCount;
        const barW = slot * 0.7;
        labels.forEach((_lab, ci) => {
            const slotX = plotX + slot * ci;
            const xb = slotX + slot * 0.15;
            let pos = 0, neg = 0;
            block.series.forEach((s, si) => {
                const v = s.values[ci];
                const from = v >= 0 ? pos : neg;
                const to = from + v;
                if (v >= 0) pos = to; else neg = to;
                const y0 = plotBottom + frac01(from) * plotH;
                const y1 = plotBottom + frac01(to) * plotH;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(xb)} ${fmtNum(Math.min(y0, y1))} ${fmtNum(barW)} ${fmtNum(Math.abs(y1 - y0))} re f`);
                if (dataLabels && Math.abs(y1 - y0) >= LABEL_SIZE + 2) {
                    ops.push('1 1 1 rg', txtCentered(fmtDataLabel(v, dataLabels), xb + barW / 2, (y0 + y1) / 2 - LABEL_SIZE / 2 + 1, LABEL_SIZE, enc));
                }
            });
        });
        ops.push('0 0 0 rg');
        emitCategoryLabels(ops, block, labels, plotX, slot, plotBottom, enc);
    } else {
        // Vertical grouped bars.
        const slot = plotW / catCount;
        const nSeries = block.series.length;
        const barW = (slot * 0.7) / nSeries;
        const zeroY = plotBottom + zeroFrac * plotH;
        const stride = resolveStride(block, labels, slot, enc);
        const rotation = block.labelRotation ?? 0;
        labels.forEach((lab, ci) => {
            const slotX = plotX + slot * ci;
            block.series.forEach((s, si) => {
                const v = s.values[ci];
                const sc = scaleFor(s);
                const yv = plotBottom + sc.frac01(v) * plotH;
                const base = sc === scale ? zeroY : plotBottom + sc.frac01(0) * plotH;
                const xb = slotX + slot * 0.15 + barW * si;
                ops.push(`${seriesColor(block, si, s)} rg`);
                ops.push(`${fmtNum(xb)} ${fmtNum(Math.min(base, yv))} ${fmtNum(barW)} ${fmtNum(Math.abs(yv - base))} re f`);
                if (dataLabels) {
                    ops.push('0 0 0 rg', pointLabel(v, xb + barW / 2, yv));
                }
            });
            if (ci % stride === 0) {
                if (rotation > 0) {
                    ops.push('0 0 0 rg', txtRotatedTick(lab, slotX + slot / 2, plotBottom - 4, LABEL_SIZE, enc, rotation));
                } else {
                    ops.push('0 0 0 rg', txtCentered(lab, slotX + slot / 2, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc));
                }
            }
        });
    }

    return ops.filter(Boolean);
}

/** Category x-labels with stride + rotation (line/area/stackedBar). */
function emitCategoryLabels(
    ops: string[], block: ChartBlock, labels: readonly string[],
    plotX: number, slot: number, plotBottom: number, enc: EncodingContext,
): void {
    const stride = resolveStride(block, labels, slot, enc);
    const rotation = block.labelRotation ?? 0;
    labels.forEach((lab, ci) => {
        if (ci % stride !== 0) return;
        const x = plotX + slot * (ci + 0.5);
        if (rotation > 0) {
            ops.push(txtRotatedTick(lab, x, plotBottom - 4, LABEL_SIZE, enc, rotation));
        } else {
            ops.push(txtCentered(lab, x, plotBottom - LABEL_SIZE - 2, LABEL_SIZE, enc));
        }
    });
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
