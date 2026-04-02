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
} from '../types/pdf-document-types.js';
import { parseImage, buildImageXObject, buildImageOperators } from './pdf-image.js';
import type { ParsedImage } from './pdf-image.js';
import { validateURL } from './pdf-annot.js';
import { parseColor } from './pdf-color.js';
import type { LinkAnnotation } from './pdf-annot.js';
import { createEncodingContext, truncate, helveticaWidth } from '../fonts/encoding.js';
import { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from '../fonts/font-embedder.js';
import { subsetTTF } from '../fonts/font-subsetter.js';
import { txt, txtR, txtC, txtTagged, txtRTagged, txtCTagged, fmtNum } from './pdf-text.js';
import { toBytes } from './pdf-stream.js';
import {
    PG_W, PG_H, DEFAULT_MARGINS,
    ROW_H, TH_H, FT_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions,
} from './pdf-layout.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import {
    createMCIDAllocator,
    buildStructureTree,
    buildXMPMetadata,
    buildOutputIntentDict,
    buildMinimalSRGBProfile,
    resolvePdfAConfig,
} from './pdf-tags.js';
import type { EncryptionState } from './pdf-encrypt.js';
import { initEncryption, encryptStream, buildEncryptDict, buildIdArray } from './pdf-encrypt.js';
import { compressStream } from './pdf-compress.js';

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
 * Wrap text into lines that fit within maxWidth.
 * Greedy line-filling algorithm: split on spaces, fill until overflow.
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

    const words = text.split(/\s+/);
    if (words.length === 0) return [''];

    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const candidate = currentLine + ' ' + words[i];
        const w = measureText(candidate, fontSize, enc);
        if (w <= maxWidth) {
            currentLine = candidate;
        } else {
            lines.push(currentLine);
            currentLine = words[i];
        }
    }
    lines.push(currentLine);
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
 * Render a footer at the bottom of the page.
 */
