/**
 * Tests for table cell borders + vertical alignment — v1.4.0.
 *
 * `TableBlock.cellBorders` draws per-cell vector strokes; `cellVAlign` (and the
 * per-column `ColumnDef.vAlign`) positions text within the row band. Both are
 * opt-in: when unset, table output is byte-identical to pre-1.4.0.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';
import type { DocumentParams, TableBlock, CellBorders } from '../../src/types/pdf-document-types.js';

function table(extra: Partial<TableBlock>): TableBlock {
    return {
        type: 'table',
        headers: ['Name', 'Value'],
        rows: [
            { cells: ['Alpha', '10'], type: '', pointed: false },
            { cells: ['Beta', '20'], type: '', pointed: false },
        ],
        ...extra,
    };
}

function build(tbl: TableBlock, extra?: Partial<DocumentParams>): string {
    return buildDocumentPDF({
        title: 'TableTest',
        blocks: [tbl],
        footerText: 'pdfnative',
        ...extra,
    });
}

describe('table cell borders', () => {
    it('strokes borders with the configured colour', () => {
        const borders: CellBorders = { all: true, color: '#ff0000' };
        const pdf = build(table({ cellBorders: borders }));
        expect(pdf).toContain('1 0 0 RG');
        // Stroked line segments (m … l S) for the cell edges.
        expect(pdf).toContain(' l S');
    });

    it('emits a dashed pattern for style: dashed', () => {
        const pdf = build(table({ cellBorders: { all: true, style: 'dashed' } }));
        expect(pdf).toContain('[3] 0 d');
        // Dash is reset afterwards so row separators stay solid.
        expect(pdf).toContain('[] 0 d');
    });

    it('emits a dotted pattern for style: dotted', () => {
        const pdf = build(table({ cellBorders: { all: true, style: 'dotted', width: 1 } }));
        expect(pdf).toContain('[1.00 2.00] 0 d');
    });

    it('honours individual side flags', () => {
        const pdf = build(table({ cellBorders: { bottom: true, color: '#00ff00' } }));
        expect(pdf).toContain('0 1 0 RG');
    });

    it('is byte-identical when cellBorders is omitted', () => {
        expect(build(table({}))).toBe(build(table({})));
    });

    it('changes output when borders are enabled', () => {
        const plain = build(table({}));
        const bordered = build(table({ cellBorders: { all: true } }));
        expect(bordered).not.toBe(plain);
        expect(bordered.length).toBeGreaterThan(plain.length);
    });
});

describe('table cell vertical alignment', () => {
    it('changes output when cellVAlign is set', () => {
        const plain = build(table({ minRowHeight: 30 }));
        const aligned = build(table({ minRowHeight: 30, cellVAlign: 'bottom' }));
        expect(aligned).not.toBe(plain);
    });

    it('produces different output for top vs bottom alignment', () => {
        const top = build(table({ minRowHeight: 30, cellVAlign: 'top' }));
        const bottom = build(table({ minRowHeight: 30, cellVAlign: 'bottom' }));
        expect(top).not.toBe(bottom);
    });

    it('lets a per-column vAlign override the table default', () => {
        const a = build(table({
            minRowHeight: 30,
            cellVAlign: 'top',
            columns: [{ f: 0.5, a: 'l', mx: 100, mxH: 100 }, { f: 0.5, a: 'l', mx: 100, mxH: 100, vAlign: 'bottom' }],
        }));
        const b = build(table({
            minRowHeight: 30,
            cellVAlign: 'top',
            columns: [{ f: 0.5, a: 'l', mx: 100, mxH: 100 }, { f: 0.5, a: 'l', mx: 100, mxH: 100 }],
        }));
        expect(a).not.toBe(b);
    });

    it('is byte-identical when no vertical alignment is set', () => {
        expect(build(table({ minRowHeight: 30 }))).toBe(build(table({ minRowHeight: 30 })));
    });

    it('still renders the cell text', () => {
        const pdf = build(table({ cellVAlign: 'middle' }));
        expect(pdf).toContain('Alpha');
        expect(pdf).toContain('Beta');
    });
});
