/**
 * pdfnative — PDF Document Builder
 * ===================================
 * Main entry point: builds a complete PDF 1.4 document as a byte string.
 *
 * Supports:
 *   - Latin mode (Helvetica built-in, WinAnsi encoding)
 *   - Unicode mode (CIDFont Type2/Identity-H, embedded TTF subset)
 *   - Multi-font (cross-script fallback with automatic font switching)
 *   - Pagination (auto-calculated page breaks)
 *   - Table rendering with header/data rows
 *   - Title, info section, balance box, footer
 *
 * ISO 32000-1 (PDF 1.4) compliant output.
 */

import type {
    PdfParams,
    FontEntry,
    EncodingContext,
    PdfLayoutOptions,
    ColumnDef,
    PageTemplate,
    PdfColor,
} from '../types/pdf-types.js';
import { createEncodingContext } from './encoding-context.js';
import { truncate } from '../fonts/encoding.js';
import { buildToUnicodeCMap, buildSubsetWidthArray } from '../fonts/font-embedder.js';
import { getDecodedFontBytes } from '../fonts/font-loader.js';
import { subsetTTF, uint8ToBinaryString } from '../fonts/font-subsetter.js';
import { txt, txtR, txtC, txtTagged, txtRTagged, txtCTagged, fmtNum, encodePdfTextString } from './pdf-text.js';
import { toBytes } from './pdf-stream.js';
import {
    PG_W, PG_H, DEFAULT_MARGINS,
    ROW_H, TH_H, INFO_LN, BAL_H, TITLE_LN, FT_H, HEADER_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions,
    resolveTemplate,
} from './pdf-layout.js';
import { normalizeColors, parseColor } from './pdf-color.js';
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

// ── Tagged Mode Helper Types ─────────────────────────────────────────

interface TagContext {
    tagged: boolean;
    mcidAlloc: ReturnType<typeof createMCIDAllocator>;
    pageObjNum: number;
    structChildren: (StructElement | MCRef)[];
}

// ── Table Builder Helpers ────────────────────────────────────────────

function _buildTableHeader(
    y: number,
    headers: readonly string[],
    enc: EncodingContext,
    cx: number[],
    cwi: number[],
    columns: readonly ColumnDef[],
    cw: number,
    mgL: number,
    mgR: number,
    pgW: number,
    colors: typeof DEFAULT_COLORS,
    fs: typeof DEFAULT_FONT_SIZES,
    tagCtx?: TagContext,
): { ops: string[]; y: number; structRow?: StructElement } {
    const ops: string[] = [];
    ops.push(`${colors.thBg} rg`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} ${fmtNum(cw)} ${fmtNum(TH_H)} re f`);
    ops.push(`0.75 w ${colors.thBrd} RG`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - TH_H)} l S`);
    ops.push(`${colors.text} rg`);

    const thChildren: (StructElement | MCRef)[] = [];

    for (let i = 0; i < headers.length; i++) {
        const t = truncate(headers[i], columns[i].mxH ?? columns[i].mx);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            const mcref: MCRef = { mcid, pageObjNum: tagCtx.pageObjNum };
            const thEl: StructElement = { type: 'TH', children: [mcref] };
            thChildren.push(thEl);
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

    const structRow = tagCtx?.tagged ? { type: 'TR', children: thChildren } as StructElement : undefined;
    return { ops, y: y - TH_H, structRow };
}

