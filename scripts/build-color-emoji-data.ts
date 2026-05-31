/**
 * BUILD COLOUR-EMOJI DATA — Noto Color Emoji (COLR/CPAL) → JS Data Module
 * ========================================================================
 * Parses NotoColorEmoji-Regular.ttf, resolves its COLR/CPAL colour glyphs via
 * the pdfnative engine, and emits a CURATED-SUBSET ES data module
 * (`fonts/noto-color-emoji-data.{js,d.ts}`) carrying:
 *   - metrics / cmap / widths / pdfWidthArray
 *   - ttfBase64 — a glyf-subset (layer outlines + colour-glyph CIDs) so the
 *     colour-glyph renderer can extract contours at document-build time
 *   - colorGlyphs — the resolved COLR layer graph (solid + linear + radial)
 *
 * The full font (~24 MB, ~3 600 colour glyphs) is intentionally NOT bundled —
 * that would produce a ~32 MB module, violating pdfnative's lean-module
 * philosophy. A focused subset of the most common emoji keeps the module
 * small while covering everyday use. For full coverage, users run this tool
 * against the full font (registerFont('emoji', () => import(...))).
 *
 * Usage:
 *   npx tsx scripts/build-color-emoji-data.ts            # default curated set
 *
 * Zero external dependency. License: Noto Color Emoji is OFL-1.1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColrCpal } from '../src/fonts/colr-parser.js';
import { subsetTTF } from '../src/fonts/font-subsetter.js';
import type { ColorGlyph } from '../src/types/pdf-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TTF_PATH = join(ROOT, 'fonts', 'ttf', 'NotoColorEmoji-Regular.ttf');
const OUT_JS = join(ROOT, 'fonts', 'noto-color-emoji-data.js');
const OUT_DTS = join(ROOT, 'fonts', 'noto-color-emoji-data.d.ts');

// ── Curated emoji set (Unicode scalar values) ────────────────────────
// Popular single-codepoint emoji across smileys, gestures, hearts, symbols,
// nature, food, activity, travel and objects. Sequence/ZWJ/flag emoji are
// out of scope for v1.3.0 (single base glyph per codepoint).
const CURATED: number[] = [
    // Smileys & emotion
    0x1f600, 0x1f601, 0x1f602, 0x1f603, 0x1f604, 0x1f605, 0x1f606, 0x1f607,
    0x1f609, 0x1f60a, 0x1f60b, 0x1f60c, 0x1f60d, 0x1f60e, 0x1f60f, 0x1f610,
    0x1f612, 0x1f613, 0x1f614, 0x1f615, 0x1f616, 0x1f618, 0x1f619, 0x1f61a,
    0x1f61c, 0x1f61d, 0x1f61e, 0x1f620, 0x1f621, 0x1f622, 0x1f623, 0x1f624,
    0x1f625, 0x1f628, 0x1f629, 0x1f62a, 0x1f62b, 0x1f62c, 0x1f62d, 0x1f62e,
    0x1f62f, 0x1f630, 0x1f631, 0x1f632, 0x1f633, 0x1f634, 0x1f635, 0x1f636,
    0x1f637, 0x1f641, 0x1f642, 0x1f643, 0x1f644, 0x1f910, 0x1f911, 0x1f912,
    0x1f913, 0x1f914, 0x1f915, 0x1f917, 0x1f920, 0x1f921, 0x1f922, 0x1f923,
    0x1f924, 0x1f925, 0x1f927, 0x1f928, 0x1f929, 0x1f92a, 0x1f92b, 0x1f92c,
    0x1f92d, 0x1f92e, 0x1f92f, 0x1f970, 0x1f973, 0x1f974, 0x1f975, 0x1f976,
    0x1f97a, 0x1f978, 0x1f979,
    // Hearts & symbols
    0x2764, 0x1f9e1, 0x1f49b, 0x1f49a, 0x1f499, 0x1f49c, 0x1f5a4, 0x1f90d,
    0x1f90e, 0x1f494, 0x1f495, 0x1f496, 0x1f497, 0x1f498, 0x1f49d, 0x1f49e,
    0x1f49f, 0x2b50, 0x1f31f, 0x2728, 0x1f4a5, 0x1f4ab, 0x1f525, 0x1f4af,
    0x2705, 0x274c, 0x2757, 0x2753, 0x26a0, 0x267b,
    // Hands & people
    0x1f44d, 0x1f44e, 0x1f44c, 0x1f44a, 0x270a, 0x270b, 0x1f44b, 0x1f450,
    0x1f64c, 0x1f64f, 0x1f44f, 0x1f590, 0x1f918, 0x1f919, 0x1f91a, 0x1f91b,
    0x1f91c, 0x1f91d, 0x1f91e, 0x1f91f, 0x1f595, 0x1f4aa,
    // Animals & nature
    0x1f436, 0x1f431, 0x1f42d, 0x1f439, 0x1f430, 0x1f43b, 0x1f43c, 0x1f428,
    0x1f42f, 0x1f981, 0x1f42e, 0x1f437, 0x1f438, 0x1f435, 0x1f414, 0x1f427,
    0x1f426, 0x1f41d, 0x1f98b, 0x1f40c, 0x1f41e, 0x1f422, 0x1f40d, 0x1f433,
    0x1f42c, 0x1f41f, 0x1f344, 0x1f33a, 0x1f337, 0x1f338, 0x1f339, 0x1f33b,
    0x1f343, 0x1f332, 0x1f333, 0x1f334,
    // Food & drink
    0x1f34e, 0x1f34c, 0x1f347, 0x1f349, 0x1f353, 0x1f352, 0x1f351, 0x1f34a,
    0x1f345, 0x1f955, 0x1f33d, 0x1f354, 0x1f355, 0x1f35f, 0x1f32d, 0x1f37f,
    0x1f366, 0x1f370, 0x1f36b, 0x1f36a, 0x2615, 0x1f37a, 0x1f377,
    // Activity, travel & objects
    0x26bd, 0x1f3c0, 0x1f3c8, 0x1f3be, 0x1f3d0, 0x1f3b8, 0x1f3b5, 0x1f3a8,
    0x1f697, 0x1f695, 0x1f68c, 0x2708, 0x1f680, 0x1f6a2, 0x231a, 0x1f4f1,
    0x1f4bb, 0x1f4a1, 0x1f4d6, 0x270f, 0x1f4cc, 0x1f512, 0x1f511, 0x1f3e0,
    0x1f381, 0x1f388, 0x1f389, 0x1f3b6, 0x1f4b0, 0x1f4b5,
];

// ── Minimal TTF table reader (cmap / hmtx / head / hhea / maxp / OS/2) ─

interface Tables { [tag: string]: { offset: number; length: number }; }

function readTables(view: DataView): Tables {
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
function parseCmap(view: DataView, base: number): Map<number, number> {
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

function main(): void {
    const ttf = new Uint8Array(readFileSync(TTF_PATH));
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

    // ── Build the curated subset ─────────────────────────────────────
    const subCmap: Record<number, number> = {};
    const subWidths: Record<number, number> = {};
    const subColor: Record<number, ColorGlyph> = {};
    const usedGids = new Set<number>([0]);
    let kept = 0; let missing = 0;
    const seen = new Set<number>();
    for (const cp of CURATED) {
        if (seen.has(cp)) continue;
        seen.add(cp);
        const gid = cmap.get(cp);
        if (gid === undefined || !colorGlyphs[gid]) { missing++; continue; }
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

    const banner = `/**
 * PRE-BUILT COLOUR-EMOJI FONT DATA — NotoColorEmoji-Regular (curated subset)
 * ==========================================================================
 * Generated by: scripts/build-color-emoji-data.ts
 * Source: NotoColorEmoji-Regular.ttf (OFL-1.1)
 * Colour glyphs: ${kept} (curated). COLR/CPAL → solid + linear + radial paints.
 *
 * Opt in:
 *   import { registerFont } from 'pdfnative';
 *   registerFont('emoji', () => import('pdfnative/fonts/noto-color-emoji-data.js'));
 *
 * DO NOT EDIT — regenerate with: npx tsx scripts/build-color-emoji-data.ts
 */`;

    const js = `${banner}

export const metrics = ${JSON.stringify(metrics)};
export const fontName = 'NotoColorEmoji-Regular';
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

import type { FontData } from '../src/types/pdf-types.js';

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

    writeFileSync(OUT_JS, js);
    writeFileSync(OUT_DTS, dts);

    const kb = Math.round(Buffer.byteLength(js) / 1024);
    console.log(`Colour-emoji data module written:`);
    console.log(`  curated glyphs kept: ${kept}  (missing: ${missing})`);
    console.log(`  used gids (outlines+CIDs): ${usedGids.size}`);
    console.log(`  module size: ${kb} KB`);
    console.log(`  ${OUT_JS}`);
}

main();
