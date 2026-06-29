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
    ColumnDef,
} from '../types/pdf-types.js';
import type {
    DocumentBlock,
    HeadingBlock,
    ParagraphBlock,
    TableBlock,
    ListBlock,
    ListItem,
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
import { truncate, helveticaWidth, helveticaBoldWidth } from '../fonts/encoding.js';
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

    ops.push(`${color} rg`);

    // Render the (possibly nested) list recursively. The fill colour is set
    // once above and persists across levels via PDF graphics state.
    const root = renderListLevel(block.items, block.style, 0, y, sz, lineH, enc, mgL, cw, tagCtx);
    ops.push(...root.ops);

    if (tagCtx?.tagged && root.struct && root.struct.children.length > 0) {
        documentChildren.push(root.struct);
    }

    return { ops, y: root.y };
}

/**
 * Render one nesting level of a list and recurse into child items.
 *
 * `depth` 0 reproduces the pre-1.4.0 flat-list geometry exactly (marker at
 * `mgL + LIST_INDENT`, text at `+ BULLET_MARK_WIDTH`), so string-only lists are
 * byte-identical. Each deeper level adds one `LIST_INDENT` step. Bullet markers
 * stay a uniform `•` at every depth — indentation conveys hierarchy and the
 * single glyph is always encodable (no `.notdef` risk in base-14 mode);
 * numbered sub-lists restart at 1.
 */
function renderListLevel(
    items: readonly (string | ListItem)[],
    style: 'bullet' | 'numbered',
    depth: number,
    y: number,
    sz: number,
    lineH: number,
    enc: EncodingContext,
    mgL: number,
    cw: number,
    tagCtx: TagContext | undefined,
): { ops: string[]; y: number; struct?: StructElement } {
    const ops: string[] = [];
    const indent = LIST_INDENT * (depth + 1);
    const markerX = mgL + indent;
    const xOffset = markerX + BULLET_MARK_WIDTH;
    const availW = cw - indent - BULLET_MARK_WIDTH;

    const levelChildren: (StructElement | MCRef)[] = [];

    for (let idx = 0; idx < items.length; idx++) {
        const entry = items[idx];
        const text = typeof entry === 'string' ? entry : entry.text;
        const children = typeof entry === 'string' ? undefined : entry.items;
        const marker = style === 'bullet' ? '\u2022' : `${idx + 1}.`;
        const lines = wrapText(text, availW, sz, enc);

        const liChildren: (StructElement | MCRef)[] = [];

        // Marker
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            liChildren.push({ mcid, pageObjNum: tagCtx.pageObjNum });
            ops.push(txtTagged(marker, markerX, y - sz, enc.f1, sz, enc, mcid));
        } else {
            ops.push(txt(marker, markerX, y - sz, enc.f1, sz, enc));
        }

        // Item text lines
        for (let li = 0; li < lines.length; li++) {
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

        // Nested sub-list (recurse one level deeper).
        if (children && children.length > 0) {
            const sub = renderListLevel(children, style, depth + 1, y, sz, lineH, enc, mgL, cw, tagCtx);
            ops.push(...sub.ops);
            y = sub.y;
            if (tagCtx?.tagged && sub.struct && sub.struct.children.length > 0) {
                liChildren.push(sub.struct);
            }
        }

        if (tagCtx?.tagged && liChildren.length > 0) {
            levelChildren.push({ type: 'LI', children: liChildren });
        }
    }

    const struct: StructElement | undefined =
        tagCtx?.tagged ? { type: 'L', children: levelChildren } : undefined;
    return { ops, y, struct };
}


/** Default zebra-row background tint (matches `DEFAULT_COLORS.thBg`). */
const DEFAULT_ZEBRA_COLOR = '0.969 0.973 0.984';

/** Default font size used to render `TableBlock.caption` (matches title body). */
const CAPTION_FONT_SIZE = 9;

/** Default line-height multiplier used for wrapped-cell row height. */
const TABLE_LINE_HEIGHT = 1.3;

/** Bottom padding kept under text inside data cells (v1.1 historic constant). */
const CELL_PAD_BOTTOM = 3;

