/**
 * SVG <text> rendering showcase (v1.5.0 — issue #61).
 *
 * SVG `<text>` elements render as upright PDF text with x/y positioning and
 * text-anchor (start / middle / end) support. Text is emitted outside the SVG
 * coordinate transform so it stays upright regardless of the viewBox scaling.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const params: DocumentParams = {
        title: 'SVG <text> labels (v1.5.0)',
        blocks: [
            { type: 'heading', text: 'SVG <text> rendering', level: 1 },
            { type: 'paragraph', text: 'SVG <text> elements render as upright PDF text with text-anchor support — ideal for labelled diagrams and charts.' },

            { type: 'heading', text: 'text-anchor alignment', level: 2 },
            {
                type: 'svg',
                data: `<svg viewBox="0 0 300 120">
                    <line x1="150" y1="0" x2="150" y2="120" stroke="#ccc" stroke-width="1"/>
                    <text x="150" y="30" text-anchor="start" font-size="14">start anchored</text>
                    <text x="150" y="60" text-anchor="middle" font-size="14">middle anchored</text>
                    <text x="150" y="90" text-anchor="end" font-size="14">end anchored</text>
                </svg>`,
                width: 300, height: 120,
                align: 'center',
            },

            { type: 'heading', text: 'Labelled bar chart', level: 2 },
            {
                type: 'svg',
                data: `<svg viewBox="0 0 320 160">
                    <rect x="20" y="60" width="40" height="80" fill="#2563EB"/>
                    <rect x="80" y="30" width="40" height="110" fill="#2563EB"/>
                    <rect x="140" y="90" width="40" height="50" fill="#2563EB"/>
                    <rect x="200" y="20" width="40" height="120" fill="#2563EB"/>
                    <text x="40" y="155" text-anchor="middle" font-size="11">Q1</text>
                    <text x="100" y="155" text-anchor="middle" font-size="11">Q2</text>
                    <text x="160" y="155" text-anchor="middle" font-size="11">Q3</text>
                    <text x="220" y="155" text-anchor="middle" font-size="11">Q4</text>
                    <text x="10" y="15" text-anchor="start" font-size="12">Revenue</text>
                </svg>`,
                width: 320, height: 160,
                align: 'center',
            },
        ],
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'svg', 'svg-text-labels.pdf'),
        'svg/svg-text-labels.pdf',
        buildDocumentPDFBytes(params),
    );
}
