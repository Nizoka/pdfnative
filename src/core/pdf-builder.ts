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
} from '../types/pdf-types.js';
import { createEncodingContext, truncate } from '../fonts/encoding.js';
import { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from '../fonts/font-embedder.js';
import { subsetTTF } from '../fonts/font-subsetter.js';
import { txt, txtR, txtC, fmtNum } from './pdf-text.js';
import { toBytes } from './pdf-stream.js';
import {
    PG_W, PG_H, DEFAULT_MARGINS,
    ROW_H, TH_H, INFO_LN, BAL_H, TITLE_LN, FT_H,
    DEFAULT_FONT_SIZES, DEFAULT_COLORS, DEFAULT_COLUMNS,
    computeColumnPositions,
} from './pdf-layout.js';

// ── Table Builder Helpers ────────────────────────────────────────────

function _buildTableHeader(
    y: number,
    headers: string[],
    enc: EncodingContext,
    cx: number[],
    cwi: number[],
    columns: typeof DEFAULT_COLUMNS,
    cw: number,
    mgL: number,
    mgR: number,
    pgW: number,
    colors: typeof DEFAULT_COLORS,
    fs: typeof DEFAULT_FONT_SIZES,
): { ops: string[]; y: number } {
    const ops: string[] = [];
    ops.push(`${colors.thBg} rg`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} ${fmtNum(cw)} ${fmtNum(TH_H)} re f`);
    ops.push(`0.75 w ${colors.thBrd} RG`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - TH_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - TH_H)} l S`);
    ops.push(`${colors.text} rg`);
    for (let i = 0; i < headers.length; i++) {
        const t = truncate(headers[i], columns[i].mxH ?? columns[i].mx);
        if (columns[i].a === 'r') {
            ops.push(txtR(t, cx[i] + cwi[i] - 3, y - TH_H + 4, enc.f2, fs.th, enc));
        } else if (columns[i].a === 'c') {
            ops.push(txtC(t, cx[i], y - TH_H + 4, enc.f2, fs.th, cwi[i], enc));
        } else {
            ops.push(txt(t, cx[i] + 3, y - TH_H + 4, enc.f2, fs.th, enc));
        }
    }
    return { ops, y: y - TH_H };
}

function _buildDataRow(
    y: number,
    cells: string[],
    type: string,
    pointed: boolean,
    enc: EncodingContext,
    cx: number[],
    cwi: number[],
    columns: typeof DEFAULT_COLUMNS,
    cw: number,
    mgL: number,
    mgR: number,
    pgW: number,
    colors: typeof DEFAULT_COLORS,
    fs: typeof DEFAULT_FONT_SIZES,
): { ops: string[]; y: number } {
    const ops: string[] = [];
    if (pointed) {
        ops.push(`${colors.ptdBg} rg`);
        ops.push(`${fmtNum(mgL)} ${fmtNum(y - ROW_H)} ${fmtNum(cw)} ${fmtNum(ROW_H)} re f`);
    }
    ops.push(`0.25 w ${colors.rowBrd} RG`);
    ops.push(`${fmtNum(mgL)} ${fmtNum(y - ROW_H)} m ${fmtNum(pgW - mgR)} ${fmtNum(y - ROW_H)} l S`);
    for (let i = 0; i < cells.length; i++) {
        const t = truncate(cells[i], columns[i].mx);
        const isAmount = (i === 3);
        const color = isAmount ? (type === 'credit' ? colors.credit : colors.debit) : colors.text;
        const font = isAmount ? enc.f2 : enc.f1;
        ops.push(`${color} rg`);
        if (columns[i].a === 'r') {
            ops.push(txtR(t, cx[i] + cwi[i] - 3, y - ROW_H + 3, font, fs.td, enc));
        } else if (columns[i].a === 'c') {
            ops.push(txtC(t, cx[i], y - ROW_H + 3, font, fs.td, cwi[i], enc));
        } else {
            ops.push(txt(t, cx[i] + 3, y - ROW_H + 3, font, fs.td, enc));
        }
    }
    return { ops, y: y - ROW_H };
}

