import { describe, it, expect } from 'vitest';
import { parseColrCpal } from '../../src/fonts/colr-parser.js';
import type { ColorGlyph } from '../../src/types/pdf-types.js';

// v1.8.0 — every transform paint, plain and variable.
//
// Before this, only formats 12, 14 and 16 were read; the seven around-centre
// and uniform-scale and rotate and skew forms threw, which dropped the whole
// glyph, and the fourteen variable twins did the same. The file header even
// claimed format 18 was handled when it was not.

// ── Minimal sfnt + COLR/CPAL builder ─────────────────────────────────

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

/** One opaque red palette entry (CPAL stores BGRA). */
function cpalTable(): Uint8Array {
    const b = new Uint8Array(18);
    const v = new DataView(b.buffer);
    v.setUint16(2, 1); v.setUint16(4, 1); v.setUint16(6, 1); v.setUint32(8, 14);
    b[14] = 0; b[15] = 0; b[16] = 255; b[17] = 255;
    return b;
}

/**
 * A COLR v1 table whose single base glyph is
 * `<transform> → PaintGlyph(20) → PaintSolid(palette 0)`.
 *
 * `fields` is written at offset 51 (just past the format byte and the 24-bit
 * sub-paint offset), which is where every transform paint keeps its own
 * operands.
 */
function colrWithTransform(format: number, fields: (v: DataView, at: number) => void): Uint8Array {
    const b = new Uint8Array(128);
    const v = new DataView(b.buffer);
    v.setUint16(0, 1);             // version 1
    v.setUint32(14, 34);           // baseGlyphListOffset
    v.setUint32(34, 1);            // numBaseGlyphPaintRecords
    v.setUint16(38, 7);            // glyph id 7
    v.setUint32(40, 16);           // → paint at 34 + 16 = 50

    // Transform paint @50: format, then a 24-bit offset to the wrapped paint.
    v.setUint8(50, format);
    setU24(v, 51, 40);             // sub-paint at 50 + 40 = 90
    fields(v, 54);                 // operands start at 50 + 4

    // PaintGlyph @90 → PaintSolid @96
    v.setUint8(90, 10); setU24(v, 91, 6); v.setUint16(94, 20);
    v.setUint8(96, 2); v.setUint16(97, 0); v.setInt16(99, 16384);
    return b;
}

function parseOne(format: number, fields: (v: DataView, at: number) => void): ColorGlyph | null {
    const font = buildSfnt({ CPAL: cpalTable(), COLR: colrWithTransform(format, fields) });
    const glyphs = parseColrCpal(font);
    return glyphs?.[7] ?? null;
}

/** The layer's matrix, or the identity when the parser omitted it. */
function matrixOf(glyph: ColorGlyph | null): number[] {
    expect(glyph, 'glyph was dropped by the parser').not.toBeNull();
    expect(glyph!.layers).toHaveLength(1);
    return [...(glyph!.layers[0].transform ?? [1, 0, 0, 1, 0, 0])];
}

const F2 = (x: number): number => Math.round(x * 16384);
const near = (got: number[], want: number[]): void => {
    expect(got).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(got[i]).toBeCloseTo(want[i], 4);
};

describe('scale transforms', () => {
    it('reads PaintScale (16)', () => {
        const m = matrixOf(parseOne(16, (v, at) => { v.setInt16(at, F2(1.5)); v.setInt16(at + 2, F2(0.5)); }));
        near(m, [1.5, 0, 0, 0.5, 0, 0]);
    });

    it('reads PaintScaleAroundCenter (18) — the header used to claim this', () => {
        const m = matrixOf(parseOne(18, (v, at) => {
            v.setInt16(at, F2(1.5)); v.setInt16(at + 2, F2(1.5));
            v.setInt16(at + 4, 100); v.setInt16(at + 6, 50);
        }));
        // Scaling about (100,50) leaves that point fixed.
        near(m, [1.5, 0, 0, 1.5, -50, -25]);
        expect(m[0] * 100 + m[2] * 50 + m[4]).toBeCloseTo(100, 4);
        expect(m[1] * 100 + m[3] * 50 + m[5]).toBeCloseTo(50, 4);
    });

    it('reads PaintScaleUniform (20)', () => {
        const m = matrixOf(parseOne(20, (v, at) => { v.setInt16(at, F2(1.5)); }));
        near(m, [1.5, 0, 0, 1.5, 0, 0]);
    });

    it('reads PaintScaleUniformAroundCenter (22)', () => {
        const m = matrixOf(parseOne(22, (v, at) => {
            v.setInt16(at, F2(1.75)); v.setInt16(at + 2, 10); v.setInt16(at + 4, 20);
        }));
        expect(m[0] * 10 + m[2] * 20 + m[4]).toBeCloseTo(10, 4);
        expect(m[1] * 10 + m[3] * 20 + m[5]).toBeCloseTo(20, 4);
    });
});