function _renderFooter(
    pageNum: number,
    totalPages: number,
    footerText: string,
    enc: EncodingContext,
    mgL: number,
    mgR: number,
    mgB: number,
    pgW: number,
    tagCtx: TagContext | undefined,
    documentChildren: (StructElement | MCRef)[],
): string[] {
    const ops: string[] = [];
    const fs = DEFAULT_FONT_SIZES;
    const color = '0.612 0.639 0.682';
    const y = mgB - 5;

    ops.push(`${color} rg`);
    if (tagCtx?.tagged) {
        const mcid1 = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        const mcid2 = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
        ops.push(txtTagged(footerText, mgL, y, enc.f1, fs.ft, enc, mcid1));
        ops.push(txtRTagged(`${pageNum}/${totalPages}`, pgW - mgR, y, enc.f1, fs.ft, enc, mcid2));
        documentChildren.push({ type: 'P', children: [{ mcid: mcid1, pageObjNum: tagCtx.pageObjNum }] });
        documentChildren.push({ type: 'P', children: [{ mcid: mcid2, pageObjNum: tagCtx.pageObjNum }] });
    } else {
        ops.push(txt(footerText, mgL, y, enc.f1, fs.ft, enc));
        ops.push(txtR(`${pageNum}/${totalPages}`, pgW - mgR, y, enc.f1, fs.ft, enc));
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

// ── Block Height Estimation ──────────────────────────────────────────

/**
 * Estimate the height of a block for pagination purposes.
 * This is a pre-rendering pass to decide if a block fits on the current page.
 */
function _estimateBlockHeight(
    block: DocumentBlock,
    enc: EncodingContext,
    cw: number,
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

    const mcidAlloc = tagged ? createMCIDAllocator() : undefined;
    const documentChildren: (StructElement | MCRef)[] = [];

    // ── Pagination: build pages from blocks ──────────────────────────
    const footerText = params.footerText ?? '';
    const availableH = pgH - mg.t - mg.b - FT_H;

    // First pass: assign blocks to pages
    const pageBlocks: DocumentBlock[][] = [[]];
    let remainH = availableH;

    for (const block of params.blocks) {
        if (block.type === 'pageBreak') {
            pageBlocks.push([]);
            remainH = availableH;
            continue;
        }

        const blockH = _estimateBlockHeight(block, enc, cw);
        if (blockH > remainH && pageBlocks[pageBlocks.length - 1].length > 0) {
            pageBlocks.push([]);
            remainH = availableH;
        }
        pageBlocks[pageBlocks.length - 1].push(block);
        remainH -= blockH;
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

    // ── Collect link annotations ─────────────────────────────────────
    const pageAnnotations: PageAnnotation[] = [];

    // ── Pre-compute page object start ────────────────────────────────
    const fontObjEnd = (enc.isUnicode && fontEntries.length > 0)
        ? 5 + fontEntries.length * 5
        : 5;
    const imageObjStart = fontObjEnd;
    const prePageObjStart = fontObjEnd + imageCount;

    // ── Render page content streams ──────────────────────────────────
    const pageStreams: string[] = [];

    for (let p = 0; p < totalPages; p++) {
        const pageObjNum = prePageObjStart + p * 2;
        const tagCtx: TagContext | undefined = tagged && mcidAlloc
            ? { tagged: true, mcidAlloc, pageObjNum, structChildren: [] }
            : undefined;

        const ops: string[] = [];
        let y = pgH - mg.t;

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
                // pageBreak handled during pagination
            }
        }

        // Footer
        const ftOps = _renderFooter(p + 1, totalPages, footerText, enc, mg.l, mg.r, mg.b, pgW, tagCtx, documentChildren);
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
    const parts: string[] = [];
    let offset = 0;

    function emit(str: string): void {
        parts.push(str);
        offset += str.length;
    }

    const objOffsets: number[] = [];
    function emitObj(num: number, content: string): void {
        objOffsets[num] = offset;
        emit(`${num} 0 obj\n${content}\nendobj\n\n`);
    }

    /**
     * Emit a stream object with optional compression and encryption.
     * Order: compress → encrypt (ISO 32000-1 §7.3.8).
     */
    function emitStreamObj(num: number, dictEntries: string, streamData: string, skipCompress?: boolean): void {
        let data = streamData;
        let dict = dictEntries;

        // Step 1: Compress (before encryption)
        if (compress && !skipCompress) {
            const compressed = compressStream(data);
            dict = dict.replace(/\/Length \d+/, `/Filter /FlateDecode /Length ${compressed.length}`);
            data = compressed;
        }

        // Step 2: Encrypt (after compression)
        if (encState) {
            const encrypted = encryptStream(data, encState, num, 0);
            emitObj(num, `${dict.replace(/\/Length \d+/, `/Length ${encrypted.length}`)} >>\nstream\n${encrypted}\nendstream`);
        } else {
            emitObj(num, `${dict} >>\nstream\n${data}\nendstream`);
        }
    }

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
        imgXObjRes = ` /XObject << ${imgRefs.join(' ')} >>`;
    }

    if (enc.isUnicode && fontEntries.length > 0) {
        pageObjStart = 5 + fontEntries.length * 5 + imageCount;

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
            const bfName = '/' + fd.fontName.replace(/[^A-Za-z0-9-]/g, '');
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
                `/Resources << /Font << ${fontRes} >>${imgXObjRes} >>${structParents}${annotsStr} >>`
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
                const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                emitObj(objNum,
                    `<< /Type /Annot /Subtype /Link ` +
                    `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                    `/Border [0 0 0] ` +
                    `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                );
                annotIdx++;
            }
        }
    } else {
        // Latin mode
        pageObjStart = 5 + imageCount;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${5 + imageCount + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);
        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        // Image XObject objects (Latin mode)
        for (let i = 0; i < imageCount; i++) {
            const img = resolvedImages[i];
            emitObj(imageObjStart + i, buildImageXObject(img.parsed));
        }

        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = 5 + imageCount + p * 2;
            const streamObjNum = 6 + imageCount + p * 2;
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
                `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imgXObjRes} >>${structParents}${annotsStr} >>`
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
                const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                emitObj(objNum,
                    `<< /Type /Annot /Subtype /Link ` +
                    `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                    `/Border [0 0 0] ` +
                    `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                );
                annotIdx++;
            }
        }
    }

    // /Info dictionary
    const baseObjCount = enc.isUnicode
        ? 4 + fontEntries.length * 5 + imageCount + totalPages * 2 + totalAnnots
        : 4 + imageCount + totalPages * 2 + totalAnnots;
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
    }

    // ── Rewrite Catalog ──────────────────────────────────────────────
    if (tagged) {
        const catalogContent =
            `<< /Type /Catalog /Pages 2 0 R ` +
            `/MarkInfo << /Marked true >> ` +
            `/StructTreeRoot ${structTreeRootObjNum} 0 R ` +
            `/Metadata ${xmpObjNum} 0 R ` +
            `/OutputIntents [${outputIntentObjNum} 0 R] >>`;

        const oldCatalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n';
        const newCatalog = `1 0 obj\n${catalogContent}\nendobj\n\n`;
        const idx = parts.indexOf(oldCatalog);
        if (idx !== -1) {
            const sizeDiff = newCatalog.length - oldCatalog.length;
            parts[idx] = newCatalog;
            offset += sizeDiff;
            for (let i = 2; i <= totalObjs; i++) {
                if (objOffsets[i] !== undefined) {
                    objOffsets[i] += sizeDiff;
                }
            }
        }
    }

    // ── Encryption dict object ─────────────────────────────────────────
    let encryptObjNum = 0;
    if (encState) {
        encryptObjNum = totalObjs + 1;
        emitObj(encryptObjNum, buildEncryptDict(encState));
        totalObjs = encryptObjNum;
    }

    // ── Cross-reference table ────────────────────────────────────────
    const xrefOffset = offset;
    emit('xref\n');
    emit(`0 ${totalObjs + 1}\n`);
    emit('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjs; i++) {
        emit(`${String(objOffsets[i]).padStart(10, '0')} 00000 n \n`);
    }

    // Trailer
    emit('trailer\n');
    if (encState) {
        emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R /Encrypt ${encryptObjNum} 0 R /ID ${buildIdArray(encState.docId)} >>\n`);
    } else {
        emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R >>\n`);
    }
    emit('startxref\n');
    emit(`${xrefOffset}\n`);
    emit('%%EOF');

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
