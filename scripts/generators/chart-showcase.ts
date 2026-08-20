/**
 * Native vector charts showcase (v1.6.0).
 *
 * Grouped bars, horizontal bars, multi-series line with markers, pie, donut,
 * negative values, an explicit axis window, and a tagged/alt-text variant —
 * all pure PDF path operators, zero dependencies.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import { loadFontEntries } from '../helpers/fonts.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Native vector charts', level: 1 },
        {
            type: 'chart', chartType: 'bar', title: 'Quarterly revenue vs cost',
            categories: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
                { label: 'Revenue', values: [120, 150, 170, 140] },
                { label: 'Cost', values: [80, 90, 100, 95] },
            ],
        },
        {
            type: 'chart', chartType: 'line', title: 'Monthly active users', markers: true,
            categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            series: [
                { label: 'Free', values: [10, 25, 22, 40, 55, 60] },
                { label: 'Paid', values: [3, 8, 12, 18, 26, 34] },
            ],
        },
        { type: 'pageBreak' },
        {
            type: 'chart', chartType: 'barH', title: 'Regional sales',
            categories: ['North', 'South', 'East', 'West'],
            series: [{ label: 'Units', values: [40, 65, 30, 52] }],
        },
        {
            type: 'chart', chartType: 'donut', title: 'Traffic sources',
            categories: ['Organic', 'Referral', 'Direct', 'Social'],
            series: [{ label: 'Share', values: [55, 20, 15, 10] }],
        },
        {
            type: 'chart', chartType: 'bar', title: 'Net cash flow (with negatives)',
            categories: ['Jan', 'Feb', 'Mar', 'Apr'],
            series: [{ label: 'Flow', values: [30, -15, 20, -5] }],
        },
    ];
    const params: DocumentParams = { title: 'Charts showcase', blocks };
    ctx.writeSafe(resolve(ctx.outputDir, 'charts', 'charts-showcase.pdf'), 'charts/charts-showcase.pdf', buildDocumentPDFBytes(params));

    // Tagged (accessible) variant with explicit alt text. PDF/A requires all
    // rendering fonts embedded (ISO 19005-2 §6.2.11.4.1), so the tagged
    // variant embeds Noto Sans instead of relying on base-14 Helvetica.
    const latinEntries = await loadFontEntries('latin', '/F3');
    const tagged: DocumentParams = {
        title: 'Accessible chart',
        blocks: [
            { type: 'heading', text: 'Accessible chart', level: 1 },
            {
                type: 'chart', chartType: 'pie', title: 'Budget split',
                altText: 'Pie chart of the annual budget: 50% engineering, 30% sales, 20% operations.',
                categories: ['Engineering', 'Sales', 'Operations'],
                series: [{ label: 'Budget', values: [50, 30, 20] }],
            },
        ],
        fontEntries: latinEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'charts', 'charts-tagged.pdf'), 'charts/charts-tagged.pdf', buildDocumentPDFBytes(tagged, { tagged: true }));

    // ── Charts v2 (v1.7.0): stacked, area, scatter, dual axis, log/time
    //    scales, data labels, and x-label collision handling (#67). ─────
    const weekly = Array.from({ length: 17 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 0, 5 + i * 7));
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    });
    const weeklyValues = weekly.map((_, i) => 40 + Math.round(30 * Math.sin(i / 2)) + i);
    const v2Blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Charts v2 — stacked, area, scatter, axes', level: 1 },
        {
            type: 'chart', chartType: 'stackedBar', title: 'Revenue composition (stacked)',
            categories: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
                { label: 'Licences', values: [60, 75, 82, 70] },
                { label: 'Services', values: [30, 35, 44, 41] },
                { label: 'Support', values: [18, 20, 22, 25] },
            ],
            dataLabels: true,
        },
        {
            type: 'chart', chartType: 'area', title: 'Server load (area)',
            categories: ['00h', '04h', '08h', '12h', '16h', '20h'],
            series: [{ label: 'CPU %', values: [12, 8, 45, 72, 66, 30] }],
            dataLabels: { suffix: '%' },
        },
        { type: 'pageBreak' },
        {
            type: 'chart', chartType: 'scatter', title: 'Defects vs module size (scatter)',
            series: [
                { label: 'Modules', values: [2, 5, 3, 9, 6, 12, 4], xValues: [120, 340, 200, 890, 560, 1200, 260] },
            ],
        },
        {
            type: 'chart', chartType: 'line', title: 'Revenue vs margin (dual axis)',
            categories: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
                { label: 'Revenue (k$)', values: [120, 150, 170, 140] },
                { label: 'Margin (%)', values: [12, 14, 11, 16], yAxis: 'right' },
            ],
            axis2: { yMin: 0, yMax: 20 },
            markers: true,
        },
        { type: 'pageBreak' },
        {
            type: 'chart', chartType: 'line', title: 'Latency percentiles (log scale)',
            axis: { scale: 'log' },
            categories: ['p50', 'p90', 'p99', 'p99.9'],
            series: [{ label: 'ms', values: [12, 85, 640, 4200] }],
            markers: true, dataLabels: true,
        },
        {
            type: 'chart', chartType: 'line', title: 'Signups over time (time axis, UTC ticks)',
            xAxis: { type: 'time' },
            series: [{
                label: 'Signups', values: [5, 9, 14, 22, 31, 45],
                xValues: ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'],
            }],
            markers: true,
        },
        { type: 'pageBreak' },
        { type: 'heading', text: 'X-label collision handling (#67)', level: 2 },
        {
            type: 'chart', chartType: 'line', title: 'Auto stride (default): 17 weekly labels never overlap',
            width: 480, categories: weekly,
            series: [{ label: 'Visits', values: weeklyValues }],
        },
        {
            type: 'chart', chartType: 'line', title: 'labelRotation: 45 — every label, rotated',
            width: 480, categories: weekly, labelRotation: 45,
            series: [{ label: 'Visits', values: weeklyValues }],
        },
        {
            type: 'chart', chartType: 'bar', title: 'labelStride: 4 — explicit stride',
            width: 480, categories: weekly, labelStride: 4,
            series: [{ label: 'Visits', values: weeklyValues }],
        },
    ];
    const v2Params: DocumentParams = { title: 'Charts v2 showcase', blocks: v2Blocks };
    ctx.writeSafe(resolve(ctx.outputDir, 'charts', 'charts-v2-showcase.pdf'), 'charts/charts-v2-showcase.pdf', buildDocumentPDFBytes(v2Params));
}
