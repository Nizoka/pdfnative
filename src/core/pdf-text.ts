/**
 * pdfnative — PDF Text Primitives
 * =================================
 * Low-level PDF content stream operators for text rendering.
 * Supports both Latin (WinAnsi) and Unicode (CIDFont) modes.
 */

import type { FontData, ShapedGlyph, EncodingContext, TextRun } from '../types/pdf-types.js';
import { toWinAnsi, helveticaWidth, helveticaBoldWidth, stripSoftHyphens, narrowNoBreakSpaceCorrection } from '../fonts/encoding.js';
import { exactBase14Width } from '../fonts/base14-metrics.js';
import { stripBidiControls, containsRTL } from '../shaping/bidi.js';
import { wrapSpan, escapePdfUtf16 } from './pdf-tags.js';

/** Format a number as PDF operator value (2 decimal places). */
export const fmtNum = (v: number): string => v.toFixed(2);

// ── Text objects ─────────────────────────────────────────────────────

/**
 * One text object under construction (ISO 32000-1 §9.4): `BT`, then for
 * every run a `Tf` when the font or size changes, a `Td` relative to the
 * current line origin and one text-showing operator, and `ET` at the end.
 *
 * Every operator of a line or cell lives in this one object (1.9.0, C25).
 * Acrobat applies a `/Span /ActualText` once per text object inside it, so a
 * line drawn as one `BT … ET` per glyph pasted the cell's text once per
 * glyph; Skia and Chrome write one object per run, and so does this. The
 * single-run line keeps the historical bytes: `BT /F3 9 Tf x y Td <…> Tj ET`.
 */
interface TextObject {
    /** Operators so far, starting with `BT`. */
    text: string;
    /** The font and size the last `Tf` selected. */
    font: string | null;
    size: number;
    /** Origin of the current line (`Tlm`), in hundredths of a point — exact integer arithmetic for relative `Td`. */
    ox: number;
    oy: number;
    /** Runs placed so far — the second one onwards starts a new line of the stream. */
    moves: number;
    /** A marked-content operator was just written: the next run starts a new line too. */
    breakBefore: boolean;
}

/** Open a text object. */
function openTextObject(): TextObject {
    return { text: 'BT', font: null, size: 0, ox: 0, oy: 0, moves: 0, breakBefore: false };
}

/** Append an operator: on the same line by default, on a new one for the second run onwards. */
function appendOp(t: TextObject, op: string, newLine: boolean = false): void {
    t.text += (newLine ? '\n' : ' ') + op;
}

/** Append a marked-content operator (`BDC` / `EMC`) on a line of its own. */
function appendMarkedContent(t: TextObject, op: string): void {
    appendOp(t, op, true);
    t.breakBefore = true;
}

/** Hundredths of a point of a coordinate as `fmtNum` would print it. */
const hundredths = (v: number): number => Math.round(Number(fmtNum(v)) * 100);

/** Print hundredths of a point as a PDF number. */
const fmtHundredths = (h: number): string => (h / 100).toFixed(2);

/**
 * Select `font` at `sz` (when they change) and move the line origin to
 * (x, y) with a `Td` relative to the current origin. The first move of an
 * object is the absolute position, byte for byte what the per-run `BT`
 * blocks of earlier releases wrote; the origin is tracked in hundredths so
 * a chain of relative moves lands exactly on the rounded absolute position.
 */
function moveTo(t: TextObject, font: string, sz: number, x: number, y: number): void {
    // Each run after the first starts on a new line of the stream.
    let newLine = t.moves > 0 || t.breakBefore;
    t.moves++;
    t.breakBefore = false;
    if (t.font !== font || t.size !== sz) {
        appendOp(t, `${font} ${sz} Tf`, newLine);
        newLine = false;
        t.font = font;
        t.size = sz;
    }
    const hx = hundredths(x);
    const hy = hundredths(y);
    appendOp(t, `${fmtHundredths(hx - t.ox)} ${fmtHundredths(hy - t.oy)} Td`, newLine);
    t.ox = hx;
    t.oy = hy;
}

/** Close the object: `ET`, and the operators as one string. */
function closeTextObject(t: TextObject): string {
    return t.text + ' ET';
}

