/**
 * Block renderers for the free-form document builder (pdf-document.ts).
 * Each renderer takes explicit parameters and returns PDF operators + new Y position.
 *
 * Extracted from pdf-document.ts to reduce module size and improve navigability.
 * All renderers follow the same signature pattern:
 *   (block, y, enc, margins, tagCtx, collectors) → { ops: string[]; y: number }
 *
 * @module core/pdf-renderers
 */

import type {
    EncodingContext,
    PageTemplate,
} from '../types/pdf-types.js';
import type {
    DocumentBlock,
    HeadingBlock,
    ParagraphBlock,
    TableBlock,
    ListBlock,
    ImageBlock,
    LinkBlock,
    TocBlock,
    BarcodeBlock,
    SvgBlock,
    FormFieldBlock,
} from '../types/pdf-document-types.js';
import { parseImage, buildImageOperators } from './pdf-image.js';
import type { ParsedImage } from './pdf-image.js';
import { validateURL } from './pdf-annot.js';
import { parseColor } from './pdf-color.js';
import type { LinkAnnotation } from './pdf-annot.js';
import { truncate, helveticaWidth } from '../fonts/encoding.js';
import { txt, txtR, txtC, txtTagged, txtRTagged, txtCTagged, fmtNum } from './pdf-text.js';
import {
    ROW_H, TH_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions,
    resolveTemplate,
} from './pdf-layout.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import type { createMCIDAllocator } from './pdf-tags.js';
import { renderBarcode } from './pdf-barcode.js';
import { renderSvg } from './pdf-svg.js';
import { defaultFieldHeight } from './pdf-form.js';
import type { FormField } from './pdf-form.js';
import { computeAutoFitColumns } from './pdf-column-fit.js';

// ── Constants ────────────────────────────────────────────────────────

/** Heading font sizes by level. */
export const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 18, 2: 14, 3: 11 };

/** Heading spacing (top + bottom) by level. */
export const HEADING_SPACING: Record<1 | 2 | 3, { top: number; bottom: number }> = {
    1: { top: 14, bottom: 10 },
    2: { top: 10, bottom: 8 },
    3: { top: 8, bottom: 6 },
};

/** Default paragraph font size. */
export const DEFAULT_PARA_SIZE = 10;

/** Default line height multiplier. */
export const DEFAULT_LINE_HEIGHT = 1.4;

/** Default list font size. */
const DEFAULT_LIST_SIZE = 10;

/** List item vertical spacing. */
const LIST_ITEM_SPACING = 2;

/** Bullet indent from left margin. */
const LIST_INDENT = 14;

/** Bullet character width approximation. */
const BULLET_MARK_WIDTH = 10;

/** Default TOC entry font size. */
const DEFAULT_TOC_SIZE = 10;

/** Default TOC indentation per level (in points). */
const DEFAULT_TOC_INDENT = 15;

/** Default TOC title text. */
const DEFAULT_TOC_TITLE = 'Table of Contents';

/** Line height for TOC entries (multiplier). */
const TOC_LINE_HEIGHT = 1.6;

/** Spacing after TOC title. */
const TOC_TITLE_SPACING = 8;

/** Post-TOC spacing before next block. */
const TOC_BOTTOM_SPACING = 12;

/** Default link color — PDF blue. */
const LINK_COLOR = '0.0 0.0 0.8';

/** Default link font size. */
const DEFAULT_LINK_SIZE = 10;

/** Link underline offset below baseline. */
const LINK_UNDERLINE_OFFSET = 1.5;

/** Default barcode dimensions by format type. */
const BARCODE_1D_WIDTH = 200;
const BARCODE_1D_HEIGHT = 60;
const BARCODE_2D_SIZE = 100;

/** Default SVG block width in points. */
const DEFAULT_SVG_SIZE = 200;

// ── Types ────────────────────────────────────────────────────────────

/** A collected heading destination for TOC link targets. */
export interface HeadingDestination {
    readonly destName: string;
    readonly text: string;
    readonly level: 1 | 2 | 3;
    pageIndex: number;
    y: number;
}

/** Tagged mode context passed to block renderers. */
export interface TagContext {
    tagged: boolean;
    mcidAlloc: ReturnType<typeof createMCIDAllocator>;
    pageObjNum: number;
    structChildren: (StructElement | MCRef)[];
}

/** A collected annotation to be emitted as a PDF indirect object. */
export interface PageAnnotation {
    readonly annot: LinkAnnotation;
    readonly page: number;
}

/** A collected form field widget to be emitted after all pages. */
export interface PageFormField {
    readonly field: FormField;
    readonly page: number;
}

