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
    PdfLayoutOptions,
    PageTemplate,
} from '../types/pdf-types.js';
import type {
    DocumentParams,
    DocumentBlock,
    ImageBlock,
    TableBlock,
    OutlineItem,
} from '../types/pdf-document-types.js';
import { buildImageXObject } from './pdf-image.js';
import { createEncodingContext } from './encoding-context.js';
import { buildToUnicodeCMap, buildSubsetWidthArray } from '../fonts/font-embedder.js';
import { buildWinAnsiToUnicodeCMap } from '../fonts/encoding.js';
import { getDecodedFontBytes } from '../fonts/font-loader.js';
import { subsetTTF, uint8ToBinaryString } from '../fonts/font-subsetter.js';
import { txt, txtTagged, fmtNum, encodePdfTextString } from './pdf-text.js';
import { toBytes } from './pdf-stream.js';
import { buildOutlineObjects, type OutlineRenderItem } from './pdf-outline.js';
import { buildPageLabelsDict } from './pdf-page-labels.js';
import { buildViewerPreferences } from './pdf-viewer-prefs.js';
import { parseColor } from './pdf-color.js';
import {
    PG_W, PG_H, DEFAULT_MARGINS,
    FT_H, HEADER_H,
    DEFAULT_FONT_SIZES, DEFAULT_MAX_BLOCKS,
} from './pdf-layout.js';
import type { StructElement, MCRef } from './pdf-tags.js';
import {
    createMCIDAllocator,
    buildStructureTree,
    buildXMPMetadata,
    buildOutputIntentDict,
    buildMinimalSRGBProfile,
    buildPdfMetadata,
    resolvePdfAConfig,
    buildEmbeddedFiles,
    validateAttachments,
    utf8EncodeBinaryString,
} from './pdf-tags.js';
import type { EncryptionState } from './pdf-encrypt.js';
import { initEncryption } from './pdf-encrypt.js';
import { createPdfWriter, writeXrefTrailer } from './pdf-assembler.js';
import type { WatermarkState } from './pdf-watermark.js';
import { validateWatermark, buildWatermarkState } from './pdf-watermark.js';
import { buildFormWidget, buildAcroFormDict, buildAppearanceStreamDict, buildRadioGroupParent } from './pdf-form.js';
import {
    estimateBlockHeight,
    renderHeading,
    renderParagraph,
    renderList,
    renderTable,
    planTable,
    renderPageTemplate,
    resolveImage,
    renderImage,
    renderLink,
    renderToc,
    renderBarcodeBlock,
    renderSvgBlock,
    renderFormFieldBlock,
} from './pdf-renderers.js';
import type {
    TagContext,
    HeadingDestination,
    PageAnnotation,
    PageFormField,
    ResolvedImage,
    TableSlice,
} from './pdf-renderers.js';

// Re-export wrapText as public API
export { wrapText } from './pdf-renderers.js';

// ── Internal Pagination Types ────────────────────────────────────────

/**
 * Synthetic block produced by `_paginateBlocks()` when a table is sliced
 * across multiple pages. Carries the original `TableBlock` plus the
 * pre-computed slice that the renderer consumes. Internal only — never
 * appears in the public `DocumentBlock` union.
 */
interface TableSliceItem {
    readonly type: '__tableSlice';
    readonly block: TableBlock;
    readonly slice: TableSlice;
}

/** Any item the paginator can place on a page. */
type PaginatedItem = DocumentBlock | TableSliceItem;

// ── Main Builder ─────────────────────────────────────────────────────

/**
 * Build a free-form PDF document from content blocks.
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization (page size, margins, tagged mode)
 * @returns Complete PDF as a binary string
 */
export function buildDocumentPDF(params: DocumentParams, layoutOptions?: Partial<PdfLayoutOptions>): string {
    return assembleDocumentParts(params, layoutOptions).join('');
}

/**
 * Assemble a free-form PDF document and return its raw object/framing parts
 * (header, indirect objects, xref, trailer) in emission order — WITHOUT
 * joining them into a single string.
 *
 * {@link buildDocumentPDF} simply joins the result. The true-streaming
 * generators (`buildDocumentPDFStreamTrue`) iterate the parts and yield them
 * progressively, freeing each as they go, so the fully-joined PDF binary never
 * materialises in memory. The byte content is identical to `buildDocumentPDF`.
 *
 * @internal
 */