function _buildFooter(
    pageNum: number,
    totalPages: number,
    footerText: string,
    enc: EncodingContext,
    mgL: number,
    mgR: number,
    mgB: number,
    pgW: number,
    colors: typeof DEFAULT_COLORS,
    fs: typeof DEFAULT_FONT_SIZES,
): string[] {
    const ops: string[] = [];
    const y = mgB - 5;
    ops.push(`${colors.footer} rg`);
    ops.push(txt(footerText, mgL, y, enc.f1, fs.ft, enc));
    ops.push(txtR(`${pageNum}/${totalPages}`, pgW - mgR, y, enc.f1, fs.ft, enc));
    return ops;
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
    const { title, infoItems, balanceText, countText, headers, rows, footerText, fontData } = params;

    // Resolve layout
    const pgW = layoutOptions?.pageWidth ?? PG_W;
    const pgH = layoutOptions?.pageHeight ?? PG_H;
    const mg = layoutOptions?.margins ?? DEFAULT_MARGINS;
    const cw = pgW - mg.l - mg.r;
    const columns = layoutOptions?.columns ?? DEFAULT_COLUMNS;
    const colors = layoutOptions?.colors ?? DEFAULT_COLORS;
    const fs = DEFAULT_FONT_SIZES;
    const { cx, cwi } = computeColumnPositions(columns, mg.l, cw);

    // Build fontEntries
    const fontEntries: FontEntry[] = params.fontEntries
        || (fontData ? [{ fontData, fontRef: '/F3', lang: 'unknown' }] : []);

    const enc = createEncodingContext(fontEntries);

    // ── Pagination ───────────────────────────────────────────────────
    const infoCount = infoItems.length;
    const page1Header = TITLE_LN + 16 + (infoCount * INFO_LN) + 8 + BAL_H + 10;
    const rowsPage1 = Math.max(0, Math.floor((pgH - mg.t - mg.b - page1Header - TH_H - FT_H) / ROW_H));
    const rowsPerPage = Math.max(1, Math.floor((pgH - mg.t - mg.b - TH_H - FT_H) / ROW_H));
    const totalRows = rows.length;

    let totalPages: number;
    if (totalRows <= rowsPage1) {
        totalPages = 1;
    } else {
        totalPages = 1 + Math.ceil((totalRows - rowsPage1) / rowsPerPage);
    }
    if (totalPages < 1) totalPages = 1;

    // ── Build page content streams ───────────────────────────────────
    const pageStreams: string[] = [];
    let rowIdx = 0;

    for (let p = 0; p < totalPages; p++) {
        const ops: string[] = [];
        let y = pgH - mg.t;

        if (p === 0) {
            // Title
            ops.push(`${colors.title} rg`);
            ops.push(txt(title, mg.l, y - fs.title, enc.f2, fs.title, enc));
            y -= TITLE_LN;

            // Title underline
            ops.push(`0.75 w ${colors.title} RG`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y)} m ${fmtNum(pgW - mg.r)} ${fmtNum(y)} l S`);
            y -= 14;

            // Info section
            for (const item of infoItems) {
                ops.push(`${colors.label} rg`);
                ops.push(txt(item.label + ' :', mg.l, y, enc.f2, fs.info, enc));
                ops.push(`${colors.text} rg`);
                ops.push(txt(item.value, mg.l + 100, y, enc.f1, fs.info, enc));
                y -= INFO_LN;
            }
            y -= 6;

            // Balance box
            ops.push(`${colors.balBg} rg`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y - BAL_H)} ${fmtNum(cw)} ${fmtNum(BAL_H)} re f`);
            ops.push(`0.5 w ${colors.balBrd} RG`);
            ops.push(`${fmtNum(mg.l)} ${fmtNum(y - BAL_H)} ${fmtNum(cw)} ${fmtNum(BAL_H)} re S`);
            ops.push(`${colors.title} rg`);
            ops.push(txt(balanceText, mg.l + 8, y - 14, enc.f2, 12, enc));
            ops.push(`${colors.footer} rg`);
            ops.push(txt(countText, mg.l + 8, y - 26, enc.f1, 7, enc));
            y -= BAL_H + 8;
        }

        // Table header
        const th = _buildTableHeader(y, headers, enc, cx, cwi, columns, cw, mg.l, mg.r, pgW, colors, fs);
        ops.push(...th.ops);
        y = th.y;

        // Table rows
        const maxRows = (p === 0) ? rowsPage1 : rowsPerPage;
        const endIdx = Math.min(rowIdx + maxRows, totalRows);
        while (rowIdx < endIdx) {
            const row = rows[rowIdx];
            const dr = _buildDataRow(y, row.cells, row.type, row.pointed, enc, cx, cwi, columns, cw, mg.l, mg.r, pgW, colors, fs);
            ops.push(...dr.ops);
            y = dr.y;
            rowIdx++;
        }

        // Footer
        ops.push(..._buildFooter(p + 1, totalPages, footerText, enc, mg.l, mg.r, mg.b, pgW, colors, fs));

        pageStreams.push(ops.join('\n'));
    }

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

    // PDF Header
    emit('%PDF-1.4\n');
    emit('%\xE2\xE3\xCF\xD3\n\n');

    // Catalog
    emitObj(1, '<< /Type /Catalog /Pages 2 0 R >>');

    let pageObjStart: number;

    if (enc.isUnicode && fontEntries.length > 0) {
        // Unicode mode: 5 objects per CIDFont group
        pageObjStart = 5 + fontEntries.length * 5;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${pageObjStart + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);

        // Helvetica fonts (kept for mixed-content fallback)
        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        // CIDFont Type2 objects — one group of 5 per fontEntry
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
            emitObj(base + 3,
                `<< /Length ${ttfBinary.length} /Length1 ${ttfBinary.length} >>\nstream\n${ttfBinary}\nendstream`);

            // ToUnicode CMap stream
            emitObj(base + 4,
                `<< /Length ${toUnicodeCMap.length} >>\nstream\n${toUnicodeCMap}\nendstream`);
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

            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << ${fontRes} >> >> >>`
            );
            emitObj(streamObjNum,
                `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
            );
        }
    } else {
        // Latin mode
        pageObjStart = 5;

        const kids: string[] = [];
        for (let p = 0; p < totalPages; p++) {
            kids.push(`${5 + p * 2} 0 R`);
        }
        emitObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${totalPages} >>`);
        emitObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
        emitObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

        for (let p = 0; p < totalPages; p++) {
            const pageObjNum = 5 + p * 2;
            const streamObjNum = 6 + p * 2;
            const stream = pageStreams[p];

            emitObj(pageObjNum,
                `<< /Type /Page /Parent 2 0 R ` +
                `/MediaBox [0 0 ${fmtNum(pgW)} ${fmtNum(pgH)}] ` +
                `/Contents ${streamObjNum} 0 R ` +
                `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
            );
            emitObj(streamObjNum,
                `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
            );
        }
    }

    // Cross-reference table
    const totalObjs = enc.isUnicode
        ? 4 + fontEntries.length * 5 + totalPages * 2
        : 4 + totalPages * 2;
    const xrefOffset = offset;
    emit('xref\n');
    emit(`0 ${totalObjs + 1}\n`);
    emit('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjs; i++) {
        emit(`${String(objOffsets[i]).padStart(10, '0')} 00000 n \n`);
    }

    // Trailer
    emit('trailer\n');
    emit(`<< /Size ${totalObjs + 1} /Root 1 0 R >>\n`);
    emit('startxref\n');
    emit(`${xrefOffset}\n`);
    emit('%%EOF');

    return parts.join('');
}

/**
 * Build a PDF and return it as a Uint8Array (ready for download or Blob).
 */
export function buildPDFBytes(params: PdfParams, layoutOptions?: Partial<PdfLayoutOptions>): Uint8Array {
    return toBytes(buildPDF(params, layoutOptions));
}
