/**
 * pdfnative — Programmatic Font Compilation API
 * =============================================
 *
 * A pure, cross-platform (Node / browser / Deno / Bun / edge) port of the
 * `pdfnative-build-font` CLI (`tools/build-font-data.cjs`). It parses a
 * TrueType/OpenType font in memory and produces either:
 *
 *   - a registerable font-data object (`parseFontData`), or
 *   - the ES/CJS module source string (`compileFontData`) that the CLI writes
 *     to disk.
 *
 * This unblocks serverless / sandboxed / in-browser workflows where spawning
 * the CLI (`child_process` / `npx`) is impossible, while keeping the zero
 * runtime-dependency guarantee (no `Buffer`, no `fs`).
 *
 * The ESM output of {@link compileFontData} is byte-identical to the CLI when
 * the same `fontName` is supplied.
 *
 * @module pdfnative/tools
 * @since 1.5.0
 */

// ── Public types ─────────────────────────────────────────────────────

/** Font metrics extracted from `head` / `hhea` / `maxp` / `OS/2`. */
export interface CompiledFontMetrics {
    readonly unitsPerEm: number;
    readonly ascent: number;
    readonly descent: number;
    readonly capHeight: number;
    readonly stemV: number;
    readonly bbox: readonly [number, number, number, number];
    readonly defaultWidth: number;
    readonly numGlyphs: number;
}

/**
 * A fully-parsed, registerable font-data object. Its shape matches the runtime
 * exports of a bundled `*-data.js` module, so it can be registered directly:
 *
 * ```ts
 * const fd = parseFontData(ttfBytes);
 * registerFont('custom', () => Promise.resolve(fd));
 * ```
 */
export interface FontDataObject {
    readonly metrics: CompiledFontMetrics;
    readonly fontName: string;
    /** Unicode code point → glyph ID. */
    readonly cmap: Record<number, number>;
    readonly defaultWidth: number;
    /** Glyph ID → advance width (non-default only). */
    readonly widths: Record<number, number>;
    /** GSUB SingleSubst: fromGid → substituteGid. */
    readonly gsub: Record<number, number>;
    /** GSUB LigatureSubst: firstGid → [[resultGid, comp1, …], …]. */
    readonly ligatures: Record<number, number[][]>;
    /** GPOS MarkToBase anchors. */
    readonly markAnchors: {
        readonly marks: Record<number, [number, number, number]>;
        readonly bases: Record<number, Record<number, [number, number]>>;
    };
    /** GPOS MarkToMark anchors. */
    readonly mark2mark: {
        readonly mark1Anchors: Record<number, Record<number, [number, number]>>;
        readonly mark2Classes: Record<number, [number, number, number]>;
    };
    /** Pre-formatted PDF `/W` array string for the CIDFont object. */
    readonly pdfWidthArray: string;
    /** Raw TTF binary as base64 (for PDF `FontFile2` embedding). */
    readonly ttfBase64: string;
}

/** Options for {@link compileFontData}. */
export interface CompileFontDataOptions {
    /**
     * Font name for `/BaseFont` and the module header. Sanitised to
     * `[A-Za-z0-9-]`. Defaults to the font's PostScript / family name from the
     * `name` table, or `'CustomFont'` when unavailable.
     */
    readonly fontName?: string;
    /** Output module format. Defaults to `'esm'`. */
    readonly format?: 'esm' | 'cjs';
}

/** Options for {@link parseFontData}. */
export interface ParseFontDataOptions {
    /** Override the derived font name (sanitised to `[A-Za-z0-9-]`). */
    readonly fontName?: string;
}

// ── Internal parsed representation (object-anchor form, mirrors the CLI) ──

interface MarkAnchorObj { classIdx: number; x: number; y: number; }
interface RawMarkAnchors {
    marks: Record<number, MarkAnchorObj>;
    bases: Record<number, Record<number, { x: number; y: number }>>;
    mark2mark: {
        mark1Anchors: Record<number, Record<number, { x: number; y: number }>>;
        mark2Classes: Record<number, MarkAnchorObj>;
    };
}
interface RawParsed {
    metrics: {
        unitsPerEm: number; ascent: number; descent: number; capHeight: number;
        stemV: number; bbox: [number, number, number, number];
        defaultWidth: number; numGlyphs: number;
    };
    cmap: Record<number, number>;
    widths: Record<number, number>;
    gsub: Record<number, number>;
    ligatures: Record<number, number[][]>;
    markAnchors: RawMarkAnchors;
    name?: string;
}

