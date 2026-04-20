/**
 * Watermark sample PDFs — text + image overlays with opacity, rotation, position.
 */

import { resolve } from 'path';
import { buildPDFBytes, buildDocumentPDFBytes } from '../../src/index.js';
import type { PdfParams, DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { makeMinimalJPEG } from '../helpers/images.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const baseRows = Array.from({ length: 20 }, (_, i) => ({
        cells: [
            `2026-01-${String(i + 1).padStart(2, '0')}`,
            `Transaction #${i + 1} – Monthly payment`,
            `${(100 + i * 10).toFixed(2)}`,
            '',
            `${(5000 - i * 10).toFixed(2)}`,
        ],
        type: i % 2 === 0 ? 'debit' : 'credit',
        pointed: i === 0,
    }));

    const baseParams: PdfParams = {
        title: 'Watermark Sample – Financial Statement',
        infoItems: [
            { label: 'Account', value: 'FR76 3000 6000 0112 3456 7890 189' },
            { label: 'Period', value: '01/01/2026 – 31/01/2026' },
        ],
        balanceText: '€ 5,000.00',
        countText: '20 operations',
        headers: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
        rows: baseRows,
        footerText: 'pdfnative – Watermark sample',
    };

    // ── Text watermark (background, default rotation) ────────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'watermark', 'watermark-text-bg.pdf'),
        'watermark/watermark-text-bg.pdf',
        buildPDFBytes(baseParams, {
            watermark: {
                text: { text: 'CONFIDENTIAL', fontSize: 60, opacity: 0.15, angle: 45 },
                position: 'background',
            },
        }),
    );

    // ── Text watermark (foreground, horizontal) ──────────────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'watermark', 'watermark-text-fg.pdf'),
        'watermark/watermark-text-fg.pdf',
        buildPDFBytes(baseParams, {
            watermark: {
                text: { text: 'DRAFT', fontSize: 80, opacity: 0.10, angle: 0, color: '#FF0000' },
                position: 'foreground',
            },
        }),
    );

    // ── Image watermark (background) ─────────────────────────────
    {
        const jpegBytes = makeMinimalJPEG();
        ctx.writeSafe(
            resolve(ctx.outputDir, 'watermark', 'watermark-image-bg.pdf'),
            'watermark/watermark-image-bg.pdf',
            buildPDFBytes(baseParams, {
                watermark: {
                    image: { data: jpegBytes, opacity: 0.08, width: 200 },
                    position: 'background',
                },
            }),
        );
    }

    // ── Text watermark on document builder ───────────────────────
    {
        const docParams: DocumentParams = {
            title: 'Document with Watermark',
            blocks: [
                { type: 'heading', text: 'Watermarked Document', level: 1 },
                { type: 'paragraph', text: 'This document demonstrates text watermarks applied to a free-form document builder output. The watermark appears as semi-transparent rotated text in the background of every page.' },
                { type: 'heading', text: 'Financial Summary', level: 2 },
                { type: 'table', headers: ['Quarter', 'Revenue', 'Expenses', 'Profit'], rows: [
                    { cells: ['Q1', '$1.2M', '$800K', '$400K'], type: 'credit', pointed: false },
                    { cells: ['Q2', '$1.5M', '$900K', '$600K'], type: 'credit', pointed: false },
                    { cells: ['Q3', '$1.3M', '$850K', '$450K'], type: 'credit', pointed: true },
                    { cells: ['Q4', '$1.8M', '$950K', '$850K'], type: 'credit', pointed: false },
                ]},
                { type: 'paragraph', text: 'The watermark is positioned in the background layer, below all content. Opacity is set to 15% for readability.' },
            ],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'watermark', 'watermark-doc-text.pdf'),
            'watermark/watermark-doc-text.pdf',
            buildDocumentPDFBytes(docParams, {
                watermark: {
                    text: { text: 'INTERNAL USE ONLY', fontSize: 48, opacity: 0.15, angle: 30 },
                    position: 'background',
                },
            }),
        );
    }

    // ── Text watermark with custom color + high opacity ──────────
    ctx.writeSafe(
        resolve(ctx.outputDir, 'watermark', 'watermark-text-custom.pdf'),
        'watermark/watermark-text-custom.pdf',
        buildPDFBytes(baseParams, {
            watermark: {
                text: { text: 'SAMPLE', fontSize: 70, opacity: 0.25, angle: -30, color: '#2563EB' },
                position: 'foreground',
            },
        }),
    );

    // ── Image watermark (foreground) on document builder ─────────
    {
        const jpegBytes = makeMinimalJPEG();
        const docParams: DocumentParams = {
            title: 'Image Watermark Document',
            blocks: [
                { type: 'heading', text: 'Image Watermark Test', level: 1 },
                { type: 'paragraph', text: 'This document uses an image watermark in the foreground layer. The image is rendered at 10% opacity over the content.' },
                { type: 'list', items: ['Supports JPEG and PNG formats', 'Auto-centering with aspect ratio', 'Configurable width and height', 'Background or foreground position'], style: 'bullet' },
            ],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'watermark', 'watermark-doc-image.pdf'),
            'watermark/watermark-doc-image.pdf',
            buildDocumentPDFBytes(docParams, {
                watermark: {
                    image: { data: jpegBytes, opacity: 0.10, width: 150 },
                    position: 'foreground',
                },
            }),
        );
    }
}
