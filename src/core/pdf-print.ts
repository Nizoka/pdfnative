/**
 * pdfnative — Print Production (v1.7.0)
 * ======================================
 * Professional-printing page geometry and decoration:
 *
 * - Page boxes — `/TrimBox`, `/BleedBox`, `/ArtBox`, `/CropBox`
 *   (ISO 32000-1 §14.11.2) plus large-format `/UserUnit`, resolved once
 *   into a page-dictionary fragment (pages share one geometry).
 * - Printer's marks (§14.11.3) — corner crop marks and edge registration
 *   targets drawn OUTSIDE the TrimBox as pure vector operators, built once
 *   and appended to every page's content stream (the watermark model).
 *
 * Everything is opt-in: without `layout.print` the output is byte-identical.
 * Marks are stroked in RGB black — a true all-separation registration
 * colour requires CMYK content support (deferred).
 *
 * @module core/pdf-print
 */

import type { PageBox, PrintOptions, PrinterMarksOptions } from '../types/pdf-types.js';
import { fmtNum } from './pdf-text.js';

/** Resolved print geometry: the page-dict fragment and the trim rectangle. */
export interface ResolvedPrintBoxes {
    /** ` /TrimBox [...] …` page-dictionary fragment (leading space), or `''`. */
    readonly boxesStr: string;
    /** The resolved TrimBox, when one exists (explicit or via `bleed`). */
    readonly trim: PageBox | null;
}

const MAX_USER_UNIT = 75_000; // ISO 32000-2 Table 31

function boxWithin(inner: PageBox, outer: PageBox): boolean {
    return inner[0] >= outer[0] - 1e-6 && inner[1] >= outer[1] - 1e-6
        && inner[2] <= outer[2] + 1e-6 && inner[3] <= outer[3] + 1e-6;
}

function boxValid(box: PageBox): boolean {
    return box.every(Number.isFinite) && box[2] > box[0] && box[3] > box[1];
}

/**
 * Validate `layout.print` against the page geometry and conformance target.
 * Throws with actionable messages; returns nothing.
 */
export function validatePrintOptions(
    print: PrintOptions,
    pgW: number,
    pgH: number,
    tagged: boolean | string | undefined,
): void {
    const media: PageBox = [0, 0, pgW, pgH];

    if (print.bleed !== undefined) {
        if (!Number.isFinite(print.bleed) || print.bleed <= 0) {
            throw new Error('print.bleed must be a positive number of points');
        }
        if (print.bleed * 2 >= Math.min(pgW, pgH)) {
            throw new Error('print.bleed leaves no trim area — it must be less than half the smaller page dimension');
        }
        if (print.trimBox) {
            throw new Error('print.bleed and print.trimBox are mutually exclusive — the shorthand derives the TrimBox');
        }
    }

    for (const [name, box] of [
        ['trimBox', print.trimBox], ['bleedBox', print.bleedBox],
        ['artBox', print.artBox], ['cropBox', print.cropBox],
    ] as const) {
        if (box === undefined) continue;
        if (!boxValid(box)) {
            throw new Error(`print.${name} must be [x0, y0, x1, y1] with x1 > x0 and y1 > y0`);
        }
        if (!boxWithin(box, media)) {
            throw new Error(`print.${name} must lie within the MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}]`);
        }
    }

    const trim = resolveTrim(print, pgW, pgH);
    const bleedBox = print.bleedBox ?? (print.bleed !== undefined ? media : undefined);
    if (trim && bleedBox && !boxWithin(trim, bleedBox)) {
        throw new Error('print.trimBox must lie within the BleedBox');
    }

    if (print.marks !== undefined && print.marks !== false && !trim) {
        throw new Error('print.marks requires a TrimBox — set print.bleed or print.trimBox');
    }

    if (print.userUnit !== undefined) {
        if (!Number.isFinite(print.userUnit) || print.userUnit < 1 || print.userUnit > MAX_USER_UNIT) {
            throw new Error(`print.userUnit must be between 1 and ${MAX_USER_UNIT}`);
        }
        if (tagged === 'pdfa1b') {
            throw new Error('print.userUnit requires PDF 1.6+ and is not allowed under PDF/A-1 (PDF 1.4) — use pdfa2b or later');
        }
    }
}

function resolveTrim(print: PrintOptions, pgW: number, pgH: number): PageBox | null {
    if (print.trimBox) return print.trimBox;
    if (print.bleed !== undefined) {
        return [print.bleed, print.bleed, pgW - print.bleed, pgH - print.bleed];
    }
    return null;
}

const boxStr = (name: string, box: PageBox): string =>
    ` /${name} [${fmtNum(box[0])} ${fmtNum(box[1])} ${fmtNum(box[2])} ${fmtNum(box[3])}]`;

/**
 * Resolve the page-dictionary fragment for the configured boxes. Pages are
 * geometry-invariant, so this is computed once per document and
 * interpolated into every page dictionary.
 */
