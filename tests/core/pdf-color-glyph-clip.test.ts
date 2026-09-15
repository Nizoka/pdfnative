import { describe, it, expect } from 'vitest';
import { renderColorGlyph } from '../../src/core/pdf-color-glyph.js';
import type { Contour } from '../../src/fonts/glyf-outline.js';
import type { ColorGlyph, ColorStop, CpalColor } from '../../src/types/pdf-types.js';

// v1.8.0 — clip sets and clip-filling layers in the colour-glyph renderer.

const square = (x0: number, y0: number, s: number): Contour[] => [[
    { x: x0, y: y0, onCurve: true }, { x: x0 + s, y: y0, onCurve: true },
    { x: x0 + s, y: y0 + s, onCurve: true }, { x: x0, y: y0 + s, onCurve: true },
]];

const OUTLINES: Record<number, Contour[]> = {
    20: square(0, 0, 100),
    21: square(50, 50, 100),
    22: [],                           // an outline the subset does not carry
};
const outlines = (gid: number): Contour[] => OUTLINES[gid] ?? [];

const RED: CpalColor = [255, 0, 0, 255];
const stops = (a0: number, a1: number): ColorStop[] => [
    { offset: 0, color: [255, 255, 255, a0] },
    { offset: 1, color: [0, 0, 0, a1] },
];

const balanced = (content: string): boolean => {
    let depth = 0;
    for (const line of content.split('\n')) {
        if (line === 'q') depth++;
        if (line === 'Q') depth--;
        if (depth < 0) return false;
    }
    return depth === 0;
};

describe('clip sets', () => {
    it('clips an ordinary layer before painting it', () => {
        const glyph: ColorGlyph = { layers: [{ glyphId: 21, paint: { kind: 'solid', color: RED }, clip: [[{ glyphId: 20 }]] }] };
        const { content } = renderColorGlyph(glyph, outlines, 1000);
        const lines = content.split('\n');
        expect(lines.indexOf('W n')).toBeGreaterThan(-1);
        expect(lines.indexOf('W n')).toBeLessThan(lines.indexOf('f'));
        expect(balanced(content)).toBe(true);
    });

    it('intersects several clip sets by nesting them', () => {
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 21, paint: { kind: 'solid', color: RED }, clip: [[{ glyphId: 20 }], [{ glyphId: 21 }]] }],
        };
        const { content } = renderColorGlyph(glyph, outlines, 1000);
        expect(content.split('\n').filter(l => l === 'W n')).toHaveLength(2);
        expect(balanced(content)).toBe(true);
    });

    it('skips a layer whose whole clip set has no outline', () => {
        const glyph: ColorGlyph = { layers: [{ glyphId: 21, paint: { kind: 'solid', color: RED }, clip: [[{ glyphId: 22 }]] }] };
        expect(renderColorGlyph(glyph, outlines, 1000).content).toBe('');
    });

    it('leaves an unclipped layer exactly as it was', () => {
        const plain: ColorGlyph = { layers: [{ glyphId: 20, paint: { kind: 'solid', color: RED } }] };
        const out = renderColorGlyph(plain, outlines, 1000).content;
        expect(out.split('\n')[0]).toBe('q');
        expect(out).not.toContain('W n');
    });
});

describe('clip-filling layers', () => {
    it('fills the clip region with a solid colour', () => {
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 20, paint: { kind: 'solid', color: RED }, clip: [[{ glyphId: 20 }]], fillsClip: true }],
        };
        const { content, bbox } = renderColorGlyph(glyph, outlines, 1000);
        expect(content).toMatch(/ re\nf/);
        expect(bbox).toEqual([-1, -1, 101, 101]);
    });

    it('paints a masked gradient as a shading over the clip', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 20,
                paint: { kind: 'linear', p0: [0, 0], p1: [100, 100], stops: stops(255, 255), extend: 'pad' },
                clip: [[{ glyphId: 20 }, { glyphId: 21 }]],
                fillsClip: true,
            }],
        };
        const form = renderColorGlyph(glyph, outlines, 1000);
        expect(form.shadings).toHaveLength(1);
        expect(form.content).toContain('/Sh0 sh');
        // The union of both outlines grows the box.
        expect(form.bbox).toEqual([-1, -1, 151, 151]);
    });

    it('carries the blend mode of the composite it came from', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 20,
                paint: { kind: 'linear', p0: [0, 0], p1: [100, 0], stops: stops(255, 255), extend: 'pad' },
                clip: [[{ glyphId: 20 }]], fillsClip: true, blendMode: 'SoftLight',
            }],
        };
        const form = renderColorGlyph(glyph, outlines, 1000);
        expect(form.extGStates.map(g => g.dict)).toContain('<< /BM /SoftLight >>');
    });
});

describe('gradient alpha', () => {
    const layer = (a0: number, a1: number): ColorGlyph => ({
        layers: [{ glyphId: 20, paint: { kind: 'linear', p0: [0, 0], p1: [100, 0], stops: stops(a0, a1), extend: 'pad' } }],
    });

    it('carries a uniform stop alpha through the ExtGState', () => {
        // A shading is colour-only; before v1.8.0 this gradient came out opaque.
        const form = renderColorGlyph(layer(128, 128), outlines, 1000);
        expect(form.extGStates.map(g => g.dict)).toContain('<< /ca 0.502 /CA 0.502 >>');
    });

    it('keeps a gradient with differing stop alphas opaque, as before', () => {
        const form = renderColorGlyph(layer(255, 0), outlines, 1000);
        expect(form.extGStates).toHaveLength(0);
    });

    it('adds nothing for an opaque gradient', () => {
        expect(renderColorGlyph(layer(255, 255), outlines, 1000).extGStates).toHaveLength(0);
    });
});
