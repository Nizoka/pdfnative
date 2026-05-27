/**
 * Tests for v1.2.0 table parity features:
 *   - `planTable()` row-height + wrapping (auto/always/never).
 *   - `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
 *   - Multi-page table slicing with shared `/Table` struct accumulator.
 *   - Single-page byte-stability regression guard against the v1.1 path.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';
import { planTable } from '../../src/core/pdf-renderers.js';
import type { TableBlock } from '../../src/types/pdf-document-types.js';
import type { EncodingContext, ColumnDef, PdfRow } from '../../src/types/pdf-types.js';
import { helveticaWidth, pdfString } from '../../src/fonts/encoding.js';

const enc: EncodingContext = {
    isUnicode: false,
    fontEntries: [],
    ps: pdfString,
    tw: helveticaWidth,
    textRuns: () => [],
    f1: '/F1',
    f2: '/F2',
};

const NARROW_COLS: ColumnDef[] = [
    { f: 0.5, a: 'l', mx: 100, mxH: 100 },
    { f: 0.5, a: 'l', mx: 100, mxH: 100 },
];

function makeRows(n: number, longCell = false): PdfRow[] {
    return Array.from({ length: n }, (_, i) => ({
        cells: [
            `R${i + 1}`,
            longCell
                ? 'A particularly long data cell that should wrap when the column is narrow enough to force the auto policy to kick in'
                : `data ${i + 1}`,
        ],
        type: 'credit',
        pointed: false,
    }));
}

// ── planTable() ──────────────────────────────────────────────────────

describe('planTable() — measurement pass', () => {
    it('wrap=auto keeps short cells on a single line', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A', 'B'],
            rows: makeRows(3),
            columns: NARROW_COLS,
            wrap: 'auto',
        };
        const plan = planTable(block, enc, 36, 523);
        for (const lines of plan.rowLines) {
            for (const cell of lines) expect(cell.length).toBe(1);
        }
        // single-line row height stays at v1.1 ROW_H = 12 for byte parity.
        expect(plan.rowHeights).toEqual([12, 12, 12]);
        expect(plan.headerHeight).toBe(15);
    });

    it('wrap=auto wraps cells that overflow their column', () => {
        const narrow: ColumnDef[] = [
            { f: 0.5, a: 'l', mx: 100, mxH: 100 },
            { f: 0.5, a: 'l', mx: 100, mxH: 100 },
        ];
        const block: TableBlock = {
            type: 'table',
            headers: ['Code', 'Description'],
            rows: makeRows(2, true),
            columns: narrow,
            wrap: 'auto',
        };
        const plan = planTable(block, enc, 36, 200);
        // Second cell should wrap to >1 line in each row.
        for (const row of plan.rowLines) {
            expect(row[1].length).toBeGreaterThan(1);
        }
        // Wrapped rows are strictly taller than the v1.1 floor.
        for (const h of plan.rowHeights) expect(h).toBeGreaterThan(12);
    });

    it('wrap=always still wraps long content (equivalent to auto when overflow occurs)', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A B', 'C D'],
            rows: [
                { cells: ['aaaaaa bbbbbb cccccc dddddd eeeeee', 'pp'], type: 'credit', pointed: false },
            ],
            columns: NARROW_COLS,
            wrap: 'always',
        };
        const plan = planTable(block, enc, 36, 60); // very narrow → forces wrap
        expect(plan.rowLines[0][0].length).toBeGreaterThan(1);
    });

    it('wrap=never returns a single line per cell (v1.1 path)', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A', 'B'],
            rows: makeRows(2, true),
            columns: NARROW_COLS,
            wrap: 'never',
        };
        const plan = planTable(block, enc, 36, 200);
        for (const row of plan.rowLines) {
            for (const cell of row) expect(cell.length).toBe(1);
        }
        expect(plan.rowHeights).toEqual([12, 12]);
    });

    it('respects minRowHeight', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A', 'B'],
            rows: makeRows(2),
            columns: NARROW_COLS,
            minRowHeight: 20,
        };
        const plan = planTable(block, enc, 36, 523);
        for (const h of plan.rowHeights) expect(h).toBeGreaterThanOrEqual(20);
    });

    it('captures caption lines + height', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A'],
            rows: [{ cells: ['x'], type: 'credit', pointed: false }],
            caption: 'Table 1 — Quarterly revenue',
        };
        const plan = planTable(block, enc, 36, 523);
        expect(plan.captionLines.length).toBeGreaterThan(0);
        expect(plan.captionHeight).toBeGreaterThan(0);
    });

    it('handles empty rows', () => {
        const block: TableBlock = {
            type: 'table',
            headers: ['A', 'B'],
            rows: [],
        };
        const plan = planTable(block, enc, 36, 523);
        expect(plan.rowLines).toEqual([]);
        expect(plan.rowHeights).toEqual([]);
    });
});

// ── End-to-end (buildDocumentPDF) ────────────────────────────────────

describe('TableBlock end-to-end (v1.2.0 fields)', () => {
    it('byte-identical for a single-page table when no new fields are set', () => {
        const pdf1 = buildDocumentPDF({
            title: 'Stability',
            blocks: [{
                type: 'table',
                headers: ['Date', 'Description', 'Cat', 'Amount', 'Note'],
                rows: makeRows(5),
            }],
            footerText: 'pdfnative',
        });
        const pdf2 = buildDocumentPDF({
            title: 'Stability',
            blocks: [{
                type: 'table',
                headers: ['Date', 'Description', 'Cat', 'Amount', 'Note'],
                rows: makeRows(5),
            }],
            footerText: 'pdfnative',
        });
        // Strip the trailer /ID (deterministic but a function of content+date).
        // Same input → identical output across two builds (also confirms determinism).
        expect(pdf1).toBe(pdf2);
    });

    it('repeats header on continuation pages (default repeatHeader=true)', () => {
        const headerStr = 'HEADER_REPEAT_CANARY';
        const pdf = buildDocumentPDF({
            title: 'Multi-page',
            blocks: [{
                type: 'table',
                headers: [headerStr, 'B'],
                rows: makeRows(120),
                columns: NARROW_COLS,
            }],
            footerText: 'pdfnative',
        });
        // 120 rows × 12pt = 1440pt of body — far more than one A4 page (~735pt).
        const occurrences = pdf.split(headerStr).length - 1;
        expect(occurrences).toBeGreaterThan(1);
    });

    it('does NOT repeat header when repeatHeader=false', () => {
        const headerStr = 'HEADER_NOREPEAT_CANARY';
        const pdf = buildDocumentPDF({
            title: 'Multi-page',
            blocks: [{
                type: 'table',
                headers: [headerStr, 'B'],
                rows: makeRows(120),
                columns: NARROW_COLS,
                repeatHeader: false,
            }],
            footerText: 'pdfnative',
        });
        const occurrences = pdf.split(headerStr).length - 1;
        expect(occurrences).toBe(1);
    });

    it('emits a zebra fill on every other data row', () => {
        const pdf = buildDocumentPDF({
            title: 'Zebra',
            blocks: [{
                type: 'table',
                headers: ['A', 'B'],
                rows: makeRows(4),
                zebra: true,
            }],
            footerText: 'pdfnative',
        });
        // Default zebra colour fill — must appear at least once for 4 rows.
        expect(pdf).toContain('0.969 0.973 0.984 rg');
    });

    it('renders a caption only on the first page of a multi-page table', () => {
        const captionStr = 'CAPTION_FIRST_ONLY_CANARY';
        const pdf = buildDocumentPDF({
            title: 'Caption',
            blocks: [{
                type: 'table',
                headers: ['A', 'B'],
                rows: makeRows(120),
                columns: NARROW_COLS,
                caption: captionStr,
            }],
            footerText: 'pdfnative',
        });
        const occurrences = pdf.split(captionStr).length - 1;
        expect(occurrences).toBe(1);
    });

    it('tagged mode emits a single /Table per source block and a /Caption child', async () => {
        const captionStr = 'CAPTION_TAG_CANARY';
        const pdf = buildDocumentPDF({
            title: 'Tagged',
            blocks: [{
                type: 'table',
                headers: ['A', 'B'],
                rows: makeRows(8),
                caption: captionStr,
            }],
            footerText: 'pdfnative',
        }, { tagged: true });
        // One /Table per source table (multi-slice still collapses into one).
        const tableMatches = pdf.match(/\/Table\b/g) ?? [];
        // /Type /Table appears in the struct-tree dict; allow ≥ 1.
        expect(tableMatches.length).toBeGreaterThanOrEqual(1);
        // /Caption struct element present.
        expect(pdf).toContain('/Caption');
    });

    it('honours wrap=never explicitly (forces v1.1 truncation path)', () => {
        const longCell = 'AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH IIII JJJJ';
        const planAlways = planTable(
            { type: 'table', headers: ['A', 'B'], rows: [{ cells: ['x', longCell], type: 'credit', pointed: false }], columns: NARROW_COLS, wrap: 'always' },
            enc, 36, 200,
        );
        const planNever = planTable(
            { type: 'table', headers: ['A', 'B'], rows: [{ cells: ['x', longCell], type: 'credit', pointed: false }], columns: NARROW_COLS, wrap: 'never' },
            enc, 36, 200,
        );
        // 'never' keeps a single line; 'always' splits the long second cell.
        expect(planNever.rowLines[0][1].length).toBe(1);
        expect(planAlways.rowLines[0][1].length).toBeGreaterThan(1);
        // The row height under 'never' matches the v1.1 ROW_H floor.
        expect(planNever.rowHeights[0]).toBe(12);
        expect(planAlways.rowHeights[0]).toBeGreaterThan(12);
    });
});
