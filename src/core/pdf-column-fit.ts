/**
 * pdfnative — Auto-fit Column Widths
 * ====================================
 * Computes column-width fractions from actual content widths so tables size
 * themselves to their data rather than to fixed `f` fractions.
 *
 * Algorithm:
 *  1. For each column, measure max(header_at_fs.th, max(data_cells_at_fs.td)).
 *  2. Add fixed cell padding (left + right) to get the desired column width.
 *  3. Compute new `f` fractions = desired / total_desired.
 *  4. Forward to `computeColumnPositions()` which honours `minWidth`/`maxWidth`.
 *
 * Output is a new `ColumnDef[]` with adjusted `f` values; other fields
 * (alignment, mx, mxH, minWidth, maxWidth) are preserved verbatim.
 *
 * Note: byte-output is not deterministic across content changes — only enable
 * when content-aware sizing is desired. Existing per-column constraints
 * (`minWidth`, `maxWidth`) are still respected by the downstream positioner.
 *
 * @module core/pdf-column-fit
 * @since 1.1.0
 */

import type { ColumnDef, EncodingContext, PdfRow } from '../types/pdf-types.js';

/** Cell padding in points (matches the 3pt left + 3pt right inset used by renderTable). */
const CELL_PAD_LEFT = 3;
const CELL_PAD_RIGHT = 3;
const CELL_PAD_TOTAL = CELL_PAD_LEFT + CELL_PAD_RIGHT;

/**
 * Compute auto-fit column fractions based on actual content widths.
 *
 * @param columns - Original column definitions
 * @param headers - Table header strings (one per column)
 * @param rows    - Data rows (each `cells[i]` aligns with `columns[i]`)
 * @param enc     - Encoding context (provides `tw(text, sz)` width measurement)
 * @param thSize  - Header font size in points
 * @param tdSize  - Data cell font size in points
 * @returns A new array of `ColumnDef` with `f` values adjusted to fit content.
 *          When all columns measure zero width (empty table), returns the input
 *          unchanged so positions stay stable.
 */
export function computeAutoFitColumns(
    columns: readonly ColumnDef[],
    headers: readonly string[],
    rows: readonly PdfRow[],
    enc: EncodingContext,
    thSize: number,
    tdSize: number,
): ColumnDef[] {
    const n = columns.length;
    if (n === 0) return [];

    const desired: number[] = new Array<number>(n).fill(0);

    for (let i = 0; i < n; i++) {
        let max = 0;
        const hdr = headers[i];
        if (hdr) {
            const w = enc.tw(hdr, thSize);
            if (w > max) max = w;
        }
        for (const row of rows) {
            const cell = row.cells[i];
            if (!cell) continue;
            const w = enc.tw(cell, tdSize);
            if (w > max) max = w;
        }
        desired[i] = max + CELL_PAD_TOTAL;
    }

    let total = 0;
    for (let i = 0; i < n; i++) total += desired[i];

    // Guard: empty table or zero-content — preserve original fractions.
    if (total <= 0) return columns.slice();

    const out: ColumnDef[] = new Array<ColumnDef>(n);
    for (let i = 0; i < n; i++) {
        out[i] = { ...columns[i], f: desired[i] / total };
    }
    return out;
}