/** The x coordinate of the current line origin, in points. */
const originX = (t: TextObject): number => t.ox / 100;

/**
 * Append a shaped run to the text object at (x, y) and return the layout pen
 * after it.
 *
 * The glyphs on the baseline form one `TJ` array: each glyph is placed by the
 * adjustment between the viewer's pen (the `/W` advances, ISO 32000-1
 * §9.4.3, thousandths of the font size subtracted from the pen) and the
 * layout's pen (the font's advances, the GPOS offset `dx`, a zero advance
 * for an attached mark, the justification gap after a space). Glyphs that
 * need no adjustment share one hex string. A glyph with a vertical offset —
 * an anchored mark — is drawn by its own `Td` and `Tj`, and the array
 * resumes after it with a new `Td`. Adjustments are rounded as written and
 * fed back into the viewer's pen, so nothing drifts along a long run.
 */
function appendShapedRun(
    t: TextObject,
    shaped: readonly ShapedGlyph[],
    x: number,
    y: number,
    font: string,
    sz: number,
    fontData: FontData,
    spaceExtra: number,
    cids?: readonly number[],
): number {
    const { metrics, widths: glyphWidths, defaultWidth } = fontData;
    const scale = sz / metrics.unitsPerEm;
    /** The viewer advances by the `/W` entry (or `/DW`) in thousandths of the font size. */
    const viewerScale = sz / 1000;
    let penLayout = x;
    let penViewer = 0;
    /**
     * The segment's `Td` origin is rounded to a hundredth of a point; the
     * whole segment is shifted by that rounding rather than every glyph
     * being pulled back to its unrounded position, so a run whose glyphs the
     * `/W` advances already place carries no adjustment at all.
     */
    let shift = 0;
    let open = false;
    let items: string[] = [];
    let hex = '';
    const flushHex = (): void => {
        if (hex !== '') { items.push(`<${hex}>`); hex = ''; }
    };
    const flushArray = (): void => {
        flushHex();
        if (items.length === 1 && items[0].startsWith('<')) appendOp(t, `${items[0]} Tj`);
        else if (items.length > 0) appendOp(t, `[${items.join(' ')}] TJ`);
        items = [];
        open = false;
    };

    for (let i = 0; i < shaped.length; i++) {
        const g = shaped[i];
        const w = glyphWidths[g.gid] !== undefined ? glyphWidths[g.gid] : defaultWidth;
        // The code shown is the document's CID (C28); the glyph id when none was allotted.
        const gid = (cids !== undefined ? cids[i] : g.gid).toString(16).padStart(4, '0').toUpperCase();
        const gx = penLayout + g.dx * scale;
        if (g.dy !== 0) {
            flushArray();
            moveTo(t, font, sz, gx, y + g.dy * scale);
            appendOp(t, `<${gid}> Tj`);
        } else {
            if (!open) {
                moveTo(t, font, sz, gx, y);
                penViewer = originX(t);
                shift = penViewer - gx;
                open = true;
            } else {
                const adj = fmtNum((penViewer - (gx + shift)) * 1000 / sz);
                if (Number(adj) !== 0) {
                    flushHex();
                    items.push(adj);
                    penViewer -= Number(adj) * viewerScale;
                }
            }
            hex += gid;
            penViewer += w * viewerScale;
        }
        if (!g.isZeroAdvance) penLayout += w * scale;
        // Justification widens the word gaps inside a shaped run (1.9.0).
        if (spaceExtra !== 0 && isSpaceGlyph(g, fontData)) penLayout += spaceExtra;
    }
    flushArray();
    return penLayout;
}

/**
 * Render pre-shaped glyphs with GPOS offsets as one text object: a `TJ`
 * array per baseline segment, a `Td` + `Tj` per vertically offset mark
 * ({@link appendShapedRun}). Empty input renders nothing. `cids` are the
 * codes to show the glyphs by (`TextRun.cids`, C28); the glyph ids without.
 */
export function txtShaped(
    shaped: ShapedGlyph[],
    x: number,
    y: number,
    font: string,
    sz: number,
    fontData: FontData,
    spaceExtra: number = 0,
    cids?: readonly number[],
): string {
    if (shaped.length === 0) return '';
    const t = openTextObject();
    appendShapedRun(t, shaped, x, y, font, sz, fontData, spaceExtra, cids);
    return closeTextObject(t);
}

