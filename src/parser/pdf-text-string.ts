/**
 * pdfnative — PDF text strings (ISO 32000-1 §7.9.2.2) → JavaScript text
 * =====================================================================
 * The tokenizer returns every PDF string as one JS character per byte. A
 * *text string* (an `/Info` entry, an annotation `/Contents` or `/T`, a form
 * field `/V`, a page-label `/P` prefix, a bookmark title…) is then one of:
 *
 * - UTF-16BE behind the `FE FF` byte order mark;
 * - UTF-8 behind the `EF BB BF` byte order mark (ISO 32000-2 §7.9.2.2.2,
 *   written by PDF 2.0 producers and accepted by every current reader);
 * - otherwise PDFDocEncoding (Annex D), a single-byte encoding that agrees
 *   with Latin-1 for the printable range but maps 0x18–0x1F and 0x80–0x9F to
 *   its own typographic characters (bullet, dashes, quotes, ligatures…) and
 *   leaves 0x7F, 0x9F and 0xAD undefined.
 *
 * Until 1.9.0 the engine carried five private copies of the UTF-16BE branch
 * and no PDFDocEncoding table at all, and downstream packages re-implemented
 * the same decoding to display `/Info` titles (#85). This module is the one
 * decoder; `encodePdfTextString` in `core/pdf-text.ts` is its counterpart.
 *
 * @module parser/pdf-text-string
 * @since 1.9.0
 */

/**
 * PDFDocEncoding code points that differ from Latin-1 (ISO 32000-1 Annex D.2).
 * Undefined positions (0x7F, 0x9F, 0xAD) map to U+FFFD so an accidental
 * byte never masquerades as text.
 */
const PDFDOC_HIGH: readonly number[] = [
    // 0x18–0x1F
    0x02D8, 0x02C7, 0x02C6, 0x02D9, 0x02DD, 0x02DB, 0x02DA, 0x02DC,
];
const PDFDOC_80_9F: readonly number[] = [
    0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x0192, 0x2044, // 0x80–0x87
    0x2039, 0x203A, 0x2212, 0x2030, 0x201E, 0x201C, 0x201D, 0x2018, // 0x88–0x8F
    0x2019, 0x201A, 0x2122, 0xFB01, 0xFB02, 0x0141, 0x0152, 0x0160, // 0x90–0x97
    0x0178, 0x017D, 0x0131, 0x0142, 0x0153, 0x0161, 0x017E, 0xFFFD, // 0x98–0x9F
];

/** One PDFDocEncoding byte → its Unicode code point. */
function pdfDocChar(byte: number): number {
    if (byte >= 0x18 && byte <= 0x1F) return PDFDOC_HIGH[byte - 0x18];
    if (byte >= 0x80 && byte <= 0x9F) return PDFDOC_80_9F[byte - 0x80];
    if (byte === 0x7F || byte === 0xAD) return 0xFFFD;
    if (byte === 0xA0) return 0x20AC; // Euro sign (PDF 1.3+)
    return byte;
}

/**
 * Decode a PDF text string that the parser returned as a byte-per-char
 * string (ISO 32000-1 §7.9.2.2): UTF-16BE behind `FE FF`, UTF-8 behind
 * `EF BB BF`, otherwise PDFDocEncoding. An odd trailing byte of a UTF-16BE
 * string becomes U+FFFD rather than being dropped.
 *
 * ```ts
 * const info = reader.resolveValue(reader.trailer.get('Info'));
 * const title = decodePdfTextString(info.get('Title') as string);
 * ```
 *
 * @param raw - The string exactly as `openPdf()` / `parseValue()` returned it.
 * @returns The Unicode text.
 * @since 1.9.0
 */
export function decodePdfTextString(raw: string): string {
    if (raw.length === 0) return '';
    const b0 = raw.charCodeAt(0) & 0xFF;
    const b1 = raw.length > 1 ? raw.charCodeAt(1) & 0xFF : -1;
    if (b0 === 0xFE && b1 === 0xFF) {
        let out = '';
        let i = 2;
        for (; i + 1 < raw.length; i += 2) {
            out += String.fromCharCode(((raw.charCodeAt(i) & 0xFF) << 8) | (raw.charCodeAt(i + 1) & 0xFF));
        }
        if (i < raw.length) out += '�';
        return out;
    }
    if (b0 === 0xEF && b1 === 0xBB && raw.length > 2 && (raw.charCodeAt(2) & 0xFF) === 0xBF) {
        const bytes = new Uint8Array(raw.length - 3);
        for (let i = 3; i < raw.length; i++) bytes[i - 3] = raw.charCodeAt(i) & 0xFF;
        return new TextDecoder('utf-8').decode(bytes);
    }
    let out = '';
    for (let i = 0; i < raw.length; i++) {
        const byte = raw.charCodeAt(i);
        // A code unit above 0xFF cannot come from the tokenizer; keep it as is.
        out += byte > 0xFF ? String.fromCharCode(byte) : String.fromCharCode(pdfDocChar(byte));
    }
    return out;
}
