/**
 * pdfnative — Public Type Definitions
 * ====================================
 * All types exported by the library for consumers.
 */

// ── Font Types ───────────────────────────────────────────────────────

/** Font metrics embedded in font data modules. */
export interface FontMetrics {
    unitsPerEm: number;
    numGlyphs: number;
    defaultWidth: number;
    ascent: number;
    descent: number;
    bbox: number[];
    capHeight: number;
    stemV: number;
}

/** Pre-built font data loaded from font data modules. */
export interface FontData {
    metrics: FontMetrics;
    fontName: string;
    cmap: Record<number, number>;
    defaultWidth: number;
    widths: Record<number, number>;
    pdfWidthArray: string;
    ttfBase64: string;
    gsub: Record<number, number>;
    markAnchors: {
        bases: Record<number, Record<number, [number, number]>>;
        marks: Record<number, [number, number, number]>;
    } | null;
    mark2mark: {
        mark1Anchors: Record<number, Record<number, [number, number]>>;
        mark2Classes: Record<number, [number, number, number]>;
    } | null;
}

/** A font entry binding FontData to a PDF font reference. */
export interface FontEntry {
    fontData: FontData;
    fontRef: string;
    lang?: string;
}

// ── Shaping Types ────────────────────────────────────────────────────

/** A single positioned glyph output from the Thai shaper. */
export interface ShapedGlyph {
    gid: number;
    dx: number;
    dy: number;
    isZeroAdvance: boolean;
}

/** A text run produced by the encoding context's textRuns() method. */
export interface TextRun {
    text: string;
    fontRef: string;
    fontData: FontData;
    shaped: ShapedGlyph[] | null;
    hexStr: string | null;
    widthPt: number;
}

/** Encoding context encapsulating text encoding and font reference logic. */
export interface EncodingContext {
    isUnicode: boolean;
    fontEntries: FontEntry[];
    ps: (str: string) => string;
    tw: (str: string, sz: number) => number;
    textRuns: (str: string, sz: number) => TextRun[];
    f1: string;
    f2: string;
    fontData?: FontData;
    getUsedGids?: () => Map<string, Set<number>>;
}

// ── PDF Parameters ───────────────────────────────────────────────────

/** A single row in the PDF table. */
export interface PdfRow {
    /** Cell text values (one per column). */
    cells: string[];
    /** Row type — used for color styling (e.g. 'credit' → green, 'debit' → red). */
    type: string;
    /** Whether the row is "pointed" (highlighted). */
    pointed: boolean;
}

/** An info key/value pair displayed in the header section. */
export interface PdfInfoItem {
    label: string;
    value: string;
}

/**
 * Parameters for PDF generation.
 * This is the main input interface — all Plika-specific coupling has been removed.
 * The consumer builds these params from their own data model.
 */
export interface PdfParams {
    /** PDF metadata title (invisible, stored in document info). */
    docTitle?: string;
    /** Visible title at the top of the first page. */
    title: string;
    /** Key/value info lines displayed below the title. */
    infoItems: PdfInfoItem[];
    /** Balance text displayed in the highlighted box. */
    balanceText: string;
    /** Count text displayed below the balance box (e.g. "42 operations"). */
    countText: string;
    /** Column headers for the table. */
    headers: string[];
    /** Data rows for the table. */
    rows: PdfRow[];
    /** Footer text displayed at the bottom of every page. */
    footerText: string;
    /** Single font data (legacy, use fontEntries for multi-font). */
    fontData?: FontData | null;
    /** Array of font entries for multi-font support (primary first). */
    fontEntries?: FontEntry[];
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
    title: PdfColor;
    credit: PdfColor;
    debit: PdfColor;
    text: PdfColor;
    thBg: PdfColor;
    thBrd: PdfColor;
    rowBrd: PdfColor;
    ptdBg: PdfColor;
    balBg: PdfColor;
    balBrd: PdfColor;
    label: PdfColor;
    footer: PdfColor;
}

/** Column definition for the table layout. */
export interface ColumnDef {
    /** Fraction of content width (0-1). */
    f: number;
    /** Alignment: 'l' = left, 'r' = right, 'c' = center. */
    a: 'l' | 'r' | 'c';
    /** Max characters for data cells. */
    mx: number;
    /** Max characters for header cells. */
    mxH: number;
}

/** Layout options (all optional, A4 defaults applied). */
export interface PdfLayoutOptions {
    /** Page width in points (default: 595.28 = A4). */
    pageWidth?: number;
    /** Page height in points (default: 841.89 = A4). */
    pageHeight?: number;
    /** Margins { top, right, bottom, left } in points. */
    margins?: { t: number; r: number; b: number; l: number };
    /** Column definitions (overrides default 5-column layout). */
    columns?: ColumnDef[];
    /** Color palette (overrides default blue theme). */
    colors?: PdfColors;
    /** Font sizes { title, info, th, td, ft }. */
    fontSizes?: Partial<{ title: number; info: number; th: number; td: number; ft: number }>;
    /**
     * Enable Tagged PDF (PDF/UA) + /ActualText + PDF/A compliance.
     * - `true` (default tagged): PDF/A-2b (ISO 19005-2) with %PDF-1.7
     * - `'pdfa1b'`: PDF/A-1b (ISO 19005-1) with %PDF-1.4
     * - `'pdfa2b'`: PDF/A-2b (ISO 19005-2) with %PDF-1.7
     * - `'pdfa2u'`: PDF/A-2u (ISO 19005-2, Unicode) with %PDF-1.7
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
    tagged?: boolean | 'pdfa1b' | 'pdfa2b' | 'pdfa2u';
    /**
     * Enable PDF encryption (password protection).
     * Uses AES-128 or AES-256 only — no RC4.
     *
     * Mutually exclusive with `tagged` (PDF/A forbids encryption per ISO 19005-1 §6.3.2).
     * Default: undefined (no encryption).
     */
    encryption?: EncryptionOptions;
    /**
     * Enable FlateDecode stream compression (ISO 32000-1 §7.3.8.1).
     *
     * When enabled, all content streams, font streams, ToUnicode CMaps, and ICC profiles
     * are compressed using DEFLATE (RFC 1951) in zlib format (RFC 1950).
     *
     * - Node.js: uses native `zlib.deflateSync()` for optimal performance
     * - Browser/other: stored-block fallback (valid FlateDecode, minimal overhead)
     *
     * Image streams (JPEG/PNG) are NOT recompressed — they already use DCTDecode/FlateDecode.
     * XMP metadata streams are NOT compressed when tagged mode is active (PDF/A safety).
     *
     * Compression is applied BEFORE encryption when both are active (ISO 32000-1 §7.3.8).
     *
     * Default: false (backward compatible).
     */
    compress?: boolean;
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

// ── Worker Types ─────────────────────────────────────────────────────

/** Message sent to the PDF Worker. */
export interface WorkerInputMessage {
    type: 'GENERATE_PDF';
    params: PdfParams;
}

/** Messages received from the PDF Worker. */
export type WorkerOutputMessage =
    | { type: 'progress'; percent: number }
    | { type: 'complete'; pdfBytes: Uint8Array }
    | { type: 'error'; message: string };
