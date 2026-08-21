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
    /** Multi-codepoint sequences resolved to a colour ligature glyph. (v1.7.0) */
    readonly keptSequences: number;
    /** Requested sequences the font's GSUB could not resolve. (v1.7.0) */
    readonly missingSequences: number;
    /** The unresolved sequences (for diagnostics). (v1.7.0) */
    readonly missingSequenceList: readonly (readonly number[])[];
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

// ── GSUB LigatureSubst (LookupType 4 + Extension 7) ──────────────────

/** Read a coverage table (format 1 glyph list or format 2 ranges). */
function readCoverage(view: DataView, offset: number): number[] {
    const format = view.getUint16(offset);
    const glyphs: number[] = [];
    if (format === 1) {
        const count = view.getUint16(offset + 2);
        for (let i = 0; i < count; i++) glyphs.push(view.getUint16(offset + 4 + i * 2));
    } else if (format === 2) {
        const rangeCount = view.getUint16(offset + 2);
        for (let i = 0; i < rangeCount; i++) {
            const rec = offset + 4 + i * 6;
            const start = view.getUint16(rec);
            const end = view.getUint16(rec + 2);
            for (let g = start; g <= end; g++) glyphs.push(g);
        }
    }
    return glyphs;
}

/** An ordered GSUB substitution lookup usable for sequence resolution. */
export type GsubSequenceLookup =
    | { readonly kind: 'single'; readonly map: Map<number, number> }
    | { readonly kind: 'multiple'; readonly map: Map<number, readonly number[]> }
    | { readonly kind: 'ligature'; readonly ligs: Map<number, number[][]> };

/**
 * Parse the GSUB lookups relevant to emoji sequence composition — Single
 * (type 1), Multiple (type 2), and Ligature (type 4), each possibly wrapped
 * in a type-7 Extension — preserving lookup order. Colour-emoji fonts chain
 * them: e.g. Noto Color Emoji first maps regional indicators through a
 * single substitution, then ligates the substituted pair into the flag.
 */