// ── TTF binary reader (DataView-based, big-endian) ───────────────────

class TTFReader {
    private readonly view: DataView;
    private readonly bytes: Uint8Array;
    pos = 0;

    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    seek(offset: number): void { this.pos = offset; }
    skip(n: number): void { this.pos += n; }

    readUint8(): number { return this.view.getUint8(this.pos++); }
    readUint16(): number { const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
    readInt16(): number { const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
    readUint32(): number { const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
    readTag(): string {
        let t = '';
        for (let k = 0; k < 4; k++) t += String.fromCharCode(this.bytes[this.pos + k]);
        this.pos += 4;
        return t;
    }
}

type TableDir = Record<string, { offset: number; length: number }>;

// ── Coverage table (shared by GSUB + GPOS) ───────────────────────────

function readCoverageTable(r: TTFReader, absOffset: number): number[] {
    const glyphs: number[] = [];
    r.seek(absOffset);
    const format = r.readUint16();
    if (format === 1) {
        const count = r.readUint16();
        for (let i = 0; i < count; i++) glyphs.push(r.readUint16());
    } else if (format === 2) {
        const rangeCount = r.readUint16();
        for (let i = 0; i < rangeCount; i++) {
            const start = r.readUint16();
            const end = r.readUint16();
            r.skip(2); // startCoverageIndex
            for (let g = start; g <= end; g++) glyphs.push(g);
        }
    }
    return glyphs;
}

// ── GSUB LookupType 1 (SingleSubst) ──────────────────────────────────

function parseGSUBSingle(r: TTFReader, tables: TableDir): Record<number, number> {
    const gsub: Record<number, number> = {};
    if (!tables['GSUB']) return gsub;
    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version
        r.skip(2); // scriptListOffset
        r.skip(2); // featureListOffset
        const lookupListOffset = r.readUint16();

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            r.seek(base + lookupListOffset + lookupOffsets[li]);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const subtableOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());
            if (lookupType !== 1) continue;

            for (const stOffset of subtableOffsets) {
                const stBase = base + lookupListOffset + lookupOffsets[li] + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);
                // NB: the cursor is intentionally left where readCoverageTable
                // ended — this mirrors the reference CLI (tools/build-font-data.cjs)
                // exactly so compileFontData is byte-identical to every bundled
                // font module. Do NOT seek back to stBase + 4.
                if (substFormat === 1) {
                    const delta = r.readInt16();
                    for (const gid of coverageGlyphs) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) gsub[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    const glyphCount = r.readUint16();
                    for (let gi = 0; gi < glyphCount && gi < coverageGlyphs.length; gi++) {
                        const sub = r.readUint16();
                        if (sub > 0) gsub[coverageGlyphs[gi]] = sub;
                    }
                }
            }
        }
    } catch {
        // Non-fatal: GSUB parse failure degrades gracefully (no shaping).
    }
    return gsub;
}

// ── GSUB LookupType 4 (LigatureSubst) ────────────────────────────────

