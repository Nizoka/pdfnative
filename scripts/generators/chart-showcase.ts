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
}