export function resolvePrintBoxes(print: PrintOptions, pgW: number, pgH: number): ResolvedPrintBoxes {
    const media: PageBox = [0, 0, pgW, pgH];
    const trim = resolveTrim(print, pgW, pgH);
    const bleedBox = print.bleedBox ?? (print.bleed !== undefined ? media : undefined);

    let boxesStr = '';
    if (print.cropBox) boxesStr += boxStr('CropBox', print.cropBox);
    if (bleedBox) boxesStr += boxStr('BleedBox', bleedBox);
    if (trim) boxesStr += boxStr('TrimBox', trim);
    if (print.artBox) boxesStr += boxStr('ArtBox', print.artBox);
    if (print.userUnit !== undefined && print.userUnit !== 1) {
        boxesStr += ` /UserUnit ${fmtNum(print.userUnit)}`;
    }
    return { boxesStr, trim };
}

/** One quarter-circle as a cubic Bézier (κ ≈ 0.5523). */
const K = 0.55228475;

function circleOps(cx: number, cy: number, r: number): string {
    const k = K * r;
    return `${fmtNum(cx + r)} ${fmtNum(cy)} m `
        + `${fmtNum(cx + r)} ${fmtNum(cy + k)} ${fmtNum(cx + k)} ${fmtNum(cy + r)} ${fmtNum(cx)} ${fmtNum(cy + r)} c `
        + `${fmtNum(cx - k)} ${fmtNum(cy + r)} ${fmtNum(cx - r)} ${fmtNum(cy + k)} ${fmtNum(cx - r)} ${fmtNum(cy)} c `
        + `${fmtNum(cx - r)} ${fmtNum(cy - k)} ${fmtNum(cx - k)} ${fmtNum(cy - r)} ${fmtNum(cx)} ${fmtNum(cy - r)} c `
        + `${fmtNum(cx + k)} ${fmtNum(cy - r)} ${fmtNum(cx + r)} ${fmtNum(cy - k)} ${fmtNum(cx + r)} ${fmtNum(cy)} c S`;
}

/**
 * Build the printer's-marks operator block for one page geometry. Called
 * once per document; the returned string is appended to every page's
 * content stream after the main content (the watermark/debug-overlay
 * precedent). All strokes stay strictly outside the TrimBox.
 */
export function buildPrinterMarksOps(
    trim: PageBox,
    pgW: number,
    pgH: number,
    marks: boolean | PrinterMarksOptions,
): string {
    const opts: PrinterMarksOptions = marks === true ? {} : (marks as PrinterMarksOptions);
    const drawCrop = opts.crop ?? true;
    const drawReg = opts.registration ?? true;
    const length = opts.length ?? 14;
    const offset = opts.offset ?? 5;
    const weight = opts.weight ?? 0.25;

    const [tx0, ty0, tx1, ty1] = trim;
    const ops: string[] = ['q', `0 0 0 RG ${fmtNum(weight)} w`];
    const line = (x1: number, y1: number, x2: number, y2: number): void => {
        ops.push(`${fmtNum(x1)} ${fmtNum(y1)} m ${fmtNum(x2)} ${fmtNum(y2)} l S`);
    };
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

    if (drawCrop) {
        // Two hairlines per corner, starting `offset` past the trim edge and
        // extending `length` outward (clamped to the media edge).
        for (const [cx, cy, dx, dy] of [
            [tx0, ty0, -1, -1], [tx1, ty0, 1, -1],
            [tx0, ty1, -1, 1], [tx1, ty1, 1, 1],
        ] as const) {
            // Horizontal stroke (aligned with the trim's horizontal edge).
            const hx0 = clamp(cx + dx * offset, 0, pgW);
            const hx1 = clamp(cx + dx * (offset + length), 0, pgW);
            if (hx0 !== hx1) line(hx0, cy, hx1, cy);
            // Vertical stroke.
            const vy0 = clamp(cy + dy * offset, 0, pgH);
            const vy1 = clamp(cy + dy * (offset + length), 0, pgH);
            if (vy0 !== vy1) line(cx, vy0, cx, vy1);
        }
    }

    if (drawReg) {
        // Registration targets (circle + cross) on the four edge midpoints,
        // centred in the strip between the trim edge and the media edge.
        const r = Math.min(4, Math.max(2, length / 4));
        const midX = (tx0 + tx1) / 2;
        const midY = (ty0 + ty1) / 2;
        const targets: Array<readonly [number, number] | null> = [
            ty0 - offset - r >= 0 ? [midX, ty0 - offset - r] : null,          // bottom
            ty1 + offset + r <= pgH ? [midX, ty1 + offset + r] : null,        // top
            tx0 - offset - r >= 0 ? [tx0 - offset - r, midY] : null,          // left
            tx1 + offset + r <= pgW ? [tx1 + offset + r, midY] : null,        // right
        ];
        for (const target of targets) {
            if (!target) continue;
            const [cx, cy] = target;
            ops.push(circleOps(cx, cy, r));
            line(cx - r * 1.4, cy, cx + r * 1.4, cy);
            line(cx, cy - r * 1.4, cx, cy + r * 1.4);
        }
    }

    ops.push('Q');
    return ops.length > 3 ? ops.join('\n') : '';
}