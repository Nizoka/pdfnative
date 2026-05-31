/**
 * pdfnative — PDF Text Primitives
 * =================================
 * Low-level PDF content stream operators for text rendering.
 * Supports both Latin (WinAnsi) and Unicode (CIDFont) modes.
 */

import type { FontData, ShapedGlyph, EncodingContext } from '../types/pdf-types.js';
import { toWinAnsi, helveticaWidth, helveticaBoldWidth } from '../fonts/encoding.js';
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

/** Format a scale factor with finer precision (emoji `cm` scaling). */
const fmtScale = (v: number): string => v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '') || '0';

/**
 * Emit a colour-emoji run: each glyph is drawn as a colour Form XObject
 * (`q s 0 0 s x y cm /CEmK Do Q`) instead of a `Tj`. Glyphs the COLR engine
 * cannot render fall back to a normal `Tj` (monochrome). Returns the advanced
 * pen x position.
 */
function emitColorEmojiRun(
    parts: string[],
    run: { fontRef: string; fontData: FontData; hexStr: string | null },
    penX: number,
    y: number,
    sz: number,
    enc: EncodingContext,
): number {
    const fd = run.fontData;
    const upm = fd.metrics.unitsPerEm;
    const scale = sz / upm;
    const s = fmtScale(scale);
    const hex = (run.hexStr ?? '').replace(/[<>]/g, '');
    for (let i = 0; i + 4 <= hex.length; i += 4) {
        const tag = hex.substr(i, 4);
        const gid = parseInt(tag, 16);
        const adv = (fd.widths[gid] !== undefined ? fd.widths[gid] : fd.defaultWidth) * scale;
        const name = enc.colorEmoji?.useGlyph(fd, gid) ?? null;
        if (name) {
            parts.push(`q ${s} 0 0 ${s} ${fmtNum(penX)} ${fmtNum(y)} cm /${name} Do Q`);
        } else {
            parts.push(`BT ${run.fontRef} ${sz} Tf ${fmtNum(penX)} ${fmtNum(y)} Td <${tag}> Tj ET`);
        }
        penX += adv;
    }
    return penX;
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

    const parts: string[] = [];
    let penX = x;
    for (const run of runs) {
        if (enc.colorEmoji && run.fontData.colorGlyphs && run.hexStr) {
            penX = emitColorEmojiRun(parts, run, penX, y, sz, enc);
        } else if (run.shaped) {
            parts.push(txtShaped(run.shaped, penX, y, run.fontRef, sz, run.fontData));
            penX += run.widthPt;
        } else {
            parts.push(`BT ${run.fontRef} ${sz} Tf ${fmtNum(penX)} ${fmtNum(y)} Td ${run.hexStr} Tj ET`);
            penX += run.widthPt;
        }
    }
    return parts.join('\n');
}

/**
 * Right-aligned text: `rightX` is the right boundary.
 *
 * When `bold` is `true` and the encoding context is in Latin (WinAnsi) mode,
 * width is measured with Helvetica-Bold AFM advances ({@link helveticaBoldWidth})
 * so the rendered right edge of bold glyphs lands exactly at `rightX`.
 * Unicode (CIDFont) mode is unaffected — `enc.tw` already routes through the
 * correct font data. Defaults to `false` for backward compatibility.
 *
 * @since 1.2.0 — the `bold` parameter.
 */
export function txtR(
    str: string,
    rightX: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    bold: boolean = false,
): string {
    const width = enc.isUnicode
        ? enc.tw(str, sz)
        : (bold ? helveticaBoldWidth(str, sz) : helveticaWidth(toWinAnsi(str), sz));
    return txt(str, rightX - width, y, font, sz, enc);
}

/**
 * Centre-aligned text within a column.
 *
 * When `bold` is `true` and the encoding context is in Latin (WinAnsi) mode,
 * width is measured with Helvetica-Bold AFM advances ({@link helveticaBoldWidth})
 * so bold text is correctly centred. Unicode (CIDFont) mode is unaffected.
 * Defaults to `false` for backward compatibility.
 *
 * @since 1.2.0 — the `bold` parameter.
 */
export function txtC(
    str: string,
    leftX: number,
    y: number,
    font: string,
    sz: number,
    colW: number,
    enc: EncodingContext,
    bold: boolean = false,
): string {
    const width = enc.isUnicode
        ? enc.tw(str, sz)
        : (bold ? helveticaBoldWidth(str, sz) : helveticaWidth(toWinAnsi(str), sz));
    return txt(str, leftX + (colW - width) / 2, y, font, sz, enc);
}

/** Tagged text at absolute position — wraps in /Span BDC…EMC with /ActualText. */
export function txtTagged(
    str: string,
    x: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    mcid: number,
): string {
    return wrapSpan(txt(str, x, y, font, sz, enc), str, mcid);
}

/**
 * Tagged right-aligned text — wraps in /Span BDC…EMC with /ActualText.
 *
 * @since 1.2.0 — the `bold` parameter.
 */
export function txtRTagged(
    str: string,
    rightX: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    mcid: number,
    bold: boolean = false,
): string {
    return wrapSpan(txtR(str, rightX, y, font, sz, enc, bold), str, mcid);
}

/**
 * Tagged centre-aligned text — wraps in /Span BDC…EMC with /ActualText.
 *
 * @since 1.2.0 — the `bold` parameter.
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
    bold: boolean = false,
): string {
    return wrapSpan(txtC(str, leftX, y, font, sz, colW, enc, bold), str, mcid);
}

/**
 * Encode a string for the PDF /Info dictionary (ISO 32000-1 §7.9.2).
 * ASCII-only → PDFDocEncoding literal `(str)`.
 * Non-ASCII → UTF-16BE hex string `<FEFF...>`.
 */
export function encodePdfTextString(str: string): string {
    // Check if all codepoints are in the printable ASCII range
    let ascii = true;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c > 126 || c < 32) { ascii = false; break; }
    }
    if (ascii) {
        // PDFDocEncoding literal — escape special chars
        const escaped = str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        return `(${escaped})`;
    }
    // UTF-16BE hex string with BOM
    let hex = 'FEFF';
    for (let i = 0; i < str.length; i++) {
        const cp = str.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) {
            const hi = 0xD800 + ((cp - 0x10000) >> 10);
            const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
            hex += hi.toString(16).padStart(4, '0').toUpperCase();
            hex += lo.toString(16).padStart(4, '0').toUpperCase();
            i++;
        } else {
            hex += cp.toString(16).padStart(4, '0').toUpperCase();
        }
    }
    return `<${hex}>`;
}
