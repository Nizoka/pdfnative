/**
 * Document outline (bookmarks) + page labels showcase (v1.4.0).
 *
 * Demonstrates:
 *   - Explicit nested /Outlines tree with bold/colour entries.
 *   - outline: 'auto' derived from heading blocks.
 *   - /PageLabels: roman-numeral front matter then decimal body.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, DocumentBlock, OutlineItem, PageLabelRange } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── Explicit nested outline + page labels ────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'heading', text: 'Preface', level: 1 },
            { type: 'paragraph', text: 'Front matter is numbered with roman numerals via /PageLabels.' },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Chapter 1 — Introduction', level: 1 },
            { type: 'paragraph', text: 'The body restarts at decimal page 1.' },
            { type: 'heading', text: '1.1 Background', level: 2 },
            { type: 'paragraph', text: 'A nested bookmark points here.' },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Chapter 2 — Methods', level: 1 },
            { type: 'paragraph', text: 'Bookmarks make long documents navigable.' },
            { type: 'heading', text: '2.1 Apparatus', level: 2 },
            { type: 'paragraph', text: 'Bold + coloured bookmark entry demonstrates /F and /C.' },
        ];

        const outline: OutlineItem[] = [
            { title: 'Preface', pageIndex: 0, italic: true },
            {
                title: 'Chapter 1 — Introduction', pageIndex: 1, bold: true, color: '#1a4fad',
                children: [{ title: '1.1 Background', pageIndex: 1 }],
            },
            {
                // Collapsed on open: its child is hidden until the reader expands
                // it (negative /Count). Demonstrates OutlineItem.open (v1.4.0).
                title: 'Chapter 2 — Methods', pageIndex: 2, bold: true, color: '#1a4fad', open: false,
                children: [{ title: '2.1 Apparatus', pageIndex: 2 }],
            },
        ];

        const pageLabels: PageLabelRange[] = [
            { startPage: 0, style: 'roman' },       // i
            { startPage: 1, style: 'decimal', start: 1 }, // 1, 2, 3…
        ];

        const params: DocumentParams = {
            title: 'Outline + Page Labels — Explicit',
            blocks,
            outline,
            pageLabels,
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'outline', 'outline-explicit.pdf'),
            'outline/outline-explicit.pdf',
            buildDocumentPDFBytes(params),
        );
    }

    // ── Auto outline derived from headings ───────────────────────
    {
        const blocks: DocumentBlock[] = [];
        for (let i = 1; i <= 4; i++) {
            blocks.push({ type: 'heading', text: `Section ${i}`, level: 1 });
            blocks.push({ type: 'paragraph', text: `Auto-generated bookmark for section ${i}.` });
            blocks.push({ type: 'heading', text: `Section ${i}.1`, level: 2 });
            blocks.push({ type: 'paragraph', text: 'Nested by heading level automatically.' });
            if (i < 4) blocks.push({ type: 'pageBreak' });
        }
        const params: DocumentParams = {
            title: 'Outline — Auto from Headings',
            blocks,
            outline: 'auto',
            pageLabels: [{ startPage: 0, style: 'decimal' }],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'outline', 'outline-auto.pdf'),
            'outline/outline-auto.pdf',
            buildDocumentPDFBytes(params),
        );
    }

    // ── Page labels with a prefixed appendix ─────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'heading', text: 'Cover', level: 1 },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Body', level: 1 },
            { type: 'paragraph', text: 'Decimal numbering.' },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Appendix A', level: 1 },
            { type: 'paragraph', text: 'Labelled A-1, A-2… via /P prefix.' },
        ];
        const params: DocumentParams = {
            title: 'Page Labels — Prefixed Appendix',
            blocks,
            pageLabels: [
                { startPage: 0, style: 'none', prefix: 'cover' },
                { startPage: 1, style: 'decimal', start: 1 },
                { startPage: 2, style: 'decimal', prefix: 'A-', start: 1 },
            ],
        };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'outline', 'page-labels.pdf'),
            'outline/page-labels.pdf',
            buildDocumentPDFBytes(params),
        );
    }
}
