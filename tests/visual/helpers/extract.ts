/**
 * Visual-regression helper — PDF content/glyph extraction.
 *
 * Parses a generated PDF, decodes each page content stream, and extracts the
 * deterministic text-show operators emitted by the document builder
 * (`BT /Fn size Tf x y Td <hexGIDs> Tj ET`). It also resolves, per font
 * resource, the embedded TrueType `glyf` bytes so a rasteriser can reproduce
 * the page bitmap from the shaped glyph IDs.
 *
 * This is TEST-ONLY tooling — it is not part of the published library.
 */

import { openPdf } from '../../../src/index.js';
import type { PdfDict, PdfStream, PdfValue } from '../../../src/parser/pdf-object-parser.js';
import { isDict, isArray, isStream } from '../../../src/parser/pdf-object-parser.js';

/** A single glyph-run show operator at an absolute device position. */
export interface ShowOp {
    /** Font resource name (e.g. `F3`). */
    readonly font: string;
    /** Font size in points. */
    readonly size: number;
    /** Baseline x (user space). */
    readonly x: number;
    /** Baseline y (user space). */
    readonly y: number;
    /** Identity-H glyph IDs decoded from the hex string. */
    readonly gids: readonly number[];
}

/** Extraction result for one page. */
export interface PageExtract {
    readonly width: number;
    readonly height: number;
    readonly ops: readonly ShowOp[];
    /** Embedded TrueType bytes per font resource name (null = no glyf outline). */
    readonly fonts: ReadonlyMap<string, Uint8Array | null>;
}

const SHOW_RE =
    /\/(\w+)\s+([\d.]+)\s+Tf\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s*<([0-9A-Fa-f]+)>\s*Tj/g;

function hexToGids(hex: string): number[] {
    const gids: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) {
        gids.push(parseInt(hex.slice(i, i + 4), 16));
    }
    return gids;
}

function bytesToLatin1(bytes: Uint8Array): string {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return s;
}

/**
 * Extract per-page show operators and embedded font bytes from a PDF.
 *
 * @param bytes - Complete PDF file bytes.
 * @returns One {@link PageExtract} per page.
 */
export function extractPages(bytes: Uint8Array): PageExtract[] {
    const r = openPdf(bytes);
    const out: PageExtract[] = [];

    for (let p = 0; p < r.pageCount; p++) {
        const page = r.getPage(p);
        const [width, height] = readMediaBox(r, page);
        const content = concatContent(r, page);
        const ops = parseShowOps(content);
        const fonts = resolveFonts(r, page);
        out.push({ width, height, ops, fonts });
    }
    return out;
}

function readMediaBox(r: ReturnType<typeof openPdf>, page: PdfDict): [number, number] {
    const mb = r.resolveValue(page.get('MediaBox') as PdfValue);
    if (isArray(mb) && mb.length === 4) {
        const n = mb.map((v) => Number(r.resolveValue(v)));
        return [n[2] - n[0], n[3] - n[1]];
    }
    return [595.28, 841.89]; // A4 default
}

function concatContent(r: ReturnType<typeof openPdf>, page: PdfDict): string {
    const c = r.resolveValue(page.get('Contents') as PdfValue);
    const streams: PdfStream[] = [];
    if (isStream(c)) streams.push(c);
    else if (isArray(c)) {
        for (const ref of c) {
            const s = r.resolveValue(ref);
            if (isStream(s)) streams.push(s);
        }
    }
    let text = '';
    for (const s of streams) {
        text += bytesToLatin1(r.decodeStream(s)) + '\n';
    }
    return text;
}

function parseShowOps(content: string): ShowOp[] {
    const ops: ShowOp[] = [];
    SHOW_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SHOW_RE.exec(content)) !== null) {
        ops.push({
            font: m[1],
            size: parseFloat(m[2]),
            x: parseFloat(m[3]),
            y: parseFloat(m[4]),
            gids: hexToGids(m[5]),
        });
    }
    return ops;
}

function resolveFonts(r: ReturnType<typeof openPdf>, page: PdfDict): Map<string, Uint8Array | null> {
    const fonts = new Map<string, Uint8Array | null>();
    const res = r.resolveValue(page.get('Resources') as PdfValue);
    if (!isDict(res)) return fonts;
    const fontDict = r.resolveValue(res.get('Font') as PdfValue);
    if (!isDict(fontDict)) return fonts;

    for (const [name, ref] of fontDict.entries()) {
        fonts.set(name, embeddedTrueType(r, r.resolveValue(ref)));
    }
    return fonts;
}

function embeddedTrueType(r: ReturnType<typeof openPdf>, fontVal: PdfValue): Uint8Array | null {
    if (!isDict(fontVal)) return null;
    // Type0 → DescendantFonts[0] → FontDescriptor → FontFile2
    let descriptorHolder: PdfDict | null = fontVal;
    const descendants = r.resolveValue(fontVal.get('DescendantFonts') as PdfValue);
    if (isArray(descendants) && descendants.length > 0) {
        const df = r.resolveValue(descendants[0]);
        if (isDict(df)) descriptorHolder = df;
    }
    const fd = r.resolveValue(descriptorHolder.get('FontDescriptor') as PdfValue);
    if (!isDict(fd)) return null;
    const ff2 = r.resolveValue(fd.get('FontFile2') as PdfValue);
    if (!isStream(ff2)) return null;
    return r.decodeStream(ff2);
}
