/**
 * pdfnative — Adobe Core 14 metrics (v1.8.0)
 * ============================================
 * Exact advance widths for the two base-14 faces pdfnative emits, taken from
 * the Adobe AFM files (units of 1/1000 em, WinAnsiEncoding order).
 *
 * The historical measurement path approximates: every digit 556, every
 * capital 680, every lowercase 500, and **556 for everything else**. That
 * default swallows most punctuation and every accented letter, so a line of
 * French or a column of currency measures visibly wrong — which shows up as
 * mis-wrapped lines, truncation that cuts too early or too late, and
 * right-aligned text that does not land on its margin.
 *
 * Switching is opt-in (`layout.metrics: 'exact'`) because better measurement
 * necessarily moves line breaks: an existing document would re-wrap, which is
 * a change of output, not a bug fix. The approximation stays the default so
 * output is byte-identical until a caller asks otherwise.
 *
 * @module fonts/base14-metrics
 */

/** Width used for WinAnsi positions with no glyph, matching the old default. */
const HELV_FALLBACK = 556;
const HELV_BOLD_FALLBACK = 611;

/**
 * Helvetica advances for WinAnsi codes 32–255 (index 0 is code 32).
 * Source: Adobe `Helvetica.afm`, Core 14 standard.
 */
const HELVETICA: readonly number[] = [
    // 0x20–0x2F
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    // 0x30–0x3F  digits, : ; < = > ?
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    // 0x40–0x4F  @ A–O
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    // 0x50–0x5F  P–Z [ \ ] ^ _
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    // 0x60–0x6F  ` a–o
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    // 0x70–0x7F  p–z { | } ~ DEL
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, HELV_FALLBACK,
    // 0x80–0x8F  CP1252 punctuation
    556, HELV_FALLBACK, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, HELV_FALLBACK, 611, HELV_FALLBACK,
    // 0x90–0x9F
    HELV_FALLBACK, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, HELV_FALLBACK, 500, 667,
    // 0xA0–0xAF
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    // 0xB0–0xBF
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    // 0xC0–0xCF
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    // 0xD0–0xDF
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    // 0xE0–0xEF
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    // 0xF0–0xFF
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
];

/**
 * Helvetica-Bold advances for WinAnsi codes 32–255 (index 0 is code 32).
 * Source: Adobe `Helvetica-Bold.afm`, Core 14 standard.
 */
const HELVETICA_BOLD: readonly number[] = [
    // 0x20–0x2F
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    // 0x30–0x3F
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    // 0x40–0x4F
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    // 0x50–0x5F
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    // 0x60–0x6F
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    // 0x70–0x7F
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, HELV_BOLD_FALLBACK,
    // 0x80–0x8F
    556, HELV_BOLD_FALLBACK, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, HELV_BOLD_FALLBACK, 611, HELV_BOLD_FALLBACK,
    // 0x90–0x9F
    HELV_BOLD_FALLBACK, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, HELV_BOLD_FALLBACK, 500, 667,
    // 0xA0–0xAF
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    // 0xB0–0xBF
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    // 0xC0–0xCF
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    // 0xD0–0xDF
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    // 0xE0–0xEF
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    // 0xF0–0xFF
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

/** First WinAnsi code the tables cover. */
const FIRST = 0x20;

/**
 * Exact advance of a WinAnsi-encoded string, in points.
 *
 * @param winAnsi Text already mapped through `toWinAnsi()`.
 * @param sz      Font size in points.
 * @param bold    Measure with Helvetica-Bold advances.
 *
 * @since 1.8.0
 */
export function exactBase14Width(winAnsi: string, sz: number, bold: boolean): number {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    const fallback = bold ? HELV_BOLD_FALLBACK : HELV_FALLBACK;
    let w = 0;
    for (let i = 0; i < winAnsi.length; i++) {
        const code = winAnsi.charCodeAt(i);
        w += code >= FIRST && code <= 0xFF ? table[code - FIRST] : fallback;
    }
    return w * sz / 1000;
}

/** The raw tables, for tests and tooling. @internal */
export const BASE14_TABLES = { helvetica: HELVETICA, helveticaBold: HELVETICA_BOLD, first: FIRST };
