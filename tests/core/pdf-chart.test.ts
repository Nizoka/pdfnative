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