function parseGSUBLigatures(r: TTFReader, tables: TableDir): Record<number, number[][]> {
    const ligatures: Record<number, number[][]> = {};
    if (!tables['GSUB']) return ligatures;
    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4);
        r.skip(2);
        r.skip(2);
        const lookupListOffset = r.readUint16();

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            const lookupBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lookupBase);
            const lookupType = r.readUint16();
            r.skip(2);
            const subtableCount = r.readUint16();
            const subtableOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());
            if (lookupType !== 4) continue;

            for (const stOffset of subtableOffsets) {
                const stBase = lookupBase + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                if (substFormat !== 1) continue;
                const coverageOffset = r.readUint16();
                const ligSetCount = r.readUint16();
                const ligSetOffsets: number[] = [];
                for (let lsi = 0; lsi < ligSetCount; lsi++) ligSetOffsets.push(r.readUint16());
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);

                for (let lsi = 0; lsi < ligSetCount && lsi < coverageGlyphs.length; lsi++) {
                    const firstGid = coverageGlyphs[lsi];
                    const ligSetBase = stBase + ligSetOffsets[lsi];
                    r.seek(ligSetBase);
                    const ligCount = r.readUint16();
                    const ligOffsets: number[] = [];
                    for (let lgi = 0; lgi < ligCount; lgi++) ligOffsets.push(r.readUint16());

                    for (const ligOff of ligOffsets) {
                        r.seek(ligSetBase + ligOff);
                        const ligatureGlyph = r.readUint16();
                        const componentCount = r.readUint16();
                        const components: number[] = [];
                        for (let ci = 0; ci < componentCount - 1; ci++) components.push(r.readUint16());
                        if (!ligatures[firstGid]) ligatures[firstGid] = [];
                        ligatures[firstGid].push([ligatureGlyph, ...components]);
                    }
                }
            }
        }
        for (const gid of Object.keys(ligatures)) {
            ligatures[gid as unknown as number].sort((a, b) => b.length - a.length);
        }
    } catch {
        // Non-fatal.
    }
    return ligatures;
}

// ── GPOS LookupType 4 (MarkToBase) + 6 (MarkToMark) ──────────────────

function parseGPOS(r: TTFReader, tables: TableDir): RawMarkAnchors {
    const result: RawMarkAnchors = { marks: {}, bases: {}, mark2mark: { mark1Anchors: {}, mark2Classes: {} } };
    if (!tables['GPOS']) return result;
    try {
        const base = tables['GPOS'].offset;
        r.seek(base);
        r.skip(4);
        r.skip(2);
        r.skip(2);
        const lookupListOffset = r.readUint16();

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            r.seek(base + lookupListOffset + lookupOffsets[li]);
            const lookupType = r.readUint16();
            r.skip(2);
            const subtableCount = r.readUint16();
            const stOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) stOffsets.push(r.readUint16());
            if (lookupType !== 4 && lookupType !== 6) continue;

            for (const stOff of stOffsets) {
                const stBase = base + lookupListOffset + lookupOffsets[li] + stOff;
                r.seek(stBase);
                r.skip(2); // posFormat
                const mark1CoverageOffset = r.readUint16();
                const mark2CoverageOffset = r.readUint16();
                const markClassCount = r.readUint16();
                const mark1ArrayOffset = r.readUint16();
                const mark2ArrayOffset = r.readUint16();

                const mark1Glyphs = readCoverageTable(r, stBase + mark1CoverageOffset);
                const mark2Glyphs = readCoverageTable(r, stBase + mark2CoverageOffset);

                r.seek(stBase + mark1ArrayOffset);
                const markCount = r.readUint16();
                const mark1Entries: (MarkAnchorObj & { gid: number })[] = [];
                for (let mi = 0; mi < markCount && mi < mark1Glyphs.length; mi++) {
                    const markClass = r.readUint16();
                    const anchorOffset = r.readUint16();
                    const savedPos = r.pos;
                    r.seek(stBase + mark1ArrayOffset + anchorOffset);
                    const anchorFormat = r.readUint16();
                    const ax = anchorFormat >= 1 ? r.readInt16() : 0;
                    const ay = anchorFormat >= 1 ? r.readInt16() : 0;
                    r.pos = savedPos;
                    mark1Entries.push({ gid: mark1Glyphs[mi], classIdx: markClass, x: ax, y: ay });
                }

                r.seek(stBase + mark2ArrayOffset);
                const baseCount = r.readUint16();
                const baseRecords: number[][] = [];
                for (let bi = 0; bi < baseCount; bi++) {
                    const recs: number[] = [];
                    for (let mc = 0; mc < markClassCount; mc++) recs.push(r.readUint16());
                    baseRecords.push(recs);
                }

                if (lookupType === 4) {
                    for (const md of mark1Entries) {
                        result.marks[md.gid] = { classIdx: md.classIdx, x: md.x, y: md.y };
                    }
                    for (let bi = 0; bi < baseCount && bi < mark2Glyphs.length; bi++) {
                        const baseGid = mark2Glyphs[bi];
                        result.bases[baseGid] = {};
                        for (let mc = 0; mc < markClassCount; mc++) {
                            const anchorOff = baseRecords[bi][mc];
                            if (!anchorOff) continue;
                            r.seek(stBase + mark2ArrayOffset + anchorOff);
                            r.skip(2);
                            const bx = r.readInt16();
                            const by = r.readInt16();
                            result.bases[baseGid][mc] = { x: bx, y: by };
                        }
                    }
                } else {
                    for (const md of mark1Entries) {
                        result.mark2mark.mark2Classes[md.gid] = { classIdx: md.classIdx, x: md.x, y: md.y };
                    }
                    for (let bi = 0; bi < baseCount && bi < mark2Glyphs.length; bi++) {
                        const m1Gid = mark2Glyphs[bi];
                        result.mark2mark.mark1Anchors[m1Gid] = {};
                        for (let mc = 0; mc < markClassCount; mc++) {
                            const anchorOff = baseRecords[bi][mc];
                            if (!anchorOff) continue;
                            r.seek(stBase + mark2ArrayOffset + anchorOff);
                            r.skip(2);
                            const mx = r.readInt16();
                            const my = r.readInt16();
                            result.mark2mark.mark1Anchors[m1Gid][mc] = { x: mx, y: my };
                        }
                    }
                }
            }
        }
    } catch {
        // Non-fatal.
    }
    return result;
}

