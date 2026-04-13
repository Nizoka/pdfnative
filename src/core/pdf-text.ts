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

/**
 * Format a number as PDF operator value (2 decimal places).
 *
 * @param v - Numeric value
 * @returns Formatted string with 2 decimal places
 */
export const fmtNum = (v: number): string => v.toFixed(2);

/**
 * Render pre-shaped glyphs with GPOS offsets.
 * Each glyph emits its own BT…ET block with absolute coordinates.
 *
 * @param shaped - Array of shaped glyphs with glyph IDs and offsets
 * @param x - Left X position in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference (e.g. '/F3')
 * @param sz - Font size in points
 * @param fontData - Font data with metrics and glyph widths
 * @returns PDF content stream operators string
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
 *
 * @param str - Text string to render
 * @param x - Left X position in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference (e.g. '/F1')
 * @param sz - Font size in points
 * @param enc - Encoding context for font selection and text encoding
 * @returns PDF content stream operators string
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

/**
 * Right-aligned text: rightX is the right boundary.
 *
 * @param str - Text string to render
 * @param rightX - Right boundary X position in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference
 * @param sz - Font size in points
 * @param enc - Encoding context
 * @returns PDF content stream operators string
 */
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

/**
 * Center-aligned text within a column.
 *
 * @param str - Text string to render
 * @param leftX - Left edge X position of the column in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference
 * @param sz - Font size in points
 * @param colW - Column width in points
 * @param enc - Encoding context
 * @returns PDF content stream operators string
 */
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
 *
 * @param str - Text string to render
 * @param x - Left X position in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference
 * @param sz - Font size in points
 * @param enc - Encoding context
 * @param mcid - Marked content identifier for linking to structure tree
 * @returns PDF content stream operators wrapped in BDC/EMC
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

/**
 * Tagged right-aligned text.
 *
 * @param str - Text string to render
 * @param rightX - Right boundary X position in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference
 * @param sz - Font size in points
 * @param enc - Encoding context
 * @param mcid - Marked content identifier
 * @returns PDF content stream operators wrapped in BDC/EMC
 */
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

/**
 * Tagged center-aligned text.
 *
 * @param str - Text string to render
 * @param leftX - Left edge X position of the column in points
 * @param y - Baseline Y position in points
 * @param font - PDF font reference
 * @param sz - Font size in points
 * @param colW - Column width in points
 * @param enc - Encoding context
 * @param mcid - Marked content identifier
 * @returns PDF content stream operators wrapped in BDC/EMC
 */
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

/**
 * Encode a string for a PDF /Info text string entry (ISO 32000-1 §7.9.2).
 *
 * If all codepoints fit PDFDocEncoding (≤ U+00FF, excluding undefined slots),
 * returns an escaped PDF literal string `(...)`.
 * Otherwise returns a UTF-16BE hex string `<FEFF...>`.
 */
export function encodePdfTextString(str: string): string {
    if (canPDFDocEncode(str)) {
        const escaped = str
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
        return `(${escaped})`;
    }
    // UTF-16BE with BOM
    const codes: string[] = ['FEFF'];
    for (let i = 0; i < str.length; i++) {
        const cp = str.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) {
            // Surrogate pair
            const hi = 0xD800 + ((cp - 0x10000) >> 10);
            const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
            codes.push(hi.toString(16).toUpperCase().padStart(4, '0'));
            codes.push(lo.toString(16).toUpperCase().padStart(4, '0'));
            i++; // skip surrogate pair
        } else {
            codes.push(cp.toString(16).toUpperCase().padStart(4, '0'));
        }
    }
    return `<${codes.join('')}>`;
}

/** PDFDocEncoding undefined slots (ISO 32000-1 Table D.2): bytes with no defined character. */
const PDF_DOC_UNDEF = new Set([0x7F, 0x80, 0xAD]);

function canPDFDocEncode(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        const cp = str.charCodeAt(i);
        if (cp > 0xFF) return false;
        if (PDF_DOC_UNDEF.has(cp)) return false;
    }
    return true;
}