/** Resolved image with parsed data and display dimensions. */
export interface ResolvedImage {
    readonly parsed: ParsedImage;
    readonly displayW: number;
    readonly displayH: number;
    readonly align: 'left' | 'center' | 'right';
    readonly alt?: string;
}

// ── Text Wrapping ────────────────────────────────────────────────────

/**
 * Measure text width in points.
 * Uses enc.tw() for Unicode mode, helveticaWidth() for Latin mode.
 */
export function measureText(str: string, sz: number, enc: EncodingContext): number {
    return enc.isUnicode ? enc.tw(str, sz) : helveticaWidth(str, sz);
}

/**
 * Check if a codepoint is CJK and allows line-breaking on either side.
 * Covers CJK Unified Ideographs, Hiragana, Katakana, Hangul,
 * CJK Symbols/Punctuation, Fullwidth Forms, and CJK extensions.
 */
function isCJKBreakable(cp: number): boolean {
    return (cp >= 0x2E80 && cp <= 0x9FFF) ||
           (cp >= 0xAC00 && cp <= 0xD7AF) ||
           (cp >= 0xF900 && cp <= 0xFAFF) ||
           (cp >= 0xFE30 && cp <= 0xFE4F) ||
           (cp >= 0xFF00 && cp <= 0xFFEF) ||
           (cp >= 0x20000 && cp <= 0x2FA1F);
}

/**
 * Tokenize text into breakable segments for line wrapping.
 * Each CJK character becomes a separate segment (breakable).
 * Latin words (non-space, non-CJK runs) remain grouped.
 * Spaces are attached to the preceding segment.
 */
function tokenizeForWrap(text: string): string[] {
    const segments: string[] = [];
    let buf = '';

    for (const ch of text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (isCJKBreakable(cp)) {
            if (buf) { segments.push(buf); buf = ''; }
            segments.push(ch);
        } else if (cp === 0x20 || cp === 0x09) {
            buf += ch;
            segments.push(buf);
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf) segments.push(buf);

    return segments;
}

/**
 * Hard-break a single overlong segment at character boundaries so no
 * single piece exceeds maxWidth. Used as a last-resort fallback when
 * a single token (e.g. a long URL, NBSP-joined title, or non-breaking
 * compound) would otherwise overflow the content width.
 *
 * Iterates by Unicode code points (not UTF-16 units) to keep surrogate
 * pairs and combining sequences intact at the slice boundary.
 */
function hardBreakSegment(
    seg: string,
    maxWidth: number,
    fontSize: number,
    enc: EncodingContext,
): string[] {
    const pieces: string[] = [];
    let buf = '';
    for (const ch of seg) {
        const candidate = buf + ch;
        const w = measureText(candidate, fontSize, enc);
        if (w <= maxWidth || buf === '') {
            buf = candidate;
        } else {
            pieces.push(buf);
            buf = ch;
        }
    }
    if (buf) pieces.push(buf);
    return pieces.length > 0 ? pieces : [seg];
}

/**
 * Wrap text into lines that fit within maxWidth.
 * Greedy line-filling algorithm with CJK character-level breaking.
 * Latin text breaks at word boundaries (spaces).
 * CJK characters break individually (no spaces needed).
 *
 * If a single segment exceeds maxWidth (e.g. a long word, URL, or
 * non-breaking-space-joined compound), it is hard-broken at character
 * boundaries to prevent overflow past the right margin. This is critical
 * for headings and titles that may contain long compounds without spaces.
 */
export function wrapText(
    text: string,
    maxWidth: number,
    fontSize: number,
    enc: EncodingContext,
): string[] {
    if (!text) return [''];
    if (maxWidth <= 0) return [text];

    const segments = tokenizeForWrap(text);
    if (segments.length === 0) return [''];

    const lines: string[] = [];
    let currentLine = '';

    for (const seg of segments) {
        const candidate = currentLine + seg;
        const w = measureText(candidate, fontSize, enc);
        if (w <= maxWidth) {
            currentLine = candidate;
            continue;
        }

        // Flush whatever fit so far on the current line.
        if (currentLine !== '') {
            lines.push(currentLine.trimEnd());
            currentLine = '';
        }

        // Try to fit the segment by itself on a fresh line.
        const segTrim = seg.trimStart();
        const segW = measureText(segTrim, fontSize, enc);
        if (segW <= maxWidth) {
            currentLine = segTrim;
            continue;
        }

        // Segment alone still overflows — hard-break at character boundaries.
        const pieces = hardBreakSegment(segTrim, maxWidth, fontSize, enc);
        for (let pi = 0; pi < pieces.length - 1; pi++) {
            lines.push(pieces[pi].trimEnd());
        }
        currentLine = pieces[pieces.length - 1];
    }
    if (currentLine) lines.push(currentLine.trimEnd());

    return lines;
}

// ── Block Renderers ──────────────────────────────────────────────────

export function renderHeading(
    block: HeadingBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const sz = HEADING_SIZES[block.level];
    const spacing = HEADING_SPACING[block.level];
    const color = parseColor(block.color ?? '0.145 0.388 0.922');
    const structTag = block.level === 1 ? 'H1' : block.level === 2 ? 'H2' : 'H3';

    y -= spacing.top;
    ops.push(`${color} rg`);

    const lines = wrapText(block.text, cw, sz, enc);
    const lineH = sz * 1.3;

    for (const line of lines) {
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtTagged(line, mgL, y - sz, enc.f2, sz, enc, mcid));
            documentChildren.push({ type: structTag, children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txt(line, mgL, y - sz, enc.f2, sz, enc));
        }
        y -= lineH;
    }

    y -= spacing.bottom;
    return { ops, y };
}