// ── `name` table (best-effort font-name derivation) ──────────────────

function parseName(r: TTFReader, tables: TableDir): string | undefined {
    if (!tables['name']) return undefined;
    try {
        const base = tables['name'].offset;
        r.seek(base);
        r.skip(2); // format
        const count = r.readUint16();
        const stringOffset = r.readUint16();
        let psName: string | undefined;
        let fullName: string | undefined;
        let familyName: string | undefined;
        for (let i = 0; i < count; i++) {
            const platformID = r.readUint16();
            const encodingID = r.readUint16();
            r.skip(2); // languageID
            const nameID = r.readUint16();
            const length = r.readUint16();
            const offset = r.readUint16();
            const savedPos = r.pos;
            // Decode Windows (platform 3) UTF-16BE or Mac (platform 1) ASCII.
            let value = '';
            r.seek(base + stringOffset + offset);
            if (platformID === 3 || (platformID === 0)) {
                for (let k = 0; k < length; k += 2) value += String.fromCharCode(r.readUint16());
            } else {
                for (let k = 0; k < length; k++) value += String.fromCharCode(r.readUint8());
            }
            r.pos = savedPos;
            void encodingID;
            if (nameID === 6) psName = value;
            else if (nameID === 4) fullName = value;
            else if (nameID === 1) familyName = value;
        }
        return psName ?? fullName ?? familyName;
    } catch {
        return undefined;
    }
}

// ── Core TTF parser ──────────────────────────────────────────────────