/** Bottom padding kept under text inside header cells (v1.1 historic constant). */
const HEADER_PAD_BOTTOM = 4;

/**
 * A measurement-pass output describing exactly how a {@link TableBlock} will
 * be rendered. Computed once during pagination and reused by every slice the
 * renderer emits — keeps page-break logic free of font/measurement concerns.
 *
 * Internal type (re-exported only between `pdf-renderers.ts` and
 * `pdf-document.ts`); not part of the public API.
 *
 * @since 1.2.0
 */
export interface TablePlan {
    readonly columns: readonly ColumnDef[];
    readonly cx: number[];
    readonly cwi: number[];
    readonly headerLines: string[][];   // [colIdx][lineIdx]
    readonly headerHeight: number;
    readonly rowLines: string[][][];    // [rowIdx][colIdx][lineIdx]
    readonly rowHeights: number[];
    readonly captionLines: string[];
    readonly captionHeight: number;
    readonly fontSize: { th: number; td: number };
    readonly pad: number;
    readonly trailerSpacing: number;
}

/**
 * One contiguous slice of a planned table assigned to a single page.
 * The renderer reads `fromRow`/`toRow` and the plan to emit exactly those
 * rows, optionally re-drawing the header (`drawHeader`) and the caption
 * (`drawCaption`). The last slice for a table sets `isFinalSlice = true`,
 * which triggers the single `/Table` struct-tree commit in tagged mode.
 *
 * @internal
 * @since 1.2.0
 */
export interface TableSlice {
    readonly plan: TablePlan;
    readonly fromRow: number;
    readonly toRow: number;       // exclusive
    readonly drawCaption: boolean;
    readonly drawHeader: boolean;
    readonly isFinalSlice: boolean;
    /** Shared accumulator collecting `/TR` / `/Caption` children across slices. */
    readonly tableStructAccum: (StructElement | MCRef)[];
}

/**
 * Measurement pass for a {@link TableBlock}. Resolves columns (honouring
 * `autoFitColumns`), measures every header and data cell against its column
 * width, wraps cells when needed per the `wrap` policy, and returns a
 * {@link TablePlan} describing the exact heights and line layout that the
 * renderer will emit.
 *
 * Pure function — safe to call multiple times during multi-pass pagination
 * (TOC etc.). O(rows × cols × maxLineLen) in the worst case.
 *
 * @since 1.2.0
 */