function _buildDataRow(
    y: number,
    cells: readonly string[],
    type: string,
    pointed: boolean,
    enc: EncodingContext,
    cx: number[],
    cwi: number[],
    columns: readonly ColumnDef[],
    cw: number,
    mgL: number,
    mgR: number,
    pgW: number,
    colors: typeof DEFAULT_COLORS,
    fs: typeof DEFAULT_FONT_SIZES,
    tagCtx?: TagContext,
): { ops: string[]; y: number; structRow?: StructElement } {
    const ops: string[] = [];
    if (pointed) {
        ops.push(`${colors.ptdBg} rg`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - ROW_H)} ${fmtNum(cw)} ${fmtNum(ROW_H)} re f`);
    }
    ops.push(`0.25 w ${colors.rowBrd} RG`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - ROW_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - ROW_H)} l S`);

    const tdChildren: (StructElement | MCRef)[] = [];

    for (let i = 0; i < cells.length; i++) {
        const t = truncate(cells[i], columns[i].mx);
        const isAmount = (i === 3);
        const color = isAmount ? (type === 'credit' ? colors.credit : colors.debit) : colors.text;
        const font = isAmount ? enc.f2 : enc.f1;
        ops.push(`${color} rg`);

        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            const mcref: MCRef = { mcid, pageObjNum: tagCtx.pageObjNum };
            const tdEl: StructElement = { type: 'TD', children: [mcref] };
            tdChildren.push(tdEl);
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

    const structRow = tagCtx?.tagged ? { type: 'TR', children: tdChildren } as StructElement : undefined;
    return { ops, y: y - ROW_H, structRow };
}

function _buildPageTemplate(
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
    defaultColor: PdfColor,
    defaultFontSize: number,
    tagCtx?: TagContext,
): { ops: string[]; structEls: StructElement[] } {
    const ops: string[] = [];
    const structEls: StructElement[] = [];
    const sz = template.fontSize ?? defaultFontSize;
    const color = parseColor(template.color ?? defaultColor);

    ops.push(`${color} rg`);

    if (template.left) {
        const text = resolveTemplate(template.left, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtTagged(text, mgL, y, enc.f1, sz, enc, mcid));
            structEls.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txt(text, mgL, y, enc.f1, sz, enc));
        }
    }

    if (template.center) {
        const text = resolveTemplate(template.center, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtCTagged(text, mgL, y, enc.f1, sz, cw, enc, mcid));
            structEls.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txtC(text, mgL, y, enc.f1, sz, cw, enc));
        }
    }

    if (template.right) {
        const text = resolveTemplate(template.right, page, pages, title, date);
        if (tagCtx?.tagged) {
            const mcid = tagCtx.mcidAlloc.next(tagCtx.pageObjNum);
            ops.push(txtRTagged(text, pgW - mgR, y, enc.f1, sz, enc, mcid));
            structEls.push({ type: 'P', children: [{ mcid, pageObjNum: tagCtx.pageObjNum }] });
        } else {
            ops.push(txtR(text, pgW - mgR, y, enc.f1, sz, enc));
        }
    }

    return { ops, structEls };
}

// ── Main Builder ─────────────────────────────────────────────────────

/**
 * Build a complete PDF document as a single-byte string.
 *
 * @param params - Document content (title, info items, rows, etc.)
 * @param layoutOptions - Optional layout customization
 * @returns Complete PDF as a binary string
 */