function parseTTFRaw(bytes: Uint8Array): RawParsed {
    const r = new TTFReader(bytes);

    const sfVersion = r.readUint32();
    if (sfVersion !== 0x00010000 && sfVersion !== 0x74727565 && sfVersion !== 0x4F54544F) {
        throw new Error(`Not a TrueType/OpenType font (sfVersion: 0x${sfVersion.toString(16)})`);
    }
    const numTables = r.readUint16();
    r.skip(6);

    const tables: TableDir = {};
    for (let i = 0; i < numTables; i++) {
        const tag = r.readTag();
        r.skip(4);
        const offset = r.readUint32();
        const length = r.readUint32();
        tables[tag] = { offset, length };
    }

    if (!tables['head']) throw new Error('Missing head table');
    r.seek(tables['head'].offset);
    r.skip(18);
    const unitsPerEm = r.readUint16();
    r.skip(16);
    const xMin = r.readInt16();
    const yMin = r.readInt16();
    const xMax = r.readInt16();
    const yMax = r.readInt16();

    if (!tables['hhea']) throw new Error('Missing hhea table');
    r.seek(tables['hhea'].offset);
    r.skip(4);
    const ascent = r.readInt16();
    const descent = r.readInt16();
    r.skip(26);
    const numberOfHMetrics = r.readUint16();

    if (!tables['maxp']) throw new Error('Missing maxp table');
    r.seek(tables['maxp'].offset);
    r.skip(4);
    const numGlyphs = r.readUint16();

    let capHeight = Math.round(ascent * 0.7);
    let stemV = 80;
    if (tables['OS/2']) {
        r.seek(tables['OS/2'].offset);
        const os2Version = r.readUint16();
        r.seek(tables['OS/2'].offset + 68);
        r.readInt16(); // sTypoAscender
        r.readInt16(); // sTypoDescender
        r.skip(4);
        if (os2Version >= 2 && tables['OS/2'].length >= 90) {
            r.seek(tables['OS/2'].offset + 88);
            capHeight = r.readInt16();
        }
        r.seek(tables['OS/2'].offset + 4);
        const weightClass = r.readUint16();
        stemV = Math.round(weightClass * 0.12);
    }

    if (!tables['hmtx']) throw new Error('Missing hmtx table');
    r.seek(tables['hmtx'].offset);
    const widths: Record<number, number> = {};
    let lastWidth = 0;
    for (let i = 0; i < numberOfHMetrics; i++) {
        const advanceWidth = r.readUint16();
        r.skip(2);
        widths[i] = advanceWidth;
        lastWidth = advanceWidth;
    }
    for (let i = numberOfHMetrics; i < numGlyphs; i++) widths[i] = lastWidth;

    if (!tables['cmap']) throw new Error('Missing cmap table');
    const cmapOffset = tables['cmap'].offset;
    r.seek(cmapOffset);
    r.skip(2);
    const numSubtables = r.readUint16();

    let bestSubtableOffset = -1;
    let bestFormat = 0;
    for (let i = 0; i < numSubtables; i++) {
        const platformID = r.readUint16();
        const encodingID = r.readUint16();
        const subtableOffset = r.readUint32();
        if ((platformID === 3 && (encodingID === 1 || encodingID === 10)) ||
            (platformID === 0 && (encodingID === 3 || encodingID === 4))) {
            const savedPos = r.pos;
            r.seek(cmapOffset + subtableOffset);
            const format = r.readUint16();
            r.pos = savedPos;
            if (format === 12 && bestFormat < 12) {
                bestSubtableOffset = cmapOffset + subtableOffset;
                bestFormat = 12;
            } else if (format === 4 && bestFormat < 4) {
                bestSubtableOffset = cmapOffset + subtableOffset;
                bestFormat = 4;
            }
        }
    }
    if (bestSubtableOffset === -1) throw new Error('No suitable cmap subtable found (need format 4 or 12)');

    const cmap: Record<number, number> = {};
    if (bestFormat === 12) {
        r.seek(bestSubtableOffset);
        r.skip(2); r.skip(2); r.skip(4); r.skip(4);
        const numGroups = r.readUint32();
        for (let i = 0; i < numGroups; i++) {
            const startCharCode = r.readUint32();
            const endCharCode = r.readUint32();
            const startGlyphID = r.readUint32();
            for (let c = startCharCode; c <= endCharCode; c++) {
                const gid = startGlyphID + (c - startCharCode);
                if (gid > 0 && gid < numGlyphs) cmap[c] = gid;
            }
        }
    } else {
        r.seek(bestSubtableOffset);
        r.skip(2); r.skip(2); r.skip(2);
        const segCountX2 = r.readUint16();
        const segCount = segCountX2 / 2;
        r.skip(6);
        const endCodes: number[] = [];
        for (let i = 0; i < segCount; i++) endCodes.push(r.readUint16());
        r.skip(2);
        const startCodes: number[] = [];
        for (let i = 0; i < segCount; i++) startCodes.push(r.readUint16());
        const idDeltas: number[] = [];
        for (let i = 0; i < segCount; i++) idDeltas.push(r.readInt16());
        const idRangeOffsetPos = r.pos;
        const idRangeOffsets: number[] = [];
        for (let i = 0; i < segCount; i++) idRangeOffsets.push(r.readUint16());

        for (let i = 0; i < segCount; i++) {
            if (startCodes[i] === 0xFFFF) break;
            for (let c = startCodes[i]; c <= endCodes[i]; c++) {
                let gid: number;
                if (idRangeOffsets[i] === 0) {
                    gid = (c + idDeltas[i]) & 0xFFFF;
                } else {
                    const offset = idRangeOffsetPos + i * 2 + idRangeOffsets[i] + (c - startCodes[i]) * 2;
                    r.seek(offset);
                    gid = r.readUint16();
                    if (gid !== 0) gid = (gid + idDeltas[i]) & 0xFFFF;
                }
                if (gid > 0 && gid < numGlyphs) cmap[c] = gid;
            }
        }
    }

    const spaceGid = cmap[0x20] || 0;
    const defaultWidth = widths[spaceGid] || widths[0] || 600;

    const gsub = parseGSUBSingle(r, tables);
    const ligatures = parseGSUBLigatures(r, tables);
    const markAnchors = parseGPOS(r, tables);
    const name = parseName(r, tables);

    return {
        metrics: {
            unitsPerEm, ascent, descent, capHeight, stemV,
            bbox: [xMin, yMin, xMax, yMax], defaultWidth, numGlyphs,
        },
        cmap, widths, gsub, ligatures, markAnchors, name,
    };
}

