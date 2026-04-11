/**
 * pdfnative — WinAnsi Encoding
 * ==============================
 * Text encoding and font reference logic for Latin (WinAnsi/Helvetica)
 * and Unicode (CIDFont/Identity-H) modes.
 */

// (no type imports needed — pure encoding functions only)

// ── WinAnsi Encoding ─────────────────────────────────────────────────

/**
 * Encode a JavaScript string to WinAnsiEncoding (ISO-8859-1 superset).
 * Characters outside this encoding are replaced with '?'.
 *
 * @param str - Input Unicode string
 * @returns WinAnsi-encoded string (single-byte characters)
 */
export function toWinAnsi(str: string): string {
    if (!str) return '';
    let r = '';
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c >= 0x20 && c <= 0x7E) r += str[i];
        else if (c >= 0xA0 && c <= 0xFF) r += str[i];
        else if (c === 0x20AC) r += '\x80';
        else if (c === 0x201A) r += '\x82';
        else if (c === 0x0192) r += '\x83';
        else if (c === 0x201E) r += '\x84';
        else if (c === 0x2026) r += '\x85';
        else if (c === 0x2020) r += '\x86';
        else if (c === 0x2021) r += '\x87';
        else if (c === 0x02C6) r += '\x88';
        else if (c === 0x2030) r += '\x89';
        else if (c === 0x0160) r += '\x8A';
        else if (c === 0x2039) r += '\x8B';
        else if (c === 0x0152) r += '\x8C';
        else if (c === 0x017D) r += '\x8E';
        else if (c === 0x2018) r += '\x91';
        else if (c === 0x2019) r += '\x92';
        else if (c === 0x201C) r += '\x93';
        else if (c === 0x201D) r += '\x94';
        else if (c === 0x2022) r += '\x95';
        else if (c === 0x2013) r += '\x96';
        else if (c === 0x2014) r += '\x97';
        else if (c === 0x02DC) r += '\x98';
        else if (c === 0x2122) r += '\x99';
        else if (c === 0x0161) r += '\x9A';
        else if (c === 0x203A) r += '\x9B';
        else if (c === 0x0153) r += '\x9C';
        else if (c === 0x017E) r += '\x9E';
        else if (c === 0x0178) r += '\x9F';
        else if (c === 0xA0 || c === 0x202F) r += ' ';
        else if (c === 0x09 || c === 0x0A || c === 0x0D) r += ' ';
        else if (c < 0x20) { /* skip control chars */ }
        else r += '?';
    }
    return r;
}

/**
 * Create a PDF string literal: encode to WinAnsi and escape (, ), \.
 *
 * @param str - Input string
 * @returns PDF literal string in parentheses, e.g. '(Hello)'
 */
export function pdfString(str: string): string {
    const s = toWinAnsi(str);
    return `(${s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

/**
 * Truncate string to max characters, appending '..' if needed.
 *
 * @param str - Input string
 * @param max - Maximum character count (includes '..' suffix)
 * @returns Truncated string or original if within limit
 */
export function truncate(str: string, max: number): string {
    if (!str || str.length <= max) return str || '';
    if (max < 2) return '..';
    return `${str.slice(0, max - 2)}..`;
}

/**
 * Approximate text width in points using Helvetica character metrics.
 *
 * @param str - Text string (WinAnsi-encoded or Unicode)
 * @param sz - Font size in points
 * @returns Estimated width in points
 */
export function helveticaWidth(str: string, sz: number): number {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        if (c >= 48 && c <= 57) w += 556;
        else if (c >= 65 && c <= 90) w += 680;
        else if (c >= 97 && c <= 122) w += 500;
        else if (c === 32) w += 278;
        else if (c === 46 || c === 44) w += 278;
        else if (c === 43) w += 584;
        else if (c === 45) w += 333;
        else if (c === 47 || c === 58) w += 278;
        // Brackets and parentheses (Helvetica AFM values)
        else if (c === 0x28 || c === 0x29) w += 333;   // ( )
        else if (c === 0x5B || c === 0x5D) w += 278;   // [ ]
        else if (c === 0x7B || c === 0x7D) w += 480;   // { }
        else if (c === 0x21) w += 278;                  // !
        else if (c === 0x3F) w += 556;                  // ?
        // Unicode extended characters (Helvetica AFM widths)
        else if (c === 0x2014 || c === 0x97) w += 1000;  // em-dash (Unicode or WinAnsi byte)
        else if (c === 0x2013 || c === 0x96) w += 556;   // en-dash
        else if (c === 0x2026 || c === 0x85) w += 1000;  // ellipsis
        else if (c === 0x2018 || c === 0x2019 || c === 0x91 || c === 0x92) w += 222;  // single quotes
        else if (c === 0x201C || c === 0x201D || c === 0x93 || c === 0x94) w += 333;  // double quotes
        else if (c === 0x20AC || c === 0x80) w += 556;   // Euro sign
        else if (c === 0x2022 || c === 0x95) w += 350;   // bullet
        else w += 556;
    }
    return w * sz / 1000;
}
