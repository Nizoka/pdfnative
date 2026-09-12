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
    /**
     * GSUB per-feature single substitutions: `{ tag: { fromGid: toGid } }`,
     * or `null` when the font declares none of the supported tags.
     * @since 1.8.0
     */
    readonly features: Record<string, Record<number, number>> | null;
    /**
     * GPOS pair kerning in design units, or `null` when the font carries no
     * pair positioning. `p` holds explicit glyph pairs, `c` the class-based
     * subtables kept in their compact OpenType form.
     * @since 1.8.0
     */
    readonly kern: RawKern | null;
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
interface RawKernClass {
    l: Record<number, number>;
    r: Record<number, number>;
    n: number;
    m: Record<number, number>;
}
interface RawKern {
    p: Record<number, Record<number, number>> | null;
    c: RawKernClass[] | null;
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
    features: Record<string, Record<number, number>> | null;
    kern: RawKern | null;
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

/**
 * Tags a font declares but a renderer must not turn on by itself: stylistic
 * sets, character variants, figure styles, small caps, swashes. They are the
 * user's choice, exposed through `features`, and merging them into the
 * default table makes every document render as if the user had ticked every
 * box. Noto Sans Thai puts 27 substitutions behind `aalt` alone.
 */
function isDiscretionaryFeature(tag: string): boolean {
    return /^(ss\d\d|cv\d\d)$/.test(tag)
        || [
            'aalt', 'salt', 'nalt', 'rand', 'swsh', 'cswh', 'titl', 'hist',
            'ornm', 'unic', 'smcp', 'c2sc', 'pcap', 'c2pc', 'sups', 'subs',
            'sinf', 'numr', 'dnom', 'frac', 'afrc', 'zero', 'ordn', 'case',
            'tnum', 'pnum', 'lnum', 'onum',
        ].includes(tag);
}

/**
 * Extract the SingleSubst mappings a shaper may apply by default.
 *
 * Mirrors `parseTTFGSUB` in the reference CLI exactly — the two generators
 * must emit byte-identical modules. See that function for why lookups behind
 * a discretionary feature are dropped and why LookupType 7 must be resolved.
 */
function parseGSUBSingle(r: TTFReader, tables: TableDir): Record<number, number> {
    const gsub: Record<number, number> = {};
    if (!tables['GSUB']) return gsub;
    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version
        r.skip(2); // scriptListOffset
        const featureListOffset = r.readUint16();
        const lookupListOffset = r.readUint16();

        r.seek(base + featureListOffset);
        const featureCount = r.readUint16();
        const wantedBy = new Map<number, { default: boolean; discretionary: boolean }>();
        for (let fi = 0; fi < featureCount; fi++) {
            const tag = r.readTag();
            const featureOffset = r.readUint16();
            const saved = r.pos;
            r.seek(base + featureListOffset + featureOffset);
            r.skip(2); // featureParamsOffset
            const lookupCount = r.readUint16();
            const discretionary = isDiscretionaryFeature(tag);
            for (let li = 0; li < lookupCount; li++) {
                const idx = r.readUint16();
                const seen = wantedBy.get(idx) ?? { default: false, discretionary: false };
                if (discretionary) seen.discretionary = true; else seen.default = true;
                wantedBy.set(idx, seen);
            }
            r.pos = saved;
        }

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            const seen = wantedBy.get(li);
            if (seen && seen.discretionary && !seen.default) continue;

            const lookupBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lookupBase);
            let lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const rawOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) rawOffsets.push(r.readUint16());

            let subtables = rawOffsets.map(o => lookupBase + o);
            if (lookupType === 7) {
                const resolved: number[] = [];
                let innerType = 0;
                for (const abs of subtables) {
                    r.seek(abs);
                    r.skip(2); // substFormat (1)
                    innerType = r.readUint16();
                    resolved.push(abs + r.readUint32());
                }
                lookupType = innerType;
                subtables = resolved;
            }
            if (lookupType !== 1) continue;

            for (const stBase of subtables) {
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const coverageGlyphs = readCoverageTable(r, stBase + coverageOffset);

                if (substFormat === 1) {
                    r.seek(stBase + 4);
                    const delta = r.readInt16();
                    for (const gid of coverageGlyphs) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) gsub[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    r.seek(stBase + 4);
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

// ── Glyph outline presence (loca) ────────────────────────────────────

/**
 * Whether a code point is *meant* to have no outline, and so must stay in a
 * font's cmap even though its glyph is empty.
 *
 * Covers controls and the whole space family, zero-width joiners, separators,
 * the bidi isolates and marks (including U+061C ARABIC LETTER MARK), the
 * Hangul and Khmer fillers, variation selectors and interlinear annotation.
 *
 * Exported because the rule must not be restated anywhere: a second copy that
 * drifts silently re-creates the bug this exists to prevent. The reference
 * CLI `tools/build-font-data.cjs` keeps its own copy only because it is
 * CommonJS and cannot import this module; the two are held together by the
 * byte-identity check between the generators.
 *
 * @since 1.8.0
 */
export function isIntentionallyBlank(cp: number): boolean {
    return cp <= 0x20
        || cp === 0xA0
        || cp === 0x034F
        || cp === 0x061C
        || cp === 0x115F || cp === 0x1160
        || cp === 0x17B4 || cp === 0x17B5
        || cp === 0x180E
        || (cp >= 0x2000 && cp <= 0x200F)
        || (cp >= 0x2028 && cp <= 0x202F)
        || (cp >= 0x205F && cp <= 0x206F)
        || cp === 0x3000
        || cp === 0x3164
        || (cp >= 0xFE00 && cp <= 0xFE0F)
        || (cp >= 0xFFF9 && cp <= 0xFFFB)
        || cp === 0xFEFF;
}

/**
 * Flag, per glyph id, whether the glyph has an outline.
 *
 * A subsetted font routinely keeps its full glyph count and its full cmap
 * while emptying the outlines it dropped. Trusting the cmap alone then makes
 * the module advertise code points the font cannot draw, which renders blank
 * instead of falling through to another registered font.
 *
 * Returns `null` for CFF fonts, where this cannot be determined.
 */
function readOutlineFlags(r: TTFReader, tables: TableDir, numGlyphs: number): Uint8Array | null {
    if (!tables['loca'] || !tables['glyf'] || !tables['head']) return null;
    try {
        r.seek(tables['head'].offset + 50);
        const indexToLocFormat = r.readInt16();
        const loca = tables['loca'].offset;
        const flags = new Uint8Array(numGlyphs);
        for (let g = 0; g < numGlyphs; g++) {
            let a: number, b: number;
            if (indexToLocFormat === 0) {
                r.seek(loca + g * 2); a = r.readUint16() * 2;
                r.seek(loca + (g + 1) * 2); b = r.readUint16() * 2;
            } else {
                r.seek(loca + g * 4); a = r.readUint32();
                r.seek(loca + (g + 1) * 4); b = r.readUint32();
            }
            if (b > a) flags[g] = 1;
        }
        return flags;
    } catch {
        return null;
    }
}

// ── GSUB per-feature SingleSubst (LookupType 1) ──────────────────────

/**
 * Feature tags extracted per tag for declarative styling.
 *
 * Must stay identical to `FEATURE_TAGS` in `tools/build-font-data.cjs`, the
 * reference CLI — the two generators emit byte-identical modules, and a
 * divergence here would silently fork the bundled font data.
 */
const FEATURE_TAGS = [
    'tnum', 'pnum', 'lnum', 'onum', 'zero', 'ordn',
    'sups', 'subs', 'smcp', 'c2sc', 'case',
];

/**
 * Parse GSUB and return `{ tag: { fromGid: toGid } }` for {@link FEATURE_TAGS}.
 *
 * Unlike {@link parseGSUBSingle}, which merges every SingleSubst lookup in the
 * font because the Indic and Thai shapers want them all, this keeps each
 * feature separate so a caller can request tabular figures without also
 * getting every contextual alternate in the face.
 *
 * Returns `null` when the font declares none of them.
 */
function parseGSUBFeatures(r: TTFReader, tables: TableDir): Record<string, Record<number, number>> | null {
    if (!tables['GSUB']) return null;
    const wanted = new Set(FEATURE_TAGS);

    try {
        const base = tables['GSUB'].offset;
        r.seek(base);
        r.skip(4); // version
        r.readUint16(); // scriptListOffset
        const featureListOffset = r.readUint16();
        const lookupListOffset = r.readUint16();

        r.seek(base + featureListOffset);
        const featureCount = r.readUint16();
        const lookupsByTag = new Map<string, Set<number>>();
        for (let fi = 0; fi < featureCount; fi++) {
            const tag = r.readTag();
            const featureOffset = r.readUint16();
            if (!wanted.has(tag)) continue;
            const saved = r.pos;
            r.seek(base + featureListOffset + featureOffset);
            r.skip(2); // featureParamsOffset
            const lookupCount = r.readUint16();
            const list = lookupsByTag.get(tag) ?? new Set<number>();
            for (let li = 0; li < lookupCount; li++) list.add(r.readUint16());
            lookupsByTag.set(tag, list);
            r.pos = saved;
        }
        if (lookupsByTag.size === 0) return null;

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        const collect = (lookupIndex: number, target: Record<number, number>): void => {
            if (lookupIndex >= lookupCount) return;
            const lkBase = base + lookupListOffset + lookupOffsets[lookupIndex];
            r.seek(lkBase);
            const lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const subtableOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) subtableOffsets.push(r.readUint16());
            if (lookupType !== 1) return;

            for (const stOffset of subtableOffsets) {
                const stBase = lkBase + stOffset;
                r.seek(stBase);
                const substFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const covered = readCoverageTable(r, stBase + coverageOffset);

                if (substFormat === 1) {
                    r.seek(stBase + 4);
                    const delta = r.readInt16();
                    for (const gid of covered) {
                        const sub = (gid + delta) & 0xFFFF;
                        if (sub > 0) target[gid] = sub;
                    }
                } else if (substFormat === 2) {
                    r.seek(stBase + 4);
                    const glyphCount = r.readUint16();
                    for (let gi = 0; gi < glyphCount && gi < covered.length; gi++) {
                        const sub = r.readUint16();
                        if (sub > 0) target[covered[gi]] = sub;
                    }
                }
            }
        };

        const out: Record<string, Record<number, number>> = {};
        for (const [tag, indices] of lookupsByTag) {
            const map: Record<number, number> = {};
            for (const idx of indices) collect(idx, map);
            if (Object.keys(map).length > 0) out[tag] = map;
        }
        return Object.keys(out).length > 0 ? out : null;
    } catch {
        return null;
    }
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

// ── GPOS LookupType 2 (PairPos / kerning) ────────────────────────────

/** Read a ClassDef into `{ gid: classIndex }`; absent glyphs are class 0. */
function readClassDef(r: TTFReader, absOffset: number): Record<number, number> {
    const classes: Record<number, number> = {};
    r.seek(absOffset);
    const format = r.readUint16();
    if (format === 1) {
        const startGid = r.readUint16();
        const count = r.readUint16();
        for (let i = 0; i < count; i++) {
            const c = r.readUint16();
            if (c !== 0) classes[startGid + i] = c;
        }
    } else if (format === 2) {
        const rangeCount = r.readUint16();
        for (let i = 0; i < rangeCount; i++) {
            const start = r.readUint16();
            const end = r.readUint16();
            const c = r.readUint16();
            if (c !== 0) for (let g = start; g <= end; g++) classes[g] = c;
        }
    }
    return classes;
}

/** Bytes a ValueRecord occupies for a given valueFormat mask. */
function valueRecordSize(valueFormat: number): number {
    let n = 0;
    for (let bit = 0; bit < 8; bit++) if (valueFormat & (1 << bit)) n += 2;
    return n;
}

/** Read a ValueRecord, returning its XAdvance and consuming the rest. */
function readXAdvance(r: TTFReader, valueFormat: number): number {
    let x = 0;
    if (valueFormat & 0x0001) r.skip(2);
    if (valueFormat & 0x0002) r.skip(2);
    if (valueFormat & 0x0004) x = r.readInt16();
    if (valueFormat & 0x0008) r.skip(2);
    if (valueFormat & 0x0010) r.skip(2);
    if (valueFormat & 0x0020) r.skip(2);
    if (valueFormat & 0x0040) r.skip(2);
    if (valueFormat & 0x0080) r.skip(2);
    return x;
}

/**
 * Parse GPOS LookupType 2 into `{ leftGid: { rightGid: adjust } }`, design
 * units. Must mirror `parseTTFGPOSKerning` in `tools/build-font-data.cjs`.
 */
function parseGPOSKerning(r: TTFReader, tables: TableDir): RawKern | null {
    if (!tables['GPOS']) return null;
    const pairMap: Record<number, Record<number, number>> = {};
    const classSubtables: RawKernClass[] = [];
    let pairs = 0;

    const add = (left: number, right: number, adjust: number): void => {
        if (adjust === 0) return;
        let row = pairMap[left];
        if (row === undefined) { row = {}; pairMap[left] = row; }
        if (row[right] === undefined) pairs++;
        row[right] = adjust;
    };

    try {
        const base = tables['GPOS'].offset;
        r.seek(base);
        r.skip(4);
        r.skip(2); // scriptListOffset
        r.skip(2); // featureListOffset
        const lookupListOffset = r.readUint16();

        r.seek(base + lookupListOffset);
        const lookupCount = r.readUint16();
        const lookupOffsets: number[] = [];
        for (let i = 0; i < lookupCount; i++) lookupOffsets.push(r.readUint16());

        for (let li = 0; li < lookupCount; li++) {
            const lkBase = base + lookupListOffset + lookupOffsets[li];
            r.seek(lkBase);
            let lookupType = r.readUint16();
            r.skip(2); // lookupFlag
            const subtableCount = r.readUint16();
            const rawOffsets: number[] = [];
            for (let si = 0; si < subtableCount; si++) rawOffsets.push(r.readUint16());

            // LookupType 9 (Extension Positioning) wraps the real subtable.
            let stAbs = rawOffsets.map(o => lkBase + o);
            if (lookupType === 9) {
                const resolved: number[] = [];
                let innerType = 0;
                for (const abs of stAbs) {
                    r.seek(abs);
                    r.skip(2);
                    innerType = r.readUint16();
                    resolved.push(abs + r.readUint32());
                }
                lookupType = innerType;
                stAbs = resolved;
            }
            if (lookupType !== 2) continue;

            for (const stBase of stAbs) {
                r.seek(stBase);
                const posFormat = r.readUint16();
                const coverageOffset = r.readUint16();
                const valueFormat1 = r.readUint16();
                const valueFormat2 = r.readUint16();
                const covered = readCoverageTable(r, stBase + coverageOffset);

                if (posFormat === 1) {
                    r.seek(stBase + 8);
                    const pairSetCount = r.readUint16();
                    const pairSetOffsets: number[] = [];
                    for (let i = 0; i < pairSetCount; i++) pairSetOffsets.push(r.readUint16());

                    for (let i = 0; i < pairSetCount && i < covered.length; i++) {
                        r.seek(stBase + pairSetOffsets[i]);
                        const pairValueCount = r.readUint16();
                        for (let p = 0; p < pairValueCount; p++) {
                            const second = r.readUint16();
                            const adjust = readXAdvance(r, valueFormat1);
                            r.skip(valueRecordSize(valueFormat2));
                            add(covered[i], second, adjust);
                        }
                    }
                } else if (posFormat === 2) {
                    r.seek(stBase + 8);
                    const classDef1Offset = r.readUint16();
                    const classDef2Offset = r.readUint16();
                    const class1Count = r.readUint16();
                    const class2Count = r.readUint16();
                    const recordsBase = r.pos;

                    const cd1 = readClassDef(r, stBase + classDef1Offset);
                    const cd2 = readClassDef(r, stBase + classDef2Offset);

                    const liveClass1 = new Set<number>();
                    for (const g of covered) {
                        const c1 = cd1[g] ?? 0;
                        if (c1 < class1Count) liveClass1.add(c1);
                    }
                    const liveClass2 = new Set(Object.values(cd2).filter(c => c < class2Count));

                    const recSize = valueRecordSize(valueFormat1) + valueRecordSize(valueFormat2);
                    const matrix: Record<number, number> = {};
                    let cells = 0;
                    for (const c1 of liveClass1) {
                        for (const c2 of liveClass2) {
                            r.seek(recordsBase + (c1 * class2Count + c2) * recSize);
                            const adjust = readXAdvance(r, valueFormat1);
                            if (adjust === 0) continue;
                            matrix[c1 * class2Count + c2] = adjust;
                            cells++;
                        }
                    }
                    if (cells === 0) continue;

                    const usedC1 = new Set<number>();
                    const usedC2 = new Set<number>();
                    for (const key of Object.keys(matrix)) {
                        const k = Number(key);
                        usedC1.add(Math.floor(k / class2Count));
                        usedC2.add(k % class2Count);
                    }
                    const left: Record<number, number> = {};
                    for (const gid of covered) {
                        const c1 = cd1[gid] ?? 0;
                        if (usedC1.has(c1)) left[gid] = c1;
                    }
                    // Class 0 is the ClassDef default, so glyphs in it are
                    // left out and the runtime falls back to 0. Spelling them
                    // out would list most of the font for no information.
                    const right: Record<number, number> = {};
                    for (const [gidStr, c2] of Object.entries(cd2)) {
                        if (c2 !== 0 && usedC2.has(c2)) right[Number(gidStr)] = c2;
                    }
                    classSubtables.push({ l: left, r: right, n: class2Count, m: matrix });
                    pairs += cells;
                }
            }
        }
    } catch {
        return null;
    }
    if (pairs === 0) return null;
    return {
        p: Object.keys(pairMap).length > 0 ? pairMap : null,
        c: classSubtables.length > 0 ? classSubtables : null,
    };
}

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

    // Outline presence, so a subsetted font cannot advertise glyphs whose
    // outlines it has emptied (see readOutlineFlags).
    const outlines = readOutlineFlags(r, tables, numGlyphs);
    const keepGlyph = (cp: number, gid: number): boolean =>
        outlines === null || outlines[gid] === 1 || isIntentionallyBlank(cp);

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
                if (gid > 0 && gid < numGlyphs && keepGlyph(c, gid)) cmap[c] = gid;
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
                if (gid > 0 && gid < numGlyphs && keepGlyph(c, gid)) cmap[c] = gid;
            }
        }
    }

    const spaceGid = cmap[0x20] || 0;
    const defaultWidth = widths[spaceGid] || widths[0] || 600;

    const gsub = parseGSUBSingle(r, tables);
    const ligatures = parseGSUBLigatures(r, tables);
    const markAnchors = parseGPOS(r, tables);
    const features = parseGSUBFeatures(r, tables);
    const kern = parseGPOSKerning(r, tables);
    const name = parseName(r, tables);

    return {
        metrics: {
            unitsPerEm, ascent, descent, capHeight, stemV,
            bbox: [xMin, yMin, xMax, yMax], defaultWidth, numGlyphs,
        },
        cmap, widths, gsub, ligatures, features, kern, markAnchors, name,
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
    const { metrics, cmap, widths, gsub, ligatures, features, kern, markAnchors } = parsed;

    const cmapEntries = Object.entries(cmap).map(([k, v]) => `${k}:${v}`).join(',');
    const defaultW = metrics.defaultWidth;
    const widthEntries = Object.entries(widths).filter(([, w]) => w !== defaultW).map(([k, v]) => `${k}:${v}`).join(',');
    const gsubEntries = Object.entries(gsub || {}).map(([k, v]) => `${k}:${v}`).join(',');
    // Per-feature single substitutions: { tag: { fromGid: toGid } }. Must
    // serialise exactly as the reference CLI does — the two generators emit
    // byte-identical modules.
    const featuresEntries = Object.entries(features || {})
        .map(([tag, map]) => `${JSON.stringify(tag)}:{${Object.entries(map).map(([k, v]) => `${k}:${v}`).join(',')}}`)
        .join(',');

    // Compact kerning, mirroring the OpenType shape (see parseGPOSKerning).
    const numMap = (o: Record<number, number>): string =>
        `{${Object.entries(o).map(([k, v]) => `${k}:${v}`).join(',')}}`;
    const kernLiteral = kern === null ? 'null' : (() => {
        const p = kern.p === null ? 'null'
            : `{${Object.entries(kern.p).map(([l, row]) => `${l}:${numMap(row)}`).join(',')}}`;
        const c = kern.c === null ? 'null'
            : `[${kern.c.map(s => `{l:${numMap(s.l)},r:${numMap(s.r)},n:${s.n},m:${numMap(s.m)}}`).join(',')}]`;
        return `{p:${p},c:${c}}`;
    })();

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

// GSUB per-feature single substitutions (v1.8.0) — { tag: { fromGid: toGid } }.
// Kept apart from the merged gsub table above, which unions every SingleSubst
// lookup in the font, so a caller can ask for tabular figures alone.
export const features = ${features ? `{${featuresEntries}}` : 'null'};

// GPOS PairPos kerning (v1.8.0), design units, negative pulls a pair together.
//   p = format-1 glyph pairs        { leftGid: { rightGid: adjust } }
//   c = format-2 class subtables    [{ l, r, n, m }] with a sparse matrix
//       keyed by (class1 * n + class2)
// The class form is kept rather than expanded: expanding Noto Sans produced
// 71 094 pairs and 594 KB, paid at parse time by every consumer.
export const kern = ${kernLiteral};

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
        features: parsed.features,
        kern: parsed.kern,
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
