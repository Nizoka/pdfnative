/**
 * pdfnative — Document Content Model Types
 * ==========================================
 * Types for the free-form document builder API (Phase 4).
 * Supports headings, paragraphs, lists, tables, spacers, and page breaks.
 */

import type { PdfRow, ColumnDef, FontEntry, PdfLayoutOptions, PdfColor, DocumentMetadata } from './pdf-types.js';
import type { BarcodeFormat, QRErrorLevel } from '../core/pdf-barcode.js';
import type { SvgRenderOptions } from '../core/pdf-svg.js';
import type { FormFieldType } from '../core/pdf-form.js';
import type { PageLabelRange } from '../core/pdf-page-labels.js';

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
    /**
     * Cell text wrapping policy.
     *
     * - `'auto'` (default) — wrap a cell's text only when its measured width
     *   exceeds the column's available width. Cells that fit stay on a single
     *   line, preserving byte-identical output with v1.1 for tables sized correctly.
     * - `'always'` — wrap every cell using the available column width.
     * - `'never'` — never wrap; fall back to v1.1 behaviour (character truncation
     *   via `ColumnDef.mx` / `mxH`, plus the clipping rectangle when `clipCells`
     *   is `true`). Useful when byte-identical v1.1 output is required.
     *
     * @since 1.2.0
     */
    readonly wrap?: 'auto' | 'always' | 'never';
    /**
     * Repeat the table header row on every continuation page when the table
     * spans multiple pages. Default: `true`.
     *
     * Single-page tables are unaffected and byte-identical to v1.1.
     *
     * @since 1.2.0
     */
    readonly repeatHeader?: boolean;
    /**
     * Alternate-row background (zebra striping).
     *
     * - `false` (default) — no zebra background.
     * - `true` — fill every other data row with a default light tint
     *   (`'0.969 0.973 0.984'`, matching the default header background).
     * - `PdfColor` — fill every other data row with the provided color.
     *
     * Uses a static (non-transparent) fill so the table remains PDF/A-1b safe.
     *
     * @since 1.2.0
     */
    readonly zebra?: boolean | PdfColor;
    /**
     * Optional caption rendered immediately above the table.
     *
     * In tagged mode, the caption is emitted as a `/Caption` structure element
     * inside the `/Table` (ISO 14289-1 §7.10.6) for assistive-technology access.
     *
     * @since 1.2.0
     */
    readonly caption?: string;
    /**
     * Minimum row height in points. Rows shorter than this are padded.
     * Defaults to the v1.1 `ROW_H` constant (`12`pt). Rows that wrap to
     * multiple lines grow as needed; this only sets the floor.
     *
     * @since 1.2.0
     */
    readonly minRowHeight?: number;
    /**
     * Horizontal cell padding in points (applied to both the left and right
     * insets inside each cell). Defaults to the v1.1 constant (`3`pt).
     *
     * @since 1.2.0
     */
    readonly cellPadding?: number;
    /**
     * Draw borders around each header/data cell. When omitted, no cell borders
     * are drawn (byte-identical to pre-1.4.0 — the table keeps only its header
     * underline and row separators). See {@link CellBorders}.
     *
     * @since 1.4.0
     */
    readonly cellBorders?: CellBorders;
    /**
     * Vertical alignment of cell content within the row band: `'top'`,
     * `'middle'`, or `'bottom'`. A per-column {@link ColumnDef.vAlign} overrides
     * this. When omitted, the historic baseline placement is preserved exactly
     * (byte-identical to pre-1.4.0).
     *
     * @since 1.4.0
     */
    readonly cellVAlign?: 'top' | 'middle' | 'bottom';
}

/**
 * Per-cell border configuration for a {@link TableBlock}. All sides are off by
 * default; enable individual sides or use `all: true`. Pure vector strokes
 * (`re`/`l`/`S`), so output stays PDF/A-safe.
 *
 * @since 1.4.0
 */
export interface CellBorders {
    /** Draw the top edge of each cell. */
    readonly top?: boolean;
    /** Draw the right edge of each cell. */
    readonly right?: boolean;
    /** Draw the bottom edge of each cell. */
    readonly bottom?: boolean;
    /** Draw the left edge of each cell. */
    readonly left?: boolean;
    /** Draw all four edges (shorthand; overrides the individual side flags). */
    readonly all?: boolean;
    /** Stroke colour. Default: `'0.8 0.8 0.8'` (light grey). */
    readonly color?: PdfColor;
    /** Stroke width in points. Default: `0.5`. */
    readonly width?: number;
    /** Stroke style. Default: `'solid'`. */
    readonly style?: 'solid' | 'dashed' | 'dotted';
}

