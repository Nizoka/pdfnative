import { describe, it, expect } from 'vitest';
import { contoursToPath, renderColorGlyph } from '../../src/core/pdf-color-glyph.js';
import type { Contour } from '../../src/fonts/glyf-outline.js';
import type { ColorGlyph } from '../../src/types/pdf-types.js';

// A unit square contour (on-curve corners), CCW.
const square: Contour = [
    { x: 0, y: 0, onCurve: true },
    { x: 100, y: 0, onCurve: true },
    { x: 100, y: 100, onCurve: true },
    { x: 0, y: 100, onCurve: true },
];

describe('contoursToPath', () => {
    it('emits move/line/close for a polygon', () => {
        const path = contoursToPath([square]);
        expect(path).toContain('0 0 m');
        expect(path).toContain('100 0 l');
        expect(path).toContain('100 100 l');
        expect(path).toContain('0 100 l');
        expect(path.trim().endsWith('h')).toBe(true);
    });

    it('converts a quadratic off-curve point to a cubic', () => {
        const tri: Contour = [
            { x: 0, y: 0, onCurve: true },
            { x: 50, y: 100, onCurve: false }, // quadratic control
            { x: 100, y: 0, onCurve: true },
        ];
        const path = contoursToPath([tri]);
        // One cubic curve operator 'c' should be present.
        expect(path).toMatch(/ c$/m);
        // Cubic control derived from quadratic: c1 = P0 + 2/3(Q-P0) = (33.333, 66.667)
        expect(path).toContain('33.333 66.667');
    });

    it('applies an affine transform to all points', () => {
        const path = contoursToPath([square], [1, 0, 0, 1, 10, 20]); // translate
        expect(path).toContain('10 20 m');
        expect(path).toContain('110 20 l');
    });

    it('handles an all-off-curve contour by synthesising a start point', () => {
        const c: Contour = [
            { x: 0, y: 0, onCurve: false },
            { x: 100, y: 0, onCurve: false },
            { x: 50, y: 100, onCurve: false },
        ];
        expect(() => contoursToPath([c])).not.toThrow();
        expect(contoursToPath([c])).toContain('m');
    });
});

describe('renderColorGlyph', () => {
    const outlineOf = (): Contour[] => [square];

    it('renders a solid layer as an rg fill', () => {
        const glyph: ColorGlyph = { layers: [{ glyphId: 1, paint: { kind: 'solid', color: [255, 0, 0, 255] } }] };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.content).toContain('1 0 0 rg');
        expect(form.content).toContain('f');
        expect(form.bbox).toEqual([0, 0, 1000, 1000]);
        expect(form.shadings).toHaveLength(0);
    });

    it('emits an ExtGState for a semi-transparent solid layer', () => {
        const glyph: ColorGlyph = { layers: [{ glyphId: 1, paint: { kind: 'solid', color: [0, 0, 0, 128] } }] };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.extGStates).toHaveLength(1);
        expect(form.extGStates[0].dict).toContain('/ca');
        expect(form.content).toContain(`/${form.extGStates[0].name} gs`);
    });

    it('renders a linear gradient as a Shading Type 2 painted via sh', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 1,
                paint: {
                    kind: 'linear', p0: [0, 0], p1: [100, 0], extend: 'pad',
                    stops: [{ offset: 0, color: [255, 0, 0, 255] }, { offset: 1, color: [0, 0, 255, 255] }],
                },
            }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(1);
        expect(form.shadings[0].dict).toContain('/ShadingType 2');
        expect(form.shadings[0].dict).toContain('/Coords [0 0 100 0]');
        expect(form.shadings[0].dict).toContain('/FunctionType 2');
        expect(form.content).toContain('W n'); // clip to outline
        expect(form.content).toContain(`/${form.shadings[0].name} sh`);
    });

    it('renders a radial gradient as a Shading Type 3', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 1,
                paint: {
                    kind: 'radial', c0: [50, 50], r0: 0, c1: [50, 50], r1: 50, extend: 'pad',
                    stops: [
                        { offset: 0, color: [255, 255, 255, 255] },
                        { offset: 0.5, color: [255, 200, 0, 255] },
                        { offset: 1, color: [200, 0, 0, 255] },
                    ],
                },
            }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings[0].dict).toContain('/ShadingType 3');
        expect(form.shadings[0].dict).toContain('/Coords [50 50 0 50 50 50]');
        // 3 stops → stitching function Type 3.
        expect(form.shadings[0].dict).toContain('/FunctionType 3');
    });

    it('paints layers back-to-front in order', () => {
        const glyph: ColorGlyph = {
            layers: [
                { glyphId: 1, paint: { kind: 'solid', color: [255, 0, 0, 255] } },
                { glyphId: 2, paint: { kind: 'solid', color: [0, 255, 0, 255] } },
            ],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.content.indexOf('1 0 0 rg')).toBeLessThan(form.content.indexOf('0 1 0 rg'));
    });

    it('bakes a layer transform into the path', () => {
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 1, paint: { kind: 'solid', color: [0, 0, 0, 255] }, transform: [1, 0, 0, 1, 5, 5] }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.content).toContain('5 5 m'); // square origin translated by (5,5)
    });
});