describe('rotate transforms', () => {
    it('reads PaintRotate (24) as a counter-clockwise turn', () => {
        // Angles are fractions of a half turn: 0.5 is 90°.
        const m = matrixOf(parseOne(24, (v, at) => { v.setInt16(at, F2(0.5)); }));
        near(m, [0, 1, -1, 0, 0, 0]);
    });

    it('reads a half turn', () => {
        const m = matrixOf(parseOne(24, (v, at) => { v.setInt16(at, F2(1)); }));
        near(m, [-1, 0, 0, -1, 0, 0]);
    });

    it('reads PaintRotateAroundCenter (26), leaving the centre fixed', () => {
        const m = matrixOf(parseOne(26, (v, at) => {
            v.setInt16(at, F2(0.5)); v.setInt16(at + 2, 60); v.setInt16(at + 4, 40);
        }));
        expect(m[0] * 60 + m[2] * 40 + m[4]).toBeCloseTo(60, 4);
        expect(m[1] * 60 + m[3] * 40 + m[5]).toBeCloseTo(40, 4);
    });
});

describe('skew transforms', () => {
    it('reads PaintSkew (28)', () => {
        // 0.25 of a half turn is 45°, whose tangent is 1.
        const m = matrixOf(parseOne(28, (v, at) => { v.setInt16(at, F2(0.25)); v.setInt16(at + 2, 0); }));
        near(m, [1, 0, 1, 1, 0, 0]);
    });

    it('skews in y independently of x', () => {
        const m = matrixOf(parseOne(28, (v, at) => { v.setInt16(at, 0); v.setInt16(at + 2, F2(0.25)); }));
        near(m, [1, 1, 0, 1, 0, 0]);
    });

    it('reads PaintSkewAroundCenter (30), leaving the centre fixed', () => {
        const m = matrixOf(parseOne(30, (v, at) => {
            v.setInt16(at, F2(0.25)); v.setInt16(at + 2, 0);
            v.setInt16(at + 4, 30); v.setInt16(at + 6, 70);
        }));
        expect(m[0] * 30 + m[2] * 70 + m[4]).toBeCloseTo(30, 4);
        expect(m[1] * 30 + m[3] * 70 + m[5]).toBeCloseTo(70, 4);
    });
});

describe('variable twins resolve at the default instance', () => {
    // Each odd format is its even twin plus a trailing variation index. At
    // the default instance every delta is zero, so the two must agree.
    const pairs: [number, number, (v: DataView, at: number) => void][] = [
        [16, 17, (v, at) => { v.setInt16(at, F2(1.5)); v.setInt16(at + 2, F2(0.5)); }],
        [18, 19, (v, at) => {
            v.setInt16(at, F2(1.5)); v.setInt16(at + 2, F2(1.5));
            v.setInt16(at + 4, 100); v.setInt16(at + 6, 50);
        }],
        [20, 21, (v, at) => { v.setInt16(at, F2(1.5)); }],
        [24, 25, (v, at) => { v.setInt16(at, F2(0.5)); }],
        [26, 27, (v, at) => { v.setInt16(at, F2(0.5)); v.setInt16(at + 2, 60); v.setInt16(at + 4, 40); }],
        [28, 29, (v, at) => { v.setInt16(at, F2(0.25)); v.setInt16(at + 2, 0); }],
        [14, 15, (v, at) => { v.setInt16(at, 25); v.setInt16(at + 2, -10); }],
    ];

    for (const [plain, variable, fields] of pairs) {
        it(`format ${variable} matches format ${plain}`, () => {
            near(matrixOf(parseOne(variable, fields)), matrixOf(parseOne(plain, fields)));
        });
    }
});

describe('translate still works', () => {
    it('reads PaintTranslate (14)', () => {
        const m = matrixOf(parseOne(14, (v, at) => { v.setInt16(at, 25); v.setInt16(at + 2, -10); }));
        near(m, [1, 0, 0, 1, 25, -10]);
    });

    it('omits the matrix entirely when it is the identity', () => {
        const glyph = parseOne(14, (v, at) => { v.setInt16(at, 0); v.setInt16(at + 2, 0); });
        expect(glyph!.layers[0].transform).toBeUndefined();
    });
});

describe('an unknown paint format still drops the glyph', () => {
    it('does not silently treat format 33 as a transform', () => {
        expect(parseOne(33, () => { /* no operands */ })).toBeNull();
    });
});