/** List block — bullet or numbered items. */
export interface ListBlock {
    readonly type: 'list';
    /**
     * List entries. Each entry is either a plain string (leaf item) or a
     * {@link ListItem} object that can carry its own nested sub-list, enabling
     * hierarchical (multi-level) bullet/numbered lists. Plain strings and
     * nested objects may be freely mixed. Passing only strings is byte-identical
     * to the pre-1.4.0 flat-list behaviour.
     */
    readonly items: readonly (string | ListItem)[];
    readonly style: 'bullet' | 'numbered';
    readonly fontSize?: number;
}

/**
 * A single hierarchical list entry: text plus an optional nested sub-list.
 * Used by {@link ListBlock} to build multi-level outlines (bullets within
 * bullets, numbered sub-items, …). Sub-items inherit the parent list's
 * `style`; numbered sub-lists restart their numbering at 1.
 *
 * @since 1.4.0
 */
export interface ListItem {
    /** The item's text content. */
    readonly text: string;
    /** Optional nested child entries (recursive). */
    readonly items?: readonly (string | ListItem)[];
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

/** A single data series in a {@link ChartBlock}. */
export interface ChartSeries {
    /** Series label (shown in the legend). */
    readonly label: string;
    /** Numeric values, one per category. */
    readonly values: readonly number[];
    /** Optional colour override (hex, tuple, or PDF RGB). */
    readonly color?: PdfColor;
    /**
     * X positions for `scatter` charts (and `line`/`area` on a non-category
     * x-axis): one entry per value. Numbers are used as-is (epoch
     * milliseconds when `xAxis.type` is `'time'`); strings are parsed as
     * ISO-8601 dates. Ignored on category axes.
     * @since 1.7.0
     */
    readonly xValues?: readonly (number | string)[];
    /**
     * Bind this series to the left (default) or right value axis. A right
     * axis appears only when at least one series selects it; configure its
     * range with {@link ChartBlock.axis2}. Cartesian charts only.
     * @since 1.7.0
     */
    readonly yAxis?: 'left' | 'right';
}

/** Supported chart types (v1.6.0; `stackedBar`/`stackedBarH`/`area`/`scatter` since v1.7.0). */
export type ChartType = 'bar' | 'barH' | 'line' | 'pie' | 'donut'
    | 'stackedBar' | 'stackedBarH' | 'area' | 'scatter';

/**
 * Chart block — native vector charts rendered as pure PDF path operators
 * (zero dependencies, no rasterisation). Bar/line charts support multiple
 * series; pie/donut take a single series.
 *
 * @since 1.6.0
 */
export interface ChartBlock {
    readonly type: 'chart';
    /** Chart kind. */
    readonly chartType: ChartType;
    /** Data series. Pie/donut use exactly one series. */
    readonly series: readonly ChartSeries[];
    /** Category / slice labels (x-axis). Defaults to 1-based indices. */
    readonly categories?: readonly string[];
    /** Plot width in points (clamped to content width). Default `460`. */
    readonly width?: number;
    /** Plot-area height in points (title/legend add measured height). Default `240`. */
    readonly height?: number;
    /** Chart title. */
    readonly title?: string;
    /** Legend placement. Default `'bottom'` for multi-series/pie, else `'none'`. */
    readonly legend?: 'bottom' | 'none';
    /** Value-axis options (bar/line). `scale` since v1.7.0. */
    readonly axis?: {
        readonly yMin?: number;
        readonly yMax?: number;
        readonly ticks?: number;
        readonly grid?: boolean;
        /** Value-axis scale. `'log'` requires strictly positive values. Default `'linear'`. @since 1.7.0 */
        readonly scale?: 'linear' | 'log';
    };
    /**
     * Secondary (right) value axis, used by series with `yAxis: 'right'`.
     * Rendered only when at least one series binds to it. @since 1.7.0
     */
    readonly axis2?: {
        readonly yMin?: number;
        readonly yMax?: number;
        readonly ticks?: number;
        readonly scale?: 'linear' | 'log';
    };
    /**
     * X-axis configuration. Default `'category'` (equal slots). `'linear'`
     * and `'time'` position points by {@link ChartSeries.xValues} — `'time'`
     * parses ISO-8601 strings / epoch milliseconds and formats tick labels
     * in UTC. Applies to `scatter` (required) and `line`/`area` (optional).
     * @since 1.7.0
     */
    readonly xAxis?: {
        readonly type?: 'category' | 'linear' | 'time';
        readonly min?: number | string;
        readonly max?: number | string;
        readonly ticks?: number;
        readonly grid?: boolean;
    };
    /**
     * Per-point value labels. `true` uses the tick formatter; an object
     * customises decimals and adds a prefix/suffix (e.g. `{ suffix: '%' }`).
     * @since 1.7.0
     */
    readonly dataLabels?: boolean | {
        readonly decimals?: number;
        readonly prefix?: string;
        readonly suffix?: string;
    };
    /**
     * Draw every Nth category label. Default: automatic — the smallest
     * stride at which measured labels no longer overlap; `1` forces every
     * label. Applies to `bar`/`stackedBar`/`line`/`area` x-axis labels.
     * @since 1.7.0
     */
    readonly labelStride?: number;
    /**
     * Rotate category labels counter-clockwise by this many degrees (0–90,
     * typical 45) — labels are right-aligned to their tick and read upward
     * toward it. Disables auto-stride unless `labelStride` is also set.
     * @since 1.7.0
     */
    readonly labelRotation?: number;
    /** Draw point markers on line series. Default `false`. */
    readonly markers?: boolean;
    /** Palette override (per-series or per-slice). */
    readonly colors?: readonly PdfColor[];
    /** Horizontal alignment. Default `'left'`. */
    readonly align?: 'left' | 'center' | 'right';
    /** Alt text for tagged PDF `/Figure /Alt`. Auto-generated when omitted. */
    readonly altText?: string;
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
    | FormFieldBlock
    | ChartBlock;

// ── Document Parameters ──────────────────────────────────────────────

/**
 * Metadata for the PDF /Info dictionary.
 * Defined in pdf-types (shared with {@link PdfParams}); re-exported here
 * for backwards compatibility.
 */
export type { DocumentMetadata } from './pdf-types.js';

/**
 * A document outline (bookmark) entry — ISO 32000-1 §12.3.3.
 *
 * Outline items form a navigable tree shown in a viewer's bookmarks
 * panel. Each item points at a 0-based page index and may nest children.
 * Bookmarks are purely navigational and PDF/A-safe.
 *
 * @since 1.4.0
 */
export interface OutlineItem {
    /** Bookmark label (UTF-16BE encoded automatically). */
    readonly title: string;
    /** 0-based destination page index. */
    readonly pageIndex: number;
    /** Destination Y coordinate in points (default: top of page). */
    readonly y?: number;
    /** Render the label bold (`/F` flag bit 2). */
    readonly bold?: boolean;
    /** Render the label italic (`/F` flag bit 1). */
    readonly italic?: boolean;
    /** Label colour (`/C`). Accepts hex, RGB tuple, or PDF operator string. */
    readonly color?: PdfColor;
    /**
     * Initial expansion state. `true` (default) renders the bookmark expanded
     * (positive `/Count`); `false` renders it collapsed (negative `/Count`),
     * hiding its children until the reader expands it. Only meaningful when the
     * item has `children`.
     */
    readonly open?: boolean;
    /** Nested child bookmarks. */
    readonly children?: readonly OutlineItem[];
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
    /**
     * Document outline / bookmarks (ISO 32000-1 §12.3.3).
     *
     * - An array of {@link OutlineItem}s builds an explicit bookmark tree.
     * - The literal `'auto'` derives a flat outline from every `heading`
     *   block in document order, using each heading's page and position.
     *
     * Adds `/Outlines` + `/PageMode /UseOutlines` to the catalog. PDF/A-safe.
     *
     * @since 1.4.0
     */
    readonly outline?: readonly OutlineItem[] | 'auto';
    /**
     * Page labels (ISO 32000-1 §12.4.2) — controls the page numbering shown
     * in a viewer's page box and thumbnails (e.g. roman front matter then
     * decimal body). Emitted as an inline `/PageLabels` number tree. PDF/A-safe.
     *
     * @since 1.4.0
     */
    readonly pageLabels?: readonly PageLabelRange[];
}

export type { PageLabelRange, PageLabelStyle } from '../core/pdf-page-labels.js';