export function renderParagraph(
    block: ParagraphBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    pgW: number,
    mgR: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const sz = block.fontSize ?? DEFAULT_PARA_SIZE;
    const lhMul = block.lineHeight ?? DEFAULT_LINE_HEIGHT;
    const lineH = sz * lhMul;
    const color = parseColor(block.color ?? '0.216 0.255 0.318');
    const indent = block.indent ?? 0;
    const align = block.align ?? 'left';

    const availW = cw - indent;
    const lines = wrapText(block.text, availW, sz, enc);

    ops.push(`${color} rg`);

    const pChildren: MCRef[] = [];

    for (const line of lines) {
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            pChildren.push({ mcid, pageObjNum: tagCtx.pageObjNum });
            if (align === 'right') {
                ops.push(txtRTagged(line, pgW - mgR, y - sz, enc.f1, sz, enc, mcid));
            } else if (align === 'center') {
                ops.push(txtCTagged(line, mgL + indent, y - sz, enc.f1, sz, availW, enc, mcid));
            } else {
                ops.push(txtTagged(line, mgL + indent, y - sz, enc.f1, sz, enc, mcid));
            }
        } else {
            if (align === 'right') {
                ops.push(txtR(line, pgW - mgR, y - sz, enc.f1, sz, enc));
            } else if (align === 'center') {
                ops.push(txtC(line, mgL + indent, y - sz, enc.f1, sz, availW, enc));
            } else {
                ops.push(txt(line, mgL + indent, y - sz, enc.f1, sz, enc));
            }
        }
        y -= lineH;
    }

    if (tagCtx?.tagged && pChildren.length > 0) {
        documentChildren.push({ type: 'P', children: pChildren });
    }

    y -= 4; // post-paragraph spacing
    return { ops, y };
}

export function renderList(
    block: ListBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const sz = block.fontSize ?? DEFAULT_LIST_SIZE;
    const lineH = sz * DEFAULT_LINE_HEIGHT;
    const color = '0.216 0.255 0.318';
    const availW = cw - LIST_INDENT - BULLET_MARK_WIDTH;

    ops.push(`${color} rg`);

    const listChildren: StructElement[] = [];

    for (let idx = 0; idx < block.items.length; idx++) {
        const item = block.items[idx];
        const marker = block.style === 'bullet' ? '\u2022' : `${idx + 1}.`;
        const lines = wrapText(item, availW, sz, enc);

        const liChildren: MCRef[] = [];

        // Marker
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            liChildren.push({ mcid, pageObjNum: tagCtx.pageObjNum });
            ops.push(txtTagged(marker, mgL + LIST_INDENT, y - sz, enc.f1, sz, enc, mcid));
        } else {
            ops.push(txt(marker, mgL + LIST_INDENT, y - sz, enc.f1, sz, enc));
        }

        // Item text lines
        for (let li = 0; li < lines.length; li++) {
            const xOffset = mgL + LIST_INDENT + BULLET_MARK_WIDTH;
            if (li === 0) {
                if (tagCtx?.tagged) {
                    const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
                    liChildren.push({ mcid, pageObjNum: tagCtx.pageObjNum });
                    ops.push(txtTagged(lines[li], xOffset, y - sz, enc.f1, sz, enc, mcid));
                } else {
                    ops.push(txt(lines[li], xOffset, y - sz, enc.f1, sz, enc));
                }
            } else {
                y -= lineH;
                if (tagCtx?.tagged) {
                    const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
                    liChildren.push({ mcid, pageObjNum: tagCtx.pageObjNum });
                    ops.push(txtTagged(lines[li], xOffset, y - sz, enc.f1, sz, enc, mcid));
                } else {
                    ops.push(txt(lines[li], xOffset, y - sz, enc.f1, sz, enc));
                }
            }
        }
        y -= lineH + LIST_ITEM_SPACING;

        if (tagCtx?.tagged && liChildren.length > 0) {
            listChildren.push({ type: 'LI', children: liChildren });
        }
    }

    if (tagCtx?.tagged && listChildren.length > 0) {
        documentChildren.push({ type: 'L', children: listChildren });
    }

    return { ops, y };
}

