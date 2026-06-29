/**
 * SHARED COLOUR-EMOJI BUILD CORE
 * ==============================
 * Pure, deterministic core shared by:
 *   - scripts/build-color-emoji-data.ts  (regenerates the bundled curated module)
 *   - scripts/build-emoji-font.ts        (the public `pdfnative-build-emoji-font` CLI)
 *
 * Given a NotoColorEmoji-Regular.ttf (or any COLR/CPAL colour font) and a list
 * of Unicode scalar values, it produces a tree-shakeable ES data module
 * (`.js` + `.d.ts`) carrying metrics / cmap / widths / pdfWidthArray, the
 * resolved COLR layer graph (`colorGlyphs`), and a glyf-subset `ttfBase64` so
 * the colour-glyph renderer can extract contours at document-build time.
 *
 * Zero external dependency. Output is byte-stable for identical inputs.
 * License note: NotoColorEmoji is OFL-1.1.
 */

import { parseColrCpal } from '../../src/fonts/colr-parser.js';
import { subsetTTF } from '../../src/fonts/font-subsetter.js';
import type { ColorGlyph } from '../../src/types/pdf-types.js';

export interface EmojiModuleStats {
    /** Colour glyphs successfully resolved and kept. */
    readonly kept: number;
    /** Requested codepoints with no colour glyph in the font. */
    readonly missing: number;
    /** Distinct glyph IDs embedded (colour CIDs + layer outlines). */
    readonly usedGids: number;
    /** Size of the generated `.js` module in KiB (rounded). */
    readonly sizeKb: number;
    /** The codepoints that had no colour glyph (for diagnostics). */
    readonly missingCodepoints: readonly number[];
}

export interface EmojiModuleResult {
    readonly js: string;
    readonly dts: string;
    readonly stats: EmojiModuleStats;
}

export interface BuildEmojiOptions {
    /** Embedded PostScript font name. Default: `'NotoColorEmoji-Regular'`. */
    readonly fontName?: string;
    /** Type-only import path used in the generated `.d.ts`. */
    readonly dtsTypeImport: string;
    /** Builds the banner comment block given the final kept-glyph count. */
    readonly makeBanner: (kept: number) => string;
}

interface TableRecord { readonly offset: number; readonly length: number; }
type Tables = Record<string, TableRecord>;

/** Read the SFNT table directory. */
export function readTables(view: DataView): Tables {
    const numTables = view.getUint16(4);
    const tables: Tables = {};
    for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
            view.getUint8(rec), view.getUint8(rec + 1),
            view.getUint8(rec + 2), view.getUint8(rec + 3),
        );
        tables[tag] = { offset: view.getUint32(rec + 8), length: view.getUint32(rec + 12) };
    }
    return tables;
}

/** Parse the best Unicode cmap subtable (format 12 preferred, else 4). */
export function parseCmap(view: DataView, base: number): Map<number, number> {
    const cmap = new Map<number, number>();
    const numSub = view.getUint16(base + 2);
    let bestOff = -1; let bestFmt = 0;
    for (let i = 0; i < numSub; i++) {
        const rec = base + 4 + i * 8;
        const plat = view.getUint16(rec);
        const enc = view.getUint16(rec + 2);
        const off = view.getUint32(rec + 4);
        if ((plat === 3 && (enc === 1 || enc === 10)) || (plat === 0 && (enc === 3 || enc === 4 || enc === 6))) {
            const fmt = view.getUint16(base + off);
            if (fmt === 12 && bestFmt < 12) { bestOff = base + off; bestFmt = 12; }
            else if (fmt === 4 && bestFmt < 4) { bestOff = base + off; bestFmt = 4; }
        }
    }
    if (bestOff < 0) return cmap;
    if (bestFmt === 12) {
        const nGroups = view.getUint32(bestOff + 12);
        for (let g = 0; g < nGroups; g++) {
            const rec = bestOff + 16 + g * 12;
            const start = view.getUint32(rec);
            const end = view.getUint32(rec + 4);
            const startGid = view.getUint32(rec + 8);
            for (let c = start; c <= end; c++) cmap.set(c, startGid + (c - start));
        }
    } else {
        const segX2 = view.getUint16(bestOff + 6);
        const segCount = segX2 / 2;
        const endBase = bestOff + 14;
        const startBase = endBase + segX2 + 2;
        const deltaBase = startBase + segX2;
        const rangeBase = deltaBase + segX2;
        for (let s = 0; s < segCount; s++) {
            const end = view.getUint16(endBase + s * 2);
            const start = view.getUint16(startBase + s * 2);
            const delta = view.getInt16(deltaBase + s * 2);
            const rangeOff = view.getUint16(rangeBase + s * 2);
            if (start === 0xffff) break;
            for (let c = start; c <= end; c++) {
                let gid: number;
                if (rangeOff === 0) gid = (c + delta) & 0xffff;
                else {
                    const gi = rangeBase + s * 2 + rangeOff + (c - start) * 2;
                    gid = view.getUint16(gi);
                    if (gid !== 0) gid = (gid + delta) & 0xffff;
                }
                if (gid !== 0) cmap.set(c, gid);
            }
        }
    }
    return cmap;
}

/**
 * Build a colour-emoji ES data module from a COLR/CPAL font and a codepoint set.
 * Deterministic: identical (ttf, codepoints, opts) always yield identical output.
 */
