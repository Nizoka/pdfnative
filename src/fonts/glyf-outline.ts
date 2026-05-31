/**
 * pdfnative — TrueType `glyf` Outline Extractor
 * ==============================================
 * Pure-JS reader that turns a TrueType glyph outline into ordered contours
 * of quadratic on/off-curve points. Zero external dependency.
 *
 * Used by the colour-glyph renderer (COLR/CPAL) to fill a base glyph's
 * outline as a native PDF path. Handles both simple and composite glyphs
 * (the latter via recursive 2×2 + translate component transforms).
 *
 * References:
 *   - ISO/IEC 14496-22 (OpenType) §5.3.3 `glyf`
 *   - Apple TrueType Reference Manual — Glyph data format
 */

/** A single outline point in font units. */
export interface OutlinePoint {
    readonly x: number;
    readonly y: number;
    /** True for on-curve points; false for quadratic control (off-curve). */
    readonly onCurve: boolean;
}

/** A closed contour: an ordered ring of on/off-curve points. */
export type Contour = OutlinePoint[];

/** A parsed TrueType font exposing just enough to read glyph outlines. */
export interface GlyfFont {
    readonly view: DataView;
    readonly glyfOffset: number;
    readonly locaOffsets: number[];
    readonly unitsPerEm: number;
}

interface TableRec {
    offset: number;
    length: number;
}

function readTableDirectory(view: DataView): Record<string, TableRec> {
    const numTables = view.getUint16(4);
    const tables: Record<string, TableRec> = {};
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

/**
 * Parse the table directory, `head`, `maxp` and `loca` so that subsequent
 * {@link extractGlyphContours} calls are O(1) lookups.
 *
 * @param bytes - Raw TrueType/OpenType (glyf-flavoured) font bytes.
 * @returns A {@link GlyfFont}, or `null` if the font has no `glyf` outlines
 *          (e.g. a CFF font) or is structurally invalid.
 */
export function parseGlyfFont(bytes: Uint8Array): GlyfFont | null {
    if (bytes.length < 12) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tables = readTableDirectory(view);
    const head = tables['head'];
    const maxp = tables['maxp'];
    const loca = tables['loca'];
    const glyf = tables['glyf'];
    if (!head || !maxp || !loca || !glyf) return null;

    const unitsPerEm = view.getUint16(head.offset + 18) || 1000;
    const locaFormat = view.getInt16(head.offset + 50);
    const numGlyphs = view.getUint16(maxp.offset + 4);

    const locaOffsets: number[] = new Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) {
        locaOffsets[i] = locaFormat === 0
            ? view.getUint16(loca.offset + i * 2) * 2
            : view.getUint32(loca.offset + i * 4);
    }

    return { view, glyfOffset: glyf.offset, locaOffsets, unitsPerEm };
}

/** Apply a 2×2 + translate transform to a point. */
function transformPoint(p: OutlinePoint, a: number, b: number, c: number, d: number, e: number, f: number): OutlinePoint {
    return {
        x: a * p.x + c * p.y + e,
        y: b * p.x + d * p.y + f,
        onCurve: p.onCurve,
    };
}

/** F2Dot14 fixed-point reader (16-bit, 2 integer + 14 fraction bits). */
function readF2Dot14(view: DataView, pos: number): number {
    return view.getInt16(pos) / 16384;
}

/**
 * Extract the contours of a single glyph in font units. Composite glyphs are
 * flattened by recursively transforming their components.
 *
 * @param font  - Parsed {@link GlyfFont}.
 * @param gid   - Glyph id.
 * @param depth - Internal recursion guard for composite glyphs.
 * @returns Array of contours (empty for whitespace / empty glyphs).
 */
export function extractGlyphContours(font: GlyfFont, gid: number, depth = 0): Contour[] {
    if (depth > 8) return []; // composite recursion guard
    const { view, glyfOffset, locaOffsets } = font;
    if (gid < 0 || gid + 1 >= locaOffsets.length) return [];

    const start = locaOffsets[gid];
    const end = locaOffsets[gid + 1];
    if (end <= start) return []; // empty glyph (e.g. space)

    const base = glyfOffset + start;
    const numberOfContours = view.getInt16(base);

    if (numberOfContours < 0) {
        return extractCompositeContours(font, base, depth);
    }
    return extractSimpleContours(view, base, numberOfContours);
}

