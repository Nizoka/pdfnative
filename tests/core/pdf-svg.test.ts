/**
 * Tests for src/core/pdf-svg.ts — SVG path rendering to PDF operators.
 */

import { describe, it, expect } from 'vitest';
import { parseSvgPath, renderSvg } from '../../src/core/pdf-svg.js';

// ── parseSvgPath ─────────────────────────────────────────────────────

describe('parseSvgPath', () => {
    it('should parse simple moveto + lineto', () => {
        const segs = parseSvgPath('M10 20 L30 40');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [30, 40] },
        ]);
    });

    it('should parse with commas as separators', () => {
        const segs = parseSvgPath('M10,20 L30,40');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [30, 40] },
        ]);
    });

    it('should parse with no separators (negative signs)', () => {
        const segs = parseSvgPath('M10-20L30-40');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, -20] },
            { cmd: 'L', args: [30, -40] },
        ]);
    });

    it('should handle Z close path', () => {
        const segs = parseSvgPath('M0 0 L10 0 L10 10 Z');
        expect(segs).toHaveLength(4);
        expect(segs[3]).toEqual({ cmd: 'Z', args: [] });
    });

    it('should handle lowercase z', () => {
        const segs = parseSvgPath('M0 0 L10 0 z');
        expect(segs[2]).toEqual({ cmd: 'Z', args: [] });
    });

    it('should handle empty string', () => {
        expect(parseSvgPath('')).toEqual([]);
    });

    it('should handle whitespace-only string', () => {
        expect(parseSvgPath('   ')).toEqual([]);
    });

    // ── Relative Commands ────────────────────────────────────────

    it('should convert relative m to absolute M', () => {
        const segs = parseSvgPath('M10 10 m5 5');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 10] },
            { cmd: 'M', args: [15, 15] },
        ]);
    });

    it('should convert relative l to absolute L', () => {
        const segs = parseSvgPath('M10 20 l5 -3');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [15, 17] },
        ]);
    });

    it('should convert relative c to absolute C', () => {
        const segs = parseSvgPath('M10 10 c1 2 3 4 5 6');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 10] },
            { cmd: 'C', args: [11, 12, 13, 14, 15, 16] },
        ]);
    });

    // ── H/V Expansion ────────────────────────────────────────────

    it('should expand H to L', () => {
        const segs = parseSvgPath('M10 20 H50');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [50, 20] },
        ]);
    });

    it('should expand V to L', () => {
        const segs = parseSvgPath('M10 20 V50');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [10, 50] },
        ]);
    });

    it('should expand relative h to L', () => {
        const segs = parseSvgPath('M10 20 h30');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [40, 20] },
        ]);
    });

    it('should expand relative v to L', () => {
        const segs = parseSvgPath('M10 20 v30');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [10, 50] },
        ]);
    });

    // ── Implicit Repeated Commands ───────────────────────────────

    it('should treat M args after first pair as L', () => {
        const segs = parseSvgPath('M10 20 30 40 50 60');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [30, 40] },
            { cmd: 'L', args: [50, 60] },
        ]);
    });

    it('should handle multiple L pairs', () => {
        const segs = parseSvgPath('M0 0 L10 10 20 20');
        expect(segs).toEqual([
            { cmd: 'M', args: [0, 0] },
            { cmd: 'L', args: [10, 10] },
            { cmd: 'L', args: [20, 20] },
        ]);
    });

    // ── Smooth Cubic (S) ─────────────────────────────────────────

    it('should expand S after C with reflected control point', () => {
        const segs = parseSvgPath('M0 0 C10 20 30 40 50 50 S70 60 80 70');
        expect(segs).toHaveLength(3);
        expect(segs[2].cmd).toBe('C');
        // Reflected: 2*50-30 = 70, 2*50-40 = 60
        expect(segs[2].args[0]).toBeCloseTo(70);
        expect(segs[2].args[1]).toBeCloseTo(60);
    });

    it('should expand S without preceding C (no reflection)', () => {
        const segs = parseSvgPath('M0 0 S10 20 30 40');
        expect(segs).toHaveLength(2);
        expect(segs[1].cmd).toBe('C');
        // No previous C, so reflected CP = current point (0,0)
        expect(segs[1].args[0]).toBeCloseTo(0);
        expect(segs[1].args[1]).toBeCloseTo(0);
    });

    // ── Quadratic to Cubic (Q) ───────────────────────────────────

    it('should convert Q to C via De Casteljau', () => {
        const segs = parseSvgPath('M0 0 Q50 100 100 0');
        expect(segs).toHaveLength(2);
        expect(segs[1].cmd).toBe('C');
        // CP1 = (0 + 2/3*(50-0), 0 + 2/3*(100-0)) ≈ (33.33, 66.67)
        expect(segs[1].args[0]).toBeCloseTo(33.33, 1);
        expect(segs[1].args[1]).toBeCloseTo(66.67, 1);
        // CP2 = (100 + 2/3*(50-100), 0 + 2/3*(100-0)) ≈ (66.67, 66.67)
        expect(segs[1].args[2]).toBeCloseTo(66.67, 1);
        expect(segs[1].args[3]).toBeCloseTo(66.67, 1);
        // End point
        expect(segs[1].args[4]).toBeCloseTo(100);
        expect(segs[1].args[5]).toBeCloseTo(0);
    });

    // ── Smooth Quadratic (T) ─────────────────────────────────────

    it('should expand T with reflected Q control point', () => {
        const segs = parseSvgPath('M0 0 Q50 100 100 0 T200 0');
        expect(segs).toHaveLength(3);
        expect(segs[2].cmd).toBe('C');
        // Reflected Q point: 2*100-50 = 150, 2*0-100 = -100
        // CP1 = (100 + 2/3*(150-100), 0 + 2/3*(-100-0)) ≈ (133.33, -66.67)
        expect(segs[2].args[0]).toBeCloseTo(133.33, 1);
        expect(segs[2].args[1]).toBeCloseTo(-66.67, 1);
    });

    // ── Arc (A) ──────────────────────────────────────────────────

    it('should convert arc to cubic bezier segments', () => {
        const segs = parseSvgPath('M0 50 A50 50 0 0 1 50 0');
        // M + at least one C segment
        expect(segs.length).toBeGreaterThanOrEqual(2);
        expect(segs[0].cmd).toBe('M');
        // All arc segments should be cubic beziers
        for (let i = 1; i < segs.length; i++) {
            expect(segs[i].cmd).toBe('C');
        }
        // Last point should be close to (50, 0)
        const last = segs[segs.length - 1];
        expect(last.args[4]).toBeCloseTo(50, 0);
        expect(last.args[5]).toBeCloseTo(0, 0);
    });

    it('should degenerate zero-radius arc to lineto', () => {
        const segs = parseSvgPath('M0 0 A0 0 0 0 1 10 10');
        expect(segs).toEqual([
            { cmd: 'M', args: [0, 0] },
            { cmd: 'L', args: [10, 10] },
        ]);
    });

    it('should degenerate same-point arc to lineto', () => {
        const segs = parseSvgPath('M10 10 A50 50 0 0 1 10 10');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 10] },
            { cmd: 'L', args: [10, 10] },
        ]);
    });

    it('should handle large arc flag', () => {
        const segs = parseSvgPath('M0 50 A50 50 0 1 1 50 0');
        expect(segs.length).toBeGreaterThan(2);
        const last = segs[segs.length - 1];
        expect(last.args[4]).toBeCloseTo(50, 0);
        expect(last.args[5]).toBeCloseTo(0, 0);
    });

    it('should handle rotated arc', () => {
        const segs = parseSvgPath('M0 0 A50 25 45 0 1 100 0');
        expect(segs.length).toBeGreaterThanOrEqual(2);
        const last = segs[segs.length - 1];
        expect(last.args[4]).toBeCloseTo(100, 0);
        expect(last.args[5]).toBeCloseTo(0, 0);
    });

    it('should handle relative arc', () => {
        const segs = parseSvgPath('M10 10 a40 40 0 0 1 40 -10');
        const last = segs[segs.length - 1];
        expect(last.args[4]).toBeCloseTo(50, 0);
        expect(last.args[5]).toBeCloseTo(0, 0);
    });

    // ── Scientific Notation ──────────────────────────────────────

    it('should parse scientific notation numbers', () => {
        const segs = parseSvgPath('M1e1 2e1 L3e1 4e1');
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [30, 40] },
        ]);
    });

    // ── Decimal Numbers ──────────────────────────────────────────

    it('should parse decimal numbers', () => {
        const segs = parseSvgPath('M1.5 2.7 L3.14 .5');
        expect(segs).toEqual([
            { cmd: 'M', args: [1.5, 2.7] },
            { cmd: 'L', args: [3.14, 0.5] },
        ]);
    });

    // ── Complex Path ─────────────────────────────────────────────

    it('should parse a complex path with mixed commands', () => {
        const segs = parseSvgPath('M10 80 C40 10 65 10 95 80 S150 150 180 80');
        expect(segs).toHaveLength(3);
        expect(segs[0].cmd).toBe('M');
        expect(segs[1].cmd).toBe('C');
        expect(segs[2].cmd).toBe('C');
    });

    it('should restore position after Z', () => {
        const segs = parseSvgPath('M10 20 L30 40 Z L5 5');
        expect(segs).toHaveLength(4);
        // After Z, current point resets to M's position (10,20)
        // L5 5 is absolute, so it's just (5,5)
        expect(segs[3]).toEqual({ cmd: 'L', args: [5, 5] });
    });

    it('should handle tab and newline separators', () => {
        const segs = parseSvgPath("M10\t20\nL30\r\n40");
        expect(segs).toEqual([
            { cmd: 'M', args: [10, 20] },
            { cmd: 'L', args: [30, 40] },
        ]);
    });
});

