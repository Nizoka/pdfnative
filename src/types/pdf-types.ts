/**
 * pdfnative — Public Type Definitions
 * ====================================
 * All types exported by the library for consumers.
 */

// ── Font Types ───────────────────────────────────────────────────────

/** Font metrics embedded in font data modules. */
export interface FontMetrics {
    readonly unitsPerEm: number;
    readonly numGlyphs: number;
    readonly defaultWidth: number;
    readonly ascent: number;
    readonly descent: number;
    readonly bbox: readonly number[];
    readonly capHeight: number;
    readonly stemV: number;
}

/** Pre-built font data loaded from font data modules. */
export interface FontData {
    readonly metrics: FontMetrics;
    readonly fontName: string;
    readonly cmap: Record<number, number>;
    readonly defaultWidth: number;
    readonly widths: Record<number, number>;
    readonly pdfWidthArray: string;
    readonly ttfBase64: string;
    readonly gsub: Record<number, number>;
    readonly ligatures?: Record<number, number[][]> | null;
    readonly markAnchors: {
        readonly bases: Record<number, Record<number, [number, number]>>;
        readonly marks: Record<number, [number, number, number]>;
    } | null;
    readonly mark2mark: {
        readonly mark1Anchors: Record<number, Record<number, [number, number]>>;
        readonly mark2Classes: Record<number, [number, number, number]>;
    } | null;
}

/** A font entry binding FontData to a PDF font reference. */
export interface FontEntry {
    readonly fontData: FontData;
    readonly fontRef: string;
    readonly lang?: string;
}

// ── Shaping Types ────────────────────────────────────────────────────

/** A single positioned glyph output from the Thai shaper. */
export interface ShapedGlyph {
    readonly gid: number;
    readonly dx: number;
    readonly dy: number;
    readonly isZeroAdvance: boolean;
}

/** A text run produced by the encoding context's textRuns() method. */
export interface TextRun {
    readonly text: string;
    readonly fontRef: string;
    readonly fontData: FontData;
    readonly shaped: ShapedGlyph[] | null;
    readonly hexStr: string | null;
    readonly widthPt: number;
}

/** Encoding context encapsulating text encoding and font reference logic. */
export interface EncodingContext {
    readonly isUnicode: boolean;
    readonly fontEntries: FontEntry[];
    readonly ps: (str: string) => string;
    readonly tw: (str: string, sz: number) => number;
    readonly textRuns: (str: string, sz: number) => TextRun[];
    readonly f1: string;
    readonly f2: string;
    readonly fontData?: FontData;
    readonly getUsedGids?: () => Map<string, Set<number>>;
}

// ── PDF Parameters ───────────────────────────────────────────────────

/** A single row in the PDF table. */
export interface PdfRow {
    /** Cell text values (one per column). */
    readonly cells: readonly string[];
    /** Row type — used for color styling (e.g. 'credit' → green, 'debit' → red). */
    readonly type: string;
    /** Whether the row is "pointed" (highlighted). */
    readonly pointed: boolean;
}

/** An info key/value pair displayed in the header section. */
export interface PdfInfoItem {
    readonly label: string;
    readonly value: string;
}

/**
 * Parameters for PDF generation.
 * This is the main input interface for table-centric PDF generation.
 * The consumer builds these params from their own data model.
 */
export interface PdfParams {
    /** PDF metadata title (invisible, stored in document info). */
    readonly docTitle?: string;
    /** Visible title at the top of the first page. */
    readonly title: string;
    /** Key/value info lines displayed below the title. */
    readonly infoItems: readonly PdfInfoItem[];
    /** Balance text displayed in the highlighted box. */
    readonly balanceText: string;
    /** Count text displayed below the balance box (e.g. "42 operations"). */
    readonly countText: string;
    /** Column headers for the table. */
    readonly headers: readonly string[];
    /** Data rows for the table. */
    readonly rows: readonly PdfRow[];
    /** Footer text displayed at the bottom of every page. */
    readonly footerText: string;
    /** Single font data (legacy, use fontEntries for multi-font). */
    readonly fontData?: FontData | null;
    /** Array of font entries for multi-font support (primary first). */
    readonly fontEntries?: FontEntry[];
}

// ── Theme / Style Types ──────────────────────────────────────────────

/** PDF RGB color string in operator format: "R G B" (values 0.0–1.0). */
export type PdfRgbString = `${number} ${number} ${number}`;

/** RGB color as a 3-tuple of values 0–255. */
export type PdfRgbTuple = readonly [r: number, g: number, b: number];

