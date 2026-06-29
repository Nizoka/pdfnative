/**
 * Smart-table parity samples (v1.2.0).
 *
 * Demonstrates the new `TableBlock` capabilities:
 *   1. `table-wrap-auto`            — `wrap: 'auto'` wraps overflowing cells.
 *   2. `table-multipage-header-repeat` — 120 rows across pages with repeated header.
 *   3. `table-zebra-caption`        — alternating row tint + captioned table.
 *   4. `table-smart-autofit`        — `autoFitColumns: true` shrinks columns
 *                                     proportionally; auto-wrap handles the rest.
 *
 * Open each PDF and visually verify cell wrapping, header repetition,
 * zebra striping, and caption placement.
 */

import { resolve } from 'node:path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { GenerateContext } from '../helpers/io.js';

function makeRows(n: number, longTail = false): { cells: string[]; type: string; pointed: boolean }[] {
    return Array.from({ length: n }, (_, i) => {
        const amt = (i + 1) * (i % 2 === 0 ? 12.34 : 7.89);
        const signed = i % 2 === 0 ? `+${amt.toFixed(2)}` : `-${amt.toFixed(2)}`;
        return {
            cells: [
                `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
                longTail
                    ? `Transaction ${i + 1} with an unusually verbose human-written description that genuinely deserves wrapping across multiple lines`
                    : `Transaction ${i + 1}`,
                i % 3 === 0 ? 'Operations' : (i % 3 === 1 ? 'Marketing' : 'R&D'),
                signed,
                i % 5 === 0 ? 'Recurring' : '',
            ],
            type: i % 2 === 0 ? 'credit' : 'debit',
            pointed: false,
        };
    });
}

async function generateWrapAuto(ctx: GenerateContext): Promise<void> {
    const doc: DocumentParams = {
        title: 'Table — wrap=auto (smart cell wrapping)',
        blocks: [
            { type: 'heading', text: 'Auto cell wrapping', level: 1 },
            {
                type: 'paragraph',
                text: 'Cells that fit stay on a single line. Cells that overflow their column wrap to multiple lines automatically. This is the new default in pdfnative v1.2.0.',
            },
            {
                type: 'table',
                headers: ['Date', 'Description', 'Team', 'Amount'],
                rows: makeRows(8, true),
                columns: [
                    { f: 0.15, a: 'l', mx: 12, mxH: 12 },
                    { f: 0.52, a: 'l', mx: 80, mxH: 80 },
                    { f: 0.15, a: 'l', mx: 20, mxH: 20 },
                    { f: 0.18, a: 'r', mx: 18, mxH: 18 },
                ],
                wrap: 'auto',
            },
        ],
        footerText: 'pdfnative v1.2.0 — table wrap=auto',
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'document', 'table-wrap-auto.pdf'),
        'document/table-wrap-auto.pdf',
        buildDocumentPDFBytes(doc),
    );
}

async function generateMultiPageRepeatHeader(ctx: GenerateContext): Promise<void> {
    const doc: DocumentParams = {
        title: 'Table — multi-page with repeated header',
        blocks: [
            { type: 'heading', text: '120-row ledger spanning multiple pages', level: 1 },
            {
                type: 'paragraph',
                text: 'The header row is re-drawn at the top of every continuation page so readers do not lose the column legend (the default for multi-page tables in v1.2.0).',
            },
            {
                type: 'table',
                headers: ['Date', 'Description', 'Team', 'Amount', 'Tag'],
                rows: makeRows(120),
                // repeatHeader is the default `true` — shown explicitly for clarity.
                repeatHeader: true,
            },
        ],
        footerText: 'pdfnative v1.2.0 — repeatHeader',
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'document', 'table-multipage-header-repeat.pdf'),
        'document/table-multipage-header-repeat.pdf',
        buildDocumentPDFBytes(doc),
    );
}

async function generateZebraCaption(ctx: GenerateContext): Promise<void> {
    const doc: DocumentParams = {
        title: 'Table — zebra striping + caption',
        blocks: [
            { type: 'heading', text: 'Captioned table with zebra rows', level: 1 },
            {
                type: 'paragraph',
                text: 'The caption is rendered immediately above the table and (in tagged mode) emitted as a /Caption structure element per ISO 14289-1 §7.10.6.',
            },
            {
                type: 'table',
                headers: ['Date', 'Description', 'Team', 'Amount', 'Tag'],
                rows: makeRows(10),
                caption: 'Table 1 — Sample ledger, May 2026',
                zebra: true,
            },
        ],
        footerText: 'pdfnative v1.2.0 — zebra + caption',
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'document', 'table-zebra-caption.pdf'),
        'document/table-zebra-caption.pdf',
        buildDocumentPDFBytes(doc),
    );
}

async function generateSmartAutoFit(ctx: GenerateContext): Promise<void> {
    const doc: DocumentParams = {
        title: 'Table — smart auto-fit columns',
        blocks: [
            { type: 'heading', text: 'autoFitColumns + wrap=auto', level: 1 },
            {
                type: 'paragraph',
                text: 'When autoFitColumns is enabled, column fractions are derived from actual content widths. If the content still exceeds the page width, columns shrink proportionally and wrap=auto kicks in to fit each cell.',
            },
            {
                type: 'table',
                headers: ['ID', 'Verbose product name', 'Status', 'Notes'],
                rows: [
                    { cells: ['1', 'Widget Pro Max XL Limited Edition with extended warranty', 'In stock', 'Ships from EU warehouse'], type: 'credit', pointed: false },
                    { cells: ['2', 'Gadget Ultra Slim', 'Backorder', 'Restock expected mid-June'], type: 'credit', pointed: false },
                    { cells: ['3', 'Thingamajig', 'In stock', 'Ships same day'], type: 'credit', pointed: false },
                    { cells: ['42', 'Long-description specialty item that pushes the visible column far beyond the comfortable width', 'Discontinued', 'Last unit'], type: 'debit', pointed: false },
                ],
                autoFitColumns: true,
                wrap: 'auto',
                caption: 'Table 2 — Auto-fit + auto-wrap interplay',
            },
        ],
        footerText: 'pdfnative v1.2.0 — smart auto-fit',
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'document', 'table-smart-autofit.pdf'),
        'document/table-smart-autofit.pdf',
        buildDocumentPDFBytes(doc),
    );
}

async function generateCellBordersVAlign(ctx: GenerateContext): Promise<void> {
    const doc: DocumentParams = {
        title: 'Table — cell borders + vertical alignment',
        blocks: [
            { type: 'heading', text: 'Per-cell borders + vertical alignment (v1.4.0)', level: 1 },
            {
                type: 'paragraph',
                text: 'cellBorders strokes per-cell vector edges (solid/dashed/dotted); cellVAlign positions cell text top/middle/bottom within each row band. Both are opt-in — tables that set neither are byte-identical to pre-1.4.0.',
            },
            {
                type: 'table',
                headers: ['SKU', 'Item description', 'Qty', 'Amount'],
                rows: [
                    { cells: ['A-100', 'Single-line short cell', '2', '+24.00'], type: 'credit', pointed: false },
                    { cells: ['A-101', 'A deliberately verbose multi-line wrapped description so the row grows tall enough to show vertical alignment', '1', '-9.50'], type: 'debit', pointed: false },
                    { cells: ['A-102', 'Another item', '5', '+62.10'], type: 'credit', pointed: false },
                ],
                columns: [
                    { f: 0.14, a: 'l', mx: 12, mxH: 12, vAlign: 'top' },
                    { f: 0.55, a: 'l', mx: 80, mxH: 80 },
                    { f: 0.12, a: 'c', mx: 8, mxH: 8, vAlign: 'bottom' },
                    { f: 0.19, a: 'r', mx: 14, mxH: 14, kind: 'amount' },
                ],
                wrap: 'auto',
                cellVAlign: 'middle',
                cellBorders: { all: true, color: '#9aa0aa', width: 0.5, style: 'solid' },
                caption: 'Table — solid borders, mixed vAlign',
            },
            { type: 'spacer', height: 16 },
            {
                type: 'table',
                headers: ['Metric', 'Q1', 'Q2'],
                rows: [
                    { cells: ['Revenue', '120', '138'], type: 'credit', pointed: false },
                    { cells: ['Margin', '18%', '21%'], type: 'credit', pointed: false },
                ],
                cellBorders: { bottom: true, style: 'dashed', color: '#1a4fad', width: 0.75 },
                caption: 'Table — dashed bottom rule only',
            },
        ],
        footerText: 'pdfnative v1.4.0 — cellBorders + cellVAlign',
    };
    ctx.writeSafe(
        resolve(ctx.outputDir, 'document', 'table-cell-borders.pdf'),
        'document/table-cell-borders.pdf',
        buildDocumentPDFBytes(doc),
    );
}

export async function generate(ctx: GenerateContext): Promise<void> {
    await generateWrapAuto(ctx);
    await generateMultiPageRepeatHeader(ctx);
    await generateZebraCaption(ctx);
    await generateSmartAutoFit(ctx);
    await generateCellBordersVAlign(ctx);
}
