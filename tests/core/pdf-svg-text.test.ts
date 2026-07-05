import { describe, it, expect } from 'vitest';
import { renderSvg } from '../../src/core/pdf-svg.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';

// #61 — SVG <text>/<tspan> MVP: text is rendered upright (outside the vertical
// viewBox flip), honours text-anchor, decodes safe entities, and requires an
// encoding context (skipped without one, preserving pre-1.5.0 behaviour).

const enc = createEncodingContext([], false, false);

describe('SVG text rendering (#61)', () => {
    it('emits a text-show operator for <text> when an encoding context is given', () => {
        const svg = '<svg viewBox="0 0 200 100"><text x="10" y="50">Label</text></svg>';
        const out = renderSvg(svg, 0, 0, 200, 100, undefined, enc);
        expect(out).toContain('BT');
        expect(out).toContain('Tj');
        expect(out).toContain('(Label)');
    });

    it('renders text upright — no cm flip wrapping the text run', () => {
        const svg = '<svg viewBox="0 0 200 100"><text x="10" y="50">Up</text></svg>';
        const out = renderSvg(svg, 0, 0, 200, 100, undefined, enc);
        // Text-only SVG (no shapes) must NOT emit a `cm` transform at all.
        expect(out).not.toContain('cm');
        expect(out).toContain('BT');
    });

    it('skips text (no BT) when no encoding context is provided', () => {
        const svg = '<svg viewBox="0 0 200 100"><text x="10" y="50">None</text></svg>';
        const out = renderSvg(svg, 0, 0, 200, 100);
        expect(out).not.toContain('BT');
        // No shapes + no rendered text ⇒ empty output.
        expect(out).toBe('');
    });

    it('shifts x for text-anchor="middle" and "end"', () => {
        const start = renderSvg('<svg viewBox="0 0 200 100"><text x="100" y="50">Mid</text></svg>', 0, 0, 200, 100, undefined, enc);
        const middle = renderSvg('<svg viewBox="0 0 200 100"><text x="100" y="50" text-anchor="middle">Mid</text></svg>', 0, 0, 200, 100, undefined, enc);
        const end = renderSvg('<svg viewBox="0 0 200 100"><text x="100" y="50" text-anchor="end">Mid</text></svg>', 0, 0, 200, 100, undefined, enc);
        // Extract the Td x-coordinate of each.
        const xOf = (s: string) => Number(/(-?[\d.]+) (?:-?[\d.]+) Td/.exec(s)?.[1] ?? '0');
        expect(xOf(middle)).toBeLessThan(xOf(start));
        expect(xOf(end)).toBeLessThan(xOf(middle));
    });

    it('decodes safe XML entities in text content', () => {
        const svg = '<svg viewBox="0 0 200 100"><text x="10" y="50">A &amp; B &lt; C</text></svg>';
        const out = renderSvg(svg, 0, 0, 200, 100, undefined, enc);
        expect(out).toContain('A & B < C');
    });

    it('renders text on top of shapes (shape cm first, then text)', () => {
        const svg = '<svg viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100" fill="#eee"/><text x="10" y="50">Over</text></svg>';
        const out = renderSvg(svg, 0, 0, 200, 100, undefined, enc);
        expect(out.indexOf('cm')).toBeGreaterThanOrEqual(0);
        expect(out.indexOf('cm')).toBeLessThan(out.indexOf('BT'));
    });
});