// ── Base64 encoder (cross-platform, no Buffer) ───────────────────────

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
    let out = '';
    const len = bytes.length;
    let i = 0;
    for (; i + 2 < len; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] +
               B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63];
    }
    const rem = len - i;
    if (rem === 1) {
        const n = bytes[i] << 16;
        out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] +
               B64_ALPHABET[(n >> 6) & 63] + '=';
    }
    return out;
}

// ── PDF /W array builder ─────────────────────────────────────────────

function buildPDFWidthArray(widths: Record<number, number>, numGlyphs: number, defaultWidth: number): string {
    const allWidths: number[] = [];
    for (let i = 0; i < numGlyphs; i++) allWidths.push(widths[i] !== undefined ? widths[i] : defaultWidth);
    const parts: string[] = [];
    let i = 0;
    while (i < numGlyphs) {
        if (allWidths[i] === defaultWidth) { i++; continue; }
        let j = i;
        while (j < numGlyphs && allWidths[j] !== defaultWidth) j++;
        const ws = allWidths.slice(i, j).join(' ');
        parts.push(`${i} [${ws}]`);
        i = j;
    }
    return parts.join(' ');
}

// ── Module source generator (ESM byte-identical to the CLI) ──────────

function sanitizeFontName(name: string): string {
    return name.replace(/[^A-Za-z0-9-]/g, '');
}

