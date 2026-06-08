import { describe, it, expect } from 'vitest';
import { parseCpal, parseColrCpal } from '../../src/fonts/colr-parser.js';

// ── Minimal sfnt builder (COLR/CPAL only) ────────────────────────────

function buildSfnt(tables: Record<string, Uint8Array>): Uint8Array {
    const tags = Object.keys(tables);
    const numTables = tags.length;
    const dirSize = 12 + numTables * 16;
    let dataSize = 0;
    for (const t of tags) dataSize += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(dirSize + dataSize);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x00010000);
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

function setU24(v: DataView, p: number, val: number): void {
    v.setUint8(p, (val >> 16) & 0xff);
    v.setUint8(p + 1, (val >> 8) & 0xff);
    v.setUint8(p + 2, val & 0xff);
}

// CPAL with palette 0 = [red, blue] (stored BGRA).
function cpalTable(): Uint8Array {
    const b = new Uint8Array(22);
    const v = new DataView(b.buffer);
    v.setUint16(0, 0);   // version
    v.setUint16(2, 2);   // numPaletteEntries
    v.setUint16(4, 1);   // numPalettes
    v.setUint16(6, 2);   // numColorRecords
    v.setUint32(8, 14);  // colorRecordsArrayOffset
    v.setUint16(12, 0);  // colorRecordIndices[0]
    // record 0: red → BGRA (0,0,255,255)
    b[14] = 0; b[15] = 0; b[16] = 255; b[17] = 255;
    // record 1: blue → BGRA (255,0,0,255)
    b[18] = 255; b[19] = 0; b[20] = 0; b[21] = 255;
    return b;
}

// COLR v0: base glyph 5 → 2 solid layers (gid10/pal0, gid11/pal1).
function colrV0(): Uint8Array {
    const b = new Uint8Array(28);
    const v = new DataView(b.buffer);
    v.setUint16(0, 0);    // version
    v.setUint16(2, 1);    // numBaseGlyphRecords
    v.setUint32(4, 14);   // baseGlyphRecordsOffset
    v.setUint32(8, 20);   // layerRecordsOffset
    v.setUint16(12, 2);   // numLayerRecords
    // baseGlyphRecord @14
    v.setUint16(14, 5); v.setUint16(16, 0); v.setUint16(18, 2);
    // layers @20
    v.setUint16(20, 10); v.setUint16(22, 0);
    v.setUint16(24, 11); v.setUint16(26, 1);
    return b;
}

// COLR v1: base glyph 7 → PaintGlyph(10) → PaintSolid(pal0);
//          base glyph 8 → PaintGlyph(11) → PaintLinearGradient(red→blue).
function colrV1(): Uint8Array {
    const b = new Uint8Array(98);
    const v = new DataView(b.buffer);
    // header
    v.setUint16(0, 1);    // version
    v.setUint32(14, 34);  // baseGlyphListOffset
    v.setUint32(18, 0);   // layerListOffset
    // BaseGlyphList @34
    v.setUint32(34, 2);   // numBaseGlyphPaintRecords
    v.setUint16(38, 7); v.setUint32(40, 16); // rec0 → paint @50
    v.setUint16(44, 8); v.setUint32(46, 27); // rec1 → paint @61
    // PaintGlyph(solid) @50
    v.setUint8(50, 10); setU24(v, 51, 6); v.setUint16(54, 10); // subPaint @56, glyph 10
    // PaintSolid @56
    v.setUint8(56, 2); v.setUint16(57, 0); v.setInt16(59, 16384); // pal0, alpha 1.0
    // PaintGlyph(linear) @61
    v.setUint8(61, 10); setU24(v, 62, 6); v.setUint16(65, 11); // subPaint @67, glyph 11
    // PaintLinearGradient @67
    v.setUint8(67, 4); setU24(v, 68, 16); // colorLine @83
    v.setInt16(71, 0); v.setInt16(73, 0);    // p0
    v.setInt16(75, 100); v.setInt16(77, 0);  // p1
    v.setInt16(79, 0); v.setInt16(81, 100);  // p2 (rotation)
    // ColorLine @83
    v.setUint8(83, 0);    // extend = pad
    v.setUint16(84, 2);   // numStops
    v.setInt16(86, 0); v.setUint16(88, 0); v.setInt16(90, 16384);     // stop 0 @0 pal0
    v.setInt16(92, 16384); v.setUint16(94, 1); v.setInt16(96, 16384); // stop 1 @1 pal1
    return b;
}

describe('parseCpal', () => {
    it('reads palette 0 colours as RGBA', () => {
        const colors = parseCpal(buildSfnt({ CPAL: cpalTable() }));
        expect(colors).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
    });

    it('returns null when CPAL is absent', () => {
        expect(parseCpal(buildSfnt({ head: new Uint8Array(54) }))).toBeNull();
    });
});

describe('parseColrCpal (v0)', () => {
    it('resolves layered solid base glyphs', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrV0() }))!;
        expect(map[5].layers).toHaveLength(2);
        expect(map[5].layers[0]).toEqual({ glyphId: 10, paint: { kind: 'solid', color: [255, 0, 0, 255] } });
        expect(map[5].layers[1]).toEqual({ glyphId: 11, paint: { kind: 'solid', color: [0, 0, 255, 255] } });
    });

    it('returns null when COLR is absent', () => {
        expect(parseColrCpal(buildSfnt({ CPAL: cpalTable() }))).toBeNull();
    });
});

describe('parseColrCpal (v1)', () => {
    it('resolves PaintGlyph → PaintSolid', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrV1() }))!;
        expect(map[7].layers).toHaveLength(1);
        expect(map[7].layers[0].glyphId).toBe(10);
        expect(map[7].layers[0].paint).toEqual({ kind: 'solid', color: [255, 0, 0, 255] });
    });

    it('resolves PaintGlyph → PaintLinearGradient', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrV1() }))!;
        const layer = map[8].layers[0];
        expect(layer.glyphId).toBe(11);
        expect(layer.paint.kind).toBe('linear');
        if (layer.paint.kind === 'linear') {
            expect(layer.paint.p0).toEqual([0, 0]);
            expect(layer.paint.p1).toEqual([100, 0]);
            expect(layer.paint.extend).toBe('pad');
            expect(layer.paint.stops).toHaveLength(2);
            expect(layer.paint.stops[0].color).toEqual([255, 0, 0, 255]);
            expect(layer.paint.stops[1].color).toEqual([0, 0, 255, 255]);
        }
    });
});