/**
 * Color input accepted by pdfnative.
 *
 * - Hex string: `"#2563EB"` or `"#26E"` (primary — standard web format)
 * - RGB tuple: `[37, 99, 235]` values 0–255 (alternative — programmatic)
 * - PDF operator string: `"0.145 0.388 0.922"` values 0.0–1.0 (advanced — native PDF format)
 */
export type PdfColor = PdfRgbString | PdfRgbTuple | (string & {});

/**
 * Color palette for the PDF.
 * Each field accepts any PdfColor format (hex, RGB tuple, or PDF operator string).
 */
export interface PdfColors {
    readonly title: PdfColor;
    readonly credit: PdfColor;
    readonly debit: PdfColor;
    readonly text: PdfColor;
    readonly thBg: PdfColor;
    readonly thBrd: PdfColor;
    readonly rowBrd: PdfColor;
    readonly ptdBg: PdfColor;
    readonly balBg: PdfColor;
    readonly balBrd: PdfColor;
    readonly label: PdfColor;
    readonly footer: PdfColor;
}

/** Column definition for the table layout. */
export interface ColumnDef {
    /** Fraction of content width (0-1). */
    readonly f: number;
    /** Alignment: 'l' = left, 'r' = right, 'c' = center. */
    readonly a: 'l' | 'r' | 'c';
    /** Max characters for data cells. */
    readonly mx: number;
    /** Max characters for header cells. */
    readonly mxH: number;
    /**
     * Minimum column width in points. When set, the resolved width is
     * clamped to at least this value, redistributing the surplus across
     * the remaining unconstrained columns (proportional to their `f`).
     * @since 1.1.0
     */
    readonly minWidth?: number;
    /**
     * Maximum column width in points. When set, the resolved width is
     * clamped to at most this value, redistributing the surplus across
     * the remaining unconstrained columns (proportional to their `f`).
     * @since 1.1.0
     */
    readonly maxWidth?: number;
}

/**
 * Options for generating a PDF in a Web Worker via `generatePDFInWorker()`.
 */
export interface WorkerGenerationOptions {
    /**
     * Timeout in milliseconds before the worker is terminated.
     * Defaults to `WORKER_TIMEOUT_MS` (60 000 ms).
     */
    readonly timeout?: number;
    /**
     * Progress callback invoked as the worker sends `{ type: 'progress', percent }` messages.
     * @param percent - Completion percentage (0–100)
     */
    readonly onProgress?: (percent: number) => void;
}

