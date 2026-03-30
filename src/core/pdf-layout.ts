/**
 * pdfnative — PDF Layout Constants
 * ==================================
 * A4 page dimensions and default layout settings.
 * All values in PDF points (1pt = 1/72 inch).
 */

import type { PdfLayoutOptions, ColumnDef, PdfColors } from '../types/pdf-types.js';

// ── A4 Dimensions ────────────────────────────────────────────────────
export const PG_W = 595.28;  // A4 width (210mm)
export const PG_H = 841.89;  // A4 height (297mm)

// ── Default Margins ──────────────────────────────────────────────────
export const DEFAULT_MARGINS = { t: 45, r: 36, b: 35, l: 36 };

// ── Computed Content Width ───────────────────────────────────────────
export const DEFAULT_CW = PG_W - DEFAULT_MARGINS.l - DEFAULT_MARGINS.r;

// ── Row Heights ──────────────────────────────────────────────────────
export const ROW_H = 12;
export const TH_H = 15;
export const INFO_LN = 13;
export const BAL_H = 32;
export const TITLE_LN = 22;
export const FT_H = 15;

// ── Default Font Sizes ───────────────────────────────────────────────
export const DEFAULT_FONT_SIZES = { title: 16, info: 9, th: 8, td: 7.5, ft: 7 };

// ── Default Colors (RGB as PDF operator strings) ─────────────────────
export const DEFAULT_COLORS: PdfColors = {
    title:   '0.145 0.388 0.922',
    credit:  '0.086 0.639 0.247',
    debit:   '0.863 0.149 0.149',
    text:    '0.216 0.255 0.318',
    thBg:    '0.976 0.980 0.988',
    thBrd:   '0.820 0.835 0.859',
    rowBrd:  '0.898 0.906 0.922',
    ptdBg:   '0.937 0.965 1.000',
    balBg:   '0.937 0.965 1.000',
    balBrd:  '0.145 0.388 0.922',
    label:   '0.294 0.333 0.388',
    footer:  '0.612 0.639 0.682',
};

// ── Default Columns ──────────────────────────────────────────────────
export const DEFAULT_COLUMNS: ColumnDef[] = [
    { f: 0.12, a: 'l', mx: 12, mxH: 12 },
    { f: 0.32, a: 'l', mx: 42, mxH: 42 },
    { f: 0.18, a: 'l', mx: 24, mxH: 24 },
    { f: 0.20, a: 'r', mx: 26, mxH: 26 },
    { f: 0.18, a: 'c', mx: 3,  mxH: 20 },
];

/**
 * Compute column X positions and widths given columns and content width.
 */
export function computeColumnPositions(
    columns: ColumnDef[],
    marginLeft: number,
    contentWidth: number
): { cx: number[]; cwi: number[] } {
    const cx: number[] = [];
    const cwi: number[] = [];
    let x = marginLeft;
    for (const col of columns) {
        cx.push(x);
        cwi.push(col.f * contentWidth);
        x += col.f * contentWidth;
    }
    return { cx, cwi };
}

/**
 * Create a resolved layout configuration from user options + defaults.
 */
export function resolveLayout(options?: Partial<PdfLayoutOptions>): {
    pgW: number; pgH: number;
    mg: { t: number; r: number; b: number; l: number };
    cw: number;
    columns: ColumnDef[];
    colors: PdfColors;
    fs: typeof DEFAULT_FONT_SIZES;
    cx: number[];
    cwi: number[];
} {
    const pgW = options?.pageWidth ?? PG_W;
    const pgH = options?.pageHeight ?? PG_H;
    const mg: { t: number; r: number; b: number; l: number } = options?.margins ?? { ...DEFAULT_MARGINS };
    const cw = pgW - mg.l - mg.r;
    const columns = options?.columns ?? DEFAULT_COLUMNS;
    const colors: PdfColors = options?.colors ?? { ...DEFAULT_COLORS };
    const fs = DEFAULT_FONT_SIZES;
    const { cx, cwi } = computeColumnPositions(columns, mg.l, cw);

    return { pgW, pgH, mg, cw, columns, colors, fs, cx, cwi };
}
