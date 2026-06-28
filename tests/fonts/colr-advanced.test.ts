import { describe, it, expect } from 'vitest';
import { parseColrCpal } from '../../src/fonts/colr-parser.js';
import { renderColorGlyph } from '../../src/core/pdf-color-glyph.js';
import type { ColorGlyph } from '../../src/types/pdf-types.js';
import type { Contour } from '../../src/fonts/glyf-outline.js';

// ── Minimal sfnt builder ─────────────────────────────────────────────

function buildSfnt(tables: Record<string, Uint8Array>): Uint8Array {
    const tags = Object.keys(tables);
    const dirSize = 12 + tags.length * 16;
    let dataSize = 0;
    for (const t of tags) dataSize += (tables[t].length + 3) & ~3;
    const out = new Uint8Array(dirSize + dataSize);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x00010000);
    view.setUint16(4, tags.length);
    let off = dirSize, rec = 12;
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

// CPAL palette 0 = [red, blue] (BGRA storage).
function cpalTable(): Uint8Array {
    const b = new Uint8Array(22);
    const v = new DataView(b.buffer);
    v.setUint16(2, 2); v.setUint16(4, 1); v.setUint16(6, 2); v.setUint32(8, 14);
    b[14] = 0; b[15] = 0; b[16] = 255; b[17] = 255;  // red
    b[18] = 255; b[19] = 0; b[20] = 0; b[21] = 255;  // blue
    return b;
}

// base glyph 7 → PaintGlyph(20) → PaintSweepGradient(0°→180°, red→blue).
function colrSweep(): Uint8Array {
    const b = new Uint8Array(96);
    const v = new DataView(b.buffer);
    v.setUint16(0, 1);            // version 1
    v.setUint32(14, 34);          // baseGlyphListOffset
    v.setUint32(34, 1);           // numBaseGlyphPaintRecords
    v.setUint16(38, 7); v.setUint32(40, 16); // rec → PaintGlyph @50
    // PaintGlyph @50
    v.setUint8(50, 10); setU24(v, 51, 6); v.setUint16(54, 20);
    // PaintSweepGradient @56
    v.setUint8(56, 8); setU24(v, 57, 14);
    v.setInt16(60, 50); v.setInt16(62, 50);     // centre
    v.setInt16(64, 0); v.setInt16(66, 16384);   // start 0° → end 180°
    // ColorLine @70
    v.setUint8(70, 0); v.setUint16(71, 2);
    v.setInt16(73, 0); v.setUint16(75, 0); v.setInt16(77, 16384);     // stop0 pal0
    v.setInt16(79, 16384); v.setUint16(81, 1); v.setInt16(83, 16384); // stop1 pal1
    return b;
}

// base glyph 7 → PaintComposite(Multiply, src=solid pal0, backdrop=solid pal1).
function colrComposite(mode: number): Uint8Array {
    const b = new Uint8Array(96);
    const v = new DataView(b.buffer);
    v.setUint16(0, 1);
    v.setUint32(14, 34);
    v.setUint32(34, 1);
    v.setUint16(38, 7); v.setUint32(40, 16); // → PaintComposite @50
    // PaintComposite @50
    v.setUint8(50, 32); setU24(v, 51, 10); v.setUint8(54, mode); setU24(v, 55, 22);
    // source PaintGlyph @60 → PaintSolid pal0 @66
    v.setUint8(60, 10); setU24(v, 61, 6); v.setUint16(64, 20);
    v.setUint8(66, 2); v.setUint16(67, 0); v.setInt16(69, 16384);
    // backdrop PaintGlyph @72 → PaintSolid pal1 @78
    v.setUint8(72, 10); setU24(v, 73, 6); v.setUint16(76, 21);
    v.setUint8(78, 2); v.setUint16(79, 1); v.setInt16(81, 16384);
    return b;
}

const square: Contour[] = [[
    { x: 0, y: 0, onCurve: true },
    { x: 100, y: 0, onCurve: true },
    { x: 100, y: 100, onCurve: true },
    { x: 0, y: 100, onCurve: true },
]];

// ── Sweep parsing ────────────────────────────────────────────────────

describe('COLR sweep gradient', () => {
    it('parses PaintSweepGradient into a sweep paint', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrSweep() }))!;
        const layer = map[7].layers[0];
        expect(layer.glyphId).toBe(20);
        expect(layer.paint.kind).toBe('sweep');
        if (layer.paint.kind === 'sweep') {
            expect(layer.paint.center).toEqual([50, 50]);
            expect(layer.paint.startAngle).toBeCloseTo(0, 5);
            expect(layer.paint.endAngle).toBeCloseTo(180, 5);
            expect(layer.paint.stops).toHaveLength(2);
        }
    });

    it('renders a sweep as flat wedges clipped to the outline', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrSweep() }))!;
        const form = renderColorGlyph(map[7] as ColorGlyph, () => square, 1000);
        // Clipped (W n), several wedge fills, no /Shading resource for sweep.
        expect(form.content).toContain('W n');
        expect(form.content.split('\n').filter(l => l === 'f').length).toBeGreaterThan(10);
        expect(form.shadings).toHaveLength(0);
    });
});

// ── Composite parsing + rendering ────────────────────────────────────

describe('COLR PaintComposite', () => {
    it('maps a blend-mode composite to backdrop + source(/BM) layers', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrComposite(23) }))!; // Multiply
        const layers = map[7].layers;
        expect(layers).toHaveLength(2);
        // Backdrop first (pal1 = blue, gid 21, no blend).
        expect(layers[0].glyphId).toBe(21);
        expect(layers[0].blendMode).toBeUndefined();
        // Source over with Multiply (pal0 = red, gid 20).
        expect(layers[1].glyphId).toBe(20);
        expect(layers[1].blendMode).toBe('Multiply');
    });

    it('emits a /BM ExtGState when rendering a blend-mode layer', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrComposite(23) }))!;
        const form = renderColorGlyph(map[7] as ColorGlyph, () => square, 1000);
        expect(form.extGStates.some(g => g.dict.includes('/BM /Multiply'))).toBe(true);
    });

    it('falls back (drops glyph) for Porter-Duff structural modes', () => {
        // mode 11 = XOR → unsupported → glyph skipped → map is null.
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrComposite(11) }));
        expect(map).toBeNull();
    });

    it('SRC_OVER (mode 3) maps to Normal (no /BM on source)', () => {
        const map = parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: colrComposite(3) }))!;
        const layers = map[7].layers;
        expect(layers[1].blendMode).toBeUndefined();
    });
});