/** Layout options (all optional, A4 defaults applied). */
export interface PdfLayoutOptions {
    /** Page width in points (default: 595.28 = A4). */
    readonly pageWidth?: number;
    /** Page height in points (default: 841.89 = A4). */
    readonly pageHeight?: number;
    /** Margins { top, right, bottom, left } in points. */
    readonly margins?: { readonly t: number; readonly r: number; readonly b: number; readonly l: number };
    /** Column definitions (overrides default 5-column layout). */
    readonly columns?: readonly ColumnDef[];
    /** Color palette (overrides default blue theme). */
    readonly colors?: PdfColors;
    /** Font sizes { title, info, th, td, ft }. */
    readonly fontSizes?: Partial<{ readonly title: number; readonly info: number; readonly th: number; readonly td: number; readonly ft: number }>;
    /**
     * Enable Tagged PDF (PDF/UA) + /ActualText + PDF/A compliance.
     * - `true` (default tagged): PDF/A-2b (ISO 19005-2) with %PDF-1.7
     * - `'pdfa1b'`: PDF/A-1b (ISO 19005-1) with %PDF-1.4
     * - `'pdfa2b'`: PDF/A-2b (ISO 19005-2) with %PDF-1.7
     * - `'pdfa2u'`: PDF/A-2u (ISO 19005-2, Unicode) with %PDF-1.7
     * - `'pdfa3b'`: PDF/A-3b (ISO 19005-3) with %PDF-1.7 — allows embedded file attachments
     * - `false` / omitted: no tagged mode (backward compatible)
     *
     * When enabled, the output includes:
     *   - StructTreeRoot with document structure
     *   - /ActualText on shaped glyph sequences for text extraction fidelity
     *   - MarkInfo << /Marked true >> on Catalog
     *   - XMP metadata stream
     *   - OutputIntent with sRGB ICC profile
     * Default: false (backward compatible).
     */
    readonly tagged?: boolean | 'pdfa1b' | 'pdfa2b' | 'pdfa2u' | 'pdfa3b';
    /**
     * Enable PDF encryption (password protection).
     * Uses AES-128 or AES-256 only — no RC4.
     *
     * Mutually exclusive with `tagged` (PDF/A forbids encryption per ISO 19005-1 §6.3.2).
     * Default: undefined (no encryption).
     */
    readonly encryption?: EncryptionOptions;
    /**
     * Enable FlateDecode stream compression (ISO 32000-1 §7.3.8.1).
     *
     * When enabled, all content streams, font streams, ToUnicode CMaps, and ICC profiles
     * are compressed using DEFLATE (RFC 1951) in zlib format (RFC 1950).
     *
     * - Node.js (ESM): call `await initNodeCompression()` once before first use.
     * - Node.js (CJS): native `zlib.deflateSync` is resolved automatically via `require`.
     * - Browser / edge runtimes: no native deflate is available by default. The library
     *   falls back to a valid DEFLATE **stored-block** wrapper (0x78 0x01 header + Adler-32
     *   checksum, no actual compression). All PDF readers accept this as valid FlateDecode,
     *   but the output will be slightly larger than the uncompressed baseline due to the
     *   DEFLATE framing overhead (~5 bytes per 64 KB block).
     *
     *   To enable real compression in the browser, supply a deflate implementation via
     *   `setDeflateImpl()` before calling `buildPDF` / `buildDocumentPDF`:
     *   ```ts
     *   import { deflate } from 'fflate'; // or 'pako', or CompressionStream
     *   import { setDeflateImpl } from 'pdfnative';
     *   setDeflateImpl((buf) => deflate(buf));
     *   ```
     *
     * Image streams (JPEG/PNG) are NOT recompressed — they already use DCTDecode/FlateDecode.
     * XMP metadata streams are NOT compressed when tagged mode is active (PDF/A safety).
     *
     * Compression is applied BEFORE encryption when both are active (ISO 32000-1 §7.3.8).
     *
     * Default: false (no compression).
     */
    readonly compress?: boolean;
    /**
     * Header template rendered at the top of every page.
     * Uses placeholder syntax: {page}, {pages}, {date}, {title}.
     * Default: undefined (no header).
     */
    readonly headerTemplate?: PageTemplate;
    /**
     * Footer template rendered at the bottom of every page.
     * Uses placeholder syntax: {page}, {pages}, {date}, {title}.
     * Overrides `footerText` when both are provided.
     * Default: undefined (uses footerText with page numbers).
     */
    readonly footerTemplate?: PageTemplate;
    /**
     * Watermark rendered on every page.
     * Supports text watermarks, image watermarks, or both.
     * Position: 'background' (behind content, default) or 'foreground' (above content).
     *
     * Note: PDF/A-1b forbids transparency (ISO 19005-1 §6.4). Watermarks with opacity < 1.0
     * will throw when used with `tagged: 'pdfa1b'`.
     *
     * Default: undefined (no watermark).
     */
    readonly watermark?: WatermarkOptions;
    /**
     * File attachments to embed in the PDF (PDF/A-3 only).
     * Each attachment becomes an /EmbeddedFile stream with /Filespec and /AFRelationship.
     *
     * Requires `tagged: 'pdfa3b'`. Throws if used with other tagged modes.
     * Default: undefined (no attachments).
     */
    readonly attachments?: readonly PdfAttachment[];
}

// ── Attachment Types ─────────────────────────────────────────────────

/**
 * Relationship of an embedded file to the PDF document (ISO 19005-3 §6.8).
 * - `'Source'`: the embedded file is the source of the document
 * - `'Data'`: the embedded file is data used to derive the document
 * - `'Alternative'`: an alternative representation
 * - `'Supplement'`: a supplement to the document
 * - `'Unspecified'`: no specific relationship
 */
export type PdfAttachmentRelationship = 'Source' | 'Data' | 'Alternative' | 'Supplement' | 'Unspecified';

/**
 * Embedded file attachment for PDF/A-3 (ISO 19005-3).
 *
 * @example
 * ```ts
 * const attachment: PdfAttachment = {
 *   filename: 'invoice-data.xml',
 *   data: new TextEncoder().encode('<invoice>...</invoice>'),
 *   mimeType: 'application/xml',
 *   relationship: 'Data',
 * };
 * ```
 */
export interface PdfAttachment {
    /** Filename for the embedded file (e.g. 'data.xml'). */
    readonly filename: string;
    /** File content as binary data. */
    readonly data: Uint8Array;
    /** MIME type (e.g. 'application/xml', 'text/csv'). */
    readonly mimeType: string;
    /** Optional description for the file. */
    readonly description?: string;
    /** Relationship to the document. Default: `'Unspecified'`. */
    readonly relationship?: PdfAttachmentRelationship;
}

// ── Encryption Types ─────────────────────────────────────────────────