function generateEsmModule(fontName: string, parsed: RawParsed, ttfBase64: string): string {
    const { metrics, cmap, widths, gsub, ligatures, markAnchors } = parsed;

    const cmapEntries = Object.entries(cmap).map(([k, v]) => `${k}:${v}`).join(',');
    const defaultW = metrics.defaultWidth;
    const widthEntries = Object.entries(widths).filter(([, w]) => w !== defaultW).map(([k, v]) => `${k}:${v}`).join(',');
    const gsubEntries = Object.entries(gsub || {}).map(([k, v]) => `${k}:${v}`).join(',');
    const ligaturesEntries = Object.entries(ligatures || {})
        .map(([gid, ligs]) => `${gid}:[${ligs.map((lig) => `[${lig.join(',')}]`).join(',')}]`)
        .join(',');
    const marksEntries = Object.entries(markAnchors.marks || {})
        .map(([gid, a]) => `${gid}:[${a.classIdx},${a.x},${a.y}]`).join(',');
    const basesEntries = Object.entries(markAnchors.bases || {})
        .map(([gid, anchors]) => `${gid}:{${Object.entries(anchors).map(([mc, a]) => `${mc}:[${a.x},${a.y}]`).join(',')}}`)
        .join(',');
    const m2m = markAnchors.mark2mark || { mark1Anchors: {}, mark2Classes: {} };
    const m2mMark1Entries = Object.entries(m2m.mark1Anchors)
        .map(([gid, anchors]) => `${gid}:{${Object.entries(anchors).map(([mc, a]) => `${mc}:[${a.x},${a.y}]`).join(',')}}`)
        .join(',');
    const m2mMark2Entries = Object.entries(m2m.mark2Classes)
        .map(([gid, a]) => `${gid}:[${a.classIdx},${a.x},${a.y}]`).join(',');
    const wArray = buildPDFWidthArray(widths, metrics.numGlyphs, defaultW);

    return `/**
 * PRE-BUILT FONT DATA — ${fontName}
 * ===================================
 * Generated by: scripts/build-font-data.cjs
 * Source: ${fontName}.ttf
 * License: SIL Open Font License 1.1
 *
 * DO NOT EDIT — Regenerate with:
 *   node scripts/build-font-data.cjs assets/fonts/${fontName}.ttf assets/fonts/${fontName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-data.js
 */

// Font metrics
export const metrics = ${JSON.stringify(metrics)};

// Font name for PDF /BaseFont
export const fontName = '${fontName.replace(/[^A-Za-z0-9-]/g, '')}';

// Unicode codepoint → Glyph ID mapping (sparse object, ~O(1) lookup)
export const cmap = {${cmapEntries}};

// Glyph ID → Advance Width (only non-default widths; default = ${defaultW})
export const defaultWidth = ${defaultW};
export const widths = {${widthEntries}};

// GSUB SingleSubst: fromGid → substituteGid
// Used by the Thai mini-shaper to select below-clash variants of consonants.
export const gsub = {${gsubEntries}};

// GSUB LigatureSubst: firstGid → [[resultGid, comp1, comp2, ...], ...]
// Used by Indic shapers for conjunct formation (C + Halant + C → ligature).
// Entries sorted longest-first for greedy matching.
export const ligatures = {${ligaturesEntries}};

// GPOS MarkToBase anchors — used by the Thai mini-shaper for mark positioning.
// marks[gid] = [classIdx, anchorX, anchorY]  (design units)
// bases[gid] = { classIdx: [anchorX, anchorY] }
export const markAnchors = {
  marks: {${marksEntries}},
  bases: {${basesEntries}}
};

// GPOS MarkToMark anchors — used for Thai vowel+tone stacking.
// mark1Anchors[mark1Gid] = { classIdx: [anchorX, anchorY] }  (base mark, e.g. above vowel)
// mark2Classes[mark2Gid] = [classIdx, anchorX, anchorY]       (combining mark, e.g. tone)
export const mark2mark = {
  mark1Anchors: {${m2mMark1Entries}},
  mark2Classes: {${m2mMark2Entries}}
};

// PDF /W array string (pre-formatted for CIDFont object)
export const pdfWidthArray = '${wArray}';

// Raw TTF binary as base64 (for PDF FontFile2 embedding)
export const ttfBase64 = '${ttfBase64}';

// Utility: get glyph width
export function getGlyphWidth(glyphId) {
    return widths[glyphId] !== undefined ? widths[glyphId] : ${defaultW};
}

// Utility: get glyph ID for unicode code point
export function getGlyphId(codePoint) {
    return cmap[codePoint] || 0;
}
`;
}

