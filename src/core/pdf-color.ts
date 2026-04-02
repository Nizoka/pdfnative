/**
 * pdfnative — Color Parsing, Validation & Normalization
 * =======================================================
 * Accepts multiple color input formats and converts them
 * into safe PDF operator strings ("R G B", values 0.0–1.0).
 *
 * Supported formats:
 *   - Hex string: "#2563EB", "#26E"
 *   - RGB tuple: [37, 99, 235] (0–255)
 *   - PDF operator string: "0.145 0.388 0.922" (0.0–1.0)
 */

import type { PdfColor, PdfColors } from '../types/pdf-types.js';

// ── Regex ────────────────────────────────────────────────────────────

/** Matches exactly 3 space-separated numbers (integer or decimal). */
const PDF_RGB_RE = /^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/;

/** Matches #RGB or #RRGGBB (case-insensitive). */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Parse a color input into a validated PDF RGB operator string.
 *
 * @param input - Color in hex, RGB tuple, or PDF operator format.
 * @returns PDF operator string "R G B" with values 0.0–1.0.
 * @throws Error if the input format is invalid or values are out of range.
 *
 * @example
 * ```ts
 * parseColor('#2563EB')           // "0.145 0.388 0.922"
 * parseColor([37, 99, 235])       // "0.145 0.388 0.922"
 * parseColor('0.145 0.388 0.922') // "0.145 0.388 0.922"
 * ```
 */
export function parseColor(input: PdfColor): string {
    if (Array.isArray(input)) {
        return parseTupleColor(input as readonly [number, number, number]);
    }
    if (typeof input === 'string') {
        if (input.startsWith('#')) return parseHexColor(input);
        if (PDF_RGB_RE.test(input)) return parsePdfRgbString(input);
    }
    throw new Error(
        `Invalid color format: ${JSON.stringify(input)}. ` +
        'Expected "#RRGGBB", "#RGB", [r, g, b] (0–255), or "R G B" (0.0–1.0).'
    );
}

/**
 * Check whether a string is a valid PDF RGB operator color.
 *
 * @param str - String to validate.
 * @returns true if the string matches the "R G B" format with values in [0, 1].
 */
export function isValidPdfRgb(str: string): boolean {
    if (!PDF_RGB_RE.test(str)) return false;
    const parts = str.split(' ');
    return parts.length === 3 && parts.every(p => {
        const n = Number(p);
        return n >= 0 && n <= 1;
    });
}

/**
 * Validate and normalize all color fields in a PdfColors object.
 * Called once in resolveLayout() — not in the rendering hot path.
 *
 * @param colors - PdfColors object with user-supplied color values.
 * @returns New PdfColors object with all values normalized to PDF RGB strings.
 */
export function normalizeColors(colors: PdfColors): PdfColors {
    return {
        title:  parseColor(colors.title),
        credit: parseColor(colors.credit),
        debit:  parseColor(colors.debit),
        text:   parseColor(colors.text),
        thBg:   parseColor(colors.thBg),
        thBrd:  parseColor(colors.thBrd),
        rowBrd: parseColor(colors.rowBrd),
        ptdBg:  parseColor(colors.ptdBg),
        balBg:  parseColor(colors.balBg),
        balBrd: parseColor(colors.balBrd),
        label:  parseColor(colors.label),
        footer: parseColor(colors.footer),
    };
}

// ── Internal Parsers ─────────────────────────────────────────────────

/** Format a channel value [0, 1] to a PDF-safe decimal string. */
function fmtChannel(n: number): string {
    const clamped = Math.max(0, Math.min(1, n));
    const rounded = Math.round(clamped * 1000) / 1000;
    return String(rounded);
}

/** Parse a hex color (#RGB or #RRGGBB) into a PDF RGB string. */
function parseHexColor(hex: string): string {
    if (!HEX_RE.test(hex)) {
        throw new Error(
            `Invalid hex color: ${JSON.stringify(hex)}. Expected "#RGB" or "#RRGGBB".`
        );
    }
    const h = hex.slice(1);
    let r: number, g: number, b: number;
    if (h.length === 3) {
        r = parseInt(h[0] + h[0], 16);
        g = parseInt(h[1] + h[1], 16);
        b = parseInt(h[2] + h[2], 16);
    } else {
        r = parseInt(h.slice(0, 2), 16);
        g = parseInt(h.slice(2, 4), 16);
        b = parseInt(h.slice(4, 6), 16);
    }
    return `${fmtChannel(r / 255)} ${fmtChannel(g / 255)} ${fmtChannel(b / 255)}`;
}

/** Parse an RGB tuple [0–255] into a PDF RGB string. */
function parseTupleColor(tuple: readonly [number, number, number]): string {
    if (tuple.length !== 3) {
        throw new Error(
            `Invalid color tuple: expected [r, g, b] with 3 values, got ${tuple.length}.`
        );
    }
    for (let i = 0; i < 3; i++) {
        const v = tuple[i];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 255) {
            throw new Error(
                `Invalid color tuple value at index ${i}: ${v}. Expected a number 0–255.`
            );
        }
    }
    return `${fmtChannel(tuple[0] / 255)} ${fmtChannel(tuple[1] / 255)} ${fmtChannel(tuple[2] / 255)}`;
}

/** Validate a PDF RGB string (3 space-separated values, each 0.0–1.0). */
function parsePdfRgbString(str: string): string {
    const parts = str.split(' ');
    for (const p of parts) {
        const n = Number(p);
        if (n < 0 || n > 1) {
            throw new Error(
                `Invalid PDF RGB value: ${p} in ${JSON.stringify(str)}. Each value must be 0.0–1.0.`
            );
        }
    }
    return str;
}