/**
 * Options for PDF encryption (password protection).
 * AES-128 and AES-256 only — no RC4 (insecure).
 *
 * Mutually exclusive with `tagged` (PDF/A forbids encryption per ISO 19005-1 §6.3.2).
 */
export interface EncryptionOptions {
    /** Password to open the PDF. Empty string or omitted = no user password required. */
    readonly userPassword?: string;
    /** Owner password — required. Controls permissions. */
    readonly ownerPassword: string;
    /** Permission flags controlling what readers can do. */
    readonly permissions?: {
        /** Allow printing. Default: true. */
        readonly print?: boolean;
        /** Allow copying text/images. Default: false. */
        readonly copy?: boolean;
        /** Allow modifying the document. Default: false. */
        readonly modify?: boolean;
        /** Allow extracting text for accessibility. Default: true. */
        readonly extractText?: boolean;
    };
    /** Encryption algorithm. Default: 'aes128'. */
    readonly algorithm?: 'aes128' | 'aes256';
}

// ── Page Template Types ──────────────────────────────────────────────

/**
 * Template for page headers and footers with placeholder support.
 *
 * Supported placeholders (resolved at render time):
 * - `{page}` — current page number
 * - `{pages}` — total page count
 * - `{date}` — current date (YYYY-MM-DD)
 * - `{title}` — document title
 *
 * @example
 * ```ts
 * const footer: PageTemplate = {
 *   left: 'Confidential',
 *   center: '{title}',
 *   right: 'Page {page} of {pages}',
 * };
 * ```
 */
export interface PageTemplate {
    /** Left-aligned text (supports placeholders). */
    readonly left?: string;
    /** Center-aligned text (supports placeholders). */
    readonly center?: string;
    /** Right-aligned text (supports placeholders). */
    readonly right?: string;
    /** Font size in points (default: 7). */
    readonly fontSize?: number;
    /** Text color (any PdfColor format: hex, RGB tuple, or PDF operator string). */
    readonly color?: PdfColor;
}

// ── Watermark Types ──────────────────────────────────────────────────

/**
 * Text watermark configuration.
 * Renders as large semi-transparent rotated text centered on each page.
 */
export interface WatermarkText {
    /** Watermark text (e.g. "DRAFT", "CONFIDENTIAL"). */
    readonly text: string;
    /** Font size in points. Default: 60. */
    readonly fontSize?: number;
    /** Text color. Default: '0.75 0.75 0.75' (light gray). */
    readonly color?: PdfColor;
    /** Opacity 0.0–1.0. Default: 0.15. */
    readonly opacity?: number;
    /** Rotation angle in degrees (counterclockwise). Default: -45. */
    readonly angle?: number;
    /**
     * Auto-fit: clamp `fontSize` so the rotated bounding box fits within the
     * page minus a 24-pt safety margin. Default: `true` (added in v1.1.0).
     *
     * Set to `false` to preserve byte-stable output when callers depend on
     * the exact `fontSize` even if it produces a watermark that overflows
     * the page (legacy v1.0.x behaviour).
     */
    readonly autoFit?: boolean;
}

/**
 * Image watermark configuration.
 * Renders a semi-transparent image centered on each page.
 */
export interface WatermarkImage {
    /** Image data (JPEG or PNG). */
    readonly data: Uint8Array;
    /** Opacity 0.0–1.0. Default: 0.10. */
    readonly opacity?: number;
    /** Display width in points (default: auto from image dimensions). */
    readonly width?: number;
    /** Display height in points (default: auto from image dimensions). */
    readonly height?: number;
}

/**
 * Watermark options for PDF pages.
 * Provide either `text` or `image` (or both).
 *
 * @example
 * ```ts
 * // Text watermark
 * { text: { text: 'DRAFT', opacity: 0.2, angle: -45 } }
 *
 * // Image watermark
 * { image: { data: pngBytes, opacity: 0.1 } }
 * ```
 */
export interface WatermarkOptions {
    /** Text watermark rendered at page center. */
    readonly text?: WatermarkText;
    /** Image watermark rendered at page center. */
    readonly image?: WatermarkImage;
    /** Render position: 'background' (behind content) or 'foreground' (above content). Default: 'background'. */
    readonly position?: 'background' | 'foreground';
}

// ── Worker Types ─────────────────────────────────────────────────────

/** Message sent to the PDF Worker. */
export interface WorkerInputMessage {
    readonly type: 'GENERATE_PDF';
    readonly params: PdfParams;
}

/** Messages received from the PDF Worker. */
export type WorkerOutputMessage =
    | { type: 'progress'; percent: number }
    | { type: 'complete'; pdfBytes: Uint8Array }
    | { type: 'error'; message: string };