export function planTable(
    block: TableBlock,
    enc: EncodingContext,
    mgL: number,
    cw: number,
): TablePlan {
    const fs = DEFAULT_FONT_SIZES;
    const baseColumns = block.columns ? [...block.columns] : DEFAULT_COLUMNS;
    const resolvedColumns = block.autoFitColumns
        ? computeAutoFitColumns(baseColumns, block.headers, block.rows, enc, fs.th, fs.td)
        : baseColumns;
    const { cx, cwi } = computeColumnPositions(resolvedColumns, mgL, cw);

    const pad = block.cellPadding ?? 3;
    const wrapMode = block.wrap ?? 'auto';
    const minRowH = block.minRowHeight ?? ROW_H;

    /**
     * Decide how a single cell should be laid out within column `i`:
     *   - `wrap: 'never'`       → single line (the renderer uses `truncate()`
     *                             at draw time, so we keep the raw string here
     *                             for byte-identical v1.1 output).
     *   - `wrap: 'always'`      → run `wrapText()` unconditionally.
     *   - `wrap: 'auto'`        → measure first; wrap only when the text
     *                             genuinely exceeds the column's writable area.
     *
     * `bold` controls width metrics for the auto-mode overflow probe: header
     * cells render in Helvetica-Bold (~16% wider than Regular in Latin mode),
     * so measuring with regular metrics would under-count their width and
     * skip wrapping when the glyphs actually overflow. Unicode/CIDFont mode
     * uses the same per-font metric for both weights.
     */
    const wrapCell = (text: string, colIdx: number, fontSize: number, bold: boolean): string[] => {
        if (wrapMode === 'never') return [text];
        const colW = cwi[colIdx];
        const availW = Math.max(0, colW - pad * 2);
        const measure = (s: string): number =>
            enc.isUnicode ? enc.tw(s, fontSize) : (bold ? helveticaBoldWidth(s, fontSize) : helveticaWidth(s, fontSize));
        if (wrapMode === 'always') {
            return wrapText(text, availW, fontSize, enc);
        }
        // 'auto' — only wrap when content actually overflows the column.
        if (availW <= 0 || measure(text) <= availW) {
            return [text];
        }
        return wrapText(text, availW, fontSize, enc);
    };

    // Header lines + height.
    const headerLines: string[][] = [];
    let headerMaxLines = 1;
    for (let i = 0; i < block.headers.length && i < resolvedColumns.length; i++) {
        const lines = wrapCell(block.headers[i], i, fs.th, true);
        headerLines.push(lines);
        if (lines.length > headerMaxLines) headerMaxLines = lines.length;
    }
    const headerHeight = headerMaxLines === 1
        ? TH_H
        : Math.max(TH_H, headerMaxLines * fs.th * TABLE_LINE_HEIGHT + CELL_PAD_BOTTOM + 2);

    // Per-row lines + heights.
    const rowLines: string[][][] = [];
    const rowHeights: number[] = [];
    for (let r = 0; r < block.rows.length; r++) {
        const row = block.rows[r];
        const cells: string[][] = [];
        let maxLines = 1;
        for (let i = 0; i < row.cells.length && i < resolvedColumns.length; i++) {
            const lines = wrapCell(row.cells[i], i, fs.td, false);
            cells.push(lines);
            if (lines.length > maxLines) maxLines = lines.length;
        }
        rowLines.push(cells);
        const h = maxLines === 1
            ? minRowH
            : Math.max(minRowH, maxLines * fs.td * TABLE_LINE_HEIGHT + CELL_PAD_BOTTOM + 2);
        rowHeights.push(h);
    }

    // Caption (optional).
    const captionLines: string[] = block.caption
        ? wrapText(block.caption, cw, CAPTION_FONT_SIZE, enc)
        : [];
    const captionHeight = captionLines.length === 0
        ? 0
        : captionLines.length * CAPTION_FONT_SIZE * TABLE_LINE_HEIGHT + 4;

    return {
        columns: resolvedColumns,
        cx,
        cwi,
        headerLines,
        headerHeight,
        rowLines,
        rowHeights,
        captionLines,
        captionHeight,
        fontSize: { th: fs.th, td: fs.td },
        pad,
        trailerSpacing: 6,
    };
}

/**
 * Resolve a `TableBlock.zebra` value to a PDF RGB operator string, or
 * `null` when zebra striping is disabled.
 */
