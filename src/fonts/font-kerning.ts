/**
 * pdfnative — Pair kerning application (v1.8.0)
 * ===============================================
 * Applies a font's GPOS pair adjustments to already-built text runs.
 *
 * Kerning is the difference between "AV" set with two nominal advances and
 * "AV" set the way the designer drew it. pdfnative extracted none of it
 * before v1.8.0: the font-data generator skipped every GPOS lookup that was
 * not mark positioning, so every pair in every script was set loose.
 *
 * Adjustments are emitted as a `TJ` array rather than by moving the pen,
 * because `TJ` keeps the whole run inside one text-showing operator: the
 * viewer's own text extraction, selection and search stay intact, which
 * per-glyph `Td` placement would fragment.
 *
 * @module fonts/font-kerning
 */

import type { FontData, TextRun, KernTable } from '../types/pdf-types.js';

/**
 * Adjustment for one glyph pair, in design units, or 0 when they do not kern.
 *
 * Explicit glyph pairs win over class-based subtables, and the first
 * subtable that yields an adjustment wins — OpenType applies one lookup per
 * pair, not the sum of all of them.
 *
 * @since 1.8.0
 */
export function kernPair(table: KernTable, left: number, right: number): number {
    const direct = table.p?.[left]?.[right];
    if (direct !== undefined) return direct;

    if (table.c) {
        for (const sub of table.c) {
            // The left glyph is gated by the subtable's coverage, so absence
            // means the subtable does not apply. The right glyph is not: a
            // glyph the ClassDef omits is class 0 (OpenType §ClassDef).
            const c1 = sub.l[left];
            if (c1 === undefined) continue;
            const c2 = sub.r[right] ?? 0;
            const adjust = sub.m[c1 * sub.n + c2];
            if (adjust !== undefined && adjust !== 0) return adjust;
        }
    }
    return 0;
}

/**
 * PDF's `TJ` numbers are thousandths of an em, **subtracted** from the pen
 * position (ISO 32000-1 §9.4.3). A kern of −40 design units therefore has to
 * be written as +40 after scaling.
 */
const TJ_SCALE = 1000;

/** Split a run's `<hex>` glyph string into glyph ids, or `null` if malformed. */
function parseGids(hexStr: string): number[] | null {
    if (!hexStr.startsWith('<') || !hexStr.endsWith('>')) return null;
    const body = hexStr.slice(1, -1);
    if (body.length === 0 || body.length % 4 !== 0) return null;
    const gids: number[] = [];
    for (let i = 0; i < body.length; i += 4) {
        const n = Number.parseInt(body.slice(i, i + 4), 16);
        if (Number.isNaN(n)) return null;
        gids.push(n);
    }
    return gids;
}

const hex4 = (g: number): string => g.toString(16).toUpperCase().padStart(4, '0');

/**
 * Build the `TJ` operand for a glyph sequence, or `null` when no pair in it
 * kerns — in which case the caller keeps the cheaper `Tj` form.
 *
 * @param gids Glyph ids, in visual order.
 * @param fd   Font supplying the pair table.
 * @returns `{ tj, adjustDesign }` where `adjustDesign` is the total advance
 *   change in design units (negative tightens).
 */
export function buildKernedTJ(
    gids: readonly number[],
    fd: FontData,
): { tj: string; adjustDesign: number } | null {
    const table = fd.kern;
    if (!table || gids.length < 2) return null;

    let total = 0;
    const parts: string[] = [];
    let run = '';

    for (let i = 0; i < gids.length; i++) {
        run += hex4(gids[i]);
        const next = i + 1 < gids.length ? gids[i + 1] : -1;
        const adjust = next >= 0 ? kernPair(table, gids[i], next) : 0;
        if (adjust !== 0) {
            parts.push(`<${run}>`);
            run = '';
            // Scale design units to the em/1000 grid TJ uses, and invert:
            // TJ subtracts, so a negative kern is written positive.
            const upm = fd.metrics.unitsPerEm || 1000;
            parts.push(String(-Math.round(adjust * TJ_SCALE / upm)));
            total += adjust;
        }
    }
    if (run.length > 0) parts.push(`<${run}>`);
    if (total === 0) return null;

    return { tj: parts.join(' '), adjustDesign: total };
}

/**
 * Apply pair kerning to text runs, attaching a `TJ` operand and correcting
 * the advance where pairs kern.
 *
 * Shaped runs are left untouched: a shaper has already positioned every
 * glyph, and GPOS pair adjustments for those scripts belong inside the
 * shaper rather than bolted on afterwards.
 *
 * @param runs Runs from `EncodingContext.textRuns()`.
 * @param sz   Font size in points, for the corrected advance.
 */
export function applyKerningToRuns(runs: readonly TextRun[], sz: number): TextRun[] {
    const out: TextRun[] = [];
    for (const run of runs) {
        if (run.shaped || !run.hexStr || !run.fontData.kern) { out.push(run); continue; }
        const gids = parseGids(run.hexStr);
        if (gids === null) { out.push(run); continue; }

        const kerned = buildKernedTJ(gids, run.fontData);
        if (kerned === null) { out.push(run); continue; }

        const upm = run.fontData.metrics.unitsPerEm || 1000;
        out.push({
            ...run,
            tjStr: kerned.tj,
            widthPt: run.widthPt + kerned.adjustDesign * sz / upm,
        });
    }
    return out;
}
