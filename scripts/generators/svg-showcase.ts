/**
 * SVG path rendering samples — raw paths, basic shapes, and full SVG markup.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── SVG shapes & paths showcase ──────────────────────────────
    {
        const params: DocumentParams = {
            title: 'SVG Path Rendering Showcase',
            blocks: [
                { type: 'heading', text: 'SVG Path Rendering Showcase', level: 1 },
                { type: 'paragraph', text: 'pdfnative renders SVG paths as native PDF path operators — pure vector, no rasterization. Supports raw path data and full SVG markup with 7 element types.' },

                // ── Raw SVG path d strings ───────────────────────
                { type: 'heading', text: 'Raw SVG Path Data', level: 2 },
                { type: 'paragraph', text: 'Triangle (M/L/Z commands):' },
                {
                    type: 'svg',
                    data: 'M 10 80 L 50 10 L 90 80 Z',
                    width: 100, height: 100,
                    viewBox: [0, 0, 100, 100],
                    fill: '#2563EB',
                },

                { type: 'paragraph', text: 'Star polygon (absolute coordinates):' },
                {
                    type: 'svg',
                    data: 'M 50 5 L 63 38 L 98 38 L 70 60 L 80 95 L 50 73 L 20 95 L 30 60 L 2 38 L 37 38 Z',
                    width: 120, height: 120,
                    viewBox: [0, 0, 100, 100],
                    fill: '#F59E0B',
                    stroke: '#D97706',
                    strokeWidth: 1.5,
                    align: 'center',
                },

                { type: 'paragraph', text: 'Cubic Bézier curve:' },
                {
                    type: 'svg',
                    data: 'M 10 80 C 30 10, 70 10, 90 80',
                    width: 120, height: 100,
                    viewBox: [0, 0, 100, 100],
                    fill: 'none',
                    stroke: '#DC2626',
                    strokeWidth: 2,
                },

                // ── SVG markup with basic shapes ─────────────────
                { type: 'heading', text: 'SVG Markup — Basic Shapes', level: 2 },
                { type: 'paragraph', text: 'Rectangles, circles, and ellipses parsed from SVG markup:' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 300 120">
                        <rect x="10" y="10" width="80" height="80" rx="10" fill="#3B82F6"/>
                        <circle cx="160" cy="50" r="40" fill="#10B981"/>
                        <ellipse cx="260" cy="50" rx="35" ry="25" fill="#8B5CF6"/>
                    </svg>`,
                    width: 300, height: 120,
                    align: 'center',
                    alt: 'Three basic SVG shapes: rounded rectangle, circle, and ellipse',
                },

                { type: 'paragraph', text: 'Lines and polylines:' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 200 100">
                        <line x1="10" y1="90" x2="190" y2="10" stroke="#EF4444" stroke-width="2"/>
                        <polyline points="10,50 50,20 90,70 130,30 170,60" fill="none" stroke="#6366F1" stroke-width="2"/>
                    </svg>`,
                    width: 200, height: 100,
                    fill: 'none',
                    stroke: '#000000',
                    align: 'center',
                },

                // ── Multi-element composition ────────────────────
                { type: 'heading', text: 'Multi-Element Composition', level: 2 },
                { type: 'paragraph', text: 'Traffic light — nested circles with element-level colors:' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 60 160">
                        <rect x="5" y="5" width="50" height="150" rx="8" fill="#374151"/>
                        <circle cx="30" cy="35" r="18" fill="#EF4444"/>
                        <circle cx="30" cy="80" r="18" fill="#F59E0B"/>
                        <circle cx="30" cy="125" r="18" fill="#10B981"/>
                    </svg>`,
                    width: 60, height: 160,
                    align: 'center',
                    alt: 'Traffic light with red, yellow, and green circles',
                },

                { type: 'paragraph', text: 'House icon — polygon roof with rectangular body:' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 120 100">
                        <polygon points="60,5 10,45 110,45" fill="#92400E"/>
                        <rect x="25" y="45" width="70" height="50" fill="#FCD34D"/>
                        <rect x="50" y="60" width="20" height="35" fill="#78350F"/>
                    </svg>`,
                    width: 120, height: 100,
                    align: 'center',
                    alt: 'Simple house icon',
                },

                // ── Alignment variations ─────────────────────────
                { type: 'heading', text: 'Alignment Options', level: 2 },
                { type: 'paragraph', text: 'Left-aligned:' },
                {
                    type: 'svg',
                    data: 'M 0 25 L 50 0 L 50 50 Z',
                    width: 60, height: 60,
                    viewBox: [0, 0, 50, 50],
                    fill: '#0EA5E9',
                    align: 'left',
                },
                { type: 'paragraph', text: 'Center-aligned:' },
                {
                    type: 'svg',
                    data: 'M 0 25 L 50 0 L 50 50 Z',
                    width: 60, height: 60,
                    viewBox: [0, 0, 50, 50],
                    fill: '#0EA5E9',
                    align: 'center',
                },
                { type: 'paragraph', text: 'Right-aligned:' },
                {
                    type: 'svg',
                    data: 'M 0 25 L 50 0 L 50 50 Z',
                    width: 60, height: 60,
                    viewBox: [0, 0, 50, 50],
                    fill: '#0EA5E9',
                    align: 'right',
                },
            ],
            footerText: 'pdfnative – SVG Path Rendering',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'svg-showcase.pdf'), 'svg-showcase.pdf', buildDocumentPDFBytes(params));
    }

    // ── SVG sizing & stroke variations ───────────────────────────
    {
        const params: DocumentParams = {
            title: 'SVG Stroke & Size Variations',
            blocks: [
                { type: 'heading', text: 'SVG Stroke & Size Variations', level: 1 },

                { type: 'heading', text: 'Stroke Widths', level: 2 },
                { type: 'paragraph', text: 'Same circle at different stroke widths (0.5, 1, 2, 4):' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 320 80">
                        <circle cx="40" cy="40" r="30" fill="none" stroke="#1D4ED8" stroke-width="0.5"/>
                        <circle cx="120" cy="40" r="30" fill="none" stroke="#1D4ED8" stroke-width="1"/>
                        <circle cx="200" cy="40" r="30" fill="none" stroke="#1D4ED8" stroke-width="2"/>
                        <circle cx="280" cy="40" r="30" fill="none" stroke="#1D4ED8" stroke-width="4"/>
                    </svg>`,
                    width: 320, height: 80,
                    fill: 'none',
                    align: 'center',
                },

                { type: 'heading', text: 'Scale Comparison', level: 2 },
                { type: 'paragraph', text: 'Same path at 60pt, 100pt, and 160pt:' },
                {
                    type: 'svg',
                    data: 'M 5 45 L 25 5 L 45 45 Z',
                    width: 60, height: 60,
                    viewBox: [0, 0, 50, 50],
                    fill: '#059669',
                },
                {
                    type: 'svg',
                    data: 'M 5 45 L 25 5 L 45 45 Z',
                    width: 100, height: 100,
                    viewBox: [0, 0, 50, 50],
                    fill: '#059669',
                },
                {
                    type: 'svg',
                    data: 'M 5 45 L 25 5 L 45 45 Z',
                    width: 160, height: 160,
                    viewBox: [0, 0, 50, 50],
                    fill: '#059669',
                },

                { type: 'heading', text: 'Fill + Stroke Combination', level: 2 },
                { type: 'paragraph', text: 'Rounded rectangle with fill and contrasting stroke:' },
                {
                    type: 'svg',
                    data: `<svg viewBox="0 0 120 80">
                        <rect x="5" y="5" width="110" height="70" rx="12" fill="#DBEAFE" stroke="#2563EB" stroke-width="2"/>
                    </svg>`,
                    width: 180, height: 120,
                    align: 'center',
                },
            ],
            footerText: 'pdfnative – SVG Stroke & Size Variations',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'svg-variations.pdf'), 'svg-variations.pdf', buildDocumentPDFBytes(params));
    }
}
