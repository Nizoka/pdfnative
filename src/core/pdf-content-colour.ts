/**
 * pdfnative — Device colour usage in content streams (v1.8.0)
 * ============================================================
 * Reports which device colour spaces a content stream paints in, so the
 * builders can check a document against its OutputIntent before writing
 * it, and the PDF/X validator can check any file after the fact.
 *
 * This is a tokenizer, not a regular expression over the stream: text
 * shown with `Tj` is data, and a literal string such as `(0 0 0 1 k)` or a
 * comment must never read as a colour operator. Strings (literal, with
 * nesting and escapes, and hexadecimal), comments, names and inline image
 * data are skipped as the content syntax defines them (ISO 32000-1 §7.2,
 * §8.9.7).
 *
 * @module core/pdf-content-colour
 */

/** The device colour spaces a content stream selects. */
export interface DeviceColourUse {
    readonly rgb: boolean;
    readonly cmyk: boolean;
    readonly gray: boolean;
}

const DEVICE_SPACE_BY_NAME: Readonly<Record<string, keyof DeviceColourUse>> = {
    DeviceRGB: 'rgb',
    DeviceCMYK: 'cmyk',
    DeviceGray: 'gray',
};

const OPERATOR_SPACE: Readonly<Record<string, keyof DeviceColourUse>> = {
    rg: 'rgb', RG: 'rgb',
    k: 'cmyk', K: 'cmyk',
    g: 'gray', G: 'gray',
};

const isWhite = (c: number): boolean =>
    c === 0x20 || c === 0x0A || c === 0x0D || c === 0x09 || c === 0x0C || c === 0x00;

/** PDF delimiter characters (ISO 32000-1 §7.2.2). */
const isDelimiter = (c: number): boolean =>
    c === 0x28 || c === 0x29 || c === 0x3C || c === 0x3E || c === 0x5B || c === 0x5D
    || c === 0x7B || c === 0x7D || c === 0x2F || c === 0x25;

/**
 * Scan a decoded content stream for device colour selections: the
 * `rg`/`RG`, `k`/`K`, `g`/`G` operators, and `cs`/`CS` naming a device space.
 */
export function scanDeviceColour(content: string): DeviceColourUse {
    const use = { rgb: false, cmyk: false, gray: false };
    const n = content.length;
    let lastName = '';
    let i = 0;

    while (i < n) {
        const c = content.charCodeAt(i);

        if (isWhite(c)) { i++; continue; }

        // Comment: to end of line.
        if (c === 0x25) {
            while (i < n && content.charCodeAt(i) !== 0x0A && content.charCodeAt(i) !== 0x0D) i++;
            continue;
        }

        // Literal string: balanced parentheses, backslash escapes.
        if (c === 0x28) {
            let depth = 1;
            i++;
            while (i < n && depth > 0) {
                const s = content.charCodeAt(i);
                if (s === 0x5C) { i += 2; continue; }
                if (s === 0x28) depth++;
                else if (s === 0x29) depth--;
                i++;
            }
            lastName = '';
            continue;
        }

        // `<<` / `>>` dictionary delimiters, or a hexadecimal string.
        if (c === 0x3C) {
            if (content.charCodeAt(i + 1) === 0x3C) { i += 2; continue; }
            const end = content.indexOf('>', i + 1);
            i = end === -1 ? n : end + 1;
            lastName = '';
            continue;
        }
        if (c === 0x3E || c === 0x5B || c === 0x5D || c === 0x7B || c === 0x7D || c === 0x29) {
            i++;
            continue;
        }

        // Name.
        if (c === 0x2F) {
            let j = i + 1;
            while (j < n && !isWhite(content.charCodeAt(j)) && !isDelimiter(content.charCodeAt(j))) j++;
            lastName = content.slice(i + 1, j);
            i = j;
            continue;
        }

        // Regular token: a number or an operator.
        let j = i;
        while (j < n && !isWhite(content.charCodeAt(j)) && !isDelimiter(content.charCodeAt(j))) j++;
        const token = content.slice(i, j);
        i = j;

        if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) continue;

        const space = OPERATOR_SPACE[token];
        if (space) {
            use[space] = true;
        } else if (token === 'cs' || token === 'CS') {
            const named = DEVICE_SPACE_BY_NAME[lastName];
            if (named) use[named] = true;
        } else if (token === 'ID') {
            // Inline image data is binary: skip to the `EI` that ends it.
            const end = content.slice(i).search(/\sEI(?=\s|$)/);
            i = end === -1 ? n : i + end + 3;
        }
        lastName = '';
    }

    return use;
}
