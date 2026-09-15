/**
 * pdfnative — PDF Text Primitives
 * =================================
 * Low-level PDF content stream operators for text rendering.
 * Supports both Latin (WinAnsi) and Unicode (CIDFont) modes.
 */

import type { FontData, ShapedGlyph, EncodingContext } from '../types/pdf-types.js';
import { toWinAnsi, helveticaWidth, helveticaBoldWidth, stripSoftHyphens } from '../fonts/encoding.js';
import { exactBase14Width } from '../fonts/base14-metrics.js';
import { stripBidiControls } from '../shaping/bidi.js';
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
        } else if (run.tjStr) {
            // Kerned: one TJ array keeps the run a single text-showing
            // operator, so viewer selection and extraction stay intact.
            parts.push(`BT ${run.fontRef} ${sz} Tf ${fmtNum(penX)} ${fmtNum(y)} Td [${run.tjStr}] TJ ET`);
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
    const width = measureFor(str, sz, enc, bold);
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
    const width = measureFor(str, sz, enc, bold);
    return txt(str, leftX + (colW - width) / 2, y, font, sz, enc);
}

/**
 * Measure a string the way {@link txtR} and {@link txtC} do, so justified
 * placement agrees with right- and centre-alignment.
 *
 * The estimate takes the Unicode string: it branches on the codepoints of
 * the CP1252 punctuation (— … “ ” ‘ ’) and strips soft hyphens and bidi
 * controls itself, so handing it WinAnsi bytes made every one of those
 * characters measure at the 556-unit default. The AFM table is indexed by
 * WinAnsi byte, so the invisible characters are stripped before mapping.
 */
function measureFor(str: string, sz: number, enc: EncodingContext, bold: boolean = false): number {
    if (enc.isUnicode) return enc.tw(str, sz);
    if (enc.metrics === 'exact') {
        return exactBase14Width(toWinAnsi(stripSoftHyphens(stripBidiControls(str))), sz, bold);
    }
    return bold ? helveticaBoldWidth(str, sz) : helveticaWidth(str, sz);
}

/**
 * A gap wider than this multiple of the natural space is a river down the
 * page, not justification. Such a line is left ragged instead.
 */
const MAX_JUSTIFY_STRETCH = 3;

/**
 * How far a character may hang past the measure, as a fraction of its own
 * advance.
 *
 * Punctuation is mostly white space inside its own box, so a line beginning
 * with an opening quote or ending in a full stop *looks* indented even though
 * its glyph origin is exactly on the margin. Letting those glyphs protrude
 * makes the optical edge straight — the difference between a page that looks
 * typeset and one that looks generated.
 *
 * Values are conservative: a half advance for the marks that are almost all
 * white, a third for dashes, less for the taller marks.
 */
const PROTRUSION: Readonly<Record<string, number>> = {
    '"': 0.5, "'": 0.5,
    '‘': 0.5, '’': 0.5, // ‘ ’
    '“': 0.5, '”': 0.5, // “ ”
    '«': 0.4, '»': 0.4, // « »
    '.': 0.5, ',': 0.5,
    '-': 0.33, '–': 0.33, '—': 0.33, // - – —
    ':': 0.25, ';': 0.25,
    '!': 0.2, '?': 0.2,
    '(': 0.2, ')': 0.2, '[': 0.2, ']': 0.2,
};

/** Points by which a line's first character should hang left of the measure. */
export function protrusionLeft(line: string, sz: number, enc: EncodingContext): number {
    const ch = line[0];
    const frac = ch === undefined ? undefined : PROTRUSION[ch];
    return frac === undefined ? 0 : measureFor(ch as string, sz, enc) * frac;
}

/** Points by which a line's last character may hang right of the measure. */
export function protrusionRight(line: string, sz: number, enc: EncodingContext): number {
    const ch = line[line.length - 1];
    const frac = ch === undefined ? undefined : PROTRUSION[ch];
    return frac === undefined ? 0 : measureFor(ch as string, sz, enc) * frac;
}

