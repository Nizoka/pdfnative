/**
 * Visual-regression helper — PDF content/glyph extraction.
 *
 * Parses a generated PDF, decodes each page content stream and replays its
 * text operators (`BT`/`ET`, `Tf`, `Td`, `Tm`, `Tj`, `TJ`) the way a viewer
 * does — since 1.9.0 (C25) a line is one text object whose runs are placed
 * by relative `Td` moves and whose shaped glyphs sit in `TJ` arrays — so
 * every glyph of every hex string comes out at its absolute origin, advanced
 * by the `/W` widths the page's CIDFonts declare. It also resolves, per font
 * resource, the embedded TrueType `glyf` bytes so a rasteriser can reproduce
 * the page bitmap from the glyph ids.
 *
 * This is TEST-ONLY tooling — it is not part of the published library.
 */

import { openPdf } from '../../../src/index.js';
import type { PdfDict, PdfStream, PdfValue } from '../../../src/parser/pdf-object-parser.js';
import { isDict, isArray, isStream } from '../../../src/parser/pdf-object-parser.js';
import { interpretGlyphs } from '../../helpers/text-objects.js';

/** One glyph at its absolute device position. */
export interface ShowOp {
    /** Font resource name (e.g. `F3`). */
    readonly font: string;
    /** Font size in points. */
    readonly size: number;
    /** Baseline x (user space). */
    readonly x: number;
    /** Baseline y (user space). */
    readonly y: number;
    /** The Identity-H glyph id — one per op. */
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

/** A page font's advances: its `/W` entries over `/DW` (ISO 32000-1 §9.7.4.3). */
interface FontWidths {
    readonly dw: number;
    readonly w: ReadonlyMap<number, number>;
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
 * Extract per-page glyph positions and embedded font bytes from a PDF.
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
        const { programs, widths } = resolveFonts(r, page);
        const widthOf = (font: string, gid: number): number => {
            const fw = widths.get(font);
            if (fw === undefined) return 500;
            return fw.w.get(gid) ?? fw.dw;
        };
        const ops = interpretGlyphs(content, widthOf).map(g => ({ font: g.font, size: g.size, x: g.x, y: g.y, gids: [g.gid] }));
        out.push({ width, height, ops, fonts: programs });
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

function resolveFonts(r: ReturnType<typeof openPdf>, page: PdfDict): { programs: Map<string, Uint8Array | null>; widths: Map<string, FontWidths> } {
    const programs = new Map<string, Uint8Array | null>();
    const widths = new Map<string, FontWidths>();
    const res = r.resolveValue(page.get('Resources') as PdfValue);
    if (!isDict(res)) return { programs, widths };
    const fontDict = r.resolveValue(res.get('Font') as PdfValue);
    if (!isDict(fontDict)) return { programs, widths };

    for (const [name, ref] of fontDict.entries()) {
        const fontVal = r.resolveValue(ref);
        const descendant = descendantFont(r, fontVal);
        programs.set(name, embeddedTrueType(r, descendant));
        if (descendant !== null) widths.set(name, cidWidths(r, descendant));
    }
    return { programs, widths };
}

/** The CIDFont of a Type0 font, else the font itself. */
function descendantFont(r: ReturnType<typeof openPdf>, fontVal: PdfValue): PdfDict | null {
    if (!isDict(fontVal)) return null;
    const descendants = r.resolveValue(fontVal.get('DescendantFonts') as PdfValue);
    if (isArray(descendants) && descendants.length > 0) {
        const df = r.resolveValue(descendants[0]);
        if (isDict(df)) return df;
    }
    return fontVal;
}

/** `/W [c [w1 w2 …] cfirst clast w …]` and `/DW` of a CIDFont (ISO 32000-1 §9.7.4.3). */
function cidWidths(r: ReturnType<typeof openPdf>, cidFont: PdfDict): FontWidths {
    const dwVal = r.resolveValue(cidFont.get('DW') as PdfValue);
    const dw = typeof dwVal === 'number' ? dwVal : 1000;
    const w = new Map<number, number>();
    const arr = r.resolveValue(cidFont.get('W') as PdfValue);
    if (isArray(arr)) {
        const items = arr.map(v => r.resolveValue(v));
        let i = 0;
        while (i < items.length) {
            const first = items[i];
            const second = items[i + 1];
            if (typeof first !== 'number') break;
            if (isArray(second)) {
                second.forEach((v, k) => { const n = r.resolveValue(v); if (typeof n === 'number') w.set(first + k, n); });
                i += 2;
            } else if (typeof second === 'number' && typeof items[i + 2] === 'number') {
                for (let g = first; g <= second; g++) w.set(g, items[i + 2] as number);
                i += 3;
            } else {
                break;
            }
        }
    }
    return { dw, w };
}

function embeddedTrueType(r: ReturnType<typeof openPdf>, fontVal: PdfDict | null): Uint8Array | null {
    if (fontVal === null) return null;
    const fd = r.resolveValue(fontVal.get('FontDescriptor') as PdfValue);
    if (!isDict(fd)) return null;
    const ff2 = r.resolveValue(fd.get('FontFile2') as PdfValue);
    if (!isStream(ff2)) return null;
    return r.decodeStream(ff2);
}
