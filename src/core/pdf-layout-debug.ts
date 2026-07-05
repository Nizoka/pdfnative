/**
 * pdfnative — Layout Debug Overlay (development aid)
 * ==================================================
 * Pure builders for the diagnostic overlay drawn when
 * {@link PdfLayoutOptions.debug} is enabled. Every function returns a
 * self-contained PDF operator string wrapped in its own `q … Q` graphics
 * block, so overlay rectangles never disturb the surrounding content stream
 * (no colour/line-width bleed, no BT/ET imbalance).
 *
 * The overlay is a *development* feature — it is only ever appended to a page
 * when the caller opts in, so production output stays byte-identical.
 *
 * @since 1.5.0
 */

import { fmtNum } from './pdf-text.js';
import type { LayoutDebugOptions } from '../types/pdf-types.js';
import type { TablePlan, TableSlice } from './pdf-renderers.js';

/** Resolved overlay layer flags. */
export interface ResolvedDebugOptions {
    readonly showMargins: boolean;
    readonly showContentBounds: boolean;
    readonly showCells: boolean;
}

/**
 * Normalise the public {@link PdfLayoutOptions.debug} value into concrete
 * layer flags. Returns `null` when the overlay is disabled (so callers can
 * skip all overlay work and keep output byte-identical).
 *
 * - `true` → every layer on.
 * - `false` / `undefined` → `null` (disabled).
 * - object → each layer as specified (unset layers default off).
 */
export function resolveDebugOptions(
    debug: boolean | LayoutDebugOptions | undefined,
): ResolvedDebugOptions | null {
    if (!debug) return null;
    if (debug === true) {
        return { showMargins: true, showContentBounds: true, showCells: true };
    }
    const showMargins = debug.showMargins === true;
    const showContentBounds = debug.showContentBounds === true;
    const showCells = debug.showCells === true;
    if (!showMargins && !showContentBounds && !showCells) return null;
    return { showMargins, showContentBounds, showCells };
}

// Overlay stroke colours (RGB operator strings).
const COL_MARGIN = '0 0.45 0.95';   // blue — page content box
const COL_BLOCK = '0.90 0.20 0.30'; // red — per-block content bounds
const COL_CELL = '0 0.62 0.30';     // green — table cell grid

/** Stroke a single rectangle in its own graphics block. */
function rectOp(x: number, y: number, w: number, h: number, color: string, lineW: number): string {
    return `q ${color} RG ${fmtNum(lineW)} w ${fmtNum(x)} ${fmtNum(y)} ${fmtNum(w)} ${fmtNum(h)} re S Q`;
}

/**
 * Page content-box overlay (page rectangle inset by the margins, above the
 * footer band). `mg` uses the document builder's `{ t, r, b, l }` convention.
 */
export function marginBoxOps(
    pgW: number, pgH: number,
    mg: { t: number; r: number; b: number; l: number },
    footerH: number,
): string {
    const x = mg.l;
    const yBottom = mg.b + footerH;
    const w = pgW - mg.l - mg.r;
    const h = (pgH - mg.t) - yBottom;
    return rectOp(x, yBottom, w, h, COL_MARGIN, 0.5);
}

/**
 * Per-block content-bounds overlay. `yTop`/`yBottom` are the exact pen
 * positions captured before and after the block was rendered (PDF space,
 * y increasing upward), so the rectangle hugs the block's real footprint.
 */
export function blockBoundsOps(x: number, width: number, yTop: number, yBottom: number): string {
    const h = yTop - yBottom;
    if (h <= 0) return '';
    return rectOp(x, yBottom, width, h, COL_BLOCK, 0.4);
}

/**
 * Table cell-grid overlay for one rendered table slice. Reconstructs the
 * exact column x-positions (`plan.cx` / `plan.cwi`) and the caption/header/row
 * bands from the plan, matching `renderTable`'s geometry, and strokes each
 * cell rectangle.
 *
 * @param yTop  Pen position at the top of the slice (before caption/header).
 */
export function tableCellOps(
    plan: TablePlan,
    slice: TableSlice | undefined,
    yTop: number,
): string {
    const drawCaption = slice ? slice.drawCaption : true;
    const drawHeader = slice ? slice.drawHeader : true;
    const fromRow = slice ? slice.fromRow : 0;
    const toRow = slice ? slice.toRow : plan.rowHeights.length;

    const parts: string[] = [];

    // Skip the caption band — cells begin below it.
    let y = yTop - (drawCaption ? plan.captionHeight : 0);

    // Header row.
    if (drawHeader) {
        const hBottom = y - plan.headerHeight;
        for (let c = 0; c < plan.cx.length; c++) {
            parts.push(rectOp(plan.cx[c], hBottom, plan.cwi[c], plan.headerHeight, COL_CELL, 0.3));
        }
        y = hBottom;
    }

    // Data rows in this slice.
    for (let r = fromRow; r < toRow; r++) {
        const rh = plan.rowHeights[r];
        const rBottom = y - rh;
        for (let c = 0; c < plan.cx.length; c++) {
            parts.push(rectOp(plan.cx[c], rBottom, plan.cwi[c], rh, COL_CELL, 0.3));
        }
        y = rBottom;
    }

    return parts.join('\n');
}
