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
    /**
     * OpenType single substitutions, kept apart per feature tag:
     * `{ 'tnum': { fromGid: toGid }, … }`.
     *
     * Distinct from {@link gsub}, which unions every SingleSubst lookup in
     * the font because the Indic and Thai shapers want them all. Splitting by
     * tag is what allows a caller to ask for tabular figures without also
     * getting every contextual alternate in the face.
     *
     * Absent or `null` on fonts built before v1.8.0, and on fonts declaring
     * none of the supported tags — feature requests are then no-ops.
     *
     * @since 1.8.0
     */
    readonly features?: Record<string, Record<number, number>> | null;
    /**
     * GPOS pair kerning: `{ leftGid: { rightGid: adjustment } }`, in design
     * units, negative to pull a pair together.
     *
     * Kerning is the most visible refinement a font carries — "AV", "To" and
     * "Yo" are set with their nominal advances without it — and pdfnative
     * extracted none of it before v1.8.0. Class-based GPOS subtables are
     * expanded to glyph pairs at build time, so applying them is a two-level
     * lookup with no shaping state.
     *
     * Absent or `null` on fonts built before v1.8.0 and on fonts with no pair
     * positioning, including the four Latin subsets whose GPOS was stripped
     * when they were subsetted.
     *
     * @since 1.8.0
     */
    readonly kern?: KernTable | null;
    readonly markAnchors: {
        readonly bases: Record<number, Record<number, [number, number]>>;
        readonly marks: Record<number, [number, number, number]>;
    } | null;
    readonly mark2mark: {
        readonly mark1Anchors: Record<number, Record<number, [number, number]>>;
        readonly mark2Classes: Record<number, [number, number, number]>;
    } | null;
    /**
     * Colour glyph table (COLR/CPAL), keyed by base glyph id. Present only
     * for colour fonts such as Noto Color Emoji (opt-in via the
     * `'emoji-color'` lang). Each entry is an ordered list of paint layers
     * resolved against the font's CPAL palette (painter's algorithm).
     * `undefined`/`null` for ordinary monochrome fonts. (v1.3.0)
     */
    readonly colorGlyphs?: Record<number, ColorGlyph> | null;
    /**
     * Multi-codepoint emoji sequences (flags via regional-indicator pairs,
     * ZWJ families/professions, …) resolved at font-build time from the
     * source font's GSUB ligature lookups. Keyed by the sequence's FIRST
     * codepoint; each entry is `[resultGid, cp2, cp3, …]` with entries
     * sorted longest-first so the runtime longest-match pre-pass can take
     * the first hit. Joiner codepoints (ZWJ, VS-16, regional indicators)
     * deliberately stay out of `cmap` — a font without this table keeps
     * the historical per-codepoint behaviour. (v1.7.0)
     */
    readonly sequences?: Record<number, number[][]> | null;
}

// ── Colour Glyph Types (COLR/CPAL — v1.3.0) ──────────────────────────

/** An sRGB colour with alpha, each channel 0–255. Resolved from CPAL. */
export type CpalColor = readonly [number, number, number, number];

/** A gradient colour stop: `offset` in [0,1] with a resolved colour. */
export interface ColorStop {
    readonly offset: number;
    readonly color: CpalColor;
}

/** How a gradient extends beyond its [0,1] range (COLR Extend / PDF Extend). */
export type GradientExtend = 'pad' | 'repeat' | 'reflect';

/** A flat colour fill (COLR PaintSolid / COLRv0 layer). */
export interface SolidPaint {
    readonly kind: 'solid';
    readonly color: CpalColor;
}

/** A linear (axial) gradient fill (COLR PaintLinearGradient → PDF Shading 2). */
export interface LinearGradientPaint {
    readonly kind: 'linear';
    readonly p0: readonly [number, number];
    readonly p1: readonly [number, number];
    readonly stops: readonly ColorStop[];
    readonly extend: GradientExtend;
}

/** A radial gradient fill (COLR PaintRadialGradient → PDF Shading 3). */
export interface RadialGradientPaint {
    readonly kind: 'radial';
    readonly c0: readonly [number, number];
    readonly r0: number;
    readonly c1: readonly [number, number];
    readonly r1: number;
    readonly stops: readonly ColorStop[];
    readonly extend: GradientExtend;
}

/**
 * A sweep (conic/angular) gradient fill (COLR PaintSweepGradient).
 *
 * PDF has no native conic shading, so the renderer approximates it as a fan
 * of flat-colour triangular wedges clipped to the glyph outline — pure path
 * operators, no shading resource. Angles are in counter-clockwise degrees
 * from the positive x-axis.
 *
 * @since 1.4.0
 */
export interface SweepGradientPaint {
    readonly kind: 'sweep';
    readonly center: readonly [number, number];
    readonly startAngle: number;
    readonly endAngle: number;
    readonly stops: readonly ColorStop[];
    readonly extend: GradientExtend;
}

