/**
 * pdfnative — Free-form Document Builder
 * ========================================
 * Generates PDF 1.4 documents from a sequence of content blocks
 * (headings, paragraphs, lists, tables, spacers, page breaks).
 *
 * Reuses the same PDF assembly pattern as pdf-builder.ts but with a
 * block-based content loop instead of the table-centric layout.
 *
 * ISO 32000-1 (PDF 1.4) compliant output.
 * ISO 14289-1 (PDF/UA-1) when tagged mode is enabled.
 * ISO 19005-1 (PDF/A-1b) when tagged mode is enabled.
 */

import type {
    FontEntry,
    EncodingContext,
    PdfLayoutOptions,
    PageTemplate,
} from '../types/pdf-types.js';
import type {
    DocumentParams,
    DocumentBlock,
    HeadingBlock,
    ParagraphBlock,
    TableBlock,
    ListBlock,
    ImageBlock,
    LinkBlock,
    TocBlock,
    BarcodeBlock,
} from '../types/pdf-document-types.js';
import { parseImage, buildImageXObject, buildImageOperators } from './pdf-image.js';
import type { ParsedImage } from './pdf-image.js';
import { validateURL } from './pdf-annot.js';
import { parseColor } from './pdf-color.js';
import type { LinkAnnotation } from './pdf-annot.js';
import { createEncodingContext } from './encoding-context.js';
import { truncate, helveticaWidth } from '../fonts/encoding.js';
import { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from '../fonts/font-embedder.js';
import { subsetTTF } from '../fonts/font-subsetter.js';
import { txt, txtR, txtC, txtTagged, txtRTagged, txtCTagged, fmtNum } from './pdf-text.js';
import { toBytes } from './pdf-stream.js';
import {
    PG_W, PG_H, DEFAULT_MARGINS,
    ROW_H, TH_H, FT_H, HEADER_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions,
    resolveTemplate,
} from './pdf-layout.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import {
    createMCIDAllocator,
    buildStructureTree,
    buildXMPMetadata,
    buildOutputIntentDict,
    buildMinimalSRGBProfile,
    resolvePdfAConfig,
    buildEmbeddedFiles,
    validateAttachments,
} from './pdf-tags.js';
import type { EncryptionState } from './pdf-encrypt.js';
import { initEncryption } from './pdf-encrypt.js';
import { createPdfWriter, writeXrefTrailer } from './pdf-assembler.js';
import type { WatermarkState } from './pdf-watermark.js';
import { validateWatermark, buildWatermarkState } from './pdf-watermark.js';
import { renderBarcode } from './pdf-barcode.js';

// ── Constants ────────────────────────────────────────────────────────

/** Heading font sizes by level. */
const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 18, 2: 14, 3: 11 };

/** Heading spacing (top + bottom) by level. */
const HEADING_SPACING: Record<1 | 2 | 3, { top: number; bottom: number }> = {
    1: { top: 14, bottom: 10 },
    2: { top: 10, bottom: 8 },
    3: { top: 8, bottom: 6 },
};

/** Default paragraph font size. */
const DEFAULT_PARA_SIZE = 10;

/** Default line height multiplier. */
const DEFAULT_LINE_HEIGHT = 1.4;

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

// ── Heading Destination Tracking ─────────────────────────────────────

/** A collected heading destination for TOC link targets. */
interface HeadingDestination {
    /** Unique destination name (e.g., 'toc_h_0'). */
    readonly destName: string;
    /** Heading display text. */
    readonly text: string;
    /** Heading level (1–3). */
    readonly level: 1 | 2 | 3;
    /** 0-based page index this heading appears on. */
    pageIndex: number;
    /** Y coordinate of the heading. */
    y: number;
}

// ── Tagged Mode Types ────────────────────────────────────────────────

interface TagContext {
    tagged: boolean;
    mcidAlloc: ReturnType<typeof createMCIDAllocator>;
    pageObjNum: number;
    structChildren: (StructElement | MCRef)[];
}

// ── Text Wrapping ────────────────────────────────────────────────────

/**
 * Measure text width in points.
 * Uses enc.tw() for Unicode mode, helveticaWidth() for Latin mode.
 */
function measureText(str: string, sz: number, enc: EncodingContext): number {
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
 * Wrap text into lines that fit within maxWidth.
 * Greedy line-filling algorithm with CJK character-level breaking.
 * Latin text breaks at word boundaries (spaces).
 * CJK characters break individually (no spaces needed).
 *
 * @param text - Input text string
 * @param maxWidth - Maximum line width in points
 * @param fontSize - Font size for measurement
 * @param enc - Encoding context
 * @returns Array of line strings
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
        if (w <= maxWidth || currentLine === '') {
            currentLine = candidate;
        } else {
            lines.push(currentLine.trimEnd());
            currentLine = seg.trimStart();
        }
    }
    if (currentLine) lines.push(currentLine.trimEnd());

    return lines;
}

// ── Block Renderers ──────────────────────────────────────────────────

/**
 * Render a heading block. Returns ops and the new Y position.
 */