function resolveZebraColor(z: TableBlock['zebra']): string | null {
    if (!z) return null;
    if (z === true) return DEFAULT_ZEBRA_COLOR;
    return parseColor(z);
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
    /**
     * Optional pre-computed slice. When omitted, the renderer plans the table
     * itself and renders all rows in one call (legacy single-call path used by
     * any caller that doesn't go through the document paginator). When set,
     * only `[fromRow, toRow)` is rendered and tagged-mode `/Table` emission is
     * deferred to `isFinalSlice`.
     * @since 1.2.0
     */
    slice?: TableSlice,
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const colors = DEFAULT_COLORS;

    // Build a synthetic full-table slice when called outside the paginator.
    const plan = slice?.plan ?? planTable(block, enc, mgL, cw);
    const fromRow = slice?.fromRow ?? 0;
    const toRow = slice?.toRow ?? block.rows.length;
    const drawCaption = slice?.drawCaption ?? true;
    const drawHeader = slice?.drawHeader ?? true;
    const isFinalSlice = slice?.isFinalSlice ?? true;
    const tableStructAccum: (StructElement | MCRef)[] = slice?.tableStructAccum
        ?? [];

    const { cx, cwi, columns, headerLines, headerHeight, rowLines, rowHeights, fontSize, pad } = plan;
    const fs = fontSize;
    const clip = block.clipCells !== false;
    const zebraColor = resolveZebraColor(block.zebra);
    const wrapMode = block.wrap ?? 'auto';

    // ── Cell borders (opt-in via block.cellBorders) ──────────────────
    // When unset, `borderSides` is null and `cellBorderOps` returns nothing, so
    // tables without borders are byte-identical to pre-1.4.0.
    const borders = block.cellBorders;
    const borderSides = borders
        ? {
            top: borders.all === true || borders.top === true,
            right: borders.all === true || borders.right === true,
            bottom: borders.all === true || borders.bottom === true,
            left: borders.all === true || borders.left === true,
        }
        : null;
    const borderColor = borders?.color ? parseColor(borders.color) : '0.8 0.8 0.8';
    const borderWidth = borders?.width ?? 0.5;
    const borderDash = borders?.style === 'dashed'
        ? '[3] 0 d'
        : borders?.style === 'dotted'
            ? `[${fmtNum(borderWidth)} ${fmtNum(borderWidth * 2)}] 0 d`
            : null;

    /**
     * Stroke the requested borders of one cell rectangle. Resets the dash
     * pattern afterwards (when dashed/dotted) so the table's row separators and
     * header underline keep their solid stroke.
     */
    const cellBorderOps = (cellX: number, cellW: number, top: number, h: number): string[] => {
        if (!borderSides || (!borderSides.top && !borderSides.right && !borderSides.bottom && !borderSides.left)) {
            return [];
        }
        const o: string[] = [];
        o.push(`${fmtNum(borderWidth)} w ${borderColor} RG${borderDash ? ' ' + borderDash : ''}`);
        const x0 = cellX, x1 = cellX + cellW, y0 = top - h, y1 = top;
        if (borderSides.top) o.push(`${fmtNum(x0)} ${fmtNum(y1)} m ${fmtNum(x1)} ${fmtNum(y1)} l S`);
        if (borderSides.bottom) o.push(`${fmtNum(x0)} ${fmtNum(y0)} m ${fmtNum(x1)} ${fmtNum(y0)} l S`);
        if (borderSides.left) o.push(`${fmtNum(x0)} ${fmtNum(y0)} m ${fmtNum(x0)} ${fmtNum(y1)} l S`);
        if (borderSides.right) o.push(`${fmtNum(x1)} ${fmtNum(y0)} m ${fmtNum(x1)} ${fmtNum(y1)} l S`);
        if (borderDash) o.push('[] 0 d');
        return o;
    };

    /**
     * Wrap a text-emitting operator in a clipping rectangle for cell `i`.
     * The clip rect spans the full column width and the actual cell band so
     * descenders aren't cut. Uses `q ... Q` to scope the clip.
     */
    const clipCell = (op: string, i: number, top: number, h: number): string =>
        clip
            ? `q ${fmtNum(cx[i])} ${fmtNum(top - h)} ${fmtNum(cwi[i])} ${fmtNum(h)} re W n\n${op}\nQ`
            : op;

    /**
     * Emit one wrapped cell, vertically top-aligned, with per-line alignment
     * (left/center/right) applied per `ColumnDef.a`. Tagged-mode allocates a
     * DISTINCT MCID per wrapped line (ISO 14289-1 §7.3 / PDF/A-2b): each
     * `Tj`/`TJ` fragment carries its own marked-content id, and every id is
     * pushed to `mcRefsOut` so the enclosing TD/TH `/K` array references them
     * all. A single-line cell still consumes exactly one MCID, so unwrapped
     * tagged tables stay byte-identical to v1.1.0.
     */
    function emitCell(
        lines: string[],
        colIdx: number,
        rowTop: number,
        rowH: number,
        font: string,
        sz: number,
        mcRefsOut: MCRef[] | null,
        isHeader: boolean,
    ): string[] {
        const col = columns[colIdx];
        const out: string[] = [];
        const lineH = sz * TABLE_LINE_HEIGHT;
        const padBottom = isHeader ? HEADER_PAD_BOTTOM : CELL_PAD_BOTTOM;
        // Resolve vertical alignment: per-column overrides the table default.
        // When neither is set, `vAlign` is undefined and the historic baseline
        // placement is used verbatim (byte-identical to pre-1.4.0).
        const vAlign = col.vAlign ?? block.cellVAlign;
        for (let li = 0; li < lines.length; li++) {
            // Preserve v1.1 character-truncation only when wrapping is disabled
            // (`wrap: 'never'`); under `'auto'`/`'always'` the planner already
            // sized the column to fit, so an extra char-truncate would clip
            // text that legitimately fits.
            const t = (lines.length === 1 && wrapMode === 'never')
                ? truncate(lines[li], (isHeader && col.mxH !== undefined) ? col.mxH : col.mx)
                : lines[li];
            // Baseline placement. With an explicit vAlign the text block is
            // positioned within the row band (top/middle/bottom); otherwise the
            // historic single-line / multi-line formulas are used unchanged.
            let baselineY: number;
            if (vAlign) {
                const blockH = lines.length * lineH;
                let offset: number;
                if (vAlign === 'top') offset = pad;
                else if (vAlign === 'bottom') offset = rowH - blockH - pad;
                else offset = (rowH - blockH) / 2; // middle
                if (offset < pad) offset = pad; // guard: content taller than band
                baselineY = rowTop - offset - li * lineH - sz + sz * 0.2;
            } else {
                // Single-line path reuses the historic v1.1 baseline (`rowH - padBottom`
                // above the row floor) → byte-identical output when no wrap fires.
                // Multi-line path top-aligns inside the cell band.
                baselineY = lines.length === 1
                    ? rowTop - rowH + padBottom
                    : rowTop - pad - sz + sz * 0.2 - li * lineH; // top-aligned with ascender bias
            }
            let op: string;
            if (mcRefsOut !== null && tagCtx?.tagged) {
                const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
                mcRefsOut.push({ mcid, pageObjNum: tagCtx.pageObjNum });
                if (col.a === 'r') {
                    op = txtRTagged(t, cx[colIdx] + cwi[colIdx] - pad, baselineY, font, sz, enc, mcid, isHeader);
                } else if (col.a === 'c') {
                    op = txtCTagged(t, cx[colIdx], baselineY, font, sz, cwi[colIdx], enc, mcid, isHeader);
                } else {
                    op = txtTagged(t, cx[colIdx] + pad, baselineY, font, sz, enc, mcid);
                }
            } else {
                if (col.a === 'r') {
                    op = txtR(t, cx[colIdx] + cwi[colIdx] - pad, baselineY, font, sz, enc, isHeader);
                } else if (col.a === 'c') {
                    op = txtC(t, cx[colIdx], baselineY, font, sz, cwi[colIdx], enc, isHeader);
                } else {
                    op = txt(t, cx[colIdx] + pad, baselineY, font, sz, enc);
                }
            }
            out.push(clipCell(op, colIdx, rowTop, rowH));
        }
        return out;
    }

    // ── Caption (first slice only) ───────────────────────────────────
    if (drawCaption && plan.captionLines.length > 0) {
        ops.push(`${colors.text} rg`);
        const lineH = CAPTION_FONT_SIZE * TABLE_LINE_HEIGHT;
        let cy = y - CAPTION_FONT_SIZE;
        const captionRefs: MCRef[] | null = tagCtx?.tagged ? [] : null;
        for (const line of plan.captionLines) {
            if (captionRefs !== null && tagCtx?.tagged) {
                const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
                captionRefs.push({ mcid, pageObjNum: tagCtx.pageObjNum });
                ops.push(txtCTagged(line, mgL, cy, enc.f2, CAPTION_FONT_SIZE, cw, enc, mcid, true));
            } else {
                ops.push(txtC(line, mgL, cy, enc.f2, CAPTION_FONT_SIZE, cw, enc, true));
            }
            cy -= lineH;
        }
        if (captionRefs && captionRefs.length > 0) {
            tableStructAccum.push({ type: 'Caption', children: captionRefs });
        }
        y -= plan.captionHeight;
    }

    // ── Header ───────────────────────────────────────────────────────
    if (drawHeader) {
        ops.push(`${colors.thBg} rg`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - headerHeight)} ${fmtNum(cw)} ${fmtNum(headerHeight)} re f`);
        ops.push(`0.75 w ${colors.thBrd} RG`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - headerHeight)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - headerHeight)} l S`);
        ops.push(`${colors.text} rg`);

        const thChildren: (StructElement | MCRef)[] = [];
        for (let i = 0; i < block.headers.length && i < columns.length; i++) {
            const cellRefs: MCRef[] | null = tagCtx?.tagged ? [] : null;
            ops.push(...emitCell(headerLines[i] ?? [''], i, y, headerHeight, enc.f2, fs.th, cellRefs, true));
            ops.push(...cellBorderOps(cx[i], cwi[i], y, headerHeight));
            if (cellRefs && cellRefs.length > 0) {
                thChildren.push({ type: 'TH', children: cellRefs });
            }
        }
        if (tagCtx?.tagged && thChildren.length > 0) {
            tableStructAccum.push({ type: 'TR', children: thChildren });
        }
        y -= headerHeight;
    }

    // ── Data rows ────────────────────────────────────────────────────
    for (let r = fromRow; r < toRow; r++) {
        const row = block.rows[r];
        const rowH = rowHeights[r];

        // Zebra fill (even data rows, counting from 0 across the entire table).
        if (zebraColor && r % 2 === 1) {
            ops.push(`${zebraColor} rg`);
            ops.push(`${fmtNum(mgL)} ${fmtNum(y - rowH)} ${fmtNum(cw)} ${fmtNum(rowH)} re f`);
        }

        // Row separator
        ops.push(`0.25 w ${colors.rowBrd} RG`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - rowH)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - rowH)} l S`);

        const tdChildren: (StructElement | MCRef)[] = [];
        const cells = rowLines[r];
        for (let i = 0; i < row.cells.length && i < columns.length; i++) {
            // Amount-column styling is opt-in via `ColumnDef.kind === 'amount'`
            // (since v1.2.0). The legacy `buildPDF()` financial path in
            // `pdf-builder.ts` keeps the historical `i === 3` heuristic for
            // byte-identical v1.0/v1.1 output.
            const isAmount = columns[i].kind === 'amount';
            const color = isAmount ? (row.type === 'credit' ? colors.credit : colors.debit) : colors.text;
            const font = isAmount ? enc.f2 : enc.f1;
            ops.push(`${color} rg`);

            const cellRefs: MCRef[] | null = tagCtx?.tagged ? [] : null;
            ops.push(...emitCell(cells[i] ?? [''], i, y, rowH, font, fs.td, cellRefs, false));
            ops.push(...cellBorderOps(cx[i], cwi[i], y, rowH));
            if (cellRefs && cellRefs.length > 0) {
                tdChildren.push({ type: 'TD', children: cellRefs });
            }
        }
        if (tagCtx?.tagged && tdChildren.length > 0) {
            tableStructAccum.push({ type: 'TR', children: tdChildren });
        }
        y -= rowH;
    }

    // ── Tagged-mode /Table emission (only after the LAST slice) ──────
    if (isFinalSlice && tagCtx?.tagged && tableStructAccum.length > 0) {
        documentChildren.push({ type: 'Table', children: tableStructAccum });
    }

    if (isFinalSlice) y -= plan.trailerSpacing;
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
            // Recursively accumulate height across nesting levels; depth 0 uses
            // the original geometry so flat lists estimate identically.
            const measureLevel = (items: readonly (string | ListItem)[], depth: number): number => {
                const availW = cw - LIST_INDENT * (depth + 1) - BULLET_MARK_WIDTH;
                let acc = 0;
                for (const entry of items) {
                    const text = typeof entry === 'string' ? entry : entry.text;
                    const lines = wrapText(text, availW, sz, enc);
                    acc += lineH + (lines.length - 1) * lineH + LIST_ITEM_SPACING;
                    if (typeof entry !== 'string' && entry.items && entry.items.length > 0) {
                        acc += measureLevel(entry.items, depth + 1);
                    }
                }
                return acc;
            };
            return measureLevel(block.items, 0);
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