/** A paint used to fill a colour-glyph layer. */
export type ColorPaint = SolidPaint | LinearGradientPaint | RadialGradientPaint | SweepGradientPaint;

/**
 * One outline taking part in a colour-layer clip.
 *
 * @since 1.8.0
 */
export interface ClipOutline {
    /** Glyph id of the outline (in the font's `glyf` table). */
    readonly glyphId: number;
    /** Affine transform `[a b c d e f]` of the outline, identity when absent. */
    readonly transform?: readonly [number, number, number, number, number, number];
}

/** A single colour-glyph layer: a base outline filled by a paint. */
export interface ColorLayer {
    /** Glyph id of the base outline (in the font's `glyf` table). */
    readonly glyphId: number;
    /** The fill applied to the outline. */
    readonly paint: ColorPaint;
    /**
     * Optional affine transform `[a b c d e f]` (font-unit space) applied to
     * both the outline and the paint geometry of this layer — flattened from
     * COLRv1 `PaintTransform`/`PaintTranslate`/`PaintScale`. Identity when
     * absent.
     */
    readonly transform?: readonly [number, number, number, number, number, number];
    /**
     * Optional PDF blend mode name (`/BM`) for this layer, flattened from a
     * COLRv1 `PaintComposite` whose composite mode maps to a separable or
     * non-separable PDF blend mode (e.g. `Multiply`, `Screen`, `Overlay`,
     * `Darken`, `Lighten`, `Difference`, `Hue`, `Luminosity`). Absent =
     * `Normal`. Porter-Duff structural modes (Clear/Src/Dest/Xor) are not
     * mapped — those glyphs fall back to the monochrome font instead.
     *
     * @since 1.4.0
     */
    readonly blendMode?: string;
    /**
     * Optional clip sets applied before the layer is painted: each set is the
     * union of the outlines it lists, and the sets are intersected. Flattened
     * from a COLRv1 `PaintComposite` in `SRC_IN` or `DEST_IN` mode whose mask
     * is made of glyph shapes, with no transparency group. A PDF clip is a
     * binary mask, so a partly translucent mask is carried as its nearest
     * binary mask: its layers at or above half opacity.
     *
     * @since 1.8.0
     */
    readonly clip?: readonly (readonly ClipOutline[])[];
    /**
     * When true, the layer paints the whole region its {@link clip} allows
     * rather than the outline of {@link glyphId}, and its paint geometry is
     * already in glyph space, so {@link transform} is absent. This carries a
     * masked fill with no outline of its own — the shaded wave across Noto's
     * flags. `glyphId` still names one of the mask outlines, so a consumer
     * unaware of this field draws something plausible rather than nothing.
     *
     * @since 1.8.0
     */
    readonly fillsClip?: boolean;
}

/** A resolved colour glyph: ordered layers painted back-to-front. */
export interface ColorGlyph {
    readonly layers: readonly ColorLayer[];
}

/** A colour-emoji Form XObject collected during content building. */
export interface ColorEmojiForm {
    /** Resource name (without leading `/`), e.g. `CEm0`. */
    readonly name: string;
    /** Form XObject content stream (font-unit space). */
    readonly content: string;
    /** Inline `/Resources` body (shadings + ExtGStates), may be empty. */
    readonly resources: string;
    /** Form BBox `[x0 y0 x1 y1]` in font units. */
    readonly bbox: readonly [number, number, number, number];
}

/**
 * Collects unique colour-emoji glyphs encountered while building a document's
 * content streams, de-duplicating them into a shared set of Form XObjects.
 * Present on the {@link EncodingContext} only when an `'emoji-color'` font
 * (a {@link FontData} carrying `colorGlyphs`) is registered. (v1.3.0)
 */
export interface ColorEmojiCollector {
    /**
     * Register use of a colour glyph and return its Form resource name, or
     * `null` when `gid` is not a colour glyph (caller falls back to normal
     * text rendering).
     */
    useGlyph(fontData: FontData, gid: number): string | null;
    /** The de-duplicated colour-emoji forms, in first-use order. */
    readonly forms: ColorEmojiForm[];
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
    /**
     * Operand for a `TJ` array when the run carries kerning adjustments, e.g.
     * `<0024> 40 <0057>`. The emitter writes `TJ` instead of `Tj` when this is
     * present; {@link widthPt} already accounts for the adjustments.
     *
     * @since 1.8.0
     */
    readonly tjStr?: string;
}

/**
 * One class-based PairPos subtable (OpenType format 2).
 *
 * Left and right glyphs are assigned classes, and the adjustment lives in a
 * matrix indexed by the pair of classes. Only classes the subtable can
 * actually reach are listed, and the matrix is sparse.
 *
 * @since 1.8.0
 */