/**
 * Justified text: lay the line's words out so it spans exactly `targetWidth`.
 *
 * The whole line is one `[…] TJ` array: each word keeps its trailing space
 * glyph and is followed by a negative adjustment that opens the gap by the
 * line's share of the slack. `Tw` would be the textbook operator, but it
 * applies only to single-byte code 32 — it has no effect at all on the
 * Identity-H CID fonts every non-Latin script uses (ISO 32000-1 §9.3.3).
 * `TJ` adjustments behave identically in both modes, keep the space
 * characters in the stream so viewers, search and `extractText()` still see
 * word boundaries, and keep the line a single text object rather than one
 * per word.
 *
 * Falls back to plain left-aligned output when the line has a single word,
 * already overruns, or would need an implausible stretch.
 *
 * @since 1.8.0
 */
export function txtJustified(
    str: string,
    x: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    targetWidth: number,
): string {
    // Split on plain spaces only: a no-break space is part of its word, which
    // is precisely what makes "150 €" survive justification intact.
    const words = str.split(' ').filter(w => w !== '');
    if (words.length < 2) return txt(str, x, y, font, sz, enc);

    // Each word carries its trailing space so the space glyph is emitted; the
    // last word does not. Measured as emitted, so kerning across the word /
    // space boundary is accounted for in Unicode mode.
    const pieces = words.map((w, i) => (i === words.length - 1 ? w : `${w} `));
    const runs = enc.isUnicode ? pieces.map(p => enc.textRuns(p, sz)) : null;
    const pieceWidths = runs
        ? runs.map(rs => rs.reduce((n, r) => n + r.widthPt, 0))
        : pieces.map(p => measureFor(p, sz, enc));
    const natural = pieceWidths.reduce((a, b) => a + b, 0);
    const extra = targetWidth - natural;
    const spaceW = measureFor(' ', sz, enc);
    if (extra <= 0 || extra / (words.length - 1) > spaceW * MAX_JUSTIFY_STRETCH) {
        return txt(str, x, y, font, sz, enc);
    }

    const gapExtra = extra / (words.length - 1);
    // TJ numbers are thousandths of the font size, subtracted from the pen
    // (ISO 32000-1 §9.4.3): a negative number widens the gap.
    const tjGap = fmtNum(-(gapExtra * 1000 / sz));

    if (runs === null) {
        const items: string[] = [];
        for (let i = 0; i < pieces.length; i++) {
            items.push(enc.ps(pieces[i]));
            if (i < pieces.length - 1) items.push(tjGap);
        }
        return `BT ${font} ${sz} Tf ${fmtNum(x)} ${fmtNum(y)} Td [${items.join(' ')}] TJ ET`;
    }

    // Unicode: consecutive plain runs of one font share a TJ array; a shaped
    // or colour-emoji run is placed on its own, as `txt()` does, and the
    // array resumes after it.
    const parts: string[] = [];
    let penX = x;
    let segFont: string | null = null;
    let segStart = 0;
    let segAdvance = 0;
    let segItems: string[] = [];
    const flush = (): void => {
        if (segFont === null) return;
        parts.push(`BT ${segFont} ${sz} Tf ${fmtNum(segStart)} ${fmtNum(y)} Td [${segItems.join(' ')}] TJ ET`);
        penX = segStart + segAdvance;
        segFont = null;
        segAdvance = 0;
        segItems = [];
    };

    for (let i = 0; i < pieces.length; i++) {
        for (const run of runs[i]) {
            const emoji = enc.colorEmoji !== undefined && run.fontData.colorGlyphs !== undefined && run.hexStr !== null;
            if (run.shaped || emoji || run.hexStr === null) {
                flush();
                if (emoji) {
                    penX = emitColorEmojiRun(parts, run, penX, y, sz, enc);
                } else if (run.shaped) {
                    parts.push(txtShaped(run.shaped, penX, y, run.fontRef, sz, run.fontData));
                    penX += run.widthPt;
                }
                continue;
            }
            if (segFont !== null && segFont !== run.fontRef) flush();
            if (segFont === null) { segFont = run.fontRef; segStart = penX; }
            segItems.push(run.tjStr ?? run.hexStr);
            segAdvance += run.widthPt;
        }
        if (i < pieces.length - 1) {
            if (segFont !== null) { segItems.push(tjGap); segAdvance += gapExtra; }
            else penX += gapExtra;
        }
    }
    flush();
    return parts.join('\n');
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