/** The marked-content opener of an untagged `/ActualText` span (C20), written inside the text object. */
function actualTextBdc(text: string): string {
    return `/Span << /ActualText ${escapePdfUtf16(text)} >> BDC`;
}

/** Whether a shaped glyph draws a plain space (U+0020). */
function isSpaceGlyph(g: ShapedGlyph, fontData: FontData): boolean {
    if (g.cps !== undefined) return g.cps.length === 1 && g.cps[0] === 0x20;
    const spaceGid = fontData.cmap[0x20];
    return spaceGid !== undefined && spaceGid !== 0 && g.gid === spaceGid;
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
    // The codes are the document's CIDs (C28): the glyph behind each is what names the colour form.
    const cidToGid = enc.getCidMaps?.().get(run.fontRef);
    for (let i = 0; i + 4 <= hex.length; i += 4) {
        const tag = hex.substr(i, 4);
        const code = parseInt(tag, 16);
        const gid = cidToGid?.[code] ?? code;
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

/** NARROW NO-BREAK SPACE — what `punctuationSpacing: 'fr'` puts before `; ! ?`. */
const NNBSP = ' ';
/**
 * WinAnsi has no narrow space glyph: the base-14 path shows an ordinary space
 * (278/1000 em) and pulls the pen back by this TJ adjustment so the gap is
 * the 167/1000 em of a narrow space (ISO 32000-1 §9.4.3: a positive number
 * moves the next glyph left by that many thousandths of the font size).
 * {@link narrowNoBreakSpaceWidth} measures it the same way. @since 1.9.0
 */
const NNBSP_TJ_ADJUST = '111';

/**
 * The `TJ` items that show `str` on the base-14 path: one literal when the
 * string has no narrow no-break space (the historical operand, byte for
 * byte), otherwise the pieces around each U+202F, each followed by an
 * ordinary space and the adjustment that narrows it (#roadmap, 1.9.0).
 */
export function latinTjItems(str: string, enc: EncodingContext): string[] {
    if (!str.includes(NNBSP)) return [enc.ps(str)];
    const pieces = str.split(NNBSP);
    const items: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
        if (i < pieces.length - 1) {
            items.push(enc.ps(pieces[i] + ' '), NNBSP_TJ_ADJUST);
        } else if (pieces[i].length > 0) {
            items.push(enc.ps(pieces[i]));
        }
    }
    return items;
}

/** A base-14 text-showing operator for `str`: `(…) Tj`, or a `TJ` array when a narrow space is involved. */
function latinShow(str: string, enc: EncodingContext): string {
    const items = latinTjItems(str, enc);
    return items.length === 1 ? `${items[0]} Tj` : `[${items.join(' ')}] TJ`;
}

/** Characters a shaper may drop or that name no glyph of their own: joiners, variation selectors, bidi controls, the soft hyphen. */
function isIgnorableForOrder(cp: number): boolean {
    return cp === 0x00AD || cp === 0x034F || (cp >= 0x200B && cp <= 0x200F) || (cp >= 0x202A && cp <= 0x202E)
        || (cp >= 0x2060 && cp <= 0x206F) || (cp >= 0xFE00 && cp <= 0xFE0F) || cp === 0xFEFF
        || (cp >= 0xE0100 && cp <= 0xE01EF) || cp < 0x20 || cp === 0x7F;
}

/**
 * Does the order of the code points the shaper reports for a run's glyphs
 * (visual order) differ from the run's text (logical order)? True for a
 * pre-base vowel sign drawn before its consonant, a reph moved after the
 * base, a split vowel sign (reported as its NFD parts), or a character the
 * shaper left undrawn. A glyph that reports nothing (an older shaper, or the
 * second part of a decomposed sign) is skipped; when any glyph is silent,
 * only a mismatch among the reported ones counts.
 */
function shapedOrderDiffers(text: string, shaped: readonly ShapedGlyph[]): boolean {
    let i = 0;
    const next = (): number => {
        while (i < text.length) {
            const cp = text.codePointAt(i) ?? 0;
            i += cp > 0xFFFF ? 2 : 1;
            if (!isIgnorableForOrder(cp)) return cp;
        }
        return -1;
    };
    let silent = false;
    for (const g of shaped) {
        const cps = g.cps;
        if (!cps || cps.length === 0) { silent = true; continue; }
        for (const cp of cps) {
            if (isIgnorableForOrder(cp)) continue;
            if (cp !== next()) return true;
        }
    }
    return !silent && next() !== -1;
}

/**
 * Should a shaped run carry `/ActualText` in untagged output? Thai sara am
 * (U+0E33) and Lao am (U+0EB3) are drawn as nikhahit + sara aa, which no
 * per-glyph ToUnicode mapping can recompose; and since 1.9.0 (C20) any
 * left-to-right run whose glyphs are not in the order of its text — Indic
 * pre-base signs, rephs, split vowel signs, Khmer and Myanmar pre-base
 * vowels — so extraction returns the source string in logical order, as
 * Chrome and Skia arrange. A right-to-left run is not decided here: the
 * emitters wrap every run of one bidi run in a span carrying its logical
 * text (C27, `TextRun.bidi`), and `layout.actualText: false` switches both
 * off.
 */
function needsActualText(run: TextRun, enc: EncodingContext): boolean {
    if (enc.actualText === false) return false;
    const text = run.text;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x0E33 || c === 0x0EB3) return true;
    }
    if (run.shaped === null || containsRTL(text)) return false;
    // A joiner steers the shaping (a legacy chillu, an explicit half form)
    // and leaves no glyph: only the span can give the spelling back.
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 0x200C || c === 0x200D) return true;
    }
    return shapedOrderDiffers(text, run.shaped);
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
    enc: EncodingContext,
    actualTextSpans: boolean = true,
): string {
    if (!enc.isUnicode) {
        return `BT ${font} ${sz} Tf ${fmtNum(x)} ${fmtNum(y)} Td ${latinShow(str, enc)} ET`;
    }

    const runs = enc.textRuns(str, sz);
    if (runs.length === 0) return '';

    // One text object for the whole line (C25); only a colour-emoji run, a
    // Form XObject that cannot sit inside `BT … ET`, closes it and the next
    // run opens another.
    const parts: string[] = [];
    let t: TextObject | null = null;
    let penX = x;
    // The right-to-left bidi run whose untagged /ActualText span is open
    // (C27), and the last one closed — a span closed early by a colour-emoji
    // run is not reopened, or the reader would paste its text twice.
    const rtlSpans = actualTextSpans && enc.actualText !== false;
    let openRtl = -1;
    let closedRtl = -1;
    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        if (enc.colorEmoji && run.fontData.colorGlyphs && run.hexStr) {
            if (t !== null) {
                if (openRtl >= 0) { appendMarkedContent(t, 'EMC'); closedRtl = openRtl; openRtl = -1; }
                parts.push(closeTextObject(t));
                t = null;
            }
            penX = emitColorEmojiRun(parts, run, penX, y, sz, enc);
            continue;
        }
        if (t === null) t = openTextObject();
        const rtl = run.bidi;
        if (rtlSpans && rtl !== undefined && openRtl !== rtl.run && closedRtl !== rtl.run) {
            appendMarkedContent(t, actualTextBdc(rtl.logical));
            openRtl = rtl.run;
        }
        if (run.shaped) {
            // A run whose glyphs are not in the order of its text (sara am,
            // a pre-base sign, a reph, a split vowel) carries its text as
            // /ActualText, legal in untagged output too (1.9.0, C20). The
            // tagged emitters wrap the whole string themselves and pass false;
            // a run inside a right-to-left span is covered by it (C27).
            const span = actualTextSpans && openRtl < 0 && needsActualText(run, enc);
            if (span) appendMarkedContent(t, actualTextBdc(run.text));
            appendShapedRun(t, run.shaped, penX, y, run.fontRef, sz, run.fontData, 0, run.cids);
            if (span) appendMarkedContent(t, 'EMC');
            penX += run.widthPt;
        } else if (run.tjStr) {
            // Kerned: one TJ array keeps the run a single text-showing
            // operator, so viewer selection and extraction stay intact.
            moveTo(t, run.fontRef, sz, penX, y);
            appendOp(t, `[${run.tjStr}] TJ`);
            penX += run.widthPt;
        } else {
            moveTo(t, run.fontRef, sz, penX, y);
            appendOp(t, `${run.hexStr} Tj`);
            penX += run.widthPt;
        }
        if (openRtl >= 0) {
            const next = i + 1 < runs.length ? runs[i + 1].bidi : undefined;
            if (next === undefined || next.run !== openRtl) { appendMarkedContent(t, 'EMC'); closedRtl = openRtl; openRtl = -1; }
        }
    }
    if (t !== null) parts.push(closeTextObject(t));
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
    actualTextSpans: boolean = true,
): string {
    const width = measureFor(str, sz, enc, bold);
    return txt(str, rightX - width, y, font, sz, enc, actualTextSpans);
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
    actualTextSpans: boolean = true,
): string {
    const width = measureFor(str, sz, enc, bold);
    return txt(str, leftX + (colW - width) / 2, y, font, sz, enc, actualTextSpans);
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
        return exactBase14Width(toWinAnsi(stripSoftHyphens(stripBidiControls(str))), sz, bold) - narrowNoBreakSpaceCorrection(str, sz);
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
    actualTextSpans: boolean = true,
): string {
    // Split on plain spaces only: a no-break space is part of its word, which
    // is precisely what makes "150 €" survive justification intact.
    const words = str.split(' ').filter(w => w !== '');
    if (words.length < 2) return txt(str, x, y, font, sz, enc, actualTextSpans);

    // A line with right-to-left runs — or any line of a right-to-left
    // paragraph — is justified over its visual runs: placing the words one
    // after another in logical order would reverse the reading order (1.9.0).
    if (enc.isUnicode && (enc.paragraphLevel === 1 || containsRTL(str))) {
        return txtJustifiedVisual(str, x, y, font, sz, enc, targetWidth, actualTextSpans);
    }

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
        return txt(str, x, y, font, sz, enc, actualTextSpans);
    }

    const gapExtra = extra / (words.length - 1);
    // TJ numbers are thousandths of the font size, subtracted from the pen
    // (ISO 32000-1 §9.4.3): a negative number widens the gap.
    const tjGap = fmtNum(-(gapExtra * 1000 / sz));

    if (runs === null) {
        const items: string[] = [];
        for (let i = 0; i < pieces.length; i++) {
            items.push(...latinTjItems(pieces[i], enc));
            if (i < pieces.length - 1) items.push(tjGap);
        }
        return `BT ${font} ${sz} Tf ${fmtNum(x)} ${fmtNum(y)} Td [${items.join(' ')}] TJ ET`;
    }

    // Unicode: consecutive plain runs of one font share a TJ array; a shaped
    // run is placed on its own inside the same text object, as `txt()` does,
    // and the array resumes after it; a colour-emoji run closes the object.
    const parts: string[] = [];
    const line = justifiedLine(parts, x, y, sz, enc, actualTextSpans);
    for (let i = 0; i < pieces.length; i++) {
        for (const run of runs[i]) line.add(run);
        if (i < pieces.length - 1) line.gap(tjGap, gapExtra);
    }
    line.end();
    return parts.join('\n');
}

