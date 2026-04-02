/**
 * pdfnative — PDF Text Primitives
 * =================================
 * Low-level PDF content stream operators for text rendering.
 * Supports both Latin (WinAnsi) and Unicode (CIDFont) modes.
 * Tagged mode wraps text in /Span marked content with /ActualText.
 */

import type { FontData, ShapedGlyph, EncodingContext } from '../types/pdf-types.js';
import { toWinAnsi, helveticaWidth } from '../fonts/encoding.js';
import { wrapSpan } from './pdf-tags.js';

/** Format a number as PDF operator value (2 decimal places). */
export const fmtNum = (v: number): string => v.toFixed(2);

/**
 * Render pre-shaped glyphs with GPOS offsets.
 * Each glyph emits its own BT…ET block with absolute coordinates.
 */
export function txtShaped(
    shaped: ShapedGlyph[],
    x: number,
    y: number,
    font: string,
    sz: number,
    fontData: FontData
): string {
    const { metrics, widths: glyphWidths, defaultWidth } = fontData;
    const upm = metrics.unitsPerEm;
    const scale = sz / upm;
    const parts: string[] = [];
    let penX = x;

    for (const g of shaped) {
        const hexGid = g.gid.toString(16).padStart(4, '0').toUpperCase();
        const adv = (glyphWidths[g.gid] !== undefined ? glyphWidths[g.gid] : defaultWidth) * scale;
        const gx = fmtNum(penX + g.dx * scale);
        const gy = fmtNum(y + g.dy * scale);
        parts.push(`BT ${font} ${sz} Tf ${gx} ${gy} Td <${hexGid}> Tj ET`);
        if (!g.isZeroAdvance) penX += adv;
    }

    return parts.join('\n');
}

/**
 * Text at absolute position (x, y) with font.
 * Multi-font: splits text into runs by cmap coverage.
 */
export function txt(
    str: string,
    x: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext
): string {
    if (!enc.isUnicode) {
        return `BT ${font} ${sz} Tf ${fmtNum(x)} ${fmtNum(y)} Td ${enc.ps(str)} Tj ET`;
    }

    const runs = enc.textRuns(str, sz);
    if (runs.length === 0) return '';

    if (runs.length === 1) {
        const run = runs[0];
        if (run.shaped) return txtShaped(run.shaped, x, y, run.fontRef, sz, run.fontData);
        return `BT ${run.fontRef} ${sz} Tf ${fmtNum(x)} ${fmtNum(y)} Td ${run.hexStr} Tj ET`;
    }

    const parts: string[] = [];
    let penX = x;
    for (const run of runs) {
        if (run.shaped) {
            parts.push(txtShaped(run.shaped, penX, y, run.fontRef, sz, run.fontData));
        } else {
            parts.push(`BT ${run.fontRef} ${sz} Tf ${fmtNum(penX)} ${fmtNum(y)} Td ${run.hexStr} Tj ET`);
        }
        penX += run.widthPt;
    }
    return parts.join('\n');
}

/** Right-aligned text: rightX is the right boundary. */
export function txtR(
    str: string,
    rightX: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext
): string {
    const width = enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(toWinAnsi(str), sz);
    return txt(str, rightX - width, y, font, sz, enc);
}

/** Center-aligned text within a column. */
export function txtC(
    str: string,
    leftX: number,
    y: number,
    font: string,
    sz: number,
    colW: number,
    enc: EncodingContext
): string {
    const width = enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(toWinAnsi(str), sz);
    return txt(str, leftX + (colW - width) / 2, y, font, sz, enc);
}

// ── Tagged variants ─────────────────────────────────────────────────
// These wrap the rendered text operators in /Span << /ActualText >> BDC...EMC
// for PDF/UA accessibility and text extraction fidelity.

/**
 * Tagged text at absolute position — wraps output in /Span with /ActualText.
 * @param mcid - Marked content identifier for linking to structure tree
 */
export function txtTagged(
    str: string,
    x: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    mcid: number,
): string {
    const content = txt(str, x, y, font, sz, enc);
    return wrapSpan(content, str, mcid);
}

/** Tagged right-aligned text. */
export function txtRTagged(
    str: string,
    rightX: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    mcid: number,
): string {
    const content = txtR(str, rightX, y, font, sz, enc);
    return wrapSpan(content, str, mcid);
}

/** Tagged center-aligned text. */
export function txtCTagged(
    str: string,
    leftX: number,
    y: number,
    font: string,
    sz: number,
    colW: number,
    enc: EncodingContext,
    mcid: number,
): string {
    const content = txtC(str, leftX, y, font, sz, colW, enc);
    return wrapSpan(content, str, mcid);
}