export function parseSequenceLookups(ttf: Uint8Array): GsubSequenceLookup[] {
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const tables = readTables(view);
    const lookups: GsubSequenceLookup[] = [];
    const gsubRec = tables['GSUB'];
    if (!gsubRec) return lookups;
    const base = gsubRec.offset;
    const lookupListBase = base + view.getUint16(base + 8);
    const lookupCount = view.getUint16(lookupListBase);

    const parseSingle = (stBase: number, map: Map<number, number>): void => {
        const format = view.getUint16(stBase);
        const coverage = readCoverage(view, stBase + view.getUint16(stBase + 2));
        if (format === 1) {
            const delta = view.getInt16(stBase + 4);
            for (const gid of coverage) map.set(gid, (gid + delta) & 0xFFFF);
        } else if (format === 2) {
            const glyphCount = view.getUint16(stBase + 4);
            for (let gi = 0; gi < glyphCount && gi < coverage.length; gi++) {
                map.set(coverage[gi], view.getUint16(stBase + 6 + gi * 2));
            }
        }
    };

    const parseMultiple = (stBase: number, map: Map<number, readonly number[]>): void => {
        if (view.getUint16(stBase) !== 1) return;
        const coverage = readCoverage(view, stBase + view.getUint16(stBase + 2));
        const seqCount = view.getUint16(stBase + 4);
        for (let si = 0; si < seqCount && si < coverage.length; si++) {
            const seqBase = stBase + view.getUint16(stBase + 6 + si * 2);
            const glyphCount = view.getUint16(seqBase);
            const out: number[] = [];
            for (let gi = 0; gi < glyphCount; gi++) out.push(view.getUint16(seqBase + 2 + gi * 2));
            map.set(coverage[si], out);
        }
    };

    const parseLig = (stBase: number, ligs: Map<number, number[][]>): void => {
        if (view.getUint16(stBase) !== 1) return;
        const coverage = readCoverage(view, stBase + view.getUint16(stBase + 2));
        const ligSetCount = view.getUint16(stBase + 4);
        for (let lsi = 0; lsi < ligSetCount && lsi < coverage.length; lsi++) {
            const firstGid = coverage[lsi];
            const ligSetBase = stBase + view.getUint16(stBase + 6 + lsi * 2);
            const ligCount = view.getUint16(ligSetBase);
            for (let lgi = 0; lgi < ligCount; lgi++) {
                const ligBase = ligSetBase + view.getUint16(ligSetBase + 2 + lgi * 2);
                const ligatureGlyph = view.getUint16(ligBase);
                const componentCount = view.getUint16(ligBase + 2);
                const entry: number[] = [ligatureGlyph];
                for (let ci = 0; ci < componentCount - 1; ci++) {
                    entry.push(view.getUint16(ligBase + 4 + ci * 2));
                }
                const list = ligs.get(firstGid);
                if (list) list.push(entry); else ligs.set(firstGid, [entry]);
            }
        }
    };

    for (let li = 0; li < lookupCount; li++) {
        const lookupBase = lookupListBase + view.getUint16(lookupListBase + 2 + li * 2);
        let lookupType = view.getUint16(lookupBase);
        const subtableCount = view.getUint16(lookupBase + 4);
        const stBases: number[] = [];
        for (let si = 0; si < subtableCount; si++) {
            let stBase = lookupBase + view.getUint16(lookupBase + 6 + si * 2);
            if (lookupType === 7 || view.getUint16(lookupBase) === 7) {
                if (view.getUint16(stBase) !== 1) continue;
                lookupType = view.getUint16(stBase + 2);
                stBase = stBase + view.getUint32(stBase + 4);
            }
            stBases.push(stBase);
        }
        if (lookupType === 1) {
            const map = new Map<number, number>();
            for (const stBase of stBases) parseSingle(stBase, map);
            if (map.size) lookups.push({ kind: 'single', map });
        } else if (lookupType === 2) {
            const map = new Map<number, readonly number[]>();
            for (const stBase of stBases) parseMultiple(stBase, map);
            if (map.size) lookups.push({ kind: 'multiple', map });
        } else if (lookupType === 4) {
            const ligs = new Map<number, number[][]>();
            for (const stBase of stBases) parseLig(stBase, ligs);
            for (const list of ligs.values()) list.sort((a, b) => b.length - a.length);
            if (ligs.size) lookups.push({ kind: 'ligature', ligs });
        }
    }
    return lookups;
}

