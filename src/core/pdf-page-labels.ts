/**
 * pdfnative — Page Labels (ISO 32000-1 §12.4.2)
 * ==============================================
 * Builds the `/PageLabels` number tree placed in the document catalog.
 * Page labels control the page numbering shown in a viewer's page-number
 * box and thumbnails (e.g. roman-numeral front matter `i, ii, iii`,
 * decimal body `1, 2, 3`, prefixed appendices `A-1, A-2`).
 *
 * The builder is **pure** and emits an inline dictionary string — page
 * labels require no indirect objects. Output is PDF/A-safe.
 */

/** Page-numbering style for a {@link PageLabelRange}. */
export type PageLabelStyle =
    | 'decimal' // 1, 2, 3   → /S /D
    | 'roman'   // i, ii, iii → /S /r
    | 'Roman'   // I, II, III → /S /R
    | 'alpha'   // a, b, c   → /S /a
    | 'Alpha'   // A, B, C   → /S /A
    | 'none';   // prefix-only (no /S)

/** A contiguous run of pages sharing a numbering scheme. */
export interface PageLabelRange {
    /** 0-based index of the first page in this range. */
    readonly startPage: number;
    /** Numbering style. Omit or use `'none'` for prefix-only labels. */
    readonly style?: PageLabelStyle;
    /** Optional label prefix (e.g. `'A-'`). */
    readonly prefix?: string;
    /** First numeric value in the range (default `1`). */
    readonly start?: number;
}

const STYLE_OP: Record<Exclude<PageLabelStyle, 'none'>, string> = {
    decimal: 'D',
    roman: 'r',
    Roman: 'R',
    alpha: 'a',
    Alpha: 'A',
};

/** Escape a PDF literal string (backslash + parentheses). */
function escapePdfLiteral(s: string): string {
    return s.replace(/[\\()]/g, c => '\\' + c);
}

/**
 * Build the inline `/PageLabels` number-tree dictionary string.
 *
 * @param ranges    Page-label ranges. Must be non-empty.
 * @param pageCount Total page count, for boundary validation.
 * @returns Inline dictionary, e.g. `<< /Nums [0 << /S /r >> 4 << /S /D >>] >>`.
 * @throws Error when a range index is out of bounds or ranges are unordered.
 */
export function buildPageLabelsDict(ranges: readonly PageLabelRange[], pageCount: number): string {
    if (ranges.length === 0) {
        throw new Error('pageLabels must contain at least one range');
    }
    const sorted = [...ranges].sort((a, b) => a.startPage - b.startPage);
    let prev = -1;
    const nums: string[] = [];
    for (const r of sorted) {
        const idx = r.startPage | 0;
        if (idx < 0 || idx >= pageCount) {
            throw new Error(`pageLabels range startPage ${idx} out of bounds (0-${pageCount - 1})`);
        }
        if (idx <= prev) {
            throw new Error(`pageLabels ranges must have strictly increasing, unique startPage values (got ${idx} after ${prev})`);
        }
        prev = idx;

        const entryParts: string[] = [];
        const style = r.style ?? 'decimal';
        if (style !== 'none') {
            entryParts.push(`/S /${STYLE_OP[style]}`);
        }
        if (r.prefix !== undefined && r.prefix !== '') {
            entryParts.push(`/P (${escapePdfLiteral(r.prefix)})`);
        }
        if (r.start !== undefined && r.start !== 1) {
            if (!Number.isInteger(r.start) || r.start < 1) {
                throw new Error(`pageLabels range start must be a positive integer (got ${r.start})`);
            }
            entryParts.push(`/St ${r.start}`);
        }
        nums.push(`${idx} << ${entryParts.join(' ')} >>`);
    }
    return `<< /Nums [${nums.join(' ')}] >>`;
}
