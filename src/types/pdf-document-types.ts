/**
 * pdfnative — Document Content Model Types
 * ==========================================
 * Types for the free-form document builder API (Phase 4).
 * Supports headings, paragraphs, lists, tables, spacers, and page breaks.
 */

import type { PdfRow, ColumnDef, FontEntry, PdfLayoutOptions, PdfColor } from './pdf-types.js';
import type { BarcodeFormat, QRErrorLevel } from '../core/pdf-barcode.js';
import type { SvgRenderOptions } from '../core/pdf-svg.js';
import type { FormFieldType } from '../core/pdf-form.js';

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
    /**
     * Clip cell contents to column bounds using PDF clip-path operators.
     * When `true`, each header/data cell is wrapped in `q <rect> re W n ... Q` so
     * over-long text cannot escape the column rectangle visually.
     *
     * When `false`, cells rely solely on the existing `truncate()` character cap
     * (ColumnDef.mx / mxH) — variable-width glyphs may still overflow visually.
     *
     * Default: `true` (recommended for PDF/A and visual safety).
     * @since 1.1.0
     */
    readonly clipCells?: boolean;
    /**
     * Auto-fit column widths to actual content widths, respecting per-column
     * `minWidth` / `maxWidth` constraints. Surplus or deficit is redistributed
     * across unconstrained columns proportional to their `f` fraction.
     *
     * When `false` (default), the explicit `f` fractions are used as-is.
     *
     * Note: byte-output is non-deterministic vs explicit widths because resolved
     * widths depend on text content and font metrics. Use only when content-aware
     * sizing is desired.
     * @since 1.1.0
     */
    readonly autoFitColumns?: boolean;
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

/** Barcode block — renders a 1D or 2D barcode using PDF path operators. */
export interface BarcodeBlock {
    readonly type: 'barcode';
    /** Barcode format to render. */
    readonly format: BarcodeFormat;
    /** Data to encode in the barcode. */
    readonly data: string;
    /** Width in points. Default: `200` for 1D, `100` for 2D. */
    readonly width?: number;
    /** Height in points. Default: `60` for 1D, same as width for 2D. */
    readonly height?: number;
    /** Horizontal alignment. Default: `'left'`. */
    readonly align?: 'left' | 'center' | 'right';
    /** QR Code error correction level. Default: `'M'`. */
    readonly ecLevel?: QRErrorLevel;
    /** PDF417 error correction level (0-8). Default: `2`. */
    readonly pdf417ECLevel?: number;
}

/** SVG block — renders vector graphics via PDF path operators. */
export interface SvgBlock {
    readonly type: 'svg';
    /** SVG path `d` attribute, or SVG markup with path/rect/circle/ellipse/line/polyline/polygon elements. */
    readonly data: string;
    /** Display width in points. Default: `200`. */
    readonly width?: number;
    /** Display height in points. Default: `200`. */
    readonly height?: number;
    /** Horizontal alignment. Default: `'left'`. */
    readonly align?: 'left' | 'center' | 'right';
    /** SVG viewBox [minX, minY, width, height]. Extracted from SVG markup or defaults to `[0, 0, width, height]`. */
    readonly viewBox?: readonly [number, number, number, number];
    /** Fill color (hex, tuple, or PDF RGB). Default: black. `'none'` disables fill. */
    readonly fill?: SvgRenderOptions['fill'];
    /** Stroke color (hex, tuple, or PDF RGB). Default: none. */
    readonly stroke?: SvgRenderOptions['stroke'];
    /** Stroke width in SVG user units. Default: `1`. */
    readonly strokeWidth?: number;
    /** Alt text for tagged PDF accessibility (/Figure /ActualText). */
    readonly alt?: string;
}

/** Form field block — interactive AcroForm widget (ISO 32000-1 §12.7). */
export interface FormFieldBlock {
    readonly type: 'formField';
    /** Field type. */
    readonly fieldType: FormFieldType;
    /** Unique field name (T entry in field dictionary). */
    readonly name: string;
    /** Display label rendered before the widget. */
    readonly label?: string;
    /** Default / initial value. */
    readonly value?: string;
    /** Placeholder hint (used in appearance stream when value is empty). */
    readonly placeholder?: string;
    /** Width of the widget in points. Default: full content width. */
    readonly width?: number;
    /** Height of the widget in points. Default varies by fieldType. */
    readonly height?: number;
    /** Font size for text fields and dropdown. Default: `10`. */
    readonly fontSize?: number;
    /** Options for dropdown and listbox field types. */
    readonly options?: readonly string[];
    /** Whether the field is read-only. Default: `false`. */
    readonly readOnly?: boolean;
    /** Whether the field is required. Default: `false`. */
    readonly required?: boolean;
    /** Maximum character count for text/multilineText. */
    readonly maxLength?: number;
    /** Whether a checkbox/radio option is initially selected. Default: `false`. */
    readonly checked?: boolean;
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
    | TocBlock
    | BarcodeBlock
    | SvgBlock
    | FormFieldBlock;

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