export function assembleDocumentParts(params: DocumentParams, layoutOptions?: Partial<PdfLayoutOptions>): string[] {
    // ── Input Validation ─────────────────────────────────────────────
    if (!params || typeof params !== 'object') {
        throw new Error('buildDocumentPDF: params is required and must be an object');
    }
    if (!Array.isArray(params.blocks)) {
        throw new Error('buildDocumentPDF: params.blocks must be an array');
    }
    const layout = layoutOptions ?? params.layout;
    const maxBlocks = layout?.maxBlocks ?? DEFAULT_MAX_BLOCKS;
    if (params.blocks.length > maxBlocks) {
        throw new Error(`buildDocumentPDF: block count (${params.blocks.length}) exceeds safe limit (${maxBlocks}). Raise it via layout.maxBlocks if this is intentional.`);
    }

    // ── Resolve layout ───────────────────────────────────────────────
    const pgW = layout?.pageWidth ?? PG_W;
    const pgH = layout?.pageHeight ?? PG_H;
    const mg = layout?.margins ?? { ...DEFAULT_MARGINS };
    const cw = pgW - mg.l - mg.r;

    // ── Font setup ───────────────────────────────────────────────────
    const fontEntries: FontEntry[] = params.fontEntries
        ? [...params.fontEntries]
        : [];

    // ── Tagged mode setup ────────────────────────────────────────────
    const pdfaConfig = resolvePdfAConfig(layout?.tagged);
    const tagged = pdfaConfig.enabled;

    const enc = createEncodingContext(fontEntries, tagged, layout?.normalize ?? false);

    // ── Encryption setup ──────────────────────
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
     *
     * Tables that don't fit on a single page are sliced row-by-row into
     * {@link PaginatedItem}s of type `'__tableSlice'`; the renderer emits each
     * slice with optional repeated header and a shared `/Table` struct-tree
     * accumulator threaded through every slice.
     */
    function _paginateBlocks(
        headingsIn?: readonly HeadingDestination[],
    ): { pages: PaginatedItem[][]; headings: HeadingDestination[] } {
        const pages: PaginatedItem[][] = [[]];
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

            // Tables get sliced row-by-row across pages with optional header
            // repetition and one shared `/Table` struct accumulator per table.
            if (block.type === 'table') {
                const plan = planTable(block, enc, mg.l, cw);
                const repeatHeader = block.repeatHeader !== false; // default true
                const sharedAccum: (StructElement | MCRef)[] = [];
                const totalRows = block.rows.length;
                let rowIdx = 0;
                let isFirstSlice = true;

                // Empty-rows table: still emit caption + header + trailer on one slice.
                if (totalRows === 0) {
                    const totalH = plan.captionHeight + plan.headerHeight + plan.trailerSpacing;
                    if (totalH > remainH && pages[pages.length - 1].length > 0) {
                        pages.push([]);
                        remainH = availableH;
                        curY = pgH - mg.t - headerH;
                    }
                    pages[pages.length - 1].push({
                        type: '__tableSlice',
                        block,
                        slice: {
                            plan,
                            fromRow: 0,
                            toRow: 0,
                            drawCaption: true,
                            drawHeader: true,
                            isFinalSlice: true,
                            tableStructAccum: sharedAccum,
                        },
                    });
                    remainH -= totalH;
                    curY -= totalH;
                    continue;
                }

                while (rowIdx < totalRows) {
                    const drawCaption = isFirstSlice;
                    const drawHeader = isFirstSlice || repeatHeader;
                    const tCapH = drawCaption ? plan.captionHeight : 0;
                    const tHdrH = drawHeader ? plan.headerHeight : 0;
                    const availableForRows = remainH - tCapH - tHdrH - plan.trailerSpacing;

                    let usedH = 0;
                    let count = 0;
                    while (
                        rowIdx + count < totalRows
                        && usedH + plan.rowHeights[rowIdx + count] <= availableForRows
                    ) {
                        usedH += plan.rowHeights[rowIdx + count];
                        count++;
                    }

                    // No rows fit AND page has prior content → move to a new page.
                    if (count === 0 && pages[pages.length - 1].length > 0) {
                        pages.push([]);
                        remainH = availableH;
                        curY = pgH - mg.t - headerH;
                        continue;
                    }
                    // No rows fit even on a fresh page (single row taller than
                    // the page): force one row through; clipCells clips overflow.
                    if (count === 0) count = 1;

                    const fromRow = rowIdx;
                    const toRow = rowIdx + count;
                    rowIdx = toRow;
                    const isFinalSlice = rowIdx >= totalRows;

                    pages[pages.length - 1].push({
                        type: '__tableSlice',
                        block,
                        slice: {
                            plan,
                            fromRow,
                            toRow,
                            drawCaption,
                            drawHeader,
                            isFinalSlice,
                            tableStructAccum: sharedAccum,
                        },
                    });

                    const sliceH = tCapH + tHdrH + usedH + (isFinalSlice ? plan.trailerSpacing : 0);
                    remainH -= sliceH;
                    curY -= sliceH;
                    isFirstSlice = false;

                    if (!isFinalSlice) {
                        pages.push([]);
                        remainH = availableH;
                        curY = pgH - mg.t - headerH;
                    }
                }
                continue;
            }

            const blockH = estimateBlockHeight(block, enc, cw, headingsIn);
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
    let pageBlocks: PaginatedItem[][];

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
                resolvedImages.push(resolveImage(block, cw));
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

    // ── Collect form fields ──────────────────────────────────────────
    const pageFormFields: PageFormField[] = [];

    // ── Pre-compute page object start ────────────────────────────────
    const fontObjEnd = (enc.isUnicode && fontEntries.length > 0)
        ? 5 + fontEntries.length * 5
        : 5;
    const imageObjStart = fontObjEnd;
    const prePageObjStart = fontObjEnd + imageCount + wmExtraObjs;

    // ── Render page content streams ──────────────────────────────────
    const pageStreams: string[] = [];
    let headingDestIdx = 0;

    // Map page object numbers to /StructParents values for ParentTree (ISO 32000-1 §14.7.4.4)
    const pageObjToStructParents = new Map<number, number>();

    for (let p = 0; p < totalPages; p++) {
        const pageObjNum = prePageObjStart + p * 2;
        if (tagged) pageObjToStructParents.set(pageObjNum, p);
        const tagCtx: TagContext | undefined = tagged && mcidAlloc
            ? { tagged: true, mcidAlloc, pageObjNum, structChildren: [] }
            : undefined;

        const ops: string[] = [];
        let y = pgH - mg.t;

        // Render header template (if provided)
        if (headerTpl) {
            const hOps = renderPageTemplate(
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
                    const result = renderHeading(block, y, enc, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'paragraph': {
                    const result = renderParagraph(block, y, enc, mg.l, cw, pgW, mg.r, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'list': {
                    const result = renderList(block, y, enc, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'table': {
                    // Raw table reaches the render loop only if a caller bypasses
                    // `_paginateBlocks()`. Render the whole table in one slice;
                    // this matches the pre-v1.2 single-call behaviour.
                    const result = renderTable(block, y, enc, mg.l, mg.r, pgW, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case '__tableSlice': {
                    const result = renderTable(
                        block.block, y, enc, mg.l, mg.r, pgW, cw, tagCtx, documentChildren, block.slice,
                    );
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
                        const result = renderImage(resolvedImages[imgIdx], imgName, y, mg.l, cw, tagCtx, documentChildren);
                        ops.push(...result.ops);
                        y = result.y;
                    }
                    break;
                }
                case 'link': {
                    const result = renderLink(block, y, enc, mg.l, cw, p, pageAnnotations, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'toc': {
                    const result = renderToc(block, headingDests, y, enc, mg.l, cw, p, pageAnnotations, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'barcode': {
                    const result = renderBarcodeBlock(block, y, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'svg': {
                    const result = renderSvgBlock(block, y, mg.l, cw, tagCtx, documentChildren);
                    ops.push(...result.ops);
                    y = result.y;
                    break;
                }
                case 'formField': {
                    const result = renderFormFieldBlock(block, y, enc, mg.l, cw, p, pageFormFields, tagCtx, documentChildren);
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
        const ftOps = renderPageTemplate(
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

    // ── Group form fields by page ────────────────────────────────────
    const formFieldsByPage = new Map<number, PageFormField[]>();
    for (const pf of pageFormFields) {
        const list = formFieldsByPage.get(pf.page) ?? [];
        list.push(pf);
        formFieldsByPage.set(pf.page, list);
    }
    const totalFormFields = pageFormFields.length;
    // Each form field: button types (checkbox/radio) = 3 objects (widget + Yes AP + Off AP)
    // Other types = 2 objects (widget + AP XObject)
    // Plus 1 dedicated Helvetica font object for form field rendering
    // Plus 1 parent object per radio group
    let totalFieldObjs = 0;
    const formFieldObjOffsets: number[] = []; // cumulative offset of each field within form block
    for (let fi = 0; fi < totalFormFields; fi++) {
        formFieldObjOffsets.push(totalFieldObjs);
        const ft = pageFormFields[fi].field.fieldType;
        totalFieldObjs += (ft === 'checkbox' || ft === 'radio') ? 3 : 2;
    }

    // Detect radio groups: radio fields sharing the same name form a group (ISO 32000-1 §12.7.4.2.4)
    const radioGroups = new Map<string, number[]>(); // group name → field indices
    for (let fi = 0; fi < totalFormFields; fi++) {
        const f = pageFormFields[fi].field;
        if (f.fieldType === 'radio') {
            const list = radioGroups.get(f.name);
            if (list) list.push(fi);
            else radioGroups.set(f.name, [fi]);
        }
    }
    const numRadioGroups = radioGroups.size;
    // Radio group parents sit after all field objects, before the font object
    const totalFormObjs = totalFieldObjs + numRadioGroups;
    const formFontObjs = totalFormFields > 0 ? 1 : 0; // dedicated /Helv font object for forms

    // Base-14 /ToUnicode CMap (issue #48): non-tagged Helvetica/Helvetica-Bold
    // carry no ToUnicode by default, so the CP1252 0x80–0x9F band (Euro, curly
    // quotes, …) is not selectable/searchable and renders as `?` in minimal
    // viewers. Emit one shared CMap as the trailing object (forward reference
    // from the font dicts). Tagged mode embeds CIDFonts with their own ToUnicode.
    const preBaseObjCount = (enc.isUnicode && fontEntries.length > 0)
        ? 4 + fontEntries.length * 5 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots + totalFormObjs + formFontObjs
        : 4 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots + totalFormObjs + formFontObjs;
    const latinToUniObjNum = tagged ? 0 : preBaseObjCount + 2; // infoObjNum + 1
    const baseFontToUniRef = latinToUniObjNum ? ` /ToUnicode ${latinToUniObjNum} 0 R` : '';

    // Colour-emoji Form XObjects (v1.3.0) — collected during the page-stream
    // build above (via the encoding context's colour-emoji collector). They are
    // emitted as trailing objects and forward-referenced from every page's
    // /XObject dict. Empty (and zero-cost) unless an 'emoji-color' font is used.
    const colorEmojiForms = enc.colorEmoji?.forms ?? [];
    const colorEmojiStart = colorEmojiForms.length > 0
        ? (latinToUniObjNum || (preBaseObjCount + 1)) + 1
        : 0;
    let colorEmojiXObjRefs = '';
    for (let k = 0; k < colorEmojiForms.length; k++) {
        colorEmojiXObjRefs += ` /${colorEmojiForms[k].name} ${colorEmojiStart + k} 0 R`;
    }

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
    if (imgXObjRes || wmImgRef || colorEmojiXObjRefs) {
        if (!imgXObjRes) imgXObjRes = ' /XObject <<';
        if (wmImgRef) imgXObjRes += ` ${wmImgRef}`;
        imgXObjRes += colorEmojiXObjRefs;
        imgXObjRes += ' >>';
    }

    if (enc.isUnicode && fontEntries.length > 0) {
        pageObjStart = 5 + fontEntries.length * 5 + imageCount + wmExtraObjs;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${pageObjStart + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);

        if (tagged) {
            // PDF/A: /F1 and /F2 alias to primary's Type0 (embedded). Bold = regular.
            const pf = fontEntries[0];
            const bfName = `/${pf.fontData.fontName.replace(/[^A-Za-z0-9-]/g, '')}`;
            const primaryBase = 5;
            const refDict = `<< /Type /Font /Subtype /Type0 /BaseFont ${bfName} ` +
                `/Encoding /Identity-H /DescendantFonts [${primaryBase + 1} 0 R] /ToUnicode ${primaryBase + 4} 0 R >>`;
            emitObj(3, refDict);
            emitObj(4, refDict);
        } else {
            emitObj(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding${baseFontToUniRef} >>`);
            emitObj(4, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding${baseFontToUniRef} >>`);
        }

        // CIDFont Type2 objects — 5 per fontEntry
        for (let fi = 0; fi < fontEntries.length; fi++) {
            const fe = fontEntries[fi];
            const fd = fe.fontData;
            const base = 5 + fi * 5;

            const fontBytes = getDecodedFontBytes(fd);
            const usedGids = enc.getUsedGids ? enc.getUsedGids().get(fe.fontRef) : null;
            const ttfBinary = usedGids && usedGids.size > 0
                ? subsetTTF(fontBytes, usedGids)
                : uint8ToBinaryString(fontBytes);

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

            // Build /Annots reference if this page has link annotations or form widgets
            const pageAnnots = annotsByPage.get(p);
            const pageFields = formFieldsByPage.get(p);
            let annotsStr = '';
            const annotRefs: string[] = [];

            if (pageAnnots && pageAnnots.length > 0) {
                const annotObjStart = pageObjStart + totalPages * 2;
                let annotIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    annotIdx += (annotsByPage.get(pp)?.length ?? 0);
                }
                for (let i = 0; i < pageAnnots.length; i++) {
                    annotRefs.push(`${annotObjStart + annotIdx + i} 0 R`);
                }
            }

            if (pageFields && pageFields.length > 0) {
                // Form widget objects start after all link annotations
                const formObjStart = pageObjStart + totalPages * 2 + totalAnnots;
                let fieldIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    fieldIdx += (formFieldsByPage.get(pp)?.length ?? 0);
                }
                for (let i = 0; i < pageFields.length; i++) {
                    annotRefs.push(`${formObjStart + formFieldObjOffsets[fieldIdx + i]} 0 R`);
                }
            }

            if (annotRefs.length > 0) {
                annotsStr = ` /Annots [${annotRefs.join(' ')}]`;
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
                        `/F 4 ` +
                        `/Dest /${destName} >>`
                    );
                } else {
                    const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/F 4 ` +
                        `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                    );
                }
                annotIdx++;
            }
        }

        // Emit form field widget + appearance objects (after link annotations)
        if (totalFormFields > 0) {
            const formObjStart = pageObjStart + totalPages * 2 + totalAnnots;
            const radioGroupParentStart = formObjStart + totalFieldObjs;
            const formFontObjNum = formObjStart + totalFormObjs;
            emitObj(formFontObjNum, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

            // Build radio group parent object map: group name → parent obj num + selected value
            const radioGroupObjNums = new Map<string, number>();
            let rgIdx = 0;
            for (const [groupName] of radioGroups) {
                radioGroupObjNums.set(groupName, radioGroupParentStart + rgIdx);
                rgIdx++;
            }

            for (let fi = 0; fi < pageFormFields.length; fi++) {
                const widgetObjNum = formObjStart + formFieldObjOffsets[fi];
                const apObjNum = widgetObjNum + 1;
                const field = pageFormFields[fi].field;
                const isButton = field.fieldType === 'checkbox' || field.fieldType === 'radio';

                // Radio group child: pass parent context
                const isRadioGroup = field.fieldType === 'radio' && radioGroups.has(field.name);
                const radioCtx = isRadioGroup
                    ? { parentObjNum: radioGroupObjNums.get(field.name) ?? 0, exportValue: field.value || 'opt' + fi }
                    : undefined;

                const result = buildFormWidget(field, apObjNum, radioCtx);
                emitObj(widgetObjNum, result.widgetDict);
                const w = field.rect[2] - field.rect[0];
                const h = field.rect[3] - field.rect[1];
                if (isButton) {
                    const yesStream = result.apYesStream ?? '';
                    const offStream = result.apOffStream ?? '';
                    emitStreamObj(apObjNum, buildAppearanceStreamDict(w, h, yesStream.length, formFontObjNum), yesStream);
                    emitStreamObj(apObjNum + 1, buildAppearanceStreamDict(w, h, offStream.length, formFontObjNum), offStream);
                } else {
                    emitStreamObj(apObjNum, buildAppearanceStreamDict(w, h, result.appearanceStream.length, formFontObjNum), result.appearanceStream);
                }
            }

            // Emit radio group parent objects
            for (const [groupName, fieldIndices] of radioGroups) {
                const parentObjNum = radioGroupObjNums.get(groupName) ?? 0;
                const childObjNums = fieldIndices.map(fi => formObjStart + formFieldObjOffsets[fi]);
                const checkedField = fieldIndices.find(fi => pageFormFields[fi].field.checked);
                const selectedValue = checkedField !== undefined
                    ? (pageFormFields[checkedField].field.value || 'opt' + checkedField)
                    : '';
                const first = pageFormFields[fieldIndices[0]].field;
                emitObj(parentObjNum, buildRadioGroupParent(groupName, selectedValue, childObjNums, first.readOnly, first.required));
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
        emitObj(3, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding${baseFontToUniRef} >>`);
        emitObj(4, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding${baseFontToUniRef} >>`);

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

            // Build /Annots reference if this page has link annotations or form widgets
            const pageAnnots = annotsByPage.get(p);
            const pageFields = formFieldsByPage.get(p);
            let annotsStr = '';
            const annotRefs: string[] = [];

            if (pageAnnots && pageAnnots.length > 0) {
                const annotObjStart = pageObjStart + totalPages * 2;
                let annotIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    annotIdx += (annotsByPage.get(pp)?.length ?? 0);
                }
                for (let i = 0; i < pageAnnots.length; i++) {
                    annotRefs.push(`${annotObjStart + annotIdx + i} 0 R`);
                }
            }

            if (pageFields && pageFields.length > 0) {
                const formObjStart = pageObjStart + totalPages * 2 + totalAnnots;
                let fieldIdx = 0;
                for (let pp = 0; pp < p; pp++) {
                    fieldIdx += (formFieldsByPage.get(pp)?.length ?? 0);
                }
                for (let i = 0; i < pageFields.length; i++) {
                    annotRefs.push(`${formObjStart + formFieldObjOffsets[fieldIdx + i]} 0 R`);
                }
            }

            if (annotRefs.length > 0) {
                annotsStr = ` /Annots [${annotRefs.join(' ')}]`;
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
                    // Internal /GoTo annotation (TOC link)
                    const destName = pa.annot.url.slice(1);
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/F 4 ` +
                        `/Dest /${destName} >>`
                    );
                } else {
                    const escapedUrl = pa.annot.url.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    emitObj(objNum,
                        `<< /Type /Annot /Subtype /Link ` +
                        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}] ` +
                        `/Border [0 0 0] ` +
                        `/F 4 ` +
                        `/A << /Type /Action /S /URI /URI (${escapedUrl}) >> >>`
                    );
                }
                annotIdx++;
            }
        }

        // Emit form field widget + appearance objects (Latin mode)
        if (totalFormFields > 0) {
            const formObjStart = pageObjStart + totalPages * 2 + totalAnnots;
            const radioGroupParentStart = formObjStart + totalFieldObjs;
            const formFontObjNum = formObjStart + totalFormObjs;
            emitObj(formFontObjNum, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');

            // Build radio group parent object map
            const radioGroupObjNums = new Map<string, number>();
            let rgIdx = 0;
            for (const [groupName] of radioGroups) {
                radioGroupObjNums.set(groupName, radioGroupParentStart + rgIdx);
                rgIdx++;
            }

            for (let fi = 0; fi < pageFormFields.length; fi++) {
                const widgetObjNum = formObjStart + formFieldObjOffsets[fi];
                const apObjNum = widgetObjNum + 1;
                const field = pageFormFields[fi].field;
                const isButton = field.fieldType === 'checkbox' || field.fieldType === 'radio';

                // Radio group child: pass parent context
                const isRadioGroup = field.fieldType === 'radio' && radioGroups.has(field.name);
                const radioCtx = isRadioGroup
                    ? { parentObjNum: radioGroupObjNums.get(field.name) ?? 0, exportValue: field.value || 'opt' + fi }
                    : undefined;

                const result = buildFormWidget(field, apObjNum, radioCtx);
                emitObj(widgetObjNum, result.widgetDict);
                const w = field.rect[2] - field.rect[0];
                const h = field.rect[3] - field.rect[1];
                if (isButton) {
                    const yesStream = result.apYesStream ?? '';
                    const offStream = result.apOffStream ?? '';
                    emitStreamObj(apObjNum, buildAppearanceStreamDict(w, h, yesStream.length, formFontObjNum), yesStream);
                    emitStreamObj(apObjNum + 1, buildAppearanceStreamDict(w, h, offStream.length, formFontObjNum), offStream);
                } else {
                    emitStreamObj(apObjNum, buildAppearanceStreamDict(w, h, result.appearanceStream.length, formFontObjNum), result.appearanceStream);
                }
            }

            // Emit radio group parent objects
            for (const [groupName, fieldIndices] of radioGroups) {
                const parentObjNum = radioGroupObjNums.get(groupName) ?? 0;
                const childObjNums = fieldIndices.map(fi => formObjStart + formFieldObjOffsets[fi]);
                const checkedField = fieldIndices.find(fi => pageFormFields[fi].field.checked);
                const selectedValue = checkedField !== undefined
                    ? (pageFormFields[checkedField].field.value || 'opt' + checkedField)
                    : '';
                const first = pageFormFields[fieldIndices[0]].field;
                emitObj(parentObjNum, buildRadioGroupParent(groupName, selectedValue, childObjNums, first.readOnly, first.required));
            }
        }
    }

    // /Info dictionary
    const baseObjCount = enc.isUnicode
        ? 4 + fontEntries.length * 5 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots + totalFormObjs + formFontObjs
        : 4 + imageCount + wmExtraObjs + totalPages * 2 + totalAnnots + totalFormObjs + formFontObjs;
    const infoObjNum = baseObjCount + 1;

    const { pdfDate, xmpDate: isoDate } = buildPdfMetadata(layout?.creationDate);
    const infoTitle = params.title ?? '';

    const metaParts: string[] = [`/Title ${encodePdfTextString(infoTitle)}`, '/Producer (pdfnative)', `/CreationDate (${pdfDate})`];
    if (params.metadata?.author) {
        metaParts.push(`/Author ${encodePdfTextString(params.metadata.author)}`);
    }
    if (params.metadata?.subject) {
        metaParts.push(`/Subject ${encodePdfTextString(params.metadata.subject)}`);
    }
    if (params.metadata?.keywords) {
        metaParts.push(`/Keywords ${encodePdfTextString(params.metadata.keywords)}`);
    }
    emitObj(infoObjNum, `<< ${metaParts.join(' ')} >>`);

    let totalObjs = infoObjNum;

    // Base-14 /ToUnicode CMap (issue #48) — trailing object so the forward
    // reference in the Helvetica/Helvetica-Bold dicts resolves.
    if (latinToUniObjNum) {
        const cmap = buildWinAnsiToUnicodeCMap();
        emitStreamObj(latinToUniObjNum, `<< /Length ${cmap.length}`, cmap);
        totalObjs = latinToUniObjNum;
    }

    // Colour-emoji Form XObjects (v1.3.0) — trailing objects forward-referenced
    // from the page /XObject dicts. Each form inlines its /Shading + /ExtGState
    // resources, so one indirect object per unique colour glyph.
    if (colorEmojiForms.length > 0) {
        for (let k = 0; k < colorEmojiForms.length; k++) {
            const f = colorEmojiForms[k];
            const objNum = colorEmojiStart + k;
            const res = f.resources ? ` /Resources << ${f.resources} >>` : '';
            emitStreamObj(
                objNum,
                `<< /Type /XObject /Subtype /Form /BBox [${f.bbox.join(' ')}]${res} /Length ${f.content.length}`,
                f.content,
            );
        }
        totalObjs = colorEmojiStart + colorEmojiForms.length - 1;
    }

    // ── Tagged PDF objects ───────────────────────────────────────────
    let xmpObjNum = 0;
    let outputIntentObjNum = 0;
    let afArrayStr = '';
    let embeddedFilesNamesDict = '';

    if (tagged) {
        const documentEl: StructElement = { type: 'Document', children: documentChildren };
        const treeStart = totalObjs + 1;
        const tree = buildStructureTree(documentEl, treeStart, pageObjToStructParents);

        for (const [objNum, content] of tree.objects) {
            emitObj(objNum, content);
        }
        structTreeRootObjNum = tree.structTreeRootObjNum;
        totalObjs = treeStart + tree.totalObjects - 1;

        xmpObjNum = totalObjs + 1;
        const xmpContent = utf8EncodeBinaryString(buildXMPMetadata(infoTitle, isoDate, pdfaConfig.pdfaPart, pdfaConfig.pdfaConformance, params.metadata?.author, params.metadata?.subject, params.metadata?.keywords));
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

    // ── Page labels (ISO 32000-1 §12.4.2) ───────────────────────────
    // Inline number tree — no indirect objects required.
    let pageLabelsStr = '';
    if (params.pageLabels && params.pageLabels.length > 0) {
        pageLabelsStr = ` /PageLabels ${buildPageLabelsDict(params.pageLabels, totalPages)}`;
    }

    // ── Viewer preferences (ISO 32000-1 §12.2) ─────────────────────
    // Catalog-level /PageLayout + /PageMode and the /ViewerPreferences dict.
    // An explicit pageMode here takes precedence over the outline's default.
    const viewerPrefs = layout?.viewerPreferences
        ? buildViewerPreferences(layout.viewerPreferences)
        : undefined;
    let viewerPrefsStr = viewerPrefs?.dict ?? '';
    if (viewerPrefs?.pageLayout) {
        viewerPrefsStr = ` /PageLayout /${viewerPrefs.pageLayout}${viewerPrefsStr}`;
    }

    // ── Document outline / bookmarks (ISO 32000-1 §12.3.3) ──────────
    // Outline items are indirect objects, appended after every other
    // trailing object so their object numbers never collide.
    let outlineCatalogStr = '';
    if (params.outline) {
        const items: OutlineRenderItem[] =
            params.outline === 'auto'
                ? autoOutlineFromHeadings(headingDests)
                : params.outline.map(mapOutlineItem);
        if (items.length > 0) {
            const outlineStart = totalObjs + 1;
            const built = buildOutlineObjects(
                items,
                outlineStart,
                (pageIndex: number) => pageObjStart + pageIndex * 2,
                pgH - mg.t,
                fmtNum,
                totalPages,
            );
            for (const [objNum, content] of built.objects) {
                emitObj(objNum, content);
            }
            totalObjs = outlineStart + built.totalObjects - 1;
            // The outline opens the bookmark panel by default via
            // /PageMode /UseOutlines — unless viewer preferences set an
            // explicit pageMode, which wins.
            outlineCatalogStr = ` /Outlines ${built.rootObjNum} 0 R`;
            if (!viewerPrefs?.pageMode) {
                outlineCatalogStr += ' /PageMode /UseOutlines';
            }
        }
    }

    // Resolved /PageMode from viewer preferences (after outline, so the
    // explicit value is appended exactly once).
    if (viewerPrefs?.pageMode) {
        viewerPrefsStr = ` /PageMode /${viewerPrefs.pageMode}${viewerPrefsStr}`;
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

    // ── Build AcroForm dictionary ──────────────────────────────────
    let acroFormStr = '';
    if (totalFormFields > 0) {
        const formObjStart = pageObjStart + totalPages * 2 + totalAnnots;
        const radioGroupParentStart = formObjStart + totalFieldObjs;
        const formFontObjNum = formObjStart + totalFormObjs;

        // /Fields: non-radio widgets + radio group parent objects (not individual radio children)
        const radioFieldIndices = new Set<number>();
        for (const indices of radioGroups.values()) {
            for (const fi of indices) radioFieldIndices.add(fi);
        }
        const fieldObjNums: number[] = [];
        for (let fi = 0; fi < pageFormFields.length; fi++) {
            if (!radioFieldIndices.has(fi)) {
                fieldObjNums.push(formObjStart + formFieldObjOffsets[fi]);
            }
        }
        for (let rgIdx = 0; rgIdx < radioGroups.size; rgIdx++) {
            fieldObjNums.push(radioGroupParentStart + rgIdx);
        }
        acroFormStr = ` ${buildAcroFormDict(fieldObjNums, formFontObjNum)}`;
    }

    // ── Rewrite Catalog ──────────────────────────────────────────────
    if (tagged) {
        let catalogContent =
            `<< /Type /Catalog /Pages 2 0 R ` +
            `/MarkInfo << /Marked true >> ` +
            `/StructTreeRoot ${structTreeRootObjNum} 0 R ` +
            `/Metadata ${xmpObjNum} 0 R ` +
            `/OutputIntents [${outputIntentObjNum} 0 R]${destsStr}${acroFormStr}${outlineCatalogStr}${pageLabelsStr}${viewerPrefsStr}`;
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
    } else if (destsStr || acroFormStr || outlineCatalogStr || pageLabelsStr || viewerPrefsStr) {
        // Non-tagged mode with TOC destinations, AcroForm, outline, page labels,
        // or viewer preferences — rewrite catalog
        const catalogContent = `<< /Type /Catalog /Pages 2 0 R${destsStr}${acroFormStr}${outlineCatalogStr}${pageLabelsStr}${viewerPrefsStr} >>`;
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
    writeXrefTrailer(writer, totalObjs, infoObjNum, encState, `${infoTitle}|${pdfDate}`);

    return parts;
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

/** Convert a public {@link OutlineItem} to the builder's normalised form. */
function mapOutlineItem(item: OutlineItem): OutlineRenderItem {
    return {
        title: item.title,
        pageIndex: item.pageIndex,
        y: item.y,
        bold: item.bold,
        italic: item.italic,
        open: item.open,
        color: item.color !== undefined ? parseColor(item.color) : undefined,
        children: item.children ? item.children.map(mapOutlineItem) : undefined,
    };
}

/**
 * Derive a nested outline from heading blocks. Headings are nested by
 * level: an H1 is a top-level item, an H2 becomes a child of the most
 * recent H1, an H3 a child of the most recent H2. Out-of-order levels
 * (e.g. a leading H2/H3) gracefully fall back to the top level.
 */
function autoOutlineFromHeadings(headings: readonly HeadingDestination[]): OutlineRenderItem[] {
    const root: OutlineRenderItem[] = [];
    // Mutable scaffolding (children arrays) mirrored onto readonly result nodes.
    const stack: Array<{ level: number; children: OutlineRenderItem[] }> = [];
    for (const h of headings) {
        const node: OutlineRenderItem & { children: OutlineRenderItem[] } = {
            title: h.text,
            pageIndex: h.pageIndex,
            y: h.y,
            children: [],
        };
        while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
            stack.pop();
        }
        if (stack.length === 0) {
            root.push(node);
        } else {
            stack[stack.length - 1].children.push(node);
        }
        stack.push({ level: h.level, children: node.children });
    }
    return root;
}