/** Apply one GSUB lookup left-to-right over a glyph sequence. */
function applyLookup(gids: readonly number[], lookup: GsubSequenceLookup): number[] {
    const out: number[] = [];
    for (let i = 0; i < gids.length;) {
        if (lookup.kind === 'single') {
            out.push(lookup.map.get(gids[i]) ?? gids[i]);
            i++;
        } else if (lookup.kind === 'multiple') {
            const exp = lookup.map.get(gids[i]);
            if (exp) out.push(...exp); else out.push(gids[i]);
            i++;
        } else {
            const candidates = lookup.ligs.get(gids[i]);
            let matched = false;
            if (candidates) {
                for (const entry of candidates) {
                    const compCount = entry.length - 1;
                    if (i + 1 + compCount > gids.length) continue;
                    let ok = true;
                    for (let c = 0; c < compCount; c++) {
                        if (gids[i + 1 + c] !== entry[1 + c]) { ok = false; break; }
                    }
                    if (ok) {
                        out.push(entry[0]);
                        i += 1 + compCount;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) { out.push(gids[i]); i++; }
        }
    }
    return out;
}

/**
 * Resolve a codepoint sequence to a single glyph id by mapping each scalar
 * through the full cmap, then applying the font's Single/Multiple/Ligature
 * GSUB lookups in table order (repeated until stable). Returns 0 when the
 * font cannot compose the sequence into exactly one glyph.
 */
export function resolveSequenceGid(
    cps: readonly number[],
    cmap: Map<number, number>,
    lookups: readonly GsubSequenceLookup[],
): number {
    let gids: number[] = [];
    for (const cp of cps) {
        const gid = cmap.get(cp);
        if (gid === undefined) {
            // A missing VS-16 is droppable (presentation-only); anything else
            // unmapped makes the sequence unresolvable.
            if (cp === 0xFE0F) continue;
            return 0;
        }
        gids.push(gid);
    }
    for (let pass = 0; pass < 4 && gids.length > 1; pass++) {
        const before = gids.join(',');
        for (const lookup of lookups) {
            gids = applyLookup(gids, lookup);
            if (gids.length === 1) break;
        }
        if (gids.join(',') === before) break;
    }
    return gids.length === 1 ? gids[0] : 0;
}

/**
 * Build a colour-emoji ES data module from a COLR/CPAL font and a codepoint set.
 * Deterministic: identical (ttf, codepoints, sequences, opts) always yield
 * identical output.
 *
 * @param sequences - Optional multi-codepoint sequences (flags, ZWJ) to
 *   resolve through the font's GSUB ligature lookups and bundle as a
 *   codepoint-keyed `sequences` export. (v1.7.0)
 */
export function buildEmojiFontModule(
    ttf: Uint8Array,
    codepoints: readonly number[],
    opts: BuildEmojiOptions,
    sequences?: readonly (readonly number[])[],
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

    // ── Resolve multi-codepoint sequences (v1.7.0) ───────────────────
    const subSequences: Record<number, number[][]> = {};
    let keptSequences = 0; let missingSequences = 0;
    const missingSequenceList: number[][] = [];
    if (sequences && sequences.length > 0) {
        const lookups = parseSequenceLookups(ttf);
        const seenSeq = new Set<string>();
        const registerVariant = (variant: readonly number[], ligGid: number): void => {
            const vKey = variant.join(',');
            if (variant.length < 2 || seenSeq.has(vKey)) return;
            seenSeq.add(vKey);
            const first = variant[0];
            if (!subSequences[first]) subSequences[first] = [];
            subSequences[first].push([ligGid, ...variant.slice(1)]);
        };
        for (const seq of sequences) {
            const key = seq.join(',');
            if (seq.length < 2 || seenSeq.has(key)) continue;
            const ligGid = resolveSequenceGid(seq, cmap, lookups);
            if (ligGid === 0 || !colorGlyphs[ligGid]) {
                seenSeq.add(key);
                missingSequences++;
                missingSequenceList.push([...seq]);
                continue;
            }
            registerVariant(seq, ligGid);
            // Register the VS-16-stripped variant too: real-world text is
            // inconsistent about emoji-presentation selectors, and both
            // spellings must resolve to the same ligature glyph.
            const stripped = seq.filter(cp => cp !== 0xFE0F);
            if (stripped.length !== seq.length) registerVariant(stripped, ligGid);
            subWidths[ligGid] = widthsAll[ligGid];
            subColor[ligGid] = colorGlyphs[ligGid];
            usedGids.add(ligGid);
            for (const layer of colorGlyphs[ligGid].layers) usedGids.add(layer.glyphId);
            keptSequences++;
        }
        // Longest-first so the runtime longest-match takes the first hit;
        // ties break lexicographically for byte-stable output.
        for (const first of Object.keys(subSequences)) {
            subSequences[first as unknown as number].sort((a, b) => {
                if (b.length !== a.length) return b.length - a.length;
                for (let i = 1; i < a.length; i++) {
                    if (a[i] !== b[i]) return a[i] - b[i];
                }
                return 0;
            });
        }
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
export const sequences = ${sequences && sequences.length > 0 ? JSON.stringify(subSequences) : 'null'};
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
export declare const sequences: FontData['sequences'];
export declare const colorGlyphs: NonNullable<FontData['colorGlyphs']>;
export declare const ttfBase64: string;
`;

    const sizeKb = Math.round(Buffer.byteLength(js) / 1024);
    return {
        js, dts,
        stats: {
            kept, missing, usedGids: usedGids.size, sizeKb, missingCodepoints,
            keptSequences, missingSequences, missingSequenceList,
        },
    };
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