// ── renderSvg ────────────────────────────────────────────────────────

describe('renderSvg', () => {
    it('should return empty string for empty data', () => {
        expect(renderSvg('', 0, 0, 100, 100)).toBe('');
    });

    it('should return empty string for zero width', () => {
        expect(renderSvg('M0 0 L10 10', 0, 0, 0, 100)).toBe('');
    });

    it('should return empty string for zero height', () => {
        expect(renderSvg('M0 0 L10 10', 0, 0, 100, 0)).toBe('');
    });

    it('should render raw path data with default viewBox', () => {
        const ops = renderSvg('M0 0 L100 100 Z', 50, 300, 100, 100);
        expect(ops).toContain('q'); // outer save
        expect(ops).toContain('cm'); // coordinate transform
        expect(ops).toContain('m'); // moveto
        expect(ops).toContain('l'); // lineto
        expect(ops).toContain('h'); // closepath
        expect(ops).toContain('f'); // fill (default)
        expect(ops).toContain('Q'); // restore
    });

    it('should use default black fill', () => {
        const ops = renderSvg('M0 0 L10 0 L10 10 Z', 0, 100, 50, 50);
        // parseColor outputs minimal format: "0 0 0" not "0.00 0.00 0.00"
        expect(ops).toContain('0 0 0 rg');
    });

    it('should disable fill when fill=none', () => {
        const ops = renderSvg('M0 0 L10 0 L10 10 Z', 0, 100, 50, 50, {
            fill: 'none',
            stroke: '#000000',
        });
        expect(ops).not.toContain(' rg');
        expect(ops).toContain('0 0 0 RG');
        expect(ops).toContain('S'); // stroke only
    });

    it('should apply custom fill color', () => {
        const ops = renderSvg('M0 0 L10 10', 0, 100, 50, 50, {
            fill: '#FF0000',
        });
        expect(ops).toContain('1 0 0 rg');
    });

    it('should apply stroke color', () => {
        const ops = renderSvg('M0 0 L10 10', 0, 100, 50, 50, {
            stroke: '#0000FF',
        });
        expect(ops).toContain('0 0 1 RG');
    });

    it('should apply stroke width', () => {
        const ops = renderSvg('M0 0 L10 10', 0, 100, 50, 50, {
            stroke: '#000000',
            strokeWidth: 2,
        });
        expect(ops).toContain('2.00 w');
    });

    it('should use B paint op for fill+stroke', () => {
        const ops = renderSvg('M0 0 L10 0 L10 10 Z', 0, 100, 50, 50, {
            fill: '#FF0000',
            stroke: '#000000',
        });
        expect(ops).toContain('B');
    });

    it('should apply custom viewBox', () => {
        const ops = renderSvg('M0 0 L100 100', 0, 200, 50, 50, {
            viewBox: [0, 0, 100, 100],
        });
        // Scale should be 50/100 = 0.5
        expect(ops).toContain('0.50 0 0 -0.50');
    });

    it('should generate correct cm matrix for identity viewBox', () => {
        const ops = renderSvg('M0 0 L10 10', 50, 300, 200, 100, {
            viewBox: [0, 0, 200, 100],
        });
        // sx=1, sy=1, cmD=-1, cmE=50, cmF=300
        expect(ops).toContain('1.00 0 0 -1.00 50.00 300.00 cm');
    });

    // ── SVG Markup ───────────────────────────────────────────────

    it('should parse SVG markup with <path> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><path d="M10 10 L90 90" fill="none" stroke="#FF0000"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('m'); // moveto
        expect(ops).toContain('l'); // lineto
        expect(ops).toContain('1 0 0 RG'); // red stroke
        expect(ops).toContain('S'); // stroke only
    });

    it('should parse SVG markup with <rect> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="80" fill="#00FF00"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('m'); // moveto
        expect(ops).toContain('l'); // lineto
        expect(ops).toContain('h'); // closepath
        expect(ops).toContain('0 1 0 rg'); // green fill
    });

    it('should parse SVG markup with <circle> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#0000FF"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('c'); // cubic bezier (arc→cubic)
        expect(ops).toContain('0 0 1 rg'); // blue fill
    });

    it('should parse SVG markup with <ellipse> element', () => {
        const svg = '<svg viewBox="0 0 200 100"><ellipse cx="100" cy="50" rx="80" ry="40"/></svg>';
        const ops = renderSvg(svg, 0, 100, 200, 100);
        expect(ops).toContain('c'); // arcs → cubic
    });

    it('should parse SVG markup with <line> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100" stroke="black"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('m');
        expect(ops).toContain('l');
    });

    it('should parse SVG markup with <polygon> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><polygon points="50,0 100,100 0,100" fill="red"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('m');
        expect(ops).toContain('l');
        expect(ops).toContain('h'); // closed
    });

    it('should parse SVG markup with <polyline> element', () => {
        const svg = '<svg viewBox="0 0 100 100"><polyline points="0,0 50,50 100,0" stroke="blue" fill="none"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('m');
        expect(ops).toContain('l');
        expect(ops).not.toContain('h'); // NOT closed
    });

    it('should extract viewBox from SVG markup', () => {
        const svg = '<svg viewBox="0 0 200 100"><path d="M0 0 L200 100"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 50);
        // Scale: 100/200 = 0.5 horizontal, 50/100 = 0.5 vertical
        expect(ops).toContain('0.50 0 0 -0.50');
    });

    it('should handle multiple elements in SVG markup', () => {
        const svg = `<svg viewBox="0 0 100 100">
            <rect x="0" y="0" width="100" height="100" fill="#CCCCCC"/>
            <circle cx="50" cy="50" r="30" fill="#FF0000"/>
        </svg>`;
        const ops = renderSvg(svg, 0, 100, 100, 100);
        // Should have both fills
        expect(ops).toContain('0.8 0.8 0.8 rg'); // gray
        expect(ops).toContain('1 0 0 rg'); // red
    });

    it('should return empty for SVG with no recognizable elements', () => {
        const svg = '<svg viewBox="0 0 100 100"><text>Hello</text></svg>';
        expect(renderSvg(svg, 0, 100, 100, 100)).toBe('');
    });

    it('should handle rounded rect', () => {
        const svg = '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="80" height="60" rx="10" ry="10"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100);
        expect(ops).toContain('c'); // rounded corners use arcs→cubics
    });

    it('should handle zero-size rect gracefully', () => {
        const svg = '<svg viewBox="0 0 100 100"><rect x="0" y="0" width="0" height="0"/></svg>';
        expect(renderSvg(svg, 0, 100, 100, 100)).toBe('');
    });

    it('should handle zero-radius circle gracefully', () => {
        const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="0"/></svg>';
        expect(renderSvg(svg, 0, 100, 100, 100)).toBe('');
    });

    // ── Option Overrides ─────────────────────────────────────────

    it('should override SVG markup viewBox with options.viewBox', () => {
        const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 L100 100"/></svg>';
        const ops = renderSvg(svg, 0, 100, 200, 200, { viewBox: [0, 0, 200, 200] });
        // Should use 200x200 viewBox, not 100x100
        expect(ops).toContain('1.00 0 0 -1.00');
    });

    it('should apply block-level fill as default for elements without fill', () => {
        const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 L100 100 Z"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100, { fill: '#FF0000' });
        expect(ops).toContain('1 0 0 rg');
    });

    it('should let element fill override block-level fill', () => {
        const svg = '<svg viewBox="0 0 100 100"><path d="M0 0 L100 100 Z" fill="#00FF00"/></svg>';
        const ops = renderSvg(svg, 0, 100, 100, 100, { fill: '#FF0000' });
        expect(ops).toContain('0 1 0 rg'); // element green, not block red
    });
});