/** What a justified layout hands the emitter for one run, beyond the run itself. */
interface JustifiedRunOptions {
    /** TJ items replacing the run's own string (its pieces around the word gaps). */
    readonly items?: readonly string[];
    /** The advance of those items, when it differs from the run's natural width. */
    readonly advance?: number;
    /** Extra width given to every space glyph of a shaped run. */
    readonly spaceExtra?: number;
}

/**
 * The emitter shared by the two justified layouts (one text object per
 * line, C25): plain runs of one font accumulate into a `TJ` array (with the
 * gap adjustments), a shaped run goes through {@link appendShapedRun} inside
 * the same text object, a colour-emoji run closes it. The array is flushed
 * with the `Td` of its start and the layout pen moves past its advance.
 */
function justifiedLine(
    parts: string[],
    x: number,
    y: number,
    sz: number,
    enc: EncodingContext,
    actualTextSpans: boolean,
): { add: (run: TextRun, opts?: JustifiedRunOptions) => void; gap: (tjGap: string, gapExtra: number) => void; end: () => void } {
    let t: TextObject | null = null;
    let penX = x;
    let segFont: string | null = null;
    let segStart = 0;
    let segAdvance = 0;
    let segItems: string[] = [];
    // The right-to-left bidi run whose untagged /ActualText span is open
    // (C27) and the last one closed, as in `txt()`.
    const rtlSpans = actualTextSpans && enc.actualText !== false;
    let openRtl = -1;
    let closedRtl = -1;

    const flush = (): void => {
        if (segFont === null) return;
        if (t === null) t = openTextObject();
        moveTo(t, segFont, sz, segStart, y);
        appendOp(t, `[${segItems.join(' ')}] TJ`);
        penX = segStart + segAdvance;
        segFont = null;
        segAdvance = 0;
        segItems = [];
    };

    /** Close the open right-to-left span, after the array it covers. */
    const closeRtl = (): void => {
        if (openRtl < 0) return;
        flush();
        if (t !== null) appendMarkedContent(t, 'EMC');
        closedRtl = openRtl;
        openRtl = -1;
    };

    const add = (run: TextRun, opts: JustifiedRunOptions = {}): void => {
        const emoji = enc.colorEmoji !== undefined && run.fontData.colorGlyphs !== undefined && run.hexStr !== null;
        const rtl = run.bidi;
        if (openRtl >= 0 && (rtl === undefined || rtl.run !== openRtl || emoji)) closeRtl();
        if (rtlSpans && !emoji && rtl !== undefined && openRtl !== rtl.run && closedRtl !== rtl.run) {
            flush();
            if (t === null) t = openTextObject();
            appendMarkedContent(t, actualTextBdc(rtl.logical));
            openRtl = rtl.run;
        }
        if (run.shaped || emoji || run.hexStr === null) {
            flush();
            if (emoji) {
                if (t !== null) { parts.push(closeTextObject(t)); t = null; }
                penX = emitColorEmojiRun(parts, run, penX, y, sz, enc);
            } else if (run.shaped) {
                if (t === null) t = openTextObject();
                const span = actualTextSpans && openRtl < 0 && needsActualText(run, enc);
                if (span) appendMarkedContent(t, actualTextBdc(run.text));
                const spaceExtra = opts.spaceExtra ?? 0;
                appendShapedRun(t, run.shaped, penX, y, run.fontRef, sz, run.fontData, spaceExtra, run.cids);
                if (span) appendMarkedContent(t, 'EMC');
                penX += run.widthPt + spaceExtra * spaceGaps(run);
            }
            return;
        }
        if (segFont !== null && segFont !== run.fontRef) flush();
        if (segFont === null) { segFont = run.fontRef; segStart = penX; }
        if (opts.items === undefined) segItems.push(run.tjStr ?? run.hexStr);
        else segItems.push(...opts.items);
        segAdvance += opts.advance ?? run.widthPt;
    };

    const gap = (tjGap: string, gapExtra: number): void => {
        if (segFont !== null) { segItems.push(tjGap); segAdvance += gapExtra; }
        else penX += gapExtra;
    };

    const end = (): void => {
        closeRtl();
        flush();
        if (t !== null) parts.push(closeTextObject(t));
    };

    return { add, gap, end };
}

