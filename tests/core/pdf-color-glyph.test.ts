import { describe, it, expect } from 'vitest';
import { contoursToPath, isAlphaRamp, renderColorGlyph } from '../../src/core/pdf-color-glyph.js';
import type { Contour } from '../../src/fonts/glyf-outline.js';
import type { ColorGlyph, ColorStop } from '../../src/types/pdf-types.js';

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
        // BBox is computed from the outline (0..100 square + 1-unit pad), not the em box.
        expect(form.bbox).toEqual([-1, -1, 101, 101]);
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

// v1.8.0 — a PDF shading carries no per-stop alpha. A gradient whose stops
// share one RGB and fade only in alpha (Noto's soft shadows) used to become a
// flat opaque fill over the artwork; it is now omitted. A gradient whose
// stops are all one colour paints as that solid instead of a shading whose
// function has C0 == C1.
describe('isAlphaRamp', () => {
    const stop = (offset: number, color: ColorStop['color']): ColorStop => ({ offset, color });

    it('is true when the stops share one RGB and differ in alpha', () => {
        expect(isAlphaRamp([stop(0, [109, 76, 65, 0]), stop(1, [109, 76, 65, 255])])).toBe(true);
        expect(isAlphaRamp([stop(0, [0, 0, 0, 0]), stop(0.5, [0, 0, 0, 128]), stop(1, [0, 0, 0, 0])])).toBe(true);
    });

    it('is false when the RGB varies, whatever the alphas do', () => {
        expect(isAlphaRamp([stop(0, [255, 0, 0, 0]), stop(1, [0, 0, 255, 255])])).toBe(false);
        expect(isAlphaRamp([stop(0, [255, 0, 0, 255]), stop(1, [0, 0, 255, 255])])).toBe(false);
    });

    it('is false for a uniform alpha and for fewer than two stops', () => {
        expect(isAlphaRamp([stop(0, [109, 76, 65, 255]), stop(1, [109, 76, 65, 255])])).toBe(false);
        expect(isAlphaRamp([stop(0, [109, 76, 65, 128]), stop(1, [109, 76, 65, 128])])).toBe(false);
        expect(isAlphaRamp([stop(0, [109, 76, 65, 0])])).toBe(false);
        expect(isAlphaRamp([])).toBe(false);
    });
});

describe('alpha ramps and single-colour gradients', () => {
    const outlineOf = (): Contour[] => [square];
    const ramp: ColorStop[] = [{ offset: 0, color: [109, 76, 65, 0] }, { offset: 1, color: [109, 76, 65, 255] }];
    const flat: ColorStop[] = [{ offset: 0.19, color: [255, 179, 0, 255] }, { offset: 0.94, color: [255, 179, 0, 255] }];
    const varying: ColorStop[] = [{ offset: 0, color: [255, 0, 0, 255] }, { offset: 1, color: [0, 0, 255, 255] }];

    it('still emits a shading for a gradient whose RGB varies under a uniform alpha', () => {
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 1, paint: { kind: 'linear', p0: [0, 0], p1: [100, 0], extend: 'pad', stops: varying } }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(1);
        expect(form.shadings[0].dict).toContain('/C0 [1 0 0] /C1 [0 0 1]');
        expect(form.content).toContain('/Sh0 sh');
        expect(form.extGStates).toHaveLength(0);
    });

    it('omits an alpha-ramp layer instead of painting it opaque', () => {
        const glyph: ColorGlyph = {
            layers: [
                { glyphId: 1, paint: { kind: 'solid', color: [255, 202, 40, 255] } },
                { glyphId: 1, paint: { kind: 'radial', c0: [50, 50], r0: 0, c1: [50, 50], r1: 80, extend: 'pad', stops: ramp } },
            ],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(0);
        expect(form.content).not.toContain(' sh');
        // The face fill is the last thing painted; the form is exactly the solid layer.
        expect(form.content.split('\n').slice(-2)).toEqual(['f', 'Q']);
        expect(form.content).toBe(renderColorGlyph({ layers: [glyph.layers[0]] }, outlineOf, 1000).content);
    });

    it('omits an alpha ramp that fills a clip region too', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 1, fillsClip: true, clip: [[{ glyphId: 1 }]],
                paint: { kind: 'linear', p0: [0, 0], p1: [100, 0], extend: 'pad', stops: ramp },
            }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(0);
        expect(form.content).toBe('');
    });

    it('paints a single-colour gradient as the equivalent solid fill', () => {
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 1, paint: { kind: 'linear', p0: [0, 0], p1: [100, 0], extend: 'pad', stops: flat } }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(0);
        expect(form.content).toContain('1 0.702 0 rg');
        expect(form.content).toMatch(/\nf\n/);
        expect(form.content).toBe(renderColorGlyph(
            { layers: [{ glyphId: 1, paint: { kind: 'solid', color: [255, 179, 0, 255] } }] }, outlineOf, 1000,
        ).content);
    });

    it('keeps a single-colour gradient alpha through the ExtGState of the solid path', () => {
        const half: ColorStop[] = [{ offset: 0, color: [0, 0, 0, 128] }, { offset: 1, color: [0, 0, 0, 128] }];
        const glyph: ColorGlyph = {
            layers: [{ glyphId: 1, paint: { kind: 'radial', c0: [50, 50], r0: 0, c1: [50, 50], r1: 80, extend: 'pad', stops: half } }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(0);
        expect(form.extGStates.map(g => g.dict)).toEqual(['<< /ca 0.502 /CA 0.502 >>']);
    });

    it('fills a clip region with the solid a single-colour gradient stands for', () => {
        const glyph: ColorGlyph = {
            layers: [{
                glyphId: 1, fillsClip: true, clip: [[{ glyphId: 1 }]],
                paint: { kind: 'radial', c0: [50, 50], r0: 0, c1: [50, 50], r1: 80, extend: 'pad', stops: flat },
            }],
        };
        const form = renderColorGlyph(glyph, outlineOf, 1000);
        expect(form.shadings).toHaveLength(0);
        expect(form.content).toMatch(/1 0\.702 0 rg\n0 0 100 100 re\nf/);
    });
});
