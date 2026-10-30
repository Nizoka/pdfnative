/**
 * pdfnative — Which code point names a glyph (ToUnicode)
 * =======================================================
 * A font's `cmap` maps several code points to one glyph: the CJK unified
 * ideograph 月 (U+6708) and the Kangxi radical ⽉ (U+2F49), the Arabic-Indic
 * digit ١ (U+0661) and its Extended Arabic-Indic twin ۱ (U+06F1), a bold
 * Greek capital in two mathematical alphanumeric blocks. Inverting the cmap
 * with "lowest code point wins" picked the radical over the ideograph for
 * about 280 glyphs of every bundled CJK font, so untagged text extracted as
 * compatibility characters no reader types (#84).
 *
 * The rule here ranks code points by block: ordinary characters first,
 * compatibility and presentation blocks last; among equals the lowest wins,
 * as before. It is the tie-break the embedder and the feature-substitution
 * map apply when no better evidence exists — the code point the text
 * actually encoded, when known, overrides it.
 *
 * @module fonts/unicode-preference
 * @since 1.9.0
 */

/**
 * Blocks whose characters are compatibility or presentation forms of
 * characters found elsewhere; a glyph shared with an ordinary character is
 * named by the ordinary one. Ranges are inclusive.
 */
const COMPATIBILITY_BLOCKS: ReadonlyArray<readonly [number, number]> = [
    [0x2E80, 0x2EFF],   // CJK Radicals Supplement
    [0x2F00, 0x2FDF],   // Kangxi Radicals
    [0x3130, 0x318F],   // Hangul Compatibility Jamo
    [0x3200, 0x32FF],   // Enclosed CJK Letters and Months
    [0x3300, 0x33FF],   // CJK Compatibility
    [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
    [0xFB00, 0xFB4F],   // Alphabetic Presentation Forms
    [0xFB50, 0xFDFF],   // Arabic Presentation Forms-A
    [0xFE10, 0xFE1F],   // Vertical Forms
    [0xFE30, 0xFE4F],   // CJK Compatibility Forms
    [0xFE50, 0xFE6F],   // Small Form Variants
    [0xFE70, 0xFEFF],   // Arabic Presentation Forms-B
    [0xFF00, 0xFFEF],   // Halfwidth and Fullwidth Forms
    [0x1D400, 0x1D7FF], // Mathematical Alphanumeric Symbols
    [0x1F100, 0x1F1FF], // Enclosed Alphanumeric Supplement
    [0x2F800, 0x2FA1F], // CJK Compatibility Ideographs Supplement
];

/**
 * 0 for an ordinary character, 1 for a compatibility or presentation form.
 *
 * @since 1.9.0
 */
export function codepointRank(cp: number): 0 | 1 {
    for (const [a, b] of COMPATIBILITY_BLOCKS) if (cp >= a && cp <= b) return 1;
    return 0;
}

/**
 * Of two code points a glyph stands for, the one that should name it in a
 * ToUnicode CMap: the ordinary character over the compatibility form, the
 * lower code point among equals (the historical rule).
 *
 * @since 1.9.0
 */
export function preferredCodepoint(a: number, b: number): number {
    const ra = codepointRank(a);
    const rb = codepointRank(b);
    if (ra !== rb) return ra < rb ? a : b;
    return a <= b ? a : b;
}