export interface KernClassSubtable {
    /** Left glyph → class index. An absent glyph is outside the coverage. */
    readonly l: Record<number, number>;
    /** Right glyph → class index. An absent glyph is class 0, the default. */
    readonly r: Record<number, number>;
    /** Number of right-hand classes, the matrix row stride. */
    readonly n: number;
    /** Sparse adjustments keyed by `leftClass * n + rightClass`. */
    readonly m: Record<number, number>;
}

/**
 * A font's pair kerning, mirroring the two OpenType PairPos formats.
 *
 * The class form is kept rather than expanded to glyph pairs: expanding
 * Noto Sans produced 71 094 pairs and 594 KB — a fifth of the module — which
 * every consumer would parse whether or not they enable kerning. In class
 * form the same data is 46 KB.
 *
 * @since 1.8.0
 */
export interface KernTable {
    /** Format-1 subtables: explicit glyph pairs. */
    readonly p: Record<number, Record<number, number>> | null;
    /** Format-2 subtables: class-based, consulted in order. */
    readonly c: readonly KernClassSubtable[] | null;
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
    /**
     * Colour-emoji collector — present only when an `'emoji-color'` font
     * (carrying `colorGlyphs`) is registered. Used by the text emitter to
     * draw colour-emoji Form XObjects inline. (v1.3.0)
     */
    readonly colorEmoji?: ColorEmojiCollector;
    /**
     * Which base-14 advance widths the Latin path measures with.
     * `'approximate'` (the default, and how it is left when absent) is the
     * historical bucketed estimate; `'exact'` uses the Adobe Core 14 AFM
     * tables. (v1.8.0)
     */
    readonly metrics?: Base14Metrics;
    /**
     * Derive a context that applies the given OpenType features to every
     * glyph it encodes and measures.
     *
     * Returns the same context when nothing would change — no registered
     * font, or none of the tags declared by the fonts in play.
     *
     * @since 1.8.0
     */
    readonly withFeatures?: (tags: readonly string[]) => EncodingContext;
}

/**
 * Base-14 measurement mode.
 *
 * - `'approximate'` — the historical estimate: 556 for digits, 680 for
 *   capitals, 500 for lowercase and 556 for everything else. Fast, and what
 *   every release up to 1.7.0 emitted.
 * - `'exact'` — the Adobe Core 14 AFM advances, correct for punctuation,
 *   accented letters and currency.
 *
 * @since 1.8.0
 */
export type Base14Metrics = 'approximate' | 'exact';

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
 * Optional metadata for the PDF /Info dictionary (ISO 32000-1 §14.3.3),
 * mirrored into the XMP packet for tagged/PDF-A output.
 */
