/**
 * Native vector charts (charts v2): a stacked bar chart of quarterly
 * revenue and a scatter plot on a linear x-axis, one per page. Charts are
 * pure PDF path operators — no rasterisation, no dependencies.
 *
 * @task Render stacked-bar and scatter charts as native vector graphics
 * @surface library
 * @since 1.7.0
 * @expect pages === 2
 */
import { buildDocumentPDFBytes, openPdf } from 'pdfnative';
import type { DocumentParams } from 'pdfnative';

const params: DocumentParams = {
    title: 'Quarterly figures',
    blocks: [
        {
            type: 'chart',
            chartType: 'stackedBar',
            title: 'Revenue by region',
            categories: ['Q1', 'Q2', 'Q3', 'Q4'],
            series: [
                { label: 'EMEA', values: [120, 135, 128, 150] },
                { label: 'Americas', values: [90, 105, 118, 122] },
                { label: 'APAC', values: [45, 52, 61, 70] },
            ],
            height: 220,
            legend: 'bottom',
        },
        { type: 'pageBreak' },
        {
            type: 'chart',
            chartType: 'scatter',
            title: 'Latency against payload size',
            xAxis: { type: 'linear', grid: true },
            series: [
                { label: 'Samples', values: [12, 18, 25, 31, 44], xValues: [10, 25, 50, 75, 100] },
            ],
            height: 220,
            dataLabels: { decimals: 0, suffix: ' ms' },
        },
    ],
    footerText: 'Quarterly figures',
};

export async function run(): Promise<{ bytes: Uint8Array; pages: number }> {
    const bytes = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });
    return { bytes, pages: openPdf(bytes).pageCount };
}