/** Word gaps a shaped run draws: its plain space glyphs. */
function spaceGaps(run: TextRun): number {
    if (!run.shaped) return 0;
    let n = 0;
    for (const g of run.shaped) if (!g.isZeroAdvance && isSpaceGlyph(g, run.fontData)) n++;
    return n;
}

/** How one text run takes part in justification. */
interface JustifiedPiece {
    readonly run: TextRun;
    /** Word gaps the run contributes (plain spaces it draws). */
    readonly gaps: number;
    /** TJ items for a hex run, each space-ending piece followed by the gap marker `null`. */
    readonly items: (string | null)[] | null;
}

/**
 * Justify a line whose runs are in visual order (bidirectional text): the
 * extra space is shared by every word gap wherever it lands after
 * reordering — inside a Hebrew run, inside a shaped Arabic run (the space
 * glyph's advance grows) or between runs. Runs that cannot be split at their
 * spaces (a kerned `TJ` run) leave the line ragged instead.
 *
 * @since 1.9.0
 */
function txtJustifiedVisual(
    str: string,
    x: number,
    y: number,
    font: string,
    sz: number,
    enc: EncodingContext,
    targetWidth: number,
    actualTextSpans: boolean = true,
): string {
    const runs = enc.textRuns(str, sz);
    if (runs.length === 0) return '';
    const pieces: JustifiedPiece[] = [];
    let natural = 0;
    let gaps = 0;
    for (const run of runs) {
        natural += run.widthPt;
        const emoji = enc.colorEmoji !== undefined && run.fontData.colorGlyphs !== undefined && run.hexStr !== null;
        if (emoji) { pieces.push({ run, gaps: 0, items: null }); continue; }
        if (run.shaped) {
            let n = 0;
            for (const g of run.shaped) if (!g.isZeroAdvance && isSpaceGlyph(g, run.fontData)) n++;
            pieces.push({ run, gaps: n, items: null });
            gaps += n;
            continue;
        }
        const items = splitRunAtSpaces(run, enc);
        if (items === null) return txt(str, x, y, font, sz, enc, actualTextSpans); // unsplittable: ragged
        const n = items.filter(it => it === null).length;
        pieces.push({ run, gaps: n, items });
        gaps += n;
    }
    const extra = targetWidth - natural;
    const spaceW = measureFor(' ', sz, enc);
    if (gaps === 0 || extra <= 0 || extra / gaps > spaceW * MAX_JUSTIFY_STRETCH) {
        return txt(str, x, y, font, sz, enc, actualTextSpans);
    }
    const gapExtra = extra / gaps;
    const tjGap = fmtNum(-(gapExtra * 1000 / sz));

    const parts: string[] = [];
    const line = justifiedLine(parts, x, y, sz, enc, actualTextSpans);
    for (const piece of pieces) {
        if (piece.items === null) {
            // A shaped run widens its own space glyphs by the gap; an emoji run has none.
            line.add(piece.run, { spaceExtra: gapExtra });
            continue;
        }
        line.add(piece.run, { items: piece.items.map(it => (it === null ? tjGap : it)), advance: piece.run.widthPt + gapExtra * piece.gaps });
    }
    line.end();
    return parts.join('\n');
}

