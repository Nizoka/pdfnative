/**
 * Tests for auto-fit column widths (Phase 4 / v1.1.0).
 */

import { describe, it, expect } from 'vitest';
import { computeAutoFitColumns } from '../../src/core/pdf-column-fit.js';
import type { ColumnDef, EncodingContext, PdfRow } from '../../src/types/pdf-types.js';
import { helveticaWidth, pdfString } from '../../src/fonts/encoding.js';

/** Minimal Helvetica encoding context for tests (matches Latin/WinAnsi mode). */
const enc: EncodingContext = {
    isUnicode: false,
    fontEntries: [],
    ps: pdfString,
    tw: helveticaWidth,
    textRuns: () => [],
    f1: '/F1',
    f2: '/F2',
};

const cols: ColumnDef[] = [
    { f: 0.5, a: 'l', mx: 50, mxH: 50 },
    { f: 0.5, a: 'l', mx: 50, mxH: 50 },
];

describe('computeAutoFitColumns', () => {
    it('redistributes fractions based on header width', () => {
        const headers = ['Short', 'A much longer header text'];
        const rows: PdfRow[] = [];
        const out = computeAutoFitColumns(cols, headers, rows, enc, 8, 7.5);
        expect(out.length).toBe(2);
        // Sum of fractions must equal 1
        const total = out[0].f + out[1].f;
        expect(total).toBeCloseTo(1, 5);
        // Long header → bigger column
        expect(out[1].f).toBeGreaterThan(out[0].f);
    });

    it('honours data row content widths', () => {
        const headers = ['A', 'B'];
        const rows: PdfRow[] = [
            { cells: ['xx', 'verylongdatacellvalue'], type: 'credit', pointed: false },
        ];
        const out = computeAutoFitColumns(cols, headers, rows, enc, 8, 7.5);
        expect(out[1].f).toBeGreaterThan(out[0].f);
    });

    it('preserves alignment / mx / mxH / minWidth / maxWidth', () => {
        const richCols: ColumnDef[] = [
            { f: 0.5, a: 'r', mx: 30, mxH: 25, minWidth: 40, maxWidth: 100 },
            { f: 0.5, a: 'c', mx: 40, mxH: 35 },
        ];
        const out = computeAutoFitColumns(richCols, ['A', 'B'], [], enc, 8, 7.5);
        expect(out[0].a).toBe('r');
        expect(out[0].mx).toBe(30);
        expect(out[0].mxH).toBe(25);
        expect(out[0].minWidth).toBe(40);
        expect(out[0].maxWidth).toBe(100);
        expect(out[1].a).toBe('c');
    });

    it('returns columns unchanged when content total is zero', () => {
        const headers = ['', ''];
        const out = computeAutoFitColumns(cols, headers, [], enc, 8, 7.5);
        // Even empty headers produce padding (CELL_PAD_TOTAL = 6pt) per column;
        // ratios stay 0.5/0.5 since each column has the same empty-content width.
        expect(out[0].f).toBeCloseTo(0.5, 5);
        expect(out[1].f).toBeCloseTo(0.5, 5);
    });

    it('handles empty column array', () => {
        expect(computeAutoFitColumns([], [], [], enc, 8, 7.5)).toEqual([]);
    });
});

describe('TableBlock.autoFitColumns wiring', () => {
    it('renders without error when autoFitColumns is true', async () => {
        const { buildDocumentPDF } = await import('../../src/core/pdf-document.js');
        const result = buildDocumentPDF({
            title: 'AutoFit Test',
            blocks: [{
                type: 'table',
                headers: ['Short', 'Much Longer Header'],
                rows: [
                    { cells: ['x', 'long content here'], type: 'credit', pointed: false },
                ],
                autoFitColumns: true,
            }],
            footerText: 'pdfnative',
        });
        expect(result).toContain('Short');
        expect(result).toContain('Much Longer Header');
        expect(result).toContain('long content here');
    });

    it('produces different output than fixed-width when content differs (sanity)', async () => {
        const { buildDocumentPDF } = await import('../../src/core/pdf-document.js');
        const make = (autoFit: boolean): string => buildDocumentPDF({
            title: 'Test',
            blocks: [{
                type: 'table',
                headers: ['Tiny', 'Huge Header Indeed'],
                rows: [{ cells: ['a', 'b'], type: 'credit', pointed: false }],
                columns: [
                    { f: 0.5, a: 'l', mx: 50, mxH: 50 },
                    { f: 0.5, a: 'l', mx: 50, mxH: 50 },
                ],
                autoFitColumns: autoFit,
            }],
            footerText: 'pdfnative',
        });
        const fixed = make(false);
        const fitted = make(true);
        expect(fixed).not.toBe(fitted);
    });
});
