import { describe, it, expect } from 'vitest';
import { parseColrCpal } from '../../src/fonts/colr-parser.js';
import type { ColorGlyph } from '../../src/types/pdf-types.js';

// v1.8.0 — COLRv1 structural masks: PaintComposite in SRC_IN and DEST_IN.

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

/** Palette 0 = opaque red (CPAL stores BGRA). */
function cpalTable(): Uint8Array {
    const b = new Uint8Array(18);
    const v = new DataView(b.buffer);
    v.setUint16(2, 1); v.setUint16(4, 1); v.setUint16(6, 1); v.setUint32(8, 14);
    b[14] = 0; b[15] = 0; b[16] = 255; b[17] = 255;
    return b;
}

const ALPHA = (a: number): number => Math.round(a * 16384);

/**
 * Base glyph 7 → PaintComposite(mode):
 *   source   @90 = bare PaintSolid(alpha `sourceAlpha`)
 *   backdrop @70 = PaintGlyph(20) → PaintSolid(alpha `backdropAlpha`)
 */
function composite(mode: number, sourceAlpha: number, backdropAlpha: number): Uint8Array {
    const b = new Uint8Array(128);
    const v = new DataView(b.buffer);
    v.setUint16(0, 1);
    v.setUint32(14, 34);
    v.setUint32(34, 1);
    v.setUint16(38, 7);
    v.setUint32(40, 16);                       // paint @50
    v.setUint8(50, 32);                        // PaintComposite
    setU24(v, 51, 40);                         // source @90
    v.setUint8(54, mode);
    setU24(v, 55, 20);                         // backdrop @70
    v.setUint8(70, 10); setU24(v, 71, 6); v.setUint16(74, 20);            // PaintGlyph(20)
    v.setUint8(76, 2); v.setUint16(77, 0); v.setInt16(79, ALPHA(backdropAlpha));
    v.setUint8(90, 2); v.setUint16(91, 0); v.setInt16(93, ALPHA(sourceAlpha));
    return b;
}

function parse(bytes: Uint8Array): ColorGlyph | undefined {
    return parseColrCpal(buildSfnt({ CPAL: cpalTable(), COLR: bytes }))?.[7];
}

describe('SRC_IN with an outline mask', () => {
    it('paints the source only inside the mask outline', () => {
        const glyph = parse(composite(5, 1, 1));
        expect(glyph).toBeDefined();
        expect(glyph!.layers).toHaveLength(1);
        const [layer] = glyph!.layers;
        expect(layer.fillsClip).toBe(true);
        expect(layer.clip).toEqual([[{ glyphId: 20 }]]);
        expect(layer.paint).toEqual({ kind: 'solid', color: [255, 0, 0, 255] });
    });

    it('does not paint the mask itself', () => {
        // SRC_IN keeps the source; the backdrop only shapes it.
        const glyph = parse(composite(5, 1, 1))!;
        expect(glyph.layers.some(l => !l.fillsClip)).toBe(false);
    });
});

describe('nearest binary mask', () => {
    it('keeps a mask layer at or above half opacity', () => {
        const glyph = parse(composite(5, 1, 0.5));
        expect(glyph?.layers[0].clip).toEqual([[{ glyphId: 20 }]]);
    });

    it('treats a mask made only of faint layers as no clip it can express', () => {
        // A 20 % mask has no outline at or above one half, so there is no
        // nearest binary mask to clip to, and the glyph falls back.
        expect(parse(composite(5, 1, 0.2))).toBeUndefined();
    });
});

describe('DEST_IN with a uniform mask', () => {
    it('leaves the backdrop untouched under an opaque mask', () => {
        const glyph = parse(composite(6, 1, 1))!;
        expect(glyph.layers).toHaveLength(1);
        expect(glyph.layers[0].glyphId).toBe(20);
        expect(glyph.layers[0].clip).toBeUndefined();
        expect(glyph.layers[0].paint).toEqual({ kind: 'solid', color: [255, 0, 0, 255] });
    });

    it('multiplies the backdrop alpha by a translucent mask', () => {
        const glyph = parse(composite(6, 0.5, 1))!;
        const paint = glyph.layers[0].paint;
        expect(paint.kind).toBe('solid');
        if (paint.kind === 'solid') expect(paint.color[3]).toBe(128);
    });
});

describe('what stays unsupported', () => {
    it('still drops a glyph whose composite mode PDF cannot express', () => {
        expect(parse(composite(11, 1, 1))).toBeUndefined(); // XOR
    });
});