/**
 * The TJ items of a hex run cut after each plain space, `null` marking a
 * gap. A base-14 (literal) run is cut on its text; a CID run on its glyph
 * string, one glyph per code point. Returns `null` when the run carries
 * spaces it cannot be cut around (a kerned run, a ligature run).
 */
function splitRunAtSpaces(run: TextRun, enc: EncodingContext): (string | null)[] | null {
    const text = run.text;
    if (!text.includes(' ')) return [run.tjStr ?? run.hexStr ?? ''];
    if (run.tjStr !== undefined || run.hexStr === null) return null;
    const hex = run.hexStr;
    const items: (string | null)[] = [];
    if (hex.startsWith('(')) {
        // Base-14 literal: cut the text, re-encode each piece.
        let piece = '';
        for (let i = 0; i < text.length; i++) {
            piece += text[i];
            if (text[i] === ' ') { items.push(...latinTjItems(piece, enc), null); piece = ''; }
        }
        if (piece) items.push(...latinTjItems(piece, enc));
        return items;
    }
    // CID hex: four hex digits per code point.
    const body = hex.slice(1, -1);
    let cpCount = 0;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c < 0xD800 || c > 0xDBFF) cpCount++; }
    if (body.length !== cpCount * 4) return null;
    let acc = '';
    let gi = 0;
    for (let i = 0; i < text.length; i++) {
        const cp = text.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) i++;
        acc += body.slice(gi * 4, gi * 4 + 4);
        gi++;
        if (cp === 0x20) { items.push(`<${acc}>`, null); acc = ''; }
    }
    if (acc) items.push(`<${acc}>`);
    return items;
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
    // The span carries the whole string as /ActualText: no inner span needed.
    return wrapSpan(txt(str, x, y, font, sz, enc, false), str, mcid);
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
    return wrapSpan(txtR(str, rightX, y, font, sz, enc, bold, false), str, mcid);
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
    return wrapSpan(txtC(str, leftX, y, font, sz, colW, enc, bold, false), str, mcid);
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
