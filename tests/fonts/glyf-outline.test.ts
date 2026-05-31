import { describe, it, expect } from 'vitest';
import { parseGlyfFont, extractGlyphContours } from '../../src/fonts/glyf-outline.js';

// ── Minimal sfnt builder ─────────────────────────────────────────────

function buildSfnt(tables: Record<string, Uint8Array>): Uint8Array {
    const tags = Object.keys(tables);
    const numTables = tags.length;
    const dirSize = 12 + numTables * 16;
    let dataSize = 0;
    for (const t of tags) dataSize += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(dirSize + dataSize);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x00010000); // sfnt version 1.0
    view.setUint16(4, numTables);
    let off = dirSize;
    let rec = 12;
    for (const tag of tags) {
        const data = tables[tag];
        for (let i = 0; i < 4; i++) view.setUint8(rec + i, tag.charCodeAt(i));
        view.setUint32(rec + 8, off);
        view.setUint32(rec + 12, data.length);
        out.set(data, off);
        off += (data.length + 3) & ~3;
        rec += 16;
    }
    return out;
}

function headTable(unitsPerEm: number, longLoca: boolean): Uint8Array {
    const b = new Uint8Array(54);
    const v = new DataView(b.buffer);
    v.setUint16(18, unitsPerEm);
    v.setInt16(50, longLoca ? 1 : 0);
    return b;
}

function maxpTable(numGlyphs: number): Uint8Array {
    const b = new Uint8Array(32);
    new DataView(b.buffer).setUint16(4, numGlyphs);
    return b;
}

function longLoca(offsets: number[]): Uint8Array {
    const b = new Uint8Array(offsets.length * 4);
    const v = new DataView(b.buffer);
    offsets.forEach((o, i) => v.setUint32(i * 4, o));
    return b;
}

/** A simple triangle glyph (0,0)-(100,0)-(50,100), all on-curve. */
function triangleGlyph(): Uint8Array {
    const b = new Uint8Array(29);
    const v = new DataView(b.buffer);
    v.setInt16(0, 1);   // numberOfContours
    v.setInt16(2, 0); v.setInt16(4, 0); v.setInt16(6, 100); v.setInt16(8, 100); // bbox
    v.setUint16(10, 2); // endPtsOfContours[0] = 2 (3 points)
    v.setUint16(12, 0); // instructionLength
    b[14] = 0x01; b[15] = 0x01; b[16] = 0x01; // flags: on-curve, int16 deltas
    v.setInt16(17, 0); v.setInt16(19, 100); v.setInt16(21, -50); // x deltas
    v.setInt16(23, 0); v.setInt16(25, 0); v.setInt16(27, 100);   // y deltas
    return b;
}

function triangleFont(): Uint8Array {
    const glyf = triangleGlyph();
    return buildSfnt({
        head: headTable(1000, true),
        maxp: maxpTable(2),
        loca: longLoca([0, 0, glyf.length]), // glyph0 empty, glyph1 = triangle
        glyf,
    });
}

describe('parseGlyfFont', () => {
    it('parses a valid glyf font', () => {
        const font = parseGlyfFont(triangleFont());
        expect(font).not.toBeNull();
        expect(font!.unitsPerEm).toBe(1000);
        expect(font!.locaOffsets).toEqual([0, 0, 29]);
    });

    it('returns null for a font without glyf/loca', () => {
        const font = parseGlyfFont(buildSfnt({ head: headTable(1000, true), maxp: maxpTable(0) }));
        expect(font).toBeNull();
    });

    it('returns null for a truncated buffer', () => {
        expect(parseGlyfFont(new Uint8Array(4))).toBeNull();
    });
});

describe('extractGlyphContours', () => {
    it('extracts a simple triangle contour', () => {
        const font = parseGlyfFont(triangleFont())!;
        const contours = extractGlyphContours(font, 1);
        expect(contours).toHaveLength(1);
        expect(contours[0]).toEqual([
            { x: 0, y: 0, onCurve: true },
            { x: 100, y: 0, onCurve: true },
            { x: 50, y: 100, onCurve: true },
        ]);
    });

    it('returns no contours for an empty glyph', () => {
        const font = parseGlyfFont(triangleFont())!;
        expect(extractGlyphContours(font, 0)).toHaveLength(0);
    });

    it('returns no contours for an out-of-range gid', () => {
        const font = parseGlyfFont(triangleFont())!;
        expect(extractGlyphContours(font, 99)).toHaveLength(0);
    });

    it('flattens a composite glyph by translating its component', () => {
        const tri = triangleGlyph();
        // Composite glyph: one component referencing glyph 1, translated by (200, 0).
        const comp = new Uint8Array(16);
        const cv = new DataView(comp.buffer);
        cv.setInt16(0, -1); // numberOfContours < 0 → composite
        cv.setInt16(2, 0); cv.setInt16(4, 0); cv.setInt16(6, 300); cv.setInt16(8, 100);
        // component: flags = ARG_1_AND_2_ARE_WORDS(0x0001) | ARGS_ARE_XY_VALUES(0x0002)
        cv.setUint16(10, 0x0003);
        cv.setUint16(12, 1);    // component glyphIndex = 1 (triangle)
        cv.setInt16(14, 200);   // dx (arg1) — dy (arg2) would follow but we keep glyph small
        const comp2 = new Uint8Array(18);
        comp2.set(comp.subarray(0, 16), 0);
        new DataView(comp2.buffer).setInt16(16, 0); // dy = 0

        const font = parseGlyfFont(buildSfnt({
            head: headTable(1000, true),
            maxp: maxpTable(3),
            loca: longLoca([0, 0, tri.length, tri.length + comp2.length]),
            glyf: (() => { const g = new Uint8Array(tri.length + comp2.length); g.set(tri, 0); g.set(comp2, tri.length); return g; })(),
        }))!;

        const contours = extractGlyphContours(font, 2);
        expect(contours).toHaveLength(1);
        // Triangle apex translated by +200 in x.
        expect(contours[0][2]).toEqual({ x: 250, y: 100, onCurve: true });
    });
});
