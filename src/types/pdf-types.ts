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

/** Color palette for the PDF (RGB strings in PDF operator format: "R G B"). */
export interface PdfColors {
    title: string;
    credit: string;
    debit: string;
    text: string;
    thBg: string;
    thBrd: string;
    rowBrd: string;
    ptdBg: string;
    balBg: string;
    balBrd: string;
    label: string;
    footer: string;
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
