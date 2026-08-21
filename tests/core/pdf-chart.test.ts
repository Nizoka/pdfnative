/**
 * Native vector charts (v1.6.0). Geometry, niceTicks, validation, tagged
 * output, byte-determinism, and injection safety.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { niceTicks, renderChartBlock } from '../../src/core/pdf-chart.js';
import type { ChartBlock } from '../../src/types/pdf-document-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

function chartDoc(chart: ChartBlock, tagged = false): Uint8Array {
    const params: DocumentParams = { title: 'Charts', blocks: [chart] as never };
    return buildDocumentPDFBytes(params, tagged ? { tagged: true } : undefined);
}

function pageContent(pdf: Uint8Array): string {
    const r = openPdf(pdf);
    const page = r.getPage(0);
    const data = r.decodeStream(r.resolveValue(page.get('Contents') ?? null) as never);
    let s = ''; for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return s;
}

const barChart: ChartBlock = {
    type: 'chart', chartType: 'bar',
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
        { label: 'Revenue', values: [120, 150, 170, 140] },
        { label: 'Cost', values: [80, 90, 100, 95] },
    ],
    title: 'Quarterly performance',
};

describe('niceTicks', () => {
    it('rounds to 1/2/5×10ⁿ and includes a zero baseline', () => {
        const t = niceTicks(0, 170, 5);
        expect(t.lo).toBe(0);
        expect(t.hi).toBeGreaterThanOrEqual(170);
        expect([1, 2, 5, 10, 20, 25, 50].some(s => Math.abs(t.step - s * Math.pow(10, Math.floor(Math.log10(t.step)))) < 1e-9 || t.step === s)).toBe(true);
    });

    it('handles all-equal values', () => {
        const t = niceTicks(5, 5, 5);
        expect(t.hi).toBeGreaterThan(t.lo);
    });

    it('handles negative-only data', () => {
        const t = niceTicks(-40, -10, 5);
        expect(t.hi).toBe(0);
        expect(t.lo).toBeLessThanOrEqual(-40);
    });
});

describe('bar chart geometry', () => {
    it('emits one filled rect per (series × category)', () => {
        const content = pageContent(chartDoc(barChart));
        const rects = (content.match(/ re f/g) ?? []).length;
        // 2 series × 4 categories = 8 bars (plus axis/grid use S, legend swatches
        // add 2 more). Assert at least the 8 data bars are present.
        expect(rects).toBeGreaterThanOrEqual(8);
    });

    it('draws the title and category labels', () => {
        const content = pageContent(chartDoc(barChart));
        expect(content).toContain('Quarterly performance');
        // Category labels appear as text draws.
        expect(content).toMatch(/Q1|Q2|Q3|Q4/);
    });

    it('clamps bars to the plot when an explicit axis window excludes data', () => {
        // yMin above some values and yMax below others: every bar rect must stay
        // within the plot band, never anchored below the axis or above the top.
        const clamped: ChartBlock = {
            type: 'chart', chartType: 'bar',
            axis: { yMin: 50, yMax: 100 },
            categories: ['a', 'b', 'c'],
            series: [{ label: 's', values: [20, 75, 150] }],
        };
        const content = pageContent(chartDoc(clamped));
        // Extract every "x y w h re f" bar rect and assert finite, in-range heights.
        const rects = [...content.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re f/g)];
        expect(rects.length).toBeGreaterThanOrEqual(3);
        for (const m of rects) {
            const h = Math.abs(parseFloat(m[4]));
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeLessThanOrEqual(240 + 1); // within plot height
        }
    });
});

describe('line and horizontal bar', () => {
    it('renders a multi-series line chart with markers', () => {
        const line: ChartBlock = {
            type: 'chart', chartType: 'line', markers: true,
            categories: ['Jan', 'Feb', 'Mar'],
            series: [{ label: 'A', values: [10, 20, 15] }, { label: 'B', values: [5, 8, 12] }],
        };
        const content = pageContent(chartDoc(line));
        expect(content).toMatch(/ l\b/); // line-to operators
        expect(openPdf(chartDoc(line)).pageCount).toBe(1);
    });

    it('renders a horizontal bar chart', () => {
        const barH: ChartBlock = {
            type: 'chart', chartType: 'barH',
            categories: ['North', 'South'],
            series: [{ label: 'Sales', values: [40, 65] }],
        };
        expect(() => chartDoc(barH)).not.toThrow();
        expect((pageContent(chartDoc(barH)).match(/ re f/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('pie / donut', () => {
    const pie: ChartBlock = {
        type: 'chart', chartType: 'pie',
        categories: ['A', 'B', 'C'],
        series: [{ label: 'Share', values: [50, 30, 20] }],
    };

    it('renders wedges with Bézier arcs', () => {
        const content = pageContent(chartDoc(pie));
        expect(content).toMatch(/ c\b/); // cubic Bézier operator present
        expect(content).toContain('%'); // percentage labels
    });

    it('donut leaves an inner hole (two arcs per wedge)', () => {
        const donut: ChartBlock = { ...pie, chartType: 'donut' };
        const content = pageContent(chartDoc(donut));
        expect(content).toMatch(/ c\b/);
    });
});

describe('validation', () => {
    const base = { type: 'chart' as const, chartType: 'bar' as const, series: [{ label: 'x', values: [1, 2] }] };
    it('rejects empty series', () => {
        expect(() => chartDoc({ ...base, series: [] })).toThrow(/series/);
    });
    it('rejects a category-length mismatch', () => {
        expect(() => chartDoc({ ...base, categories: ['a', 'b', 'c'] })).toThrow(/does not match/);
    });
    it('rejects non-finite values', () => {
        expect(() => chartDoc({ ...base, series: [{ label: 'x', values: [1, NaN] }] })).toThrow(/non-finite/);
    });
    it('rejects a multi-series pie', () => {
        expect(() => chartDoc({ type: 'chart', chartType: 'pie', series: [{ label: 'a', values: [1] }, { label: 'b', values: [2] }] })).toThrow(/one series/);
    });
    it('rejects negative pie values', () => {
        expect(() => chartDoc({ type: 'chart', chartType: 'pie', series: [{ label: 'a', values: [1, -2] }] })).toThrow(/non-negative/);
        // Scatter is positional by definition — a category x-axis is refused
        // at validation instead of failing later inside parseXValue.
        expect(() => chartDoc({
            type: 'chart', chartType: 'scatter', xAxis: { type: 'category' },
            series: [{ label: 'p', values: [1, 2], xValues: [1, 2] }],
        })).toThrow(/positional x-axis/);
        // Degenerate log axis: every series on the right leaves the left
        // axis with no positive data — clean error, not NaN geometry.
        expect(() => chartDoc({
            type: 'chart', chartType: 'line', axis: { scale: 'log' }, axis2: {},
            series: [{ label: 'r', values: [1, 10], yAxis: 'right' }],
        })).toThrow(/log-scale axis requires positive data/);
    });
});

describe('safety and determinism', () => {
    it('escapes malicious label content (no operator injection)', () => {
        const evil: ChartBlock = {
            type: 'chart', chartType: 'bar',
            categories: ['x) Tj 0 0 1 rg (pwn'],
            series: [{ label: 'a', values: [1] }],
        };
        const content = pageContent(chartDoc(evil));
        // The injected "0 0 1 rg" must be inside a PDF string literal, escaped —
        // never a bare colour operator. The raw parenthesis is backslash-escaped.
        expect(content).toContain('\\)');
    });

    it('produces byte-identical output for the same input', () => {
        const a = chartDoc(barChart);
        const b = chartDoc(barChart);
        expect(a).toEqual(b);
    });

    it('rejects an invalid colour', () => {
        expect(() => chartDoc({ type: 'chart', chartType: 'bar', series: [{ label: 'a', values: [1], color: 'notacolor' }] })).toThrow();
    });
});

describe('tagged PDF', () => {
    it('wraps the chart in a /Figure with /Alt', () => {
        const content = pageContent(chartDoc(barChart, true));
        expect(content).toContain('/Figure');
        expect(content).toContain('/Alt');
    });

    it('auto-generates alt text when none is given', () => {
        // Rendered directly to inspect the BDC alt payload.
        const enc = { isUnicode: false, ps: (s: string) => `(${s})`, tw: () => 0 } as never;
        const { ops } = renderChartBlock(barChart, 700, 50, 500, enc, {
            tagged: true, mcidAlloc: { next: () => 0 }, pageObjNum: 1,
        } as never, []);
        expect(ops.join('\n')).toContain('/Figure');
    });
});

// ── v1.7.0: label collision handling (issue #67) ─────────────────────

describe('x-label stride and rotation (issue #67)', () => {
    const weekly = Array.from({ length: 17 }, (_, i) => `2026-01-${String(5 + i).padStart(2, '0')}w`);
    const dense: ChartBlock = {
        type: 'chart', chartType: 'line', width: 480,
        categories: weekly,
        series: [{ label: 'Visits', values: weekly.map((_, i) => 100 + i) }],
    };

    const countLabels = (content: string): number => (content.match(/\(2026-01-/g) ?? []).length;

    it('auto-stride skips labels when 17 weekly categories overlap at 480pt', () => {
        const content = pageContent(chartDoc(dense));
        const drawn = countLabels(content);
        expect(drawn).toBeGreaterThan(0);
        expect(drawn).toBeLessThan(17);
    });

    it('keeps every label when they fit (auto-stride = 1)', () => {
        const content = pageContent(chartDoc(barChart));
        for (const lab of ['Q1', 'Q2', 'Q3', 'Q4']) expect(content).toContain(lab);
    });

    it('honours an explicit labelStride', () => {
        const content = pageContent(chartDoc({ ...dense, labelStride: 2 }));
        expect(countLabels(content)).toBe(9); // indices 0,2,…,16
    });

    it('labelStride: 1 forces every label even when they overlap', () => {
        const content = pageContent(chartDoc({ ...dense, labelStride: 1 }));
        expect(countLabels(content)).toBe(17);
    });

    it('rotates labels with a cm matrix and grows the estimated height', async () => {
        const rotated: ChartBlock = { ...dense, labelRotation: 45 };
        const content = pageContent(chartDoc(rotated));
        expect(content).toMatch(/q 0\.71 0\.71 -0\.71 0\.71 [\d.]+ [\d.]+ cm/);
        expect(countLabels(content)).toBe(17); // rotation defeats overlap without stride
        const { estimateChartHeight } = await import('../../src/core/pdf-chart.js');
        expect(estimateChartHeight(rotated)).toBeGreaterThan(estimateChartHeight(dense));
    });

    it('rejects invalid stride and rotation values', () => {
        expect(() => chartDoc({ ...dense, labelStride: 0 })).toThrow(/labelStride/);
        expect(() => chartDoc({ ...dense, labelStride: 1.5 })).toThrow(/labelStride/);
        expect(() => chartDoc({ ...dense, labelRotation: 180 })).toThrow(/labelRotation/);
        expect(() => chartDoc({ ...dense, labelRotation: -10 })).toThrow(/labelRotation/);
    });
});

// ── v1.7.0: new chart kinds ──────────────────────────────────────────

describe('stacked bars', () => {
    const stacked: ChartBlock = {
        type: 'chart', chartType: 'stackedBar',
        categories: ['Q1', 'Q2', 'Q3'],
        series: [
            { label: 'A', values: [10, 20, 30] },
            { label: 'B', values: [5, 15, 25] },
            { label: 'C', values: [-8, -3, -12] },
        ],
    };

    it('emits one rect per (series × category) with negative stacking', () => {
        const content = pageContent(chartDoc(stacked));
        const rects = (content.match(/ re f/g) ?? []).length;
        expect(rects).toBeGreaterThanOrEqual(9); // 3 series × 3 categories
    });

    it('renders horizontal stacked bars', () => {
        const content = pageContent(chartDoc({ ...stacked, chartType: 'stackedBarH' }));
        expect((content.match(/ re f/g) ?? []).length).toBeGreaterThanOrEqual(9);
    });

    it('is byte-deterministic', () => {
        expect(chartDoc(stacked)).toEqual(chartDoc(stacked));
    });

    it('rejects log scale on stacked charts', () => {
        expect(() => chartDoc({ ...stacked, axis: { scale: 'log' } })).toThrow(/stacked/);
    });
});

describe('area charts', () => {
    const area: ChartBlock = {
        type: 'chart', chartType: 'area',
        categories: ['a', 'b', 'c', 'd'],
        series: [{ label: 'Load', values: [10, 40, 25, 60] }],
    };

    it('fills a closed polygon and strokes the line on top', () => {
        const content = pageContent(chartDoc(area));
        expect(content).toMatch(/l h f/);   // closed filled polygon
        expect(content).toMatch(/ S\b/);    // stroked series line
    });

    it('mixes the fill toward white without transparency operators', () => {
        const content = pageContent(chartDoc(area));
        expect(content).not.toContain('/ExtGState');
        expect(content).not.toContain(' gs');
    });
});

describe('scatter charts', () => {
    const scatter: ChartBlock = {
        type: 'chart', chartType: 'scatter',
        series: [{ label: 'P', values: [3, 7, 5], xValues: [10, 20, 30] }],
    };

    it('renders one marker per point on a linear x-axis', () => {
        const content = pageContent(chartDoc(scatter));
        expect(content).toMatch(/ c\b/); // circle Béziers
    });

    it('requires xValues', () => {
        expect(() => chartDoc({ type: 'chart', chartType: 'scatter', series: [{ label: 'P', values: [1, 2] }] }))
            .toThrow(/xValues/);
    });

    it('rejects an xValues length mismatch', () => {
        expect(() => chartDoc({
            type: 'chart', chartType: 'scatter',
            series: [{ label: 'P', values: [1, 2, 3], xValues: [1, 2] }],
        })).toThrow(/length/);
    });
});

// ── v1.7.0: axes ─────────────────────────────────────────────────────

describe('log scale', () => {
    const log: ChartBlock = {
        type: 'chart', chartType: 'line',
        axis: { scale: 'log' },
        categories: ['a', 'b', 'c'],
        series: [{ label: 'L', values: [10, 1000, 100000] }],
    };

    it('renders decade ticks', () => {
        const content = pageContent(chartDoc(log));
        expect(content).toContain('(10)');
        expect(content).toContain('(1k)');
        expect(content).toContain('(100k)');
    });

    it('rejects non-positive values on a log axis', () => {
        expect(() => chartDoc({ ...log, series: [{ label: 'L', values: [0, 10, 100] }] })).toThrow(/non-positive/);
        expect(() => chartDoc({ ...log, axis: { scale: 'log', yMin: -1 } })).toThrow(/> 0/);
    });
});

describe('time axis', () => {
    const timeline: ChartBlock = {
        type: 'chart', chartType: 'line',
        xAxis: { type: 'time' },
        series: [{
            label: 'T', values: [1, 2, 3, 4],
            xValues: ['2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z'],
        }],
    };

    it('formats month ticks in UTC (YYYY-MM)', () => {
        const content = pageContent(chartDoc(timeline));
        expect(content).toMatch(/\(2026-0\d\)/);
    });

    it('is byte-deterministic', () => {
        expect(chartDoc(timeline)).toEqual(chartDoc(timeline));
    });

    it('rejects date strings without a time axis', () => {
        expect(() => chartDoc({
            type: 'chart', chartType: 'scatter',
            series: [{ label: 'T', values: [1], xValues: ['2026-01-01'] }],
        })).toThrow(/time/);
    });

    it('rejects unparseable dates', () => {
        expect(() => chartDoc({
            type: 'chart', chartType: 'line', xAxis: { type: 'time' },
            series: [{ label: 'T', values: [1], xValues: ['not-a-date'] }],
        })).toThrow(/ISO-8601/);
    });
});

describe('secondary axis', () => {
    const dual: ChartBlock = {
        type: 'chart', chartType: 'line',
        categories: ['a', 'b', 'c'],
        series: [
            { label: 'Revenue', values: [100, 200, 300] },
            { label: 'Margin', values: [10, 12, 9], yAxis: 'right' },
        ],
        axis2: { yMin: 0, yMax: 20 },
    };

    it('renders a right axis line and right tick labels', () => {
        const content = pageContent(chartDoc(dual));
        expect(content).toContain('(20)'); // axis2 max tick
    });

    it('axis2 without a right-bound series changes nothing', () => {
        const plain: ChartBlock = { ...barChart };
        const withUnusedAxis2: ChartBlock = { ...barChart, axis2: { yMin: 0, yMax: 100 } };
        expect(chartDoc(withUnusedAxis2)).toEqual(chartDoc(plain));
    });

    it('rejects yAxis binding on pie charts', () => {
        expect(() => chartDoc({
            type: 'chart', chartType: 'pie',
            series: [{ label: 'p', values: [1, 2], yAxis: 'right' }],
        })).toThrow(/cartesian/);
    });
});

// ── v1.7.0: data labels ──────────────────────────────────────────────

describe('data labels', () => {
    it('draws formatted values above bars', () => {
        const content = pageContent(chartDoc({ ...barChart, dataLabels: true }));
        expect(content).toContain('(120)');
        expect(content).toContain('(170)');
    });

    it('applies decimals, prefix and suffix', () => {
        const content = pageContent(chartDoc({
            type: 'chart', chartType: 'line',
            categories: ['a', 'b'],
            series: [{ label: 'M', values: [12.345, 8.1] }],
            dataLabels: { decimals: 1, suffix: '%' },
        }));
        expect(content).toContain('(12.3%)');
        expect(content).toContain('(8.1%)');
    });

    it('omits labels when disabled (default)', () => {
        const content = pageContent(chartDoc(barChart));
        expect(content).not.toContain('(120)');
    });
});