function _renderHeading(
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

/**
 * Render a paragraph block with text wrapping.
 */
function _renderParagraph(
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

/**
 * Render a list block (bullet or numbered).
 */
function _renderList(
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
                // First line on same Y as marker
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

/**
 * Render a table block. Reuses the same pattern as pdf-builder.ts table helpers.
 */
function _renderTable(
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
    const columns = block.columns ? [...block.columns] : DEFAULT_COLUMNS;
    const fs = DEFAULT_FONT_SIZES;
    const colors = DEFAULT_COLORS;
    const { cx, cwi } = computeColumnPositions(columns, mgL, cw);

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
                ops.push(txtRTagged(t, cx[i] + cwi[i] - 3, y - TH_H + 4, enc.f2, fs.th, enc, mcid));
            } else if (columns[i].a === 'c') {
                ops.push(txtCTagged(t, cx[i], y - TH_H + 4, enc.f2, fs.th, cwi[i], enc, mcid));
            } else {
                ops.push(txtTagged(t, cx[i] + 3, y - TH_H + 4, enc.f2, fs.th, enc, mcid));
            }
        } else {
            if (columns[i].a === 'r') {
                ops.push(txtR(t, cx[i] + cwi[i] - 3, y - TH_H + 4, enc.f2, fs.th, enc));
            } else if (columns[i].a === 'c') {
                ops.push(txtC(t, cx[i], y - TH_H + 4, enc.f2, fs.th, cwi[i], enc));
            } else {
                ops.push(txt(t, cx[i] + 3, y - TH_H + 4, enc.f2, fs.th, enc));
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
                    ops.push(txtRTagged(t, cx[i] + cwi[i] - 3, y - ROW_H + 3, font, fs.td, enc, mcid));
                } else if (columns[i].a === 'c') {
                    ops.push(txtCTagged(t, cx[i], y - ROW_H + 3, font, fs.td, cwi[i], enc, mcid));
                } else {
                    ops.push(txtTagged(t, cx[i] + 3, y - ROW_H + 3, font, fs.td, enc, mcid));
                }
            } else {
                if (columns[i].a === 'r') {
                    ops.push(txtR(t, cx[i] + cwi[i] - 3, y - ROW_H + 3, font, fs.td, enc));
                } else if (columns[i].a === 'c') {
                    ops.push(txtC(t, cx[i], y - ROW_H + 3, font, fs.td, cwi[i], enc));
                } else {
                    ops.push(txt(t, cx[i] + 3, y - ROW_H + 3, font, fs.td, enc));
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

/**
 * Render a page template (header or footer) at the given Y position.
 * Resolves {page}, {pages}, {date}, {title} placeholders and renders
 * left/center/right text segments.
 */
function _renderPageTemplate(
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

/** Resolved image with parsed data and display dimensions. */
interface ResolvedImage {
    readonly parsed: ParsedImage;
    readonly displayW: number;
    readonly displayH: number;
    readonly align: 'left' | 'center' | 'right';
    readonly alt?: string;
}

/**
 * Parse and resolve display dimensions for an image block.
 * Scales to fit within contentWidth while preserving aspect ratio.
 */
function _resolveImage(block: ImageBlock, contentWidth: number): ResolvedImage {
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
        // Default: use native dimensions, scale down if wider than content area
        displayW = nativeW;
        displayH = nativeH;
    }

    // Clamp to content width
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

/**
 * Render an image block. Returns ops and the new Y position.
 */
function _renderImage(
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

    return { ops, y: imgY - 6 }; // post-image spacing
}

/** Default link color — PDF blue. */
const LINK_COLOR = '0.0 0.0 0.8';

/** Default link font size. */
const DEFAULT_LINK_SIZE = 10;

/** Link underline offset below baseline. */
const LINK_UNDERLINE_OFFSET = 1.5;

// ── Link Rendering ───────────────────────────────────────────────────

/** A collected annotation to be emitted as a PDF indirect object. */
interface PageAnnotation {
    readonly annot: LinkAnnotation;
    readonly page: number; // page index (0-based)
}

/**
 * Render a link block. Renders clickable underlined text and collects annotations.
 */
function _renderLink(
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

    // Validate URL — only render as link if valid
    const isValid = validateURL(block.url);

    const lines = wrapText(block.text, cw, sz, enc);

    ops.push(`${color} rg`);

    for (const line of lines) {
        const textW = measureText(line, sz, enc);
        const textX = mgL;
        const textY = y - sz;

        // Render text
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

        // Collect annotation for this line (rect in PDF coords)
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

    y -= 4; // post-link spacing
    return { ops, y };
}

// ── Table of Contents ────────────────────────────────────────────────

/**
 * Estimate the height of a TOC block based on collected headings.
 */
function _estimateTocHeight(
    tocBlock: TocBlock,
    headings: readonly HeadingDestination[],
): number {
    const sz = tocBlock.fontSize ?? DEFAULT_TOC_SIZE;
    const maxLevel = tocBlock.maxLevel ?? 3;
    const titleSz = 14; // TOC title size
    const lineH = sz * TOC_LINE_HEIGHT;

    const filteredCount = headings.filter(h => h.level <= maxLevel).length;
    return titleSz + TOC_TITLE_SPACING + filteredCount * lineH + TOC_BOTTOM_SPACING;
}

/**
 * Render a Table of Contents block.
 * Renders the TOC title and one entry per collected heading with page numbers.
 * Collects /GoTo annotations for each entry.
 */
function _renderToc(
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

        // Truncate heading text if needed
        let displayText = heading.text;
        if (measureText(displayText, sz, enc) > availTextW) {
            while (displayText.length > 1 && measureText(displayText + '...', sz, enc) > availTextW) {
                displayText = displayText.slice(0, -1);
            }
            displayText += '...';
        }
        const textW = measureText(displayText, sz, enc);

        // Heading text
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

        // Page number (right-aligned)
        ops.push(txtR(pageNumStr, mgL + cw, textY, enc.f1, sz, enc));

        // Collect /GoTo annotation for this entry
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

/** Default barcode dimensions by format type. */
const BARCODE_1D_WIDTH = 200;
const BARCODE_1D_HEIGHT = 60;
const BARCODE_2D_SIZE = 100;

function _is2DFormat(format: string): boolean {
    return format === 'qr' || format === 'datamatrix';
}

function _estimateBarcodeHeight(block: BarcodeBlock): number {
    if (_is2DFormat(block.format)) {
        return block.height ?? block.width ?? BARCODE_2D_SIZE;
    }
    return block.height ?? BARCODE_1D_HEIGHT;
}

function _renderBarcodeBlock(
    block: BarcodeBlock,
    y: number,
    mgL: number,
    cw: number,
    tagCtx?: TagContext,
    documentChildren?: (StructElement | MCRef)[],
): { ops: string[]; y: number } {
    const ops: string[] = [];
    const is2D = _is2DFormat(block.format);
    const w = block.width ?? (is2D ? BARCODE_2D_SIZE : BARCODE_1D_WIDTH);
    const h = block.height ?? (is2D ? w : BARCODE_1D_HEIGHT);

    // Horizontal alignment
    let bx = mgL;
    if (block.align === 'center') {
        bx = mgL + (cw - w) / 2;
    } else if (block.align === 'right') {
        bx = mgL + cw - w;
    }

    const by = y - h;

    // Tagged mode: wrap in /Figure
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

    y = by - 6; // post-barcode spacing
    return { ops, y };
}

// ── Block Height Estimation ──────────────────────────────────────────

/**
 * Estimate the height of a block for pagination purposes.
 * This is a pre-rendering pass to decide if a block fits on the current page.
 */
function _estimateBlockHeight(
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
            return Infinity; // Forces new page
        }
        case 'image': {
            const resolved = _resolveImage(block, cw);
            return resolved.displayH + 6; // post-image spacing
        }
        case 'link': {
            const sz = block.fontSize ?? DEFAULT_LINK_SIZE;
            const lines = wrapText(block.text, cw, sz, enc);
            return lines.length * (sz * DEFAULT_LINE_HEIGHT) + 4;
        }
        case 'toc': {
            return headings ? _estimateTocHeight(block, headings) : 0;
        }
        case 'barcode': {
            return _estimateBarcodeHeight(block) + 6;
        }
    }
}

// ── Main Builder ─────────────────────────────────────────────────────

/**
 * Build a free-form PDF document from content blocks.
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization (page size, margins, tagged mode)
 * @returns Complete PDF as a binary string
 */
export function buildDocumentPDF(params: DocumentParams, layoutOptions?: Partial<PdfLayoutOptions>): string {
    // ── Input Validation ─────────────────────────────────────────────
    if (!params || typeof params !== 'object') {
        throw new Error('buildDocumentPDF: params is required and must be an object');
    }
    if (!Array.isArray(params.blocks)) {
        throw new Error('buildDocumentPDF: params.blocks must be an array');
    }
    if (params.blocks.length > 10_000) {
        throw new Error(`buildDocumentPDF: block count (${params.blocks.length}) exceeds safe limit (10,000)`);
    }

    const layout = layoutOptions ?? params.layout;

    // ── Resolve layout ───────────────────────────────────────────────
    const pgW = layout?.pageWidth ?? PG_W;
    const pgH = layout?.pageHeight ?? PG_H;
    const mg = layout?.margins ?? { ...DEFAULT_MARGINS };
    const cw = pgW - mg.l - mg.r;

    // ── Font setup ───────────────────────────────────────────────────
    const fontEntries: FontEntry[] = params.fontEntries
        ? [...params.fontEntries]
        : [];
    const enc = createEncodingContext(fontEntries);

    // ── Tagged mode setup ────────────────────────────────────────────
    const pdfaConfig = resolvePdfAConfig(layout?.tagged);
    const tagged = pdfaConfig.enabled;

    // ── Encryption setup ──────────────────────────────────────────────
    const encryptionOpts = layout?.encryption;
    if (tagged && encryptionOpts) {
        throw new Error('PDF/A and encryption are mutually exclusive (ISO 19005-1 §6.3.2)');
    }
    const encState: EncryptionState | null = encryptionOpts ? initEncryption(encryptionOpts) : null;

    // ── Compression setup ─────────────────────────────────────────────
    const compress = layout?.compress === true;

    // ── Watermark setup ──────────────────────────────────────────────
    const watermarkOpts = layout?.watermark;
    if (watermarkOpts) {
        validateWatermark(watermarkOpts, layout?.tagged);
    }

    // ── Attachments setup (PDF/A-3 only) ─────────────────────────────
    const attachments = layout?.attachments;
    validateAttachments(attachments, layout?.tagged);

    const mcidAlloc = tagged ? createMCIDAllocator() : undefined;
    const documentChildren: (StructElement | MCRef)[] = [];

    // ── Resolve header/footer templates ──────────────────────────────
    const footerText = params.footerText ?? '';
    const footerTpl: PageTemplate = layout?.footerTemplate ?? {
        left: footerText || undefined,
        right: '{page}/{pages}',
    };
    const headerTpl: PageTemplate | undefined = layout?.headerTemplate;
    const headerH = headerTpl ? HEADER_H : 0;

    const dateNow = new Date();
    const pad2d = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${dateNow.getFullYear()}-${pad2d(dateNow.getMonth() + 1)}-${pad2d(dateNow.getDate())}`;
    const docTitle = params.title ?? '';

    // ── Pagination: build pages from blocks ──────────────────────────
    const availableH = pgH - mg.t - mg.b - FT_H - headerH;

    const hasToc = params.blocks.some(b => b.type === 'toc');

    /**
     * Run a pagination pass to assign blocks to pages and collect heading positions.
     * Returns page blocks array and collected headings.
     */
    function _paginateBlocks(
        headingsIn?: readonly HeadingDestination[],
    ): { pages: DocumentBlock[][]; headings: HeadingDestination[] } {
        const pages: DocumentBlock[][] = [[]];
        const headings: HeadingDestination[] = [];
        let remainH = availableH;
        let headingIdx = 0;
        // Track Y per page for heading destination positions
        let curY = pgH - mg.t - headerH;

        // Account for title on page 0
        if (params.title) {
            const titleH = 22 + 12; // TITLE_LN + underline spacing
            remainH -= titleH;
            curY -= titleH;
        }

        for (const block of params.blocks) {
            if (block.type === 'pageBreak') {
                pages.push([]);
                remainH = availableH;
                curY = pgH - mg.t - headerH;
                continue;
            }

            const blockH = _estimateBlockHeight(block, enc, cw, headingsIn);
            if (blockH > remainH && pages[pages.length - 1].length > 0) {
                pages.push([]);
                remainH = availableH;
                curY = pgH - mg.t - headerH;
            }

            pages[pages.length - 1].push(block);

            if (block.type === 'heading') {
                headings.push({
                    destName: `toc_h_${headingIdx++}`,
                    text: block.text,
                    level: block.level,
                    pageIndex: pages.length - 1,
                    y: curY,
                });
            }

            remainH -= blockH;
            curY -= blockH;
        }

        return { pages, headings };
    }

    // Multi-pass pagination for TOC support (max 3 iterations)
    let headingDests: HeadingDestination[] = [];
    let pageBlocks: DocumentBlock[][];

    if (hasToc) {
        // Pass 1: paginate without TOC content to collect headings
        const pass1 = _paginateBlocks();
        headingDests = pass1.headings;

        // Pass 2: re-paginate with TOC height included
        const pass2 = _paginateBlocks(headingDests);

        // Check if heading page assignments changed
        const pagesChanged = pass2.headings.some((h, i) =>
            i < headingDests.length && h.pageIndex !== headingDests[i].pageIndex
        );

        if (pagesChanged) {
            // Pass 3: final re-pagination with updated heading positions
            headingDests = pass2.headings;
            const pass3 = _paginateBlocks(headingDests);
            headingDests = pass3.headings;
            pageBlocks = pass3.pages;
        } else {
            headingDests = pass2.headings;
            pageBlocks = pass2.pages;
        }
    } else {
        const result = _paginateBlocks();
        pageBlocks = result.pages;
        headingDests = result.headings;
    }

    const totalPages = Math.max(1, pageBlocks.length);

    // ── Collect images and resolve them ───────────────────────────────
    const resolvedImages: ResolvedImage[] = [];
    const imageBlockMap = new Map<ImageBlock, number>(); // block → image index
    for (const blocks of pageBlocks) {
        for (const block of blocks) {
            if (block.type === 'image') {
                const idx = resolvedImages.length;
                imageBlockMap.set(block, idx);
                resolvedImages.push(_resolveImage(block, cw));
            }
        }
    }
    const imageCount = resolvedImages.length;

    // ── Build watermark state ────────────────────────────────────────
    const wmState: WatermarkState | null = watermarkOpts
        ? buildWatermarkState(watermarkOpts, pgW, pgH, enc)
        : null;
    const wmExtraObjs = wmState
        ? wmState.extGStates.size + (wmState.imageXObj ? 1 : 0)
        : 0;

    // ── Collect link annotations ─────────────────────────────────────
    const pageAnnotations: PageAnnotation[] = [];

    // ── Pre-compute page object start ────────────────────────────────
    const fontObjEnd = (enc.isUnicode && fontEntries.length > 0)
        ? 5 + fontEntries.length * 5
        : 5;
    const imageObjStart = fontObjEnd;
    const prePageObjStart = fontObjEnd + imageCount + wmExtraObjs;

    // ── Render page content streams ──────────────────────────────────
    const pageStreams: string[] = [];
    let headingDestIdx = 0;

    for (let p = 0; p < totalPages; p++) {
        const pageObjNum = prePageObjStart + p * 2;
        const tagCtx: TagContext | undefined = tagged && mcidAlloc
            ? { tagged: true, mcidAlloc, pageObjNum, structChildren: [] }
            : undefined;

        const ops: string[] = [];
        let y = pgH - mg.t;

        // Render header template (if provided)
        if (headerTpl) {
            const hOps = _renderPageTemplate(
                headerTpl, p + 1, totalPages, docTitle, dateStr,
                y - (headerTpl.fontSize ?? DEFAULT_FONT_SIZES.ft),
                enc, mg.l, mg.r, pgW, cw, tagCtx, documentChildren,
            );
            ops.push(...hOps);
            y -= HEADER_H;
        }

        // Background watermark (behind content)
        if (wmState?.backgroundOps) {
            ops.push(wmState.backgroundOps);
        }

        // Render title on first page
        if (p === 0 && params.title) {
            const titleSz = 16;
            const titleColor = '0.145 0.388 0.922';
            ops.push(`${titleColor} rg`);
            if (tagCtx?.tagged) {
                const mcid = tagCtx.mcidAlloc.next(pageObjNum);
                ops.push(txtTagged(params.title, mg.l, y - titleSz, enc.f2, titleSz, enc, mcid));
                documentChildren.push({ type: 'H1', children: [{ mcid, pageObjNum }] });
            } else {
                ops.push(txt(params.title, mg.l, y - titleSz, enc.f2, titleSz, enc));
            }
            y -= 22; // TITLE_LN

            // Title underline
            ops.push(`0.75 w ${titleColor} RG`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y)} m ${fmtNum(pgW - mg.r)} ${fmtNum(y)} l S`);
            y -= 12;
        }

        // Render blocks for this page
        const blocks = pageBlocks[p] ?? [];
        for (const block of blocks) {
            switch (block.type) {
                case 'heading': {
                    // Update heading destination with actual render position
                    if (headingDestIdx < headingDests.length) {
                        headingDests[headingDestIdx].pageIndex = p;
                        headingDests[headingDestIdx].y = y;
                        headingDestIdx++;
                    }
                    const result = _renderHeading(block, y, enc, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'paragraph': {
                    const result = _renderParagraph(block, y, enc, mg.l, cw, pgW, mg.r, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'list': {
                    const result = _renderList(block, y, enc, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'table': {
                    const result = _renderTable(block, y, enc, mg.l, mg.r, pgW, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'spacer': {
                    y -= block.height;
                    break;
                }
                case 'image': {
                    const imgIdx = imageBlockMap.get(block);
                    if (imgIdx !== undefined) {
                        const imgName = `/Im${imgIdx + 1}`;
                        const result = _renderImage(resolvedImages[imgIdx], imgName, y, mg.l, cw, tagCtx, documentChildren);
                        ops.push(...result.ops);
                        y = result.y;
                    }
                    break;
                }
                case 'link': {
                    const result = _renderLink(block, y, enc, mg.l, cw, p, pageAnnotations, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'toc': {
                    const result = _renderToc(block, headingDests, y, enc, mg.l, cw, p, pageAnnotations, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'barcode': {
                    const result = _renderBarcodeBlock(block, y, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                // pageBreak handled during pagination
            }
        }

        // Foreground watermark (above content)
        if (wmState?.foregroundOps) {
            ops.push(wmState.foregroundOps);
        }

        // Footer
        const ftOps = _renderPageTemplate(
            footerTpl, p + 1, totalPages, docTitle, dateStr,
            mg.b - 5, enc, mg.l, mg.r, pgW, cw, tagCtx, documentChildren,
        );
        ops.push(...ftOps);

        pageStreams.push(ops.join('\n'));
    }

    // ── Group annotations by page ────────────────────────────────────
    const annotsByPage = new Map<number, PageAnnotation[]>();
    for (const pa of pageAnnotations) {
        const list = annotsByPage.get(pa.page) ?? [];
        list.push(pa);
        annotsByPage.set(pa.page, list);
    }
    const totalAnnots = pageAnnotations.length;

    // ── Assemble PDF binary ──────────────────────────────────────────
    const { emit, emitObj, emitStreamObj, offset: getOffset, adjustOffset, objOffsets, parts } = createPdfWriter(compress, encState);

    // PDF Header
    emit(`%PDF-${pdfaConfig.pdfVersion}\n`);
    emit('%\xE2\xE3\xCF\xD3\n\n');

    // Catalog placeholder
    emitObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

    let pageObjStart: number;
    let structTreeRootObjNum = 0;

    // Build image /XObject resource string
    let imgXObjRes = '';
    if (imageCount > 0) {
        const imgRefs: string[] = [];
        for (let i = 0; i < imageCount; i++) {
            imgRefs.push(`/Im${i + 1} ${imageObjStart + i} 0 R`);
        }
        imgXObjRes = ` /XObject << ${imgRefs.join(' ')}`;
    }

    // Build watermark resource strings
    let wmGsRes = '';
    let wmImgRef = '';
    const wmObjStart = fontObjEnd + imageCount;
    if (wmState) {
        let wmObjIdx = 0;
        const gsRefs: string[] = [];
        for (const [gsName] of wmState.extGStates) {
            gsRefs.push(`${gsName} ${wmObjStart + wmObjIdx} 0 R`);
            wmObjIdx++;
        }
        wmGsRes = gsRefs.length > 0 ? ` /ExtGState << ${gsRefs.join(' ')} >>` : '';
        if (wmState.imageXObj) {
            wmImgRef = `/ImW1 ${wmObjStart + wmObjIdx} 0 R`;
        }
    }

    // Combine XObject resource dict
    if (imgXObjRes || wmImgRef) {
        if (!imgXObjRes) imgXObjRes = ' /XObject <<';
        if (wmImgRef) imgXObjRes += ` ${wmImgRef}`;
        imgXObjRes += ' >>';
    }

    if (enc.isUnicode && fontEntries.length > 0) {
        pageObjStart = 5 + fontEntries.length * 5 + imageCount + wmExtraObjs;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${pageObjStart + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);

        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        // CIDFont Type2 objects — 5 per fontEntry
        for (let fi = 0; fi < fontEntries.length; fi++) {
            const fe = fontEntries[fi];
            const fd = fe.fontData;
            const base = 5 + fi * 5;

            const fullTtfBinary = base64ToByteString(fd.ttfBase64);
            const usedGids = enc.getUsedGids ? enc.getUsedGids().get(fe.fontRef) : null;
            const ttfBinary = usedGids && usedGids.size > 0
                ? subsetTTF(fullTtfBinary, usedGids)
                : fullTtfBinary;

            const fm = fd.metrics;
            const bfName = `/${fd.fontName.replace(/[^A-Za-z0-9-]/g, '')}`;
            const toUnicodeCMap = usedGids && usedGids.size > 0
                ? buildToUnicodeCMap(fd.cmap, usedGids)
                : buildToUnicodeCMap(fd.cmap, new Set());

            const subsetW = buildSubsetWidthArray(fd.widths, usedGids ?? new Set());
            const wArray = subsetW || fd.pdfWidthArray;

            emitObj(base,
                `<< /Type /Font /Subtype /Type0 /BaseFont ${bfName} ` +
                `/Encoding /Identity-H /DescendantFonts [${base + 1} 0 R] /ToUnicode ${base + 4} 0 R >>`);

            emitObj(base + 1,
                `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${bfName} ` +
                `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
                `/FontDescriptor ${base + 2} 0 R ` +
                `/DW ${fm.defaultWidth} ` +
                `/W [${wArray}] ` +
                `/CIDToGIDMap /Identity >>`);

            emitObj(base + 2,
                `<< /Type /FontDescriptor /FontName ${bfName} ` +
                `/Flags 4 ` +
                `/FontBBox [${fm.bbox.join(' ')}] ` +
                `/ItalicAngle 0 ` +
                `/Ascent ${fm.ascent} ` +
                `/Descent ${fm.descent} ` +
                `/CapHeight ${fm.capHeight} ` +
                `/StemV ${fm.stemV} ` +
                `/FontFile2 ${base + 3} 0 R >>`);

            emitStreamObj(base + 3, `<< /Length ${ttfBinary.length} /Length1 ${ttfBinary.length}`, ttfBinary);

            emitStreamObj(base + 4, `<< /Length ${toUnicodeCMap.length}`, toUnicodeCMap);
        }

        // Image XObject objects
        for (let i = 0; i < imageCount; i++) {
            const img = resolvedImages[i];
            emitObj(imageObjStart + i, buildImageXObject(img.parsed));
        }

        // Watermark objects (ExtGState + optional image)
        if (wmState) {
            let wmObjIdx = 0;
            for (const [, gsDict] of wmState.extGStates) {
                emitObj(wmObjStart + wmObjIdx, gsDict);
                wmObjIdx++;
            }
            if (wmState.imageXObj) {
                emitObj(wmObjStart + wmObjIdx, wmState.imageXObj);
            }
        }

        let fontRes = '/F1 3 0 R /F2 4 0 R';
        for (let fi = 0; fi < fontEntries.length; fi++) {
            fontRes += ` ${fontEntries[fi].fontRef} ${5 + fi * 5} 0 R`;
        }

        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = pageObjStart + p * 2;
            const streamObjNum = pageObjStart + 1 + p * 2;
            const stream = pageStreams[p];
            const structParents = tagged ? ` /StructParents ${p}` : '';

            // Build /Annots reference if this page has link annotations
            const pageAnnots = annotsByPage.get(p);
            let annotsStr = '';
            if (pageAnnots && pageAnnots.length > 0) {
                const annotObjStart = pageObjStart + totalPages * 2;
                let annotIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    annotIdx += (annotsByPage.get(pp)?.length ?? 0);
                }
                const refs = pageAnnots.map((_, i) => `${annotObjStart + annotIdx + i} 0 R`).join(' ');
                annotsStr = ` /Annots [${refs}]`;
            }

            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << ${fontRes} >>${imgXObjRes}${wmGsRes} >>${structParents}${annotsStr} >>`
            );
            emitStreamObj(streamObjNum, `<< /Length ${stream.length}`, stream);
        }

        // Emit link annotation objects (after all pages)
        if (totalAnnots > 0) {
            const annotObjStart = pageObjStart + totalPages * 2;
            let annotIdx = 0;
            for (const pa of pageAnnotations) {
                const objNum = annotObjStart + annotIdx;
                const [x1, y1, x2, y2] = pa.annot.rect;
                if (pa.annot.url.startsWith('#')) {
                    // Internal /GoTo annotation (TOC link)
                    const destName = pa.annot.url.slice(1);
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/Dest /${destName} >>`
                    );
                } else {
                    const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                    );
                }
                annotIdx++;
            }
        }
    } else {
        // Latin mode
        pageObjStart = 5 + imageCount + wmExtraObjs;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${5 + imageCount + wmExtraObjs + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);
        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        // Image XObject objects (Latin mode)
        for (let i = 0; i < imageCount; i++) {
            const img = resolvedImages[i];
            emitObj(imageObjStart + i, buildImageXObject(img.parsed));
        }

        // Watermark objects (Latin mode)
        if (wmState) {
            let wmObjIdx = 0;
            for (const [, gsDict] of wmState.extGStates) {
                emitObj(wmObjStart + wmObjIdx, gsDict);
                wmObjIdx++;
            }
            if (wmState.imageXObj) {
                emitObj(wmObjStart + wmObjIdx, wmState.imageXObj);
            }
        }

        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = 5 + imageCount + wmExtraObjs + p * 2;
            const streamObjNum = 6 + imageCount + wmExtraObjs + p * 2;
            const stream = pageStreams[p];
            const structParents = tagged ? ` /StructParents ${p}` : '';

            // Build /Annots reference if this page has link annotations
            const pageAnnots = annotsByPage.get(p);
            let annotsStr = '';
            if (pageAnnots && pageAnnots.length > 0) {
                const annotObjStart = pageObjStart + totalPages * 2;
                let annotIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    annotIdx += (annotsByPage.get(pp)?.length ?? 0);
                }
                const refs = pageAnnots.map((_, i) => `${annotObjStart + annotIdx + i} 0 R`).join(' ');
                annotsStr = ` /Annots [${refs}]`;
            }

            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imgXObjRes}${wmGsRes} >>${structParents}${annotsStr} >>`
            );
            emitStreamObj(streamObjNum, `<< /Length ${stream.length}`, stream);
        }

        // Emit link annotation objects (Latin mode, after all pages)
        if (totalAnnots > 0) {
            const annotObjStart = pageObjStart + totalPages * 2;
            let annotIdx = 0;
            for (const pa of pageAnnotations) {
                const objNum = annotObjStart + annotIdx;
                const [x1, y1, x2, y2] = pa.annot.rect;
                if (pa.annot.url.startsWith('#')) {
                    const destName = pa.annot.url.slice(1);
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/Dest /${destName} >>`
                    );
                } else {
                    const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                    );
                }
                annotIdx++;
            }
        }
    }

    // /Info dictionary
    const baseObjCount = enc.isUnicode
        ? 4 + fontEntries.length * 5 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots
        : 4 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots;
    const infoObjNum = baseObjCount + 1;

    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const pdfDate = `D:${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
        `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const isoDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
        `T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const infoTitle = params.title ?? '';
    const escapedTitle = infoTitle.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

    const metaParts: string[] = [`/Title (${escapedTitle})`, '/Producer (pdfnative)', `/CreationDate (${pdfDate})`];
    if (params.metadata?.author) {
        const a = params.metadata.author.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        metaParts.push(`/Author (${a})`);
    }
    if (params.metadata?.subject) {
        const s = params.metadata.subject.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        metaParts.push(`/Subject (${s})`);
    }
    if (params.metadata?.keywords) {
        const k = params.metadata.keywords.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        metaParts.push(`/Keywords (${k})`);
    }
    emitObj(infoObjNum, `<< ${metaParts.join(' ')} >>`);

    let totalObjs = infoObjNum;

    // ── Tagged PDF objects ───────────────────────────────────────────
    let xmpObjNum = 0;
    let outputIntentObjNum = 0;
    let afArrayStr = '';
    let embeddedFilesNamesDict = '';

    if (tagged) {
        const documentEl: StructElement = { type: 'Document', children: documentChildren };
        const treeStart = totalObjs + 1;
        const tree = buildStructureTree(documentEl, treeStart);

        for (const [objNum, content] of tree.objects) {
            emitObj(objNum, content);
        }
        structTreeRootObjNum = tree.structTreeRootObjNum;
        totalObjs = treeStart + tree.totalObjects - 1;

        xmpObjNum = totalObjs + 1;
        const xmpContent = buildXMPMetadata(infoTitle, isoDate, pdfaConfig.pdfaPart, pdfaConfig.pdfaConformance);
        emitStreamObj(xmpObjNum,
            `<< /Type /Metadata /Subtype /XML /Length ${xmpContent.length}`, xmpContent, true);
        totalObjs = xmpObjNum;

        const iccObjNum = totalObjs + 1;
        const iccProfile = buildMinimalSRGBProfile();
        emitStreamObj(iccObjNum,
            `<< /N 3 /Length ${iccProfile.length}`, iccProfile);
        totalObjs = iccObjNum;

        outputIntentObjNum = totalObjs + 1;
        emitObj(outputIntentObjNum, buildOutputIntentDict(iccObjNum, pdfaConfig.outputIntentSubtype));
        totalObjs = outputIntentObjNum;

        // Embedded file attachments (PDF/A-3 only)
        if (attachments && attachments.length > 0) {
            const efResult = buildEmbeddedFiles(attachments, totalObjs + 1);
            for (const [objNum, content] of efResult.objects) {
                const streamData = efResult.streams.get(objNum);
                if (streamData !== undefined) {
                    emitStreamObj(objNum, content, streamData);
                } else {
                    emitObj(objNum, content);
                }
            }
            afArrayStr = efResult.filespecObjNums.map(n => `${n} 0 R`).join(' ');
            embeddedFilesNamesDict = efResult.namesDict;
            totalObjs += efResult.totalObjects;
        }
    }

    // ── Build named destinations for TOC ────────────────────────────
    let destsStr = '';
    if (hasToc && headingDests.length > 0) {
        const destEntries = headingDests.map(h => {
            const destPageObjNum = pageObjStart + h.pageIndex * 2;
            return `/${h.destName} [${destPageObjNum} 0 R /XYZ ${fmtNum(mg.l)} ${fmtNum(h.y)} null]`;
        });
        destsStr = ` /Dests << ${destEntries.join(' ')} >>`;
    }

    // ── Rewrite Catalog ──────────────────────────────────────────────
    if (tagged) {
        let catalogContent =
            `<< /Type /Catalog /Pages 2 0 R ` +
            `/MarkInfo << /Marked true >> ` +
            `/StructTreeRoot ${structTreeRootObjNum} 0 R ` +
            `/Metadata ${xmpObjNum} 0 R ` +
            `/OutputIntents [${outputIntentObjNum} 0 R]${destsStr}`;
        if (afArrayStr) {
            catalogContent += ` /AF [${afArrayStr}] ${embeddedFilesNamesDict}`;
        }
        catalogContent += ` >>`;

        const oldCatalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n';
        const newCatalog = `1 0 obj\n${catalogContent}\nendobj\n\n`;
        const idx = parts.indexOf(oldCatalog);
        if (idx !== -1) {
            const sizeDiff = newCatalog.length - oldCatalog.length;
            parts[idx] = newCatalog;
            adjustOffset(sizeDiff);
            for (let i = 2; i <= totalObjs; i++) {
                if (objOffsets[i] !== undefined) {
                    objOffsets[i] += sizeDiff;
                }
            }
        }
    } else if (destsStr) {
        // Non-tagged mode with TOC destinations — rewrite catalog
        const catalogContent = `<< /Type /Catalog /Pages 2 0 R${destsStr} >>`;
        const oldCatalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n';
        const newCatalog = `1 0 obj\n${catalogContent}\nendobj\n\n`;
        const idx = parts.indexOf(oldCatalog);
        if (idx !== -1) {
            const sizeDiff = newCatalog.length - oldCatalog.length;
            parts[idx] = newCatalog;
            adjustOffset(sizeDiff);
            for (let i = 2; i <= totalObjs; i++) {
                if (objOffsets[i] !== undefined) {
                    objOffsets[i] += sizeDiff;
                }
            }
        }
    }

    // ── Xref, Trailer, %%EOF ────────────────────────────────────────
    const writer = { emit, emitObj, emitStreamObj, offset: getOffset, adjustOffset, objOffsets, parts };
    writeXrefTrailer(writer, totalObjs, infoObjNum, encState);

    return parts.join('');
}

/**
 * Build a free-form PDF document and return as Uint8Array.
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization
 * @returns PDF as Uint8Array ready for download or Blob
 */
export function buildDocumentPDFBytes(params: DocumentParams, layoutOptions?: Partial<PdfLayoutOptions>): Uint8Array {
    return toBytes(buildDocumentPDF(params, layoutOptions));
}
