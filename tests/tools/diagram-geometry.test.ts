import { describe, it, expect } from 'vitest';
import { analyseDiagram, type DiagramGeometry, type GeometryBox, type GeometryText } from '../../scripts/lib/diagram-geometry.js';

// The pure half of `npm run verify:diagrams`: the browser collects rendered
// geometry, this function decides what is a defect. Synthetic geometries
// exercise every rule and every declared exemption.

const canvas: GeometryBox = { x: 0, y: 0, w: 960, h: 560 };
const text = (label: string, x: number, y: number, w: number, h = 14, extra: Partial<GeometryText> = {}): GeometryText =>
    ({ label, x, y, w, h, ...extra });
const diagram = (parts: Partial<DiagramGeometry>): DiagramGeometry =>
    ({ width: 960, height: 560, texts: [], rects: [canvas], strokes: [], ...parts });
const kinds = (g: DiagramGeometry): string[] => analyseDiagram(g).map((f) => f.kind);

describe('analyseDiagram', () => {
    it('accepts a label that fits its box with the padding', () => {
        const box = { x: 100, y: 100, w: 200, h: 40 };
        expect(analyseDiagram(diagram({ rects: [canvas, box], texts: [text('fits', 110, 112, 180)] }))).toEqual([]);
    });

    it('reports a label that leaves its box, with the excess', () => {
        const box = { x: 100, y: 100, w: 200, h: 40 };
        const findings = analyseDiagram(diagram({ rects: [canvas, box], texts: [text('too long for the box', 110, 112, 200)] }));
        expect(findings.map((f) => f.kind)).toEqual(['overflow']);
        expect(findings[0]!.message).toContain('by 14');
    });

    it('ignores the full-canvas background as a container', () => {
        expect(kinds(diagram({ texts: [text('title on the canvas', 380, 30, 200)] }))).toEqual([]);
    });

    it('reports two sibling boxes that overlap but not a box nested in another', () => {
        const group = { x: 20, y: 20, w: 600, h: 300 };
        const inner = { x: 40, y: 40, w: 200, h: 60 };
        const sibling = { x: 220, y: 50, w: 200, h: 60 };
        expect(kinds(diagram({ rects: [canvas, group, inner] }))).toEqual([]);
        expect(kinds(diagram({ rects: [canvas, group, inner, sibling] }))).toEqual(['box-overlap']);
    });

    it('reports a label that straddles the edge of a box it is not inside', () => {
        const left = { x: 40, y: 100, w: 220, h: 200 };
        const right = { x: 660, y: 100, w: 260, h: 200 };
        const found = kinds(diagram({ rects: [canvas, left, right], texts: [text('an envelope wider than its lane', 230, 272, 480)] }));
        expect(found).toEqual(['straddle', 'straddle']);
    });

    it('reports two labels that collide', () => {
        expect(kinds(diagram({ texts: [text('first', 100, 100, 80), text('second', 150, 108, 80)] }))).toEqual(['text-overlap']);
    });

    it('reports a line drawn through a label', () => {
        const through = { tag: 'line', points: [{ x: 480, y: 80 }, { x: 480, y: 351 }, { x: 480, y: 460 }] };
        expect(kinds(diagram({ texts: [text('controlled transfer', 420, 344, 120)], strokes: [through] }))).toEqual(['stroke-through-text']);
    });

    it('exempts a haloed label, an intentional stroke and an intentional box', () => {
        const through = { tag: 'line', points: [{ x: 480, y: 350 }] };
        expect(kinds(diagram({ texts: [text('haloed', 420, 344, 120, 14, { halo: true })], strokes: [through] }))).toEqual([]);
        expect(kinds(diagram({ texts: [text('struck through', 420, 344, 120)], strokes: [{ ...through, intentional: true }] }))).toEqual([]);
        const group = { x: 28, y: 92, w: 904, h: 150 };
        const pill = { x: 44, y: 83, w: 164, h: 20, intentional: true };
        expect(kinds(diagram({ rects: [canvas, group, pill], texts: [text('AGENT', 60, 87, 100, 12)] }))).toEqual([]);
    });

    it('hides the part of a stroke painted over by a later opaque box', () => {
        const pill = { x: 400, y: 220, w: 130, h: 20, opaque: true, order: 10 };
        const label = text('npm install', 415, 223, 100, 13);
        const connector = { tag: 'path', order: 5, points: [{ x: 460, y: 200 }, { x: 460, y: 230 }, { x: 460, y: 260 }] };
        expect(kinds(diagram({ rects: [canvas, pill], texts: [label], strokes: [connector] }))).toEqual([]);
        expect(kinds(diagram({ rects: [canvas, pill], texts: [label], strokes: [{ ...connector, order: 20 }] }))).toEqual(['stroke-through-text']);
    });
});