export function buildPDF(params: PdfParams, layoutOptions?: Partial<PdfLayoutOptions>): string {
    // ── Input Validation (system boundary) ───────────────────────────
    if (!params || typeof params !== 'object') {
        throw new Error('buildPDF: params is required and must be an object');
    }
    if (!Array.isArray(params.rows)) {
        throw new Error('buildPDF: params.rows must be an array');
    }
    if (!Array.isArray(params.headers)) {
        throw new Error('buildPDF: params.headers must be an array');
    }
    if (params.rows.length > 100_000) {
        throw new Error(`buildPDF: row count (${params.rows.length}) exceeds safe limit (100,000)`);
    }

    const { title, infoItems, balanceText, countText, headers, rows, footerText, fontData } = params;

    // Resolve layout
    const pgW = layoutOptions?.pageWidth ?? PG_W;
    const pgH = layoutOptions?.pageHeight ?? PG_H;
    const mg = layoutOptions?.margins ?? DEFAULT_MARGINS;
    const cw = pgW - mg.l - mg.r;
    const columns = layoutOptions?.columns ?? DEFAULT_COLUMNS;
    const rawColors = layoutOptions?.colors ?? DEFAULT_COLORS;
    const colors = layoutOptions?.colors ? normalizeColors(rawColors) : rawColors;
    const fs = layoutOptions?.fontSizes
        ? { ...DEFAULT_FONT_SIZES, ...layoutOptions.fontSizes }
        : DEFAULT_FONT_SIZES;
    const { cx, cwi } = computeColumnPositions(columns, mg.l, cw);

    // Build fontEntries
    const fontEntries: FontEntry[] = params.fontEntries
        || (fontData ? [{ fontData, fontRef: '/F3', lang: 'unknown' }] : []);

    // Resolve PDF/A config early (required by encoding context)
    const pdfaConfig = resolvePdfAConfig(layoutOptions?.tagged);
    const tagged = pdfaConfig.enabled;

    const enc = createEncodingContext(fontEntries, tagged);

    // ── Resolve header/footer templates ──────────────────────────────
    const footerTpl: PageTemplate = layoutOptions?.footerTemplate ?? {
        left: footerText || undefined,
        right: '{page}/{pages}',
    };
    const headerTpl: PageTemplate | undefined = layoutOptions?.headerTemplate;
    const headerH = headerTpl ? HEADER_H : 0;

    const dateNow = new Date();
    const pad2d = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${dateNow.getFullYear()}-${pad2d(dateNow.getMonth() + 1)}-${pad2d(dateNow.getDate())}`;

    // ── Pagination ───────────────────────────────────────────────────
    const infoCount = infoItems.length;
    const page1Header = TITLE_LN + 16 + (infoCount * INFO_LN) + 8 + BAL_H + 10;
    const rowsPage1 = Math.max(0, Math.floor((pgH - mg.t - mg.b - page1Header - TH_H - FT_H - headerH) / ROW_H));
    const rowsPerPage = Math.max(1, Math.floor((pgH - mg.t - mg.b - TH_H - FT_H - headerH) / ROW_H));
    const totalRows = rows.length;

    let totalPages: number;
    if (totalRows <= rowsPage1) {
        totalPages = 1;
    } else {
        totalPages = 1 + Math.ceil((totalRows - rowsPage1) / rowsPerPage);
    }
    if (totalPages < 1) totalPages = 1;

    // ── Tagged mode setup ─────────────────────────────────────────────
    // (pdfaConfig and tagged already resolved above for encoding context)

    // ── Encryption setup ──────────────────────────────────────────────
    const encryptionOpts = layoutOptions?.encryption;
    if (tagged && encryptionOpts) {
        throw new Error('PDF/A and encryption are mutually exclusive (ISO 19005-1 §6.3.2)');
    }
    const encState: EncryptionState | null = encryptionOpts ? initEncryption(encryptionOpts) : null;

    // ── Compression setup ─────────────────────────────────────────────
    const compress = layoutOptions?.compress === true;

    // ── Watermark setup ──────────────────────────────────────────────
    const watermarkOpts = layoutOptions?.watermark;
    if (watermarkOpts) {
        validateWatermark(watermarkOpts, layoutOptions?.tagged);
    }

    // ── Attachments setup (PDF/A-3 only) ─────────────────────────────
    const attachments = layoutOptions?.attachments;
    validateAttachments(attachments, layoutOptions?.tagged);

    const wmState: WatermarkState | null = watermarkOpts
        ? buildWatermarkState(watermarkOpts, pgW, pgH, enc)
        : null;
    const wmExtraObjs = wmState
        ? wmState.extGStates.size + (wmState.imageXObj ? 1 : 0)
        : 0;

    const mcidAlloc = tagged ? createMCIDAllocator() : undefined;

    // Structure elements collected during page building (only when tagged)
    // The document structure: /Document → [/P (title), /P (info)..., /P (balance), /Table, /P (footer)...]
    const documentChildren: (StructElement | MCRef)[] = [];
    const tableRows: StructElement[] = [];

    // ── Build page content streams ───────────────────────────────────
    const pageStreams: string[] = [];
    let rowIdx = 0;

    // We need page obj nums for MCRef, but they depend on font count which we already know.
    // Compute pageObjStart the same way the assembly section does.
    const prePageObjStart = (enc.isUnicode && fontEntries.length > 0)
        ? 5 + fontEntries.length * 5 + wmExtraObjs
        : 5 + wmExtraObjs;

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
            const ht = _buildPageTemplate(
                headerTpl, p + 1, totalPages, title, dateStr,
                y - (headerTpl.fontSize ?? fs.ft),
                enc, mg.l, mg.r, pgW, cw, colors.footer, fs.ft, tagCtx,
            );
            ops.push(...ht.ops);
            if (tagged) documentChildren.push(...ht.structEls);
            y -= HEADER_H;
        }

        // Background watermark (behind content)
        if (wmState?.backgroundOps) {
            ops.push(wmState.backgroundOps);
        }

        if (p === 0) {
            // Title
            ops.push(`${colors.title} rg`);
            if (tagCtx) {
                const mcid = tagCtx.mcidAlloc.next(pageObjNum);
                ops.push(txtTagged(title, mg.l, y - fs.title, enc.f2, fs.title, enc, mcid));
                documentChildren.push({ type: 'P', children: [{ mcid, pageObjNum }] });
            } else {
                ops.push(txt(title, mg.l, y - fs.title, enc.f2, fs.title, enc));
            }
            y -= TITLE_LN;

            // Title underline
            ops.push(`0.75 w ${colors.title} RG`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y)} m ${fmtNum(pgW - mg.r)} ${fmtNum(y)} l S`);
            y -= 14;

            // Info section
            for (const item of infoItems) {
                ops.push(`${colors.label} rg`);
                if (tagCtx) {
                    const mcidLabel = tagCtx.mcidAlloc.next(pageObjNum);
                    const mcidValue = tagCtx.mcidAlloc.next(pageObjNum);
                    ops.push(txtTagged(`${item.label} :`, mg.l, y, enc.f2, fs.info, enc, mcidLabel));
                    ops.push(`${colors.text} rg`);
                    ops.push(txtTagged(item.value, mg.l + 100, y, enc.f1, fs.info, enc, mcidValue));
                    documentChildren.push({
                        type: 'P',
                        children: [
                            { mcid: mcidLabel, pageObjNum },
                            { mcid: mcidValue, pageObjNum },
                        ],
                    });
                } else {
                    ops.push(txt(`${item.label} :`, mg.l, y, enc.f2, fs.info, enc));
                    ops.push(`${colors.text} rg`);
                    ops.push(txt(item.value, mg.l + 100, y, enc.f1, fs.info, enc));
                }
                y -= INFO_LN;
            }
            y -= 6;

            // Balance box
            ops.push(`${colors.balBg} rg`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y - BAL_H)} ${fmtNum(cw)} ${fmtNum(BAL_H)} re f`);
            ops.push(`0.5 w ${colors.balBrd} RG`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y - BAL_H)} ${fmtNum(cw)} ${fmtNum(BAL_H)} re S`);
            ops.push(`${colors.title} rg`);
            if (tagCtx) {
                const mcidBal = tagCtx.mcidAlloc.next(pageObjNum);
                const mcidCnt = tagCtx.mcidAlloc.next(pageObjNum);
                ops.push(txtTagged(balanceText, mg.l + 8, y - 14, enc.f2, 12, enc, mcidBal));
                ops.push(`${colors.footer} rg`);
                ops.push(txtTagged(countText, mg.l + 8, y - 26, enc.f1, 7, enc, mcidCnt));
                documentChildren.push({
                    type: 'P',
                    children: [
                        { mcid: mcidBal, pageObjNum },
                        { mcid: mcidCnt, pageObjNum },
                    ],
                });
            } else {
                ops.push(txt(balanceText, mg.l + 8, y - 14, enc.f2, 12, enc));
                ops.push(`${colors.footer} rg`);
                ops.push(txt(countText, mg.l + 8, y - 26, enc.f1, 7, enc));
            }
            y -= BAL_H + 8;
        }

        // Table header
        const th = _buildTableHeader(y, headers, enc, cx, cwi, columns, cw, mg.l, mg.r, pgW, colors, fs, tagCtx);
        ops.push(...th.ops);
        y = th.y;
        if (th.structRow) tableRows.push(th.structRow);

        // Table rows
        const maxRows = (p === 0) ? rowsPage1 : rowsPerPage;
        const endIdx = Math.min(rowIdx + maxRows, totalRows);
        while (rowIdx < endIdx) {
            const row = rows[rowIdx];
            const dr = _buildDataRow(y, row.cells, row.type, row.pointed, enc, cx, cwi, columns, cw, mg.l, mg.r, pgW, colors, fs, tagCtx);
            ops.push(...dr.ops);
            y = dr.y;
            if (dr.structRow) tableRows.push(dr.structRow);
            rowIdx++;
        }

        // Foreground watermark (above content)
        if (wmState?.foregroundOps) {
            ops.push(wmState.foregroundOps);
        }

        // Footer
        const ft = _buildPageTemplate(
            footerTpl, p + 1, totalPages, title, dateStr,
            mg.b - 5, enc, mg.l, mg.r, pgW, cw, colors.footer, fs.ft, tagCtx,
        );
        ops.push(...ft.ops);
        if (tagged) documentChildren.push(...ft.structEls);

        pageStreams.push(ops.join('\n'));
    }

    // Build the table structure element (inserted before footer /P elements)
    if (tagged && tableRows.length > 0) {
        const tableEl: StructElement = { type: 'Table', children: tableRows };
        // Insert table after header P elements and before footer P elements
        // Header P elements: 1 (title) + infoItems.length + 1 (balance) = infoItems.length + 2
        const headerPCount = infoItems.length + 2;
        documentChildren.splice(headerPCount, 0, tableEl);
    }

    // ── Assemble PDF binary ──────────────────────────────────────────
    const { emit, emitObj, emitStreamObj, offset: getOffset, adjustOffset, objOffsets, parts } = createPdfWriter(compress, encState);

    // PDF Header
    emit(`%PDF-${pdfaConfig.pdfVersion}\n`);
    emit('%\xE2\xE3\xCF\xD3\n\n');

    // Catalog — placeholder, will be rewritten after we know tagged obj nums
    emitObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

    let pageObjStart: number;
    let structTreeRootObjNum = 0;

    if (enc.isUnicode && fontEntries.length > 0) {
        // Unicode mode: 5 objects per CIDFont group
        pageObjStart = 5 + fontEntries.length * 5 + wmExtraObjs;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${pageObjStart + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);

        if (tagged) {
            // PDF/A: /F1 and /F2 must reference embedded fonts. Alias both to
            // primary font's Type0 (sharing FontFile2 stream). Bold renders as
            // regular under PDF/A — register a separate Bold font for true bold.
            const pf = fontEntries[0];
            const bfName = `/${pf.fontData.fontName.replace(/[^A-Za-z0-9-]/g, '')}`;
            const primaryBase = 5;
            const refDict = `<< /Type /Font /Subtype /Type0 /BaseFont ${bfName} ` +
                `/Encoding /Identity-H /DescendantFonts [${primaryBase + 1} 0 R] /ToUnicode ${primaryBase + 4} 0 R >>`;
            emitObj(3, refDict);
            emitObj(4, refDict);
        } else {
            // Helvetica fonts (kept for mixed-content fallback)
            emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
            emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
        }

        // CIDFont Type2 objects — one group of 5 per fontEntry
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

            // Type0 (Composite Font)
            emitObj(base,
                `<< /Type /Font /Subtype /Type0 /BaseFont ${bfName} ` +
                `/Encoding /Identity-H /DescendantFonts [${base + 1} 0 R] /ToUnicode ${base + 4} 0 R >>`);

            // CIDFont
            emitObj(base + 1,
                `<< /Type /Font /Subtype /CIDFontType2 /BaseFont ${bfName} ` +
                `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
                `/FontDescriptor ${base + 2} 0 R ` +
                `/DW ${fm.defaultWidth} ` +
                `/W [${wArray}] ` +
                `/CIDToGIDMap /Identity >>`);

            // FontDescriptor
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

            // FontFile2 (raw TTF binary stream)
            emitStreamObj(base + 3,
                `<< /Length ${ttfBinary.length} /Length1 ${ttfBinary.length}`, ttfBinary);

            // ToUnicode CMap stream
            emitStreamObj(base + 4, `<< /Length ${toUnicodeCMap.length}`, toUnicodeCMap);
        }

        // Watermark objects (ExtGState + optional image)
        const wmObjStart = 5 + fontEntries.length * 5;
        let wmGsRes = '';
        let wmImgRes = '';
        if (wmState) {
            let wmObjIdx = 0;
            const gsRefs: string[] = [];
            for (const [gsName, gsDict] of wmState.extGStates) {
                emitObj(wmObjStart + wmObjIdx, gsDict);
                gsRefs.push(`${gsName} ${wmObjStart + wmObjIdx} 0 R`);
                wmObjIdx++;
            }
            wmGsRes = gsRefs.length > 0 ? ` /ExtGState << ${gsRefs.join(' ')} >>` : '';
            if (wmState.imageXObj) {
                emitObj(wmObjStart + wmObjIdx, wmState.imageXObj);
                wmImgRes = ` /XObject << /ImW1 ${wmObjStart + wmObjIdx} 0 R >>`;
            }
        }

        // Build font resources
        let fontRes = '/F1 3 0 R /F2 4 0 R';
        for (let fi = 0; fi < fontEntries.length; fi++) {
            fontRes += ` ${fontEntries[fi].fontRef} ${5 + fi * 5} 0 R`;
        }

        // Pages
        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = pageObjStart + p * 2;
            const streamObjNum = pageObjStart + 1 + p * 2;
            const stream = pageStreams[p];

            const structParents = tagged ? ` /StructParents ${p}` : '';
            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << ${fontRes} >>${wmImgRes}${wmGsRes} >>${structParents} >>`
            );
            emitStreamObj(streamObjNum, `<< /Length ${stream.length}`, stream);
        }
    } else {
        // Latin mode
        pageObjStart = 5 + wmExtraObjs;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${pageObjStart + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);
        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        // Watermark objects (Latin mode)
        const wmObjStartLatin = 5;
        let wmGsResLatin = '';
        let wmImgResLatin = '';
        if (wmState) {
            let wmObjIdx = 0;
            const gsRefs: string[] = [];
            for (const [gsName, gsDict] of wmState.extGStates) {
                emitObj(wmObjStartLatin + wmObjIdx, gsDict);
                gsRefs.push(`${gsName} ${wmObjStartLatin + wmObjIdx} 0 R`);
                wmObjIdx++;
            }
            wmGsResLatin = gsRefs.length > 0 ? ` /ExtGState << ${gsRefs.join(' ')} >>` : '';
            if (wmState.imageXObj) {
                emitObj(wmObjStartLatin + wmObjIdx, wmState.imageXObj);
                wmImgResLatin = ` /XObject << /ImW1 ${wmObjStartLatin + wmObjIdx} 0 R >>`;
            }
        }

        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = pageObjStart + p * 2;
            const streamObjNum = pageObjStart + 1 + p * 2;
            const stream = pageStreams[p];

            const structParents = tagged ? ` /StructParents ${p}` : '';
            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${wmImgResLatin}${wmGsResLatin} >>${structParents} >>`
            );
            emitStreamObj(streamObjNum, `<< /Length ${stream.length}`, stream);
        }
    }

    // /Info dictionary (ISO 32000-1 §14.3.3)
    const baseObjCount = enc.isUnicode
        ? 4 + fontEntries.length * 5 + wmExtraObjs + totalPages * 2
        : 4 + wmExtraObjs + totalPages * 2;
    const infoObjNum = baseObjCount + 1;

    const { pdfDate, xmpDate: isoDate } = buildPdfMetadata();
    const infoTitle = params.docTitle || title || '';
    emitObj(infoObjNum,
        `<< /Title ${encodePdfTextString(infoTitle)} /Producer (pdfnative) /CreationDate (${pdfDate}) >>`);

    let totalObjs = infoObjNum;

    // ── Tagged PDF objects (StructTreeRoot, XMP, ICC, OutputIntent) ──
    let xmpObjNum = 0;
    let outputIntentObjNum = 0;
    let afArrayStr = '';
    let embeddedFilesNamesDict = '';

    if (tagged) {
        // Build document structure tree
        const documentEl: StructElement = { type: 'Document', children: documentChildren };
        const treeStart = totalObjs + 1;
        const tree = buildStructureTree(documentEl, treeStart, pageObjToStructParents);

        for (const [objNum, content] of tree.objects) {
            emitObj(objNum, content);
        }
        structTreeRootObjNum = tree.structTreeRootObjNum;
        totalObjs = treeStart + tree.totalObjects - 1;

        // XMP metadata stream (skip compression for PDF/A validator compatibility)
        xmpObjNum = totalObjs + 1;
        const xmpContent = utf8EncodeBinaryString(buildXMPMetadata(infoTitle, isoDate, pdfaConfig.pdfaPart, pdfaConfig.pdfaConformance));
        emitStreamObj(xmpObjNum,
            `<< /Type /Metadata /Subtype /XML /Length ${xmpContent.length}`, xmpContent, true);
        totalObjs = xmpObjNum;

        // ICC profile stream
        const iccObjNum = totalObjs + 1;
        const iccProfile = buildMinimalSRGBProfile();
        emitStreamObj(iccObjNum,
            `<< /N 3 /Length ${iccProfile.length}`, iccProfile);
        totalObjs = iccObjNum;

        // OutputIntent
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

    // ── Rewrite Catalog with tagged attributes ──────────────────────
    if (tagged) {
        // Overwrite the catalog object in-place by rebuilding parts[catalogIdx]
        // We need to find and replace the catalog entry
        let catalogContent =
            `<< /Type /Catalog /Pages 2 0 R ` +
            `/MarkInfo << /Marked true >> ` +
            `/StructTreeRoot ${structTreeRootObjNum} 0 R ` +
            `/Metadata ${xmpObjNum} 0 R ` +
            `/OutputIntents [${outputIntentObjNum} 0 R]`;
        if (afArrayStr) {
            catalogContent += ` /AF [${afArrayStr}] ${embeddedFilesNamesDict}`;
        }
        catalogContent += ` >>`;

        // Rebuild: find the catalog object string and replace it
        const oldCatalog = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n\n';
        const newCatalog = `1 0 obj\n${catalogContent}\nendobj\n\n`;
        const idx = parts.indexOf(oldCatalog);
        if (idx !== -1) {
            const sizeDiff = newCatalog.length - oldCatalog.length;
            parts[idx] = newCatalog;
            // Adjust all offsets after the catalog
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

    return parts.join('');
}

/**
 * Build a PDF and return it as a Uint8Array (ready for download or Blob).
 *
 * @param params - PDF content parameters (title, rows, info items, fonts)
 * @param layoutOptions - Optional layout customization (page size, margins, tagged mode)
 * @returns PDF as Uint8Array ready for download or Blob
 */
export function buildPDFBytes(params: PdfParams, layoutOptions?: Partial<PdfLayoutOptions>): Uint8Array {
    return toBytes(buildPDF(params, layoutOptions));
}