function extractSimpleContours(view: DataView, base: number, numberOfContours: number): Contour[] {
    let pos = base + 10; // skip header (numberOfContours + bbox)

    const endPts: number[] = new Array(numberOfContours);
    for (let i = 0; i < numberOfContours; i++) {
        endPts[i] = view.getUint16(pos);
        pos += 2;
    }
    const numPoints = numberOfContours > 0 ? endPts[numberOfContours - 1] + 1 : 0;

    // Skip instructions.
    const instrLen = view.getUint16(pos);
    pos += 2 + instrLen;

    // Read flags (with repeat compression).
    const flags: number[] = new Array(numPoints);
    for (let i = 0; i < numPoints;) {
        const flag = view.getUint8(pos++);
        flags[i++] = flag;
        if (flag & 0x08) { // REPEAT_FLAG
            let repeat = view.getUint8(pos++);
            while (repeat-- > 0 && i < numPoints) flags[i++] = flag;
        }
    }

    // X coordinates (delta-encoded).
    const xs: number[] = new Array(numPoints);
    let x = 0;
    for (let i = 0; i < numPoints; i++) {
        const flag = flags[i];
        if (flag & 0x02) { // X_SHORT_VECTOR
            const dx = view.getUint8(pos++);
            x += (flag & 0x10) ? dx : -dx;
        } else if (!(flag & 0x10)) { // not X_IS_SAME
            x += view.getInt16(pos);
            pos += 2;
        }
        xs[i] = x;
    }

    // Y coordinates (delta-encoded).
    const ys: number[] = new Array(numPoints);
    let y = 0;
    for (let i = 0; i < numPoints; i++) {
        const flag = flags[i];
        if (flag & 0x04) { // Y_SHORT_VECTOR
            const dy = view.getUint8(pos++);
            y += (flag & 0x20) ? dy : -dy;
        } else if (!(flag & 0x20)) { // not Y_IS_SAME
            y += view.getInt16(pos);
            pos += 2;
        }
        ys[i] = y;
    }

    // Split the flat point list into contours.
    const contours: Contour[] = [];
    let startPt = 0;
    for (let c = 0; c < numberOfContours; c++) {
        const endPt = endPts[c];
        const contour: Contour = [];
        for (let i = startPt; i <= endPt; i++) {
            contour.push({ x: xs[i], y: ys[i], onCurve: (flags[i] & 0x01) !== 0 });
        }
        if (contour.length > 0) contours.push(contour);
        startPt = endPt + 1;
    }
    return contours;
}

function extractCompositeContours(font: GlyfFont, base: number, depth: number): Contour[] {
    const { view } = font;
    let pos = base + 10;
    const out: Contour[] = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
        const flags = view.getUint16(pos); pos += 2;
        const componentGid = view.getUint16(pos); pos += 2;

        let arg1: number;
        let arg2: number;
        if (flags & 0x0001) { // ARG_1_AND_2_ARE_WORDS
            arg1 = view.getInt16(pos); pos += 2;
            arg2 = view.getInt16(pos); pos += 2;
        } else {
            arg1 = (view.getInt8(pos)); pos += 1;
            arg2 = (view.getInt8(pos)); pos += 1;
        }

        let a = 1, b = 0, c = 0, d = 1;
        if (flags & 0x0008) { // WE_HAVE_A_SCALE
            a = d = readF2Dot14(view, pos); pos += 2;
        } else if (flags & 0x0040) { // WE_HAVE_AN_X_AND_Y_SCALE
            a = readF2Dot14(view, pos); pos += 2;
            d = readF2Dot14(view, pos); pos += 2;
        } else if (flags & 0x0080) { // WE_HAVE_A_TWO_BY_TWO
            a = readF2Dot14(view, pos); pos += 2;
            b = readF2Dot14(view, pos); pos += 2;
            c = readF2Dot14(view, pos); pos += 2;
            d = readF2Dot14(view, pos); pos += 2;
        }

        // ARGS_ARE_XY_VALUES → translate; otherwise point-matching (rare, ignored).
        const e = (flags & 0x0002) ? arg1 : 0;
        const f = (flags & 0x0002) ? arg2 : 0;

        const sub = extractGlyphContours(font, componentGid, depth + 1);
        for (const contour of sub) {
            out.push(contour.map((p) => transformPoint(p, a, b, c, d, e, f)));
        }

        if (!(flags & 0x0020)) break; // no MORE_COMPONENTS
    }
    return out;
}