export function renderTable(
    block: TableBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    mgR: number,
    pgW: number,
    cw: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const baseColumns = block.columns ? [...block.columns] : DEFAULT_COLUMNS;
    const fs = DEFAULT_FONT_SIZES;
    const colors = DEFAULT_COLORS;
    // Phase 4 — auto-fit column widths based on actual content.
    // When enabled, override `f` fractions with content-derived values; the
    // existing minWidth/maxWidth clamping in `computeColumnPositions()` still
    // applies, so per-column constraints are honoured.
    const columns = block.autoFitColumns
        ? computeAutoFitColumns(baseColumns, block.headers, block.rows, enc, fs.th, fs.td)
        : baseColumns;
    const { cx, cwi } = computeColumnPositions(columns, mgL, cw);

    // Cell clipping: ISO 32000-1 §8.5.4 — `q <rect> re W n ... Q` keeps cell
    // contents inside their column rectangle. Defaults to `true` for v1.1.0+.
    const clip = block.clipCells !== false;

    /**
     * Wrap a text-emitting operator in a clipping rectangle for cell `i`.
     * The clip rect spans the full column width and a generous vertical band
     * (TH_H or ROW_H) so descenders aren't cut. Uses `q ... Q` to scope the clip.
     */
    const clipCell = (op: string, i: number, top: number, h: number): string =>
        clip
            ? `q ${fmtNum(cx[i])} ${fmtNum(top - h)} ${fmtNum(cwi[i])} ${fmtNum(h)} re W n\n${op}\nQ`
            : op;

    const tableRows: StructElement[] = [];

    // Table header
    ops.push(`${colors.thBg} rg`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} ${fmtNum(cw)} ${fmtNum(TH_H)} re f`);
    ops.push(`0.75 w ${colors.thBrd} RG`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - TH_H)} l S`);
    ops.push(`${colors.text} rg`);

    const thChildren: (StructElement | MCRef)[] = [];
    for (let i = 0; i < block.headers.length && i < columns.length; i++) {
        const t = truncate(block.headers[i], columns[i].mxH ?? columns[i].mx);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            thChildren.push({ type: 'TH', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
            if (columns[i].a === 'r') {
                ops.push(clipCell(txtRTagged(t, cx[i] + cwi[i] - 3, y - TH_H + 4, enc.f2, fs.th, enc, mcid), i, y, TH_H));
            } else if (columns[i].a === 'c') {
                ops.push(clipCell(txtCTagged(t, cx[i], y - TH_H + 4, enc.f2, fs.th, cwi[i], enc, mcid), i, y, TH_H));
            } else {
                ops.push(clipCell(txtTagged(t, cx[i] + 3, y - TH_H + 4, enc.f2, fs.th, enc, mcid), i, y, TH_H));
            }
        } else {
            if (columns[i].a === 'r') {
                ops.push(clipCell(txtR(t, cx[i] + cwi[i] - 3, y - TH_H + 4, enc.f2, fs.th, enc), i, y, TH_H));
            } else if (columns[i].a === 'c') {
                ops.push(clipCell(txtC(t, cx[i], y - TH_H + 4, enc.f2, fs.th, cwi[i], enc), i, y, TH_H));
            } else {
                ops.push(clipCell(txt(t, cx[i] + 3, y - TH_H + 4, enc.f2, fs.th, enc), i, y, TH_H));
            }
        }
    }
    if (tagCtx?.tagged) tableRows.push({ type: 'TR', children: thChildren });
    y -= TH_H;

    // Table data rows
    for (const row of block.rows) {
        ops.push(`0.25 w ${colors.rowBrd} RG`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - ROW_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - ROW_H)} l S`);

        const tdChildren: (StructElement | MCRef)[] = [];
        for (let i = 0; i < row.cells.length && i < columns.length; i++) {
            const t = truncate(row.cells[i], columns[i].mx);
            const isAmount = (i === 3);
            const color = isAmount ? (row.type === 'credit' ? colors.credit : colors.debit) : colors.text;
            const font = isAmount ? enc.f2 : enc.f1;
            ops.push(`${color} rg`);

            if (tagCtx?.tagged) {
                const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
                tdChildren.push({ type: 'TD', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
                if (columns[i].a === 'r') {
                    ops.push(clipCell(txtRTagged(t, cx[i] + cwi[i] - 3, y - ROW_H + 3, font, fs.td, enc, mcid), i, y, ROW_H));
                } else if (columns[i].a === 'c') {
                    ops.push(clipCell(txtCTagged(t, cx[i], y - ROW_H + 3, font, fs.td, cwi[i], enc, mcid), i, y, ROW_H));
                } else {
                    ops.push(clipCell(txtTagged(t, cx[i] + 3, y - ROW_H + 3, font, fs.td, enc, mcid), i, y, ROW_H));
                }
            } else {
                if (columns[i].a === 'r') {
                    ops.push(clipCell(txtR(t, cx[i] + cwi[i] - 3, y - ROW_H + 3, font, fs.td, enc), i, y, ROW_H));
                } else if (columns[i].a === 'c') {
                    ops.push(clipCell(txtC(t, cx[i], y - ROW_H + 3, font, fs.td, cwi[i], enc), i, y, ROW_H));
                } else {
                    ops.push(clipCell(txt(t, cx[i] + 3, y - ROW_H + 3, font, fs.td, enc), i, y, ROW_H));
                }
            }
        }
        if (tagCtx?.tagged) tableRows.push({ type: 'TR', children: tdChildren });
        y -= ROW_H;
    }

    if (tagCtx?.tagged && tableRows.length > 0) {
        documentChildren.push({ type: 'Table', children: tableRows });
    }

    y -= 6; // post-table spacing
    return { ops, y };
}

export function renderPageTemplate(
    template: PageTemplate,
    page: number,
    pages: number,
    title: string,
    date: string,
    y: number,
    enc: EncodingContext,
    mgL: number,
    mgR: number,
    pgW: number,
    cw: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): string[] {
    const ops: string[] = [];
    const sz = template.fontSize ?? DEFAULT_FONT_SIZES.ft;
    const color = parseColor(template.color ?? '0.612 0.639 0.682');

    ops.push(`${color} rg`);

    if (template.left) {
        const text = resolveTemplate(template.left, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtTagged(text, mgL, y, enc.f1, sz, enc, mcid));
            documentChildren.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txt(text, mgL, y, enc.f1, sz, enc));
        }
    }

    if (template.center) {
        const text = resolveTemplate(template.center, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtCTagged(text, mgL, y, enc.f1, sz, cw, enc, mcid));
            documentChildren.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txtC(text, mgL, y, enc.f1, sz, cw, enc));
        }
    }

    if (template.right) {
        const text = resolveTemplate(template.right, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtRTagged(text, pgW - mgR, y, enc.f1, sz, enc, mcid));
            documentChildren.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txtR(text, pgW - mgR, y, enc.f1, sz, enc));
        }
    }

    return ops;
}

// ── Image Rendering ──────────────────────────────────────────────────

export function resolveImage(block: ImageBlock, contentWidth: number): ResolvedImage {
    const parsed = parseImage(block.data);
    const nativeW = parsed.width;
    const nativeH = parsed.height;
    const aspect = nativeW / nativeH;

    let displayW: number;
    let displayH: number;

    if (block.width && block.height) {
        displayW = block.width;
        displayH = block.height;
    } else if (block.width) {
        displayW = block.width;
        displayH = block.width / aspect;
    } else if (block.height) {
        displayH = block.height;
        displayW = block.height * aspect;
    } else {
        displayW = nativeW;
        displayH = nativeH;
    }

    if (displayW > contentWidth) {
        displayW = contentWidth;
        displayH = contentWidth / aspect;
    }

    return {
        parsed,
        displayW,
        displayH,
        align: block.align ?? 'left',
        alt: block.alt,
    };
}

export function renderImage(
    resolved: ResolvedImage,
    imgName: string,
    y: number,
    mgL: number,
    cw: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const { displayW, displayH, align } = resolved;

    let x = mgL;
    if (align === 'center') x = mgL + (cw - displayW) / 2;
    else if (align === 'right') x = mgL + cw - displayW;

    const imgY = y - displayH;

    if (tagCtx?.tagged) {
        const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        const altHex = resolved.alt
            ? Array.from(resolved.alt).map(c => {
                const cp = c.codePointAt(0) ?? 0;
                return cp.toString(16).toUpperCase().padStart(4, '0');
            }).join('')
            : '';
        const actualText = resolved.alt ? ` /ActualText <FEFF${altHex}>` : '';
        ops.push(`/Span << /MCID ${mcid}${actualText} >> BDC`);
        ops.push(buildImageOperators(imgName, x, imgY, displayW, displayH));
        ops.push('EMC');
        documentChildren.push({ type: 'Figure', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
    } else {
        ops.push(buildImageOperators(imgName, x, imgY, displayW, displayH));
    }

    return { ops, y: imgY - 6 };
}

// ── Link Rendering ───────────────────────────────────────────────────

export function renderLink(
    block: LinkBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    pageIndex: number,
    pageAnnotations: PageAnnotation[],
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const sz = block.fontSize ?? DEFAULT_LINK_SIZE;
    const color = parseColor(block.color ?? LINK_COLOR);
    const lineH = sz * DEFAULT_LINE_HEIGHT;

    const isValid = validateURL(block.url);

    const lines = wrapText(block.text, cw, sz, enc);

    ops.push(`${color} rg`);

    for (const line of lines) {
        const textW = measureText(line, sz, enc);
        const textX = mgL;
        const textY = y - sz;

        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtTagged(line, textX, textY, enc.f1, sz, enc, mcid));
            documentChildren.push({ type: 'Link', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txt(line, textX, textY, enc.f1, sz, enc));
        }

        // Underline
        const ulY = textY - LINK_UNDERLINE_OFFSET;
        ops.push(`${color} RG 0.5 w`);
        ops.push(`${fmtNum(textX)} ${fmtNum(ulY)} m ${fmtNum(textX + textW)} ${fmtNum(ulY)} l S`);

        if (isValid) {
            pageAnnotations.push({
                annot: {
                    url: block.url,
                    rect: [textX, textY - 2, textX + textW, textY + sz + 2],
                },
                page: pageIndex,
            });
        }

        y -= lineH;
    }

    y -= 4;
    return { ops, y };
}

// ── Table of Contents ────────────────────────────────────────────────

export function estimateTocHeight(
    tocBlock: TocBlock,
    headings: readonly HeadingDestination[],
): number {
    const sz = tocBlock.fontSize ?? DEFAULT_TOC_SIZE;
    const maxLevel = tocBlock.maxLevel ?? 3;
    const titleSz = 14;
    const lineH = sz * TOC_LINE_HEIGHT;

    const filteredCount = headings.filter(h => h.level <= maxLevel).length;
    return titleSz + TOC_TITLE_SPACING + filteredCount * lineH + TOC_BOTTOM_SPACING;
}

export function renderToc(
    tocBlock: TocBlock,
    headings: readonly HeadingDestination[],
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    pageIndex: number,
    pageAnnotations: PageAnnotation[],
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const sz = tocBlock.fontSize ?? DEFAULT_TOC_SIZE;
    const indent = tocBlock.indent ?? DEFAULT_TOC_INDENT;
    const maxLevel = tocBlock.maxLevel ?? 3;
    const title = tocBlock.title ?? DEFAULT_TOC_TITLE;
    const lineH = sz * TOC_LINE_HEIGHT;

    // TOC Title
    const titleSz = 14;
    const titleColor = '0.145 0.388 0.922';
    ops.push(`${titleColor} rg`);
    if (tagCtx?.tagged) {
        const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        ops.push(txtTagged(title, mgL, y - titleSz, enc.f2, titleSz, enc, mcid));
        documentChildren.push({ type: 'TOC', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
    } else {
        ops.push(txt(title, mgL, y - titleSz, enc.f2, titleSz, enc));
    }
    y -= titleSz + TOC_TITLE_SPACING;

    // TOC entries
    const textColor = '0.216 0.255 0.318';
    ops.push(`${textColor} rg`);

    for (const heading of headings) {
        if (heading.level > maxLevel) continue;

        const entryIndent = (heading.level - 1) * indent;
        const entryX = mgL + entryIndent;
        const pageNumStr = `${heading.pageIndex + 1}`;
        const pageNumW = measureText(pageNumStr, sz, enc);
        const dotLeaderEnd = mgL + cw - pageNumW - 4;
        const availTextW = dotLeaderEnd - entryX - 8;

        let displayText = heading.text;
        if (measureText(displayText, sz, enc) > availTextW) {
            const ell = '…';
            while (displayText.length > 1 && measureText(displayText + ell, sz, enc) > availTextW) {
                displayText = displayText.slice(0, -1);
            }
            displayText += ell;
        }
        const textW = measureText(displayText, sz, enc);

        const textY = y - sz;
        const font = heading.level === 1 ? enc.f2 : enc.f1;
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtTagged(displayText, entryX, textY, font, sz, enc, mcid));
            documentChildren.push({ type: 'TOCI', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txt(displayText, entryX, textY, font, sz, enc));
        }

        // Dot leader
        const dotStart = entryX + textW + 4;
        if (dotStart < dotLeaderEnd) {
            const dotStr = '.'.repeat(Math.max(1, Math.floor((dotLeaderEnd - dotStart) / (measureText('.', sz, enc) + 0.5))));
            ops.push(`0.6 0.6 0.6 rg`);
            ops.push(txt(dotStr, dotStart, textY, enc.f1, sz, enc));
            ops.push(`${textColor} rg`);
        }

        ops.push(txtR(pageNumStr, mgL + cw, textY, enc.f1, sz, enc));

        pageAnnotations.push({
            annot: {
                url: `#${heading.destName}`,
                rect: [entryX, textY - 2, mgL + cw, textY + sz + 2],
            },
            page: pageIndex,
        });

        y -= lineH;
    }

    y -= TOC_BOTTOM_SPACING;
    return { ops, y };
}