export interface DocumentMetadata {
    readonly author?: string;
    readonly subject?: string;
    readonly keywords?: string;
    /**
     * `/Info /Trapped` (ISO 32000-1 §14.11.6): whether the document has
     * been trapped for high-end colour printing. Mirrored to XMP as
     * `pdf:Trapped`. @since 1.7.0
     */
    readonly trapped?: 'True' | 'False' | 'Unknown';
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
    /**
     * Document metadata written to /Info (/Author /Subject /Keywords) and
     * mirrored into the XMP packet under tagged/PDF-A modes. Omitted →
     * byte-identical output to previous releases.
     * @since 1.7.0
     */
    readonly metadata?: DocumentMetadata;
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
    /**
     * Semantic kind for the column. When set to `'amount'`, data cells in
     * this column render in Helvetica-Bold with credit/debit colouring
     * driven by `row.type`. Opt-in replacement for the pre-1.2.0
     * hardcoded `i === 3` heuristic in `renderTable`. Default: plain text
     * in `colors.text` and `enc.f1` (Helvetica-Regular).
     * @since 1.2.0
     */
    readonly kind?: 'amount';
    /**
     * Vertical alignment of this column's cell content within the row band
     * (`'top'` | `'middle'` | `'bottom'`). Overrides the table-level
     * `TableBlock.cellVAlign`. When omitted, the historic baseline placement is
     * preserved (byte-identical to pre-1.4.0).
     * @since 1.4.0
     */
    readonly vAlign?: 'top' | 'middle' | 'bottom';
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

// ── Conformance Diagnostics (v1.7.0) ─────────────────────────────────

/** Machine-readable conformance diagnostic codes (stable API — additions only). */
export type PdfDiagnosticCode =
    /** PDF/A level requested with no `fontEntries` — unembedded standard-14 fonts (ISO 19005 §6.2.11.4.1). (#69) */
    | 'PDFA_NO_FONT_ENTRIES'
    /** DeviceCMYK image under a PDF/A claim with an sRGB OutputIntent (ISO 19005-2 §6.2.4.3). */
    | 'PDFA_DEVICE_CMYK_IMAGE'
    /** AcroForm fields under a PDF/A claim — form appearances use an unembedded base-14 /Helv font (ISO 19005 §6.2.11.4.1). */
    | 'PDFA_UNEMBEDDED_FORM_FONT';

/** A single conformance diagnostic surfaced by the builders. */
export interface PdfDiagnostic {
    readonly code: PdfDiagnosticCode;
    /** Human-readable, actionable message (includes the remedy). */
    readonly message: string;
    readonly severity: 'warning';
}

/** Sink for conformance diagnostics. Pass `() => {}` to silence. */
export type PdfDiagnosticHandler = (diagnostic: PdfDiagnostic) => void;

/**
 * Fine typographic control over how text blocks break across pages.
 *
 * Every setting is opt-in: with `typography` omitted, paragraphs stay atomic
 * and output is byte-identical to earlier releases.
 *
 * @since 1.8.0
 */
export interface TypographyOptions {
    /**
     * Allow a paragraph to break across a page boundary at a line boundary.
     *
     * Historically a paragraph was atomic: one that did not fit in the
     * remaining space moved to the next page whole, which leaves large gaps in
     * running text, and one taller than a full page simply overflowed off the
     * bottom. With this on, a paragraph is laid out line by line, the way
     * tables have always been laid out row by row.
     *
     * {@link orphans} and {@link widows} constrain where those breaks may fall
     * and only apply when this is on.
     *
     * Default: `false` (atomic, byte-identical).
     */
    readonly splitParagraphs?: boolean;
    /**
     * Minimum number of a paragraph's lines that must remain at the foot of a
     * page for a break to be allowed there. Fewer, and the whole paragraph
     * moves to the next page rather than leaving a stranded first line.
     *
     * Requires {@link splitParagraphs}. Default: `2`.
     */
    readonly orphans?: number;
    /**
     * Minimum number of a paragraph's lines that must be carried to the next
     * page. Fewer, and the break is pulled earlier so the remainder is not a
     * single stranded last line.
     *
     * Requires {@link splitParagraphs}. Default: `2`.
     */
    readonly widows?: number;
    /**
     * Keep every heading with the content that follows it: a heading that
     * would be the last item on a page moves to the next page along with it.
     *
     * Independent of {@link splitParagraphs} — a heading stranded at the foot
     * of a page is the most visible break fault in a generated report, and
     * fixing it needs no line-level layout.
     *
     * Individual blocks can opt in or out with their own `keepWithNext`.
     *
     * Default: `false`.
     */
    readonly keepHeadingsWithNext?: boolean;
    /**
     * Bind a numerical value to the unit symbol that follows it with a
     * no-break space, so `150 €`, `12 kg` or `30 %` never break across a
     * line. ISO 80000-1 §7.1 asks for this in every language, so it carries
     * no locale and no cultural assumption.
     *
     * Pass `true` for the built-in symbol list, or an object to extend it.
     * Only an existing plain space is converted, and only before a recognised
     * unit standing on its own — "150 personnes" stays breakable.
     *
     * Default: `false`.
     */
    readonly unitBinding?: boolean | UnitBindingOptions;
    /**
     * Replace the plain spaces around punctuation with no-break ones.
     *
     * Unlike unit binding, this is **not** universal: French sets a narrow
     * space before `;` `!` `?`, Canadian French sets none, English, German,
     * Italian and Spanish set none anywhere, and Polish has an unrelated rule
     * about one-letter prepositions. So it takes either the name of a preset
     * the library can state precisely (`'fr'`, `'fr-CA'`) or an explicit list
     * of rules describing any other convention.
     *
     * Only existing spaces are converted; nothing is inserted where the
     * author wrote none. Applies to headings, paragraphs, lists, link labels
     * and table content.
     *
     * Default: `undefined` (no change).
     */
    readonly punctuationSpacing?: PunctuationSpacingPreset | readonly PunctuationSpacingRule[];
    /**
     * Let punctuation hang past the edge it sits against, so the optical edge
     * of a column reads straight.
     *
     * A line beginning with an opening quote, or ending in a full stop, looks
     * indented even with its glyph origin exactly on the margin, because the
     * mark is mostly white space inside its own box. Hanging it back out is
     * the classic fix, and the most visible difference between typeset and
     * generated pages.
     *
     * Applies to paragraphs: the leading mark of left-aligned and justified
     * lines, and the trailing mark of justified and right-aligned ones.
     * Offsets are a fraction of the mark's own advance and are conservative.
     *
     * Default: `false`.
     */
    readonly opticalMargins?: boolean;
    /**
     * Which advance widths the base-14 (Latin, non-embedded) path measures
     * with.
     *
     * The historical estimate buckets every digit at 556, every capital at
     * 680, every lowercase at 500 and everything else at 556 — which covers
     * most punctuation and every accented letter. A line of French or a
     * column of currency therefore measures visibly wrong, showing up as
     * mis-wrapped lines, truncation that cuts too early or too late, and
     * right-aligned text that misses its margin.
     *
     * `'exact'` reads the Adobe Core 14 AFM advances instead. It is opt-in
     * because better measurement necessarily moves line breaks: an existing
     * document re-wraps, which is a change of output rather than a bug fix.
     *
     * Only affects the base-14 path. Registered (embedded) fonts always
     * measure from their own `hmtx` table.
     *
     * Default: `'approximate'`.
     */
    readonly metrics?: Base14Metrics;
    /**
     * OpenType features to apply to the document's text, by tag.
     *
     * The one that earns its keep is `'tnum'`: proportional digits make a
     * column of amounts ragged, because `1` is narrower than `8`. Tabular
     * figures give every digit the same advance, which is the difference
     * between a financial table that lines up and one that does not.
     *
     * Only single substitutions are supported — one glyph in, one glyph out.
     * That is what makes them safe to apply without a shaping engine.
     * Available tags: `tnum`, `pnum`, `lnum`, `onum`, `zero`, `ordn`, `sups`,
     * `subs`, `smcp`, `c2sc`, `case`. Contextual and ligature features
     * (`liga`, `calt`, `frac`) are out of scope.
     *
     * Requires a registered font: the non-embedded base-14 faces carry no
     * OpenType tables. Asking for a tag a font does not declare is a silent
     * no-op, since the same document may be built with different fonts.
     * Later tags win where two features touch the same glyph.
     *
     * Default: none.
     */
    readonly fontFeatures?: readonly string[];
    /**
     * Apply the font's pair kerning.
     *
     * Without it "AV", "To" and "Yo" are set with their nominal advances,
     * which is the single most visible difference between typeset and
     * generated text. Adjustments are emitted as `TJ` arrays, so a kerned run
     * stays one text-showing operator and viewer selection and extraction are
     * unaffected.
     *
     * Requires a registered font carrying a `kern` table — the base-14 faces
     * have no OpenType data, and the four Latin subsets had their GPOS
     * stripped when they were subsetted. Opt-in because it necessarily moves
     * glyphs and therefore changes output.
     *
     * Default: `false`.
     */
    readonly kerning?: boolean;
}

/** Built-in punctuation-spacing conventions. @since 1.8.0 */
export type PunctuationSpacingPreset = 'fr' | 'fr-CA';

/**
 * One punctuation-spacing rule: the plain space on `side` of `char` becomes
 * the given no-break space.
 *
 * @since 1.8.0
 */
export interface PunctuationSpacingRule {
    /** The punctuation character the rule applies to. */
    readonly char: string;
    /** Which side of the character the space sits on. */
    readonly side: 'before' | 'after';
    /** `'nbsp'` for U+00A0, `'narrow'` for U+202F. */
    readonly space: 'nbsp' | 'narrow';
}

/** Configuration for {@link TypographyOptions.unitBinding}. @since 1.8.0 */
export interface UnitBindingOptions {
    /**
     * Unit symbols to recognise, replacing the built-in list entirely.
     * Longer symbols win over shorter prefixes automatically.
     */
    readonly units?: readonly string[];
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
     * Escalate conformance diagnostics (e.g. a PDF/A level requested with
     * no embedded fonts) to thrown errors instead of warnings, before any
     * output bytes are produced. Default `false`. @since 1.7.0
     */
    readonly strict?: boolean;
    /**
     * Sink for conformance diagnostics. Default: `console.warn`, once per
     * diagnostic code per build. Pass `() => {}` to silence. Ignored when
     * `strict` is set (diagnostics throw instead). @since 1.7.0
     */
    readonly onDiagnostic?: PdfDiagnosticHandler;
    /**
     * Professional print-production options: bleed/trim/art/crop page
     * boxes, printer's marks, and `/UserUnit`. Byte-identical output when
     * omitted. See {@link PrintOptions}. @since 1.7.0
     */
    readonly print?: PrintOptions;
    /**
     * Caller-supplied OutputIntent ICC profile for tagged/PDF-A output —
     * replaces the built-in minimal sRGB profile. RGB profiles only.
     * Ignored when `tagged` is off (no OutputIntent is emitted there).
     * See {@link CustomOutputIntent}. @since 1.7.0
     */
    readonly outputIntent?: CustomOutputIntent;
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
     *   but the output is in fact slightly **larger** than the uncompressed baseline, because
     *   of the DEFLATE framing overhead (~5 bytes per 64 KB block).
     *
     *   To get real compression there, inject a **synchronous** compressor. The recommended
     *   route is `setDeflateRawImpl()`, which takes plain RFC 1951 output — what portable
     *   compressors actually emit — and lets pdfnative add the zlib envelope itself:
     *   ```ts
     *   import { getCodec, METHOD_DEFLATE } from 'zipnative';
     *   import { setDeflateRawImpl } from 'pdfnative';
     *
     *   const codec = getCodec(METHOD_DEFLATE);
     *   setDeflateRawImpl((buf) => codec.compressSync!(buf, { level: 6, deterministic: true }));
     *   ```
     *   zipnative is a zero-dependency pure-TypeScript encoder, so this keeps the whole stack
     *   dependency-free; `deterministic: true` pins its pure encoder, so the emitted PDF is
     *   byte-identical on every runtime. On a typical text-heavy document this takes the
     *   output to roughly a quarter of its uncompressed size, where the stored-block fallback
     *   would have made it marginally bigger.
     *
     *   `setDeflateImpl()` remains available for a compressor that already emits the
     *   RFC 1950 envelope:
     *   ```ts
     *   import { zlibSync } from 'fflate';   // NOT `deflateSync`, which is raw
     *   setDeflateImpl((buf) => zlibSync(buf));
     *   ```
     *   ```ts
     *   import pako from 'pako';             // `pako.deflate` already wraps
     *   setDeflateImpl((buf) => pako.deflate(buf));
     *   ```
     *   Two traps, both rejected at build time with an explanatory error rather than
     *   silently producing blank pages: passing **raw** RFC 1951 output to `setDeflateImpl`
     *   (fflate's `deflateSync`, `CompressionStream`'s `'deflate-raw'`), and passing an
     *   **asynchronous** compressor to either entry point, which returns `undefined` or a
     *   `Promise` rather than bytes. `CompressionStream` cannot be adapted at all, because
     *   PDF assembly is synchronous.
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
    /**
     * Maximum number of document blocks `buildDocumentPDF` / `buildDocumentPDFBytes`
     * (and the streaming variants) will accept before throwing. This is a
     * safety rail against accidental unbounded input, not a hard engine limit —
     * raise it for very large generated reports (e.g. multi-thousand-page
     * medical or financial documents).
     *
     * Default: `DEFAULT_MAX_BLOCKS` (100 000), matching the table builder's
     * 100 000-row ceiling. Has no effect on the table builder (`buildPDF`).
     *
     * @since 1.3.0
     */
    readonly maxBlocks?: number;
    /**
     * Apply Unicode normalization to all rendered text before shaping and
     * encoding. Uses the native `String.prototype.normalize` (zero dependency).
     *
     * Useful when input text may contain decomposed combining sequences (e.g.
     * Vietnamese, some Indic input, or text copied from macOS which favours
     * NFD) so that base + combining marks compose to the precomposed code
     * points a font's cmap is most likely to cover, maximising glyph coverage.
     *
     * - `'NFC'` (recommended): canonical composition
     * - `'NFD'`: canonical decomposition
     * - `'NFKC'` / `'NFKD'`: compatibility (de)composition
     * - `false` / omitted: no normalization (default — output is byte-identical)
     *
     * Default: `false` (backward compatible, byte-stable).
     *
     * @since 1.3.0
     */
    readonly normalize?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD' | false;
    /**
     * Override the PDF creation date embedded in `/Info /CreationDate` and
     * XMP metadata. Accepts any `Date` object.
     *
     * When omitted, defaults to `new Date()` at build time. Pinning this
     * value makes output byte-identical across repeated calls — useful for
     * deterministic tests and content-addressable storage.
     *
     * Default: `undefined` (current wall-clock time).
     *
     * @since 1.3.0
     */
    readonly creationDate?: Date;
    /**
     * Fine typographic control: where a paragraph may break across pages and
     * how many of its lines must stay together.
     *
     * Entirely opt-in. Omitted, every setting keeps its historical behaviour
     * and output is byte-identical.
     *
     * @since 1.8.0
     */
    readonly typography?: TypographyOptions;
    /**
     * How a conforming viewer should present the document when it is first
     * opened: initial page layout, page mode (bookmark/thumbnail panel, full
     * screen…), window fit/centering, UI-chrome visibility, and whether the
     * window title shows the document title. Maps to catalog `/PageLayout`,
     * `/PageMode`, and the `/ViewerPreferences` dictionary (ISO 32000-1 §12.2).
     *
     * Purely presentational, PDF/A-safe, and fully optional. When the document
     * also has an outline, an explicit `pageMode` here overrides the outline's
     * default `/UseOutlines`.
     *
     * Default: `undefined` (viewer default presentation).
     *
     * @since 1.4.0
     */
    readonly viewerPreferences?: ViewerPreferences;
    /**
     * Draw a diagnostic layout overlay on every page to visualise how the
     * document builder placed content. Purely a development aid — leave it
     * off (the default) for production output.
     *
     * - `false` / omitted: no overlay (default — output is byte-identical).
     * - `true`: draw all overlay layers (margin box, block content bounds,
     *   and table cell outlines).
     * - object: enable individual layers selectively.
     *
     * The overlay is drawn with thin, semi-transparent-free stroked rectangles
     * in distinct colours and never alters text placement, so a document built
     * with `debug` on has identical content geometry to one built with it off —
     * only extra guide rectangles are added.
     *
     * @since 1.5.0
     */
    readonly debug?: boolean | LayoutDebugOptions;
}

/**
 * Fine-grained control over the {@link PdfLayoutOptions.debug} overlay layers.
 * Every layer defaults to `false`; pass `debug: true` to enable them all.
 *
 * @since 1.5.0
 */
export interface LayoutDebugOptions {
    /** Draw the page content box (page rect inset by the margins). */
    readonly showMargins?: boolean;
    /** Draw a rectangle around each block's laid-out content bounds. */
    readonly showContentBounds?: boolean;
    /** Draw cell outlines for every table cell. */
    readonly showCells?: boolean;
}

/**
 * Viewer presentation preferences (ISO 32000-1 §12.2, Table 150 + §7.7.2).
 *
 * Every field is optional; omitted fields leave the viewer's default behaviour
 * unchanged. Purely presentational and PDF/A-safe.
 *
 * @since 1.4.0
 */
export interface ViewerPreferences {
    /**
     * Initial page layout (catalog `/PageLayout`):
     * - `'singlePage'`: one page at a time
     * - `'oneColumn'`: continuous single column
     * - `'twoColumnLeft'` / `'twoColumnRight'`: continuous two columns, odd pages on the left/right
     * - `'twoPageLeft'` / `'twoPageRight'`: two pages at a time, odd pages on the left/right
     */
    readonly pageLayout?:
        | 'singlePage' | 'oneColumn'
        | 'twoColumnLeft' | 'twoColumnRight'
        | 'twoPageLeft' | 'twoPageRight';
    /**
     * Initial page mode (catalog `/PageMode`):
     * - `'useNone'`: neither bookmarks nor thumbnails visible
     * - `'useOutlines'`: bookmark panel open
     * - `'useThumbs'`: thumbnail panel open
     * - `'fullScreen'`: full-screen, no menu/panel
     * - `'useOC'`: optional-content (layers) panel
     * - `'useAttachments'`: attachments panel
     */
    readonly pageMode?:
        | 'useNone' | 'useOutlines' | 'useThumbs'
        | 'fullScreen' | 'useOC' | 'useAttachments';
    /** Hide the viewer's tool bars. */
    readonly hideToolbar?: boolean;
    /** Hide the viewer's menu bar. */
    readonly hideMenubar?: boolean;
    /** Hide UI elements (scrollbars, navigation controls), leaving only the page. */
    readonly hideWindowUI?: boolean;
    /** Resize the document window to fit the first displayed page. */
    readonly fitWindow?: boolean;
    /** Centre the document window on the screen. */
    readonly centerWindow?: boolean;
    /** Show the document title (from `/Info /Title`) in the window title bar. */
    readonly displayDocTitle?: boolean;
    /** Page mode to use when exiting full-screen (`/NonFullScreenPageMode`). */
    readonly nonFullScreenPageMode?: 'useNone' | 'useOutlines' | 'useThumbs' | 'useOC';
    /** Predominant reading order: left-to-right (default) or right-to-left. */
    readonly direction?: 'l2r' | 'r2l';
    /** Page-scaling default for the Print dialog (`/PrintScaling`). */
    readonly printScaling?: 'none' | 'appDefault';
    /**
     * Paper-handling default for the Print dialog (`/Duplex`):
     * single-sided, or double-sided flipping on the short/long edge.
     * @since 1.7.0
     */
    readonly duplex?: 'simplex' | 'duplexFlipShortEdge' | 'duplexFlipLongEdge';
    /**
     * Ask the printer to pick the input tray from the PDF page size
     * (`/PickTrayByPDFSize`, Windows viewers). @since 1.7.0
     */
    readonly pickTrayByPDFSize?: boolean;
    /**
     * Default page ranges for the Print dialog (`/PrintPageRange`), as
     * inclusive 1-based `[first, last]` pairs — e.g. `[[1, 4], [7, 7]]`.
     * @since 1.7.0
     */
    readonly printPageRange?: readonly (readonly [number, number])[];
    /** Default number of copies for the Print dialog (`/NumCopies`; viewers honour 2–5 per ISO 32000 Table 150, other values are ignored). @since 1.7.0 */
    readonly numCopies?: number;
}

// ── Print Production Types (v1.7.0) ──────────────────────────────────

/** A page box rectangle `[x0, y0, x1, y1]` in points, PDF user space. */
export type PageBox = readonly [number, number, number, number];

/** Printer's-marks options for {@link PrintOptions.marks}. */
export interface PrinterMarksOptions {
    /** Draw corner crop (trim) marks. Default `true`. */
    readonly crop?: boolean;
    /** Draw registration targets on the four edge midpoints. Default `true`. */
    readonly registration?: boolean;
    /** Mark stroke length in points. Default `14`. */
    readonly length?: number;
    /** Gap between the TrimBox edge and the mark start, in points. Default `5`. */
    readonly offset?: number;
    /** Mark stroke weight in points. Default `0.25` (hairline). */
    readonly weight?: number;
}

/**
 * Professional print-production options (`layout.print`, v1.7.0): page
 * geometry boxes (ISO 32000-1 §14.11.2), printer's marks (§14.11.3) and
 * large-format `/UserUnit`. Purely additive — output is byte-identical
 * when the option is absent. Marks are drawn in RGB black; true
 * all-separation registration colour arrives with CMYK content support.
 */
export interface PrintOptions {
    /**
     * Bleed shorthand in points: sets `TrimBox` = MediaBox inset by this
     * amount on every side and `BleedBox` = MediaBox. Design the page with
     * `pageWidth`/`pageHeight` = trim size + 2×bleed and let backgrounds
     * run to the page edge. Mutually exclusive with an explicit `trimBox`.
     * (3&nbsp;mm ≈ 8.5&nbsp;pt.)
     */
    readonly bleed?: number;
    /** Explicit `/TrimBox` — the finished page size after cutting. */
    readonly trimBox?: PageBox;
    /** Explicit `/BleedBox` — content clipped in production. Defaults sensibly with `bleed`. */
    readonly bleedBox?: PageBox;
    /** Explicit `/ArtBox` — meaningful-content extent. */
    readonly artBox?: PageBox;
    /** Explicit `/CropBox` — the region displayed/printed by viewers. */
    readonly cropBox?: PageBox;
    /**
     * Printer's marks drawn OUTSIDE the TrimBox on every page: `true` for
     * crop + registration marks with professional defaults, or a
     * {@link PrinterMarksOptions} object. Requires a TrimBox (explicit or
     * via `bleed`).
     */
    readonly marks?: boolean | PrinterMarksOptions;
    /**
     * `/UserUnit`: size of one user-space unit in multiples of 1/72 inch
     * (1–75 000), for pages larger than the 14 400-unit limit (banners,
     * plans). Requires PDF 1.6+ — the header is raised to `%PDF-1.7` when
     * needed; forbidden under `tagged: 'pdfa1b'` (PDF/A-1 is PDF 1.4).
     */
    readonly userUnit?: number;
}

/**
 * Caller-supplied OutputIntent for tagged/PDF-A documents (v1.7.0):
 * replaces the built-in minimal sRGB profile with a real ICC profile
 * (e.g. sRGB IEC61966-2.1 v4, Adobe RGB). RGB profiles only — pdfnative
 * emits RGB content; a CMYK intent would contradict it (veraPDF rejects
 * mismatches). Omitted → the historical built-in profile, byte-identical.
 */
export interface CustomOutputIntent {
    /** Raw ICC profile bytes (must declare an RGB data colour space). */
    readonly iccProfile: Uint8Array;
    /** `/OutputConditionIdentifier` — e.g. `"sRGB IEC61966-2.1"`. */
    readonly outputConditionIdentifier: string;
    /** `/RegistryName` — default `"http://www.color.org"`. */
    readonly registryName?: string;
    /** `/OutputCondition` — human-readable condition name. */
    readonly outputCondition?: string;
    /** `/Info` — additional human-readable information. */
    readonly info?: string;
}

// ── Layout Inspection Types ──────────────────────────────────────────

/**
 * One block's laid-out footprint, as reported by {@link inspectDocumentLayout}.
 * Coordinates are in PDF user space (origin bottom-left, points), matching the
 * document builder: `top` is the y-coordinate of the block's upper edge and
 * `height` extends downward from it.
 *
 * @since 1.5.0
 */
export interface InspectedBlock {
    /** The originating block's `type` (e.g. `'heading'`, `'paragraph'`, `'table'`). */
    readonly type: string;
    /** 0-based index of the page this block was placed on. */
    readonly page: number;
    /** X-coordinate of the block's left edge (points). */
    readonly x: number;
    /** Y-coordinate of the block's top edge (points, y increases upward). */
    readonly top: number;
    /** Content width available to the block (points). */
    readonly width: number;
    /** Estimated block height (points). */
    readonly height: number;
}

/** One page's worth of {@link InspectedBlock}s. @since 1.5.0 */
export interface InspectedPage {
    /** 0-based page index. */
    readonly index: number;
    /** Blocks placed on this page, in render order. */
    readonly blocks: readonly InspectedBlock[];
}

/**
 * Deterministic, read-only description of how {@link inspectDocumentLayout}
 * expects the document builder to paginate and place a set of blocks. Useful
 * for debugging layout, writing layout assertions in tests, or building
 * higher-level tooling — it never renders a PDF.
 *
 * The result mirrors the builder's pagination using the same measurement
 * primitives; treat the per-block geometry as a faithful estimate.
 *
 * @since 1.5.0
 */
export interface LayoutInspection {
    /** Page width in points. */
    readonly pageWidth: number;
    /** Page height in points. */
    readonly pageHeight: number;
    /** Page margins `{ t, r, b, l }` in points. */
    readonly margins: { readonly t: number; readonly r: number; readonly b: number; readonly l: number };
    /** Total number of pages the blocks paginate into. */
    readonly totalPages: number;
    /** Per-page block placement. */
    readonly pages: readonly InspectedPage[];
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