// ── Document Builder Integration ─────────────────────────────────────

describe('SvgBlock in document builder', () => {
    // Import the document builder dynamically to avoid circular deps
    it('should render SvgBlock in buildDocumentPDFBytes', async () => {
        const { buildDocumentPDFBytes } = await import('../../src/core/pdf-document.js');
        const pdf = buildDocumentPDFBytes({
            title: 'SVG Test',
            blocks: [
                {
                    type: 'svg',
                    data: 'M0 0 L100 0 L100 100 L0 100 Z',
                    width: 100,
                    height: 100,
                },
            ],
        });
        expect(pdf).toBeInstanceOf(Uint8Array);
        expect(pdf.length).toBeGreaterThan(100);
    });

    it('should render SvgBlock with SVG markup', async () => {
        const { buildDocumentPDFBytes } = await import('../../src/core/pdf-document.js');
        const pdf = buildDocumentPDFBytes({
            title: 'SVG Markup Test',
            blocks: [
                {
                    type: 'svg',
                    data: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/></svg>',
                    width: 100,
                    height: 100,
                    align: 'center',
                },
            ],
        });
        expect(pdf).toBeInstanceOf(Uint8Array);
    });

    it('should render SvgBlock with tagged mode', async () => {
        const { buildDocumentPDF } = await import('../../src/core/pdf-document.js');
        const pdfStr = buildDocumentPDF({
            title: 'SVG Tagged Test',
            blocks: [
                {
                    type: 'svg',
                    data: 'M0 0 L50 50 Z',
                    width: 50,
                    height: 50,
                    alt: 'A triangle',
                },
            ],
        }, { tagged: true });
        // Verify tagged mode markers
        expect(pdfStr).toContain('/Span');
        expect(pdfStr).toContain('BDC');
        expect(pdfStr).toContain('EMC');
        expect(pdfStr).toContain('/Figure');
        expect(pdfStr).toContain('/ActualText');
    });

    it('should render multiple SVG blocks', async () => {
        const { buildDocumentPDFBytes } = await import('../../src/core/pdf-document.js');
        const pdf = buildDocumentPDFBytes({
            title: 'Multi SVG',
            blocks: [
                { type: 'svg', data: 'M0 0 L10 10 Z', width: 50, height: 50 },
                { type: 'svg', data: 'M0 0 L20 20 Z', width: 80, height: 80, align: 'right' },
            ],
        });
        expect(pdf).toBeInstanceOf(Uint8Array);
    });

    it('should handle SVG block with all options', async () => {
        const { buildDocumentPDFBytes } = await import('../../src/core/pdf-document.js');
        const pdf = buildDocumentPDFBytes({
            title: 'Full SVG Options',
            blocks: [
                {
                    type: 'svg',
                    data: '<svg viewBox="0 0 200 200"><rect x="10" y="10" width="180" height="180" rx="20" fill="#336699" stroke="#000" stroke-width="2"/></svg>',
                    width: 150,
                    height: 150,
                    align: 'center',
                    fill: '#336699',
                    stroke: '#000000',
                    strokeWidth: 2,
                    alt: 'A rounded rectangle',
                },
            ],
        });
        expect(pdf).toBeInstanceOf(Uint8Array);
    });

    it('should mix SVG with other block types', async () => {
        const { buildDocumentPDFBytes } = await import('../../src/core/pdf-document.js');
        const pdf = buildDocumentPDFBytes({
            title: 'Mixed Blocks',
            blocks: [
                { type: 'heading', text: 'SVG Section', level: 1 },
                { type: 'paragraph', text: 'Here is a vector graphic:' },
                { type: 'svg', data: 'M0 0 L50 50 L100 0 Z', width: 100, height: 50, fill: '#FF6600' },
                { type: 'paragraph', text: 'And some text after.' },
            ],
        });
        expect(pdf).toBeInstanceOf(Uint8Array);
    });
});