// ── Barcode Rendering ────────────────────────────────────────────────

function is2DFormat(format: string): boolean {
    return format === 'qr' || format === 'datamatrix';
}

export function estimateBarcodeHeight(block: BarcodeBlock): number {
    if (is2DFormat(block.format)) {
        return block.height ?? block.width ?? BARCODE_2D_SIZE;
    }
    return block.height ?? BARCODE_1D_HEIGHT;
}

export function renderBarcodeBlock(
    block: BarcodeBlock,
    y: number,
    mgL: number,
    cw: number,
    tagCtx?: TagContext,
    documentChildren?: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const is2D = is2DFormat(block.format);
    const w = block.width ?? (is2D ? BARCODE_2D_SIZE : BARCODE_1D_WIDTH);
    const h = block.height ?? (is2D ? w : BARCODE_1D_HEIGHT);

    let bx = mgL;
    if (block.align === 'center') {
        bx = mgL + (cw - w) / 2;
    } else if (block.align === 'right') {
        bx = mgL + cw - w;
    }

    const by = y - h;

    if (tagCtx?.tagged) {
        const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        ops.push(`/Span << /MCID ${mcid} >> BDC`);
        ops.push(renderBarcode(block.format, block.data, bx, by, w, h, {
            ecLevel: block.ecLevel,
            pdf417ECLevel: block.pdf417ECLevel,
        }));
        ops.push('EMC');
        documentChildren?.push({ type: 'Figure', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
    } else {
        ops.push(renderBarcode(block.format, block.data, bx, by, w, h, {
            ecLevel: block.ecLevel,
            pdf417ECLevel: block.pdf417ECLevel,
        }));
    }

    y = by - 6;
    return { ops, y };
}

// ── SVG Rendering ────────────────────────────────────────────────────

export function renderSvgBlock(
    block: SvgBlock,
    y: number,
    mgL: number,
    cw: number,
    tagCtx?: TagContext,
    documentChildren?: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const w = block.width ?? DEFAULT_SVG_SIZE;
    const h = block.height ?? DEFAULT_SVG_SIZE;

    let bx = mgL;
    if (block.align === 'center') {
        bx = mgL + (cw - w) / 2;
    } else if (block.align === 'right') {
        bx = mgL + cw - w;
    }

    const by = y;

    const svgOps = renderSvg(block.data, bx, by, w, h, {
        fill: block.fill,
        stroke: block.stroke,
        strokeWidth: block.strokeWidth,
        viewBox: block.viewBox,
    });

    if (svgOps) {
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            const altText = block.alt ?? '';
            if (altText) {
                const altHex = Array.from(altText).map(c =>
                    (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
                ).join('');
                ops.push(`/Span << /MCID ${mcid} /ActualText <FEFF${altHex}> >> BDC`);
            } else {
                ops.push(`/Span << /MCID ${mcid} >> BDC`);
            }
            ops.push(svgOps);
            ops.push('EMC');
            documentChildren?.push({ type: 'Figure', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(svgOps);
        }
    }

    y = y - h - 6;
    return { ops, y };
}

// ── Form Field Rendering ─────────────────────────────────────────────

export function renderFormFieldBlock(
    block: FormFieldBlock,
    y: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    pageIndex: number,
    formFields: PageFormField[],
    tagCtx?: TagContext,
    documentChildren?: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const fontSize = block.fontSize ?? DEFAULT_PARA_SIZE;

    if (block.label) {
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(`/Span << /MCID ${mcid} >> BDC`);
            ops.push('BT');
            ops.push(`${enc.f2} ${fmtNum(fontSize)} Tf`);
            ops.push(`${fmtNum(mgL)} ${fmtNum(y - fontSize)} Td`);
            ops.push(`${enc.ps(block.label)} Tj`);
            ops.push('ET');
            ops.push('EMC');
            documentChildren?.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push('BT');
            ops.push(`${enc.f2} ${fmtNum(fontSize)} Tf`);
            ops.push(`${fmtNum(mgL)} ${fmtNum(y - fontSize)} Td`);
            ops.push(`${enc.ps(block.label)} Tj`);
            ops.push('ET');
        }
        y -= fontSize * 1.3;
    }

    const isButton = block.fieldType === 'checkbox' || block.fieldType === 'radio';
    const fieldH = block.height ?? defaultFieldHeight(block.fieldType);
    const fieldW = block.width ?? (isButton ? fieldH : cw);
    const x1 = mgL;
    const y1 = y - fieldH;
    const x2 = x1 + fieldW;
    const y2 = y;

    formFields.push({
        field: {
            fieldType: block.fieldType,
            name: block.name,
            value: block.value ?? '',
            rect: [x1, y1, x2, y2],
            fontSize: block.fontSize ?? DEFAULT_PARA_SIZE,
            options: block.options ?? [],
            readOnly: block.readOnly ?? false,
            required: block.required ?? false,
            maxLength: block.maxLength ?? null,
            page: pageIndex,
            checked: block.checked ?? false,
        },
        page: pageIndex,
    });

    if (tagCtx?.tagged) {
        const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        const nameHex = Array.from(block.name).map(c =>
            (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
        ).join('');
        ops.push(`/Span << /MCID ${mcid} /ActualText <FEFF${nameHex}> >> BDC`);
        ops.push('EMC');
        documentChildren?.push({ type: 'Form', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
    }

    y = y1 - 6;
    return { ops, y };
}

// ── Block Height Estimation ──────────────────────────────────────────

export function estimateBlockHeight(
    block: DocumentBlock,
    enc: EncodingContext,
    cw: number,
    headings?: readonly HeadingDestination[],
): number {
    switch (block.type) {
        case 'heading': {
            const sz = HEADING_SIZES[block.level];
            const spacing = HEADING_SPACING[block.level];
            const lines = wrapText(block.text, cw, sz, enc);
            return spacing.top + lines.length * (sz * 1.3) + spacing.bottom;
        }
        case 'paragraph': {
            const sz = block.fontSize ?? DEFAULT_PARA_SIZE;
            const lhMul = block.lineHeight ?? DEFAULT_LINE_HEIGHT;
            const indent = block.indent ?? 0;
            const lines = wrapText(block.text, cw - indent, sz, enc);
            return lines.length * (sz * lhMul) + 4;
        }
        case 'list': {
            const sz = block.fontSize ?? DEFAULT_LIST_SIZE;
            const lineH = sz * DEFAULT_LINE_HEIGHT;
            const availW = cw - LIST_INDENT - BULLET_MARK_WIDTH;
            let h = 0;
            for (const item of block.items) {
                const lines = wrapText(item, availW, sz, enc);
                h += lineH + (lines.length - 1) * lineH + LIST_ITEM_SPACING;
            }
            return h;
        }
        case 'table': {
            return TH_H + block.rows.length * ROW_H + 6;
        }
        case 'spacer': {
            return block.height;
        }
        case 'pageBreak': {
            return Infinity;
        }
        case 'image': {
            const resolved = resolveImage(block, cw);
            return resolved.displayH + 6;
        }
        case 'link': {
            const sz = block.fontSize ?? DEFAULT_LINK_SIZE;
            const lines = wrapText(block.text, cw, sz, enc);
            return lines.length * (sz * DEFAULT_LINE_HEIGHT) + 4;
        }
        case 'toc': {
            return headings ? estimateTocHeight(block, headings) : 0;
        }
        case 'barcode': {
            return estimateBarcodeHeight(block) + 6;
        }
        case 'svg': {
            return (block.height ?? DEFAULT_SVG_SIZE) + 6;
        }
        case 'formField': {
            const labelH = block.label ? DEFAULT_PARA_SIZE * 1.3 : 0;
            return labelH + (block.height ?? defaultFieldHeight(block.fieldType)) + 6;
        }
    }
}