export function buildEmojiFontModule(
    ttf: Uint8Array,
    codepoints: readonly number[],
    opts: BuildEmojiOptions,
): EmojiModuleResult {
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const tables = readTables(view);

    const unitsPerEm = view.getUint16(tables['head'].offset + 18);
    const xMin = view.getInt16(tables['head'].offset + 36);
    const yMin = view.getInt16(tables['head'].offset + 38);
    const xMax = view.getInt16(tables['head'].offset + 40);
    const yMax = view.getInt16(tables['head'].offset + 42);
    const ascent = view.getInt16(tables['hhea'].offset + 4);
    const descent = view.getInt16(tables['hhea'].offset + 6);
    const numberOfHMetrics = view.getUint16(tables['hhea'].offset + 34);
    const numGlyphs = view.getUint16(tables['maxp'].offset + 4);
    let capHeight = Math.round(ascent * 0.7);
    if (tables['OS/2'] && tables['OS/2'].length >= 90) {
        capHeight = view.getInt16(tables['OS/2'].offset + 88);
    }

    // hmtx widths
    const widthsAll: number[] = new Array(numGlyphs).fill(0);
    let lastW = 0;
    for (let i = 0; i < numGlyphs; i++) {
        if (i < numberOfHMetrics) { lastW = view.getUint16(tables['hmtx'].offset + i * 4); }
        widthsAll[i] = lastW;
    }

    const cmap = parseCmap(view, tables['cmap'].offset);
    const colorGlyphs = parseColrCpal(ttf);
    if (!colorGlyphs) throw new Error('Font has no COLR/CPAL table');

    // ── Build the requested subset ───────────────────────────────────
    const subCmap: Record<number, number> = {};
    const subWidths: Record<number, number> = {};
    const subColor: Record<number, ColorGlyph> = {};
    const usedGids = new Set<number>([0]);
    let kept = 0; let missing = 0;
    const missingCodepoints: number[] = [];
    const seen = new Set<number>();
    for (const cp of codepoints) {
        if (seen.has(cp)) continue;
        seen.add(cp);
        const gid = cmap.get(cp);
        if (gid === undefined || !colorGlyphs[gid]) { missing++; missingCodepoints.push(cp); continue; }
        subCmap[cp] = gid;
        subWidths[gid] = widthsAll[gid];
        subColor[gid] = colorGlyphs[gid];
        usedGids.add(gid);
        for (const layer of colorGlyphs[gid].layers) usedGids.add(layer.glyphId);
        kept++;
    }

    // Subset the glyf table (subsetTTF expands composites + keeps gids stable).
    const subBinary = subsetTTF(ttf, usedGids);
    const ttfBase64 = Buffer.from(subBinary, 'latin1').toString('base64');

    const defaultWidth = widthsAll[cmap.get(0x20) ?? 0] || widthsAll[0] || unitsPerEm;

    // CID /W array (compact runs) for the colour CIDs.
    const cids = Object.keys(subWidths).map(Number).sort((a, b) => a - b);
    const wParts: string[] = [];
    for (const cid of cids) wParts.push(`${cid} [${subWidths[cid]}]`);
    const pdfWidthArray = wParts.join(' ');

    const metrics = {
        unitsPerEm, ascent, descent, capHeight, stemV: 80,
        bbox: [xMin, yMin, xMax, yMax], defaultWidth, numGlyphs,
    };

    const fontName = opts.fontName ?? 'NotoColorEmoji-Regular';
    const fontNameLiteral = fontName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const banner = opts.makeBanner(kept);

    const js = `${banner}

export const metrics = ${JSON.stringify(metrics)};
export const fontName = '${fontNameLiteral}';
export const cmap = ${JSON.stringify(subCmap)};
export const defaultWidth = ${defaultWidth};
export const widths = ${JSON.stringify(subWidths)};
export const pdfWidthArray = ${JSON.stringify(pdfWidthArray)};
export const gsub = {};
export const ligatures = null;
export const markAnchors = null;
export const mark2mark = null;
export const colorGlyphs = ${JSON.stringify(subColor)};
export const ttfBase64 = ${JSON.stringify(ttfBase64)};
`;

    const dts = `${banner}

import type { FontData } from '${opts.dtsTypeImport.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';

export declare const metrics: FontData['metrics'];
export declare const fontName: string;
export declare const cmap: Record<number, number>;
export declare const defaultWidth: number;
export declare const widths: Record<number, number>;
export declare const pdfWidthArray: string;
export declare const gsub: Record<number, number>;
export declare const ligatures: null;
export declare const markAnchors: null;
export declare const mark2mark: null;
export declare const colorGlyphs: NonNullable<FontData['colorGlyphs']>;
export declare const ttfBase64: string;
`;

    const sizeKb = Math.round(Buffer.byteLength(js) / 1024);
    return { js, dts, stats: { kept, missing, usedGids: usedGids.size, sizeKb, missingCodepoints } };
}

/**
 * Enumerate every Unicode scalar value in the font's cmap that resolves to a
 * COLR/CPAL colour glyph, sorted ascending. Used by the CLI `--all` preset.
 */
export function allColorCodepoints(ttf: Uint8Array): number[] {
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const tables = readTables(view);
    const cmap = parseCmap(view, tables['cmap'].offset);
    const colorGlyphs = parseColrCpal(ttf);
    if (!colorGlyphs) throw new Error('Font has no COLR/CPAL table');
    const out: number[] = [];
    for (const [cp, gid] of cmap) {
        if (colorGlyphs[gid]) out.push(cp);
    }
    return out.sort((a, b) => a - b);
}