function generateCjsModule(fontName: string, parsed: RawParsed, ttfBase64: string): string {
    // Reuse the ESM body, then rewrite the export bindings into CommonJS.
    const esm = generateEsmModule(fontName, parsed, ttfBase64);
    const names = [
        'metrics', 'fontName', 'cmap', 'defaultWidth', 'widths', 'gsub',
        'ligatures', 'markAnchors', 'mark2mark', 'pdfWidthArray', 'ttfBase64',
        'getGlyphWidth', 'getGlyphId',
    ];
    const body = esm
        .replace(/export const /g, 'const ')
        .replace(/export function /g, 'function ');
    return `${body}\nmodule.exports = { ${names.join(', ')} };\n`;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Parse a TrueType/OpenType font from an in-memory byte buffer into a
 * registerable {@link FontDataObject} whose shape matches the runtime exports
 * of a bundled `*-data.js` module.
 *
 * @param buffer - Raw `.ttf` / `.otf` bytes.
 * @param opts - Optional overrides (`fontName`).
 * @throws If the buffer is not a valid TrueType/OpenType font or lacks a usable
 *   `cmap` subtable (format 4 or 12).
 */
export function parseFontData(buffer: Uint8Array, opts: ParseFontDataOptions = {}): FontDataObject {
    const parsed = parseTTFRaw(buffer);
    const fontName = sanitizeFontName(opts.fontName ?? parsed.name ?? 'CustomFont') || 'CustomFont';
    const ttfBase64 = encodeBase64(buffer);

    // Convert object-anchor form → array form (runtime module shape).
    const marks: Record<number, [number, number, number]> = {};
    for (const [gid, a] of Object.entries(parsed.markAnchors.marks)) {
        marks[gid as unknown as number] = [a.classIdx, a.x, a.y];
    }
    const bases: Record<number, Record<number, [number, number]>> = {};
    for (const [gid, anchors] of Object.entries(parsed.markAnchors.bases)) {
        const inner: Record<number, [number, number]> = {};
        for (const [mc, a] of Object.entries(anchors)) inner[mc as unknown as number] = [a.x, a.y];
        bases[gid as unknown as number] = inner;
    }
    const mark1Anchors: Record<number, Record<number, [number, number]>> = {};
    for (const [gid, anchors] of Object.entries(parsed.markAnchors.mark2mark.mark1Anchors)) {
        const inner: Record<number, [number, number]> = {};
        for (const [mc, a] of Object.entries(anchors)) inner[mc as unknown as number] = [a.x, a.y];
        mark1Anchors[gid as unknown as number] = inner;
    }
    const mark2Classes: Record<number, [number, number, number]> = {};
    for (const [gid, a] of Object.entries(parsed.markAnchors.mark2mark.mark2Classes)) {
        mark2Classes[gid as unknown as number] = [a.classIdx, a.x, a.y];
    }

    // Filter widths to non-default only (matches module runtime shape).
    const filteredWidths: Record<number, number> = {};
    for (const [gid, w] of Object.entries(parsed.widths)) {
        if (w !== parsed.metrics.defaultWidth) filteredWidths[gid as unknown as number] = w;
    }

    return {
        metrics: parsed.metrics,
        fontName,
        cmap: parsed.cmap,
        defaultWidth: parsed.metrics.defaultWidth,
        widths: filteredWidths,
        gsub: parsed.gsub,
        ligatures: parsed.ligatures,
        markAnchors: { marks, bases },
        mark2mark: { mark1Anchors, mark2Classes },
        pdfWidthArray: buildPDFWidthArray(parsed.widths, parsed.metrics.numGlyphs, parsed.metrics.defaultWidth),
        ttfBase64,
    };
}

/**
 * Compile a TrueType/OpenType font from an in-memory byte buffer into an
 * ES-module (default) or CommonJS-module source string, identical to what the
 * `pdfnative-build-font` CLI writes to disk (ESM output is byte-identical when
 * the same `fontName` is supplied).
 *
 * @param buffer - Raw `.ttf` / `.otf` bytes.
 * @param opts - Optional `fontName` and `format` (`'esm'` | `'cjs'`).
 * @returns The module source code as a string, ready to write to a `.js` file.
 * @throws If the buffer is not a valid TrueType/OpenType font.
 */
export function compileFontData(buffer: Uint8Array, opts: CompileFontDataOptions = {}): string {
    const parsed = parseTTFRaw(buffer);
    // Pass the raw name through: the generator sanitises only the `export const
    // fontName` value, mirroring the CLI's byte-for-byte output.
    const fontName = opts.fontName ?? parsed.name ?? 'CustomFont';
    const ttfBase64 = encodeBase64(buffer);
    return opts.format === 'cjs'
        ? generateCjsModule(fontName, parsed, ttfBase64)
        : generateEsmModule(fontName, parsed, ttfBase64);
}
