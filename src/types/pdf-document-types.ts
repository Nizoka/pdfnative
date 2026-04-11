/**
 * pdfnative — Document Content Model Types
 * ==========================================
 * Types for the free-form document builder API (Phase 4).
 * Supports headings, paragraphs, lists, tables, spacers, and page breaks.
 */

import type { PdfRow, ColumnDef, FontEntry, PdfLayoutOptions, PdfColor } from './pdf-types.js';

// ── Block Types ──────────────────────────────────────────────────────

/** Heading block — rendered at a predefined size based on level. */
export interface HeadingBlock {
    readonly type: 'heading';
    readonly text: string;
    readonly level: 1 | 2 | 3;
    readonly color?: PdfColor;
}

/** Paragraph block — text wrapping with configurable alignment. */
export interface ParagraphBlock {
    readonly type: 'paragraph';
    readonly text: string;
    readonly fontSize?: number;
    readonly lineHeight?: number;
    readonly align?: 'left' | 'right' | 'center';
    readonly indent?: number;
    readonly color?: PdfColor;
}

/** Table block — reuses existing PdfRow/ColumnDef types. */
export interface TableBlock {
    readonly type: 'table';
    readonly headers: readonly string[];
    readonly rows: readonly PdfRow[];
    readonly columns?: readonly ColumnDef[];
}

/** List block — bullet or numbered items. */
export interface ListBlock {
    readonly type: 'list';
    readonly items: readonly string[];
    readonly style: 'bullet' | 'numbered';
    readonly fontSize?: number;
}

/** Spacer block — vertical whitespace. */
export interface SpacerBlock {
    readonly type: 'spacer';
    readonly height: number;
}

/** Page break block — forces a new page. */
export interface PageBreakBlock {
    readonly type: 'pageBreak';
}

/** Image block — embeds a JPEG or PNG image. */
export interface ImageBlock {
    readonly type: 'image';
    readonly data: Uint8Array;
    readonly width?: number;
    readonly height?: number;
    readonly align?: 'left' | 'center' | 'right';
    readonly alt?: string;
}

/** Link block — clickable hyperlink text. */
export interface LinkBlock {
    readonly type: 'link';
    readonly text: string;
    readonly url: string;
    readonly fontSize?: number;
    readonly color?: PdfColor;
}

/** Table of Contents block — auto-generated from heading blocks. */
export interface TocBlock {
    readonly type: 'toc';
    /** Title shown above TOC entries. Default: `'Table of Contents'`. */
    readonly title?: string;
    /** Maximum heading level to include (1–3). Default: `3`. */
    readonly maxLevel?: 1 | 2 | 3;
    /** Font size for TOC entries. Default: `10`. */
    readonly fontSize?: number;
    /** Indent per heading level in points. Default: `15`. */
    readonly indent?: number;
}

/** Union of all supported document blocks. */
export type DocumentBlock =
    | HeadingBlock
    | ParagraphBlock
    | TableBlock
    | ListBlock
    | SpacerBlock
    | PageBreakBlock
    | ImageBlock
    | LinkBlock
    | TocBlock;

// ── Document Parameters ──────────────────────────────────────────────

/** Metadata for the PDF /Info dictionary. */
export interface DocumentMetadata {
    readonly author?: string;
    readonly subject?: string;
    readonly keywords?: string;
}

/**
 * Parameters for the free-form document PDF builder.
 *
 * @example
 * ```ts
 * const params: DocumentParams = {
 *   title: 'Meeting Notes',
 *   blocks: [
 *     { type: 'heading', text: 'Agenda', level: 1 },
 *     { type: 'paragraph', text: 'Discuss Q1 results...' },
 *     { type: 'list', items: ['Revenue', 'Expenses', 'Forecast'], style: 'bullet' },
 *   ],
 *   footerText: 'Confidential',
 * };
 * ```
 */
export interface DocumentParams {
    readonly title?: string;
    readonly blocks: readonly DocumentBlock[];
    readonly footerText?: string;
    readonly fontEntries?: readonly FontEntry[];
    readonly metadata?: DocumentMetadata;
    readonly layout?: Partial<PdfLayoutOptions>;
}
