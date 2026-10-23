/**
 * pdfnative — Color Parsing, Validation & Normalization
 * =======================================================
 * Accepts multiple color input formats and converts them into safe PDF
 * operands ("R G B" or "C M Y K", values 0.0–1.0).
 *
 * Supported formats:
 *   - Hex string: "#2563EB", "#26E"
 *   - RGB tuple: [37, 99, 235] (0–255)
 *   - PDF operator string: "0.145 0.388 0.922" (0.0–1.0)
 *   - CMYK tuple: [100, 60, 0, 10] (percent, 0–100) — since v1.8.0
 *   - PDF CMYK string: "1 0.6 0 0.1" (0.0–1.0) — since v1.8.0
 *   - Spot colour { spot: 'PANTONE 300 C', tint } and ink mix { inks } —
 *     since v1.9.0; see pdf-spot.ts for the colour-space resources
 *
 * The component count decides the space: three is DeviceRGB, four is
 * DeviceCMYK. The CMYK tuple is in percent because that is how print
 * software states ink coverage, the way the RGB tuple follows the web's
 * 0–255; the string forms stay in PDF's own 0.0–1.0 unit.
 *
 * Emitting a colour goes through {@link fillOp} / {@link strokeOp} rather
 * than through string concatenation at the call site. Until v1.8.0 the
 * operator was appended by hand at roughly a hundred places across a dozen
 * modules, which meant the library could only ever emit one colour space:
 * adding a second would have required finding and editing every one of them.
 * The two helpers are that single point of choice.
 */

import type { PdfColor, PdfColors, PdfSpotColor, PdfInkMix } from '../types/pdf-types.js';

// ── Regex ────────────────────────────────────────────────────────────

/** Matches exactly 3 space-separated numbers (integer or decimal). */
const PDF_RGB_RE = /^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/;

/** Matches exactly 4 space-separated numbers (integer or decimal). */
const PDF_CMYK_RE = /^\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/;

/** Matches #RGB or #RRGGBB (case-insensitive). */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// ── Spot colour names (v1.9.0) ───────────────────────────────────────

/** Resource-name prefix of a `/Separation` spot colour space. */
export const SPOT_PREFIX = 'Spot_';
/** Resource-name prefix of a `/DeviceN` ink-mix colour space. */
export const DEVICEN_PREFIX = 'DeviceN_';

/**
 * Encode text as a PDF name token (without the leading slash): letters,
 * digits, `.`, `-` and `_` stay, every other byte of the UTF-8 form
 * becomes `#xx` (ISO 32000-1 §7.3.5). Reversible, so a resource name can
 * be mapped back to the ink it stands for.
 *
 * @since 1.9.0
 */
export function pdfNameEncode(text: string): string {
    let out = '';
    for (const ch of text) {
        if (/^[A-Za-z0-9._-]$/.test(ch)) { out += ch; continue; }
        const cp = ch.codePointAt(0) ?? 0;
        const bytes = cp < 0x80 ? [cp]
            : cp < 0x800 ? [0xC0 | (cp >> 6), 0x80 | (cp & 0x3F)]
            : cp < 0x10000 ? [0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)]
            : [0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F)];
        for (const b of bytes) out += '#' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
}

/** Decode a name token written by {@link pdfNameEncode}. */
export function pdfNameDecode(token: string): string {
    const bytes: number[] = [];
    for (let i = 0; i < token.length; i++) {
        if (token[i] === '#' && /^[0-9A-Fa-f]{2}$/.test(token.slice(i + 1, i + 3))) {
            bytes.push(parseInt(token.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push(token.charCodeAt(i));
        }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The colour-space resource name of one spot ink. */
export function spotColourSpaceName(ink: string): string {
    return SPOT_PREFIX + pdfNameEncode(ink);
}

/** The colour-space resource name of an ink mix; the inks in sorted order. */
export function inkMixColourSpaceName(inks: readonly string[]): string {
    return DEVICEN_PREFIX + inks.map(pdfNameEncode).join('__');
}

/** A spot colour-space resource name read back: which inks it is over. */
export interface ParsedSpotName {
    readonly kind: 'separation' | 'devicen';
    readonly inks: readonly string[];
}

/**
 * Map a resource name back to the ink(s) it stands for, or `null` when it
 * is not a spot name pdfnative wrote. The name may be the encoded token of
 * a content stream (`Spot_PANTONE#20300#20C`) or the decoded dictionary
 * key (`Spot_PANTONE 300 C`); `#xx` escapes are decoded either way.
 *
 * @since 1.9.0
 */
export function parseColourSpaceName(name: string): ParsedSpotName | null {
    if (name.startsWith(SPOT_PREFIX)) return { kind: 'separation', inks: [pdfNameDecode(name.slice(SPOT_PREFIX.length))] };
    if (name.startsWith(DEVICEN_PREFIX)) return { kind: 'devicen', inks: name.slice(DEVICEN_PREFIX.length).split('__').map(pdfNameDecode) };
    return null;
}

const isSpotColor = (input: unknown): input is PdfSpotColor =>
    typeof input === 'object' && input !== null && typeof (input as PdfSpotColor).spot === 'string';
const isInkMix = (input: unknown): input is PdfInkMix =>
    typeof input === 'object' && input !== null && typeof (input as PdfInkMix).inks === 'object' && (input as PdfInkMix).inks !== null;

function tintOf(value: unknown, what: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Invalid ${what}: ${JSON.stringify(value)}. Expected a tint between 0 and 1.`);
    }
    return fmtChannel(value);
}

/**
 * The canonical operand string of a spot colour or ink mix:
 * `"/<colour-space name> <tints>"`. It is what {@link parseColor} returns
 * for them and what every colour string starting with `/` is read as, so
 * the many call sites that keep a parsed colour as a string keep working.
 */
function parseSpotColor(input: PdfSpotColor | PdfInkMix): string {
    if (isSpotColor(input)) {
        if (input.spot.trim() === '') throw new Error('Invalid spot colour: the ink name is empty');
        return `/${spotColourSpaceName(input.spot)} ${tintOf(input.tint ?? 1, `tint of spot colour '${input.spot}'`)}`;
    }
    const names = Object.keys(input.inks).sort();
    if (names.length === 0) throw new Error('Invalid ink mix: no inks');
    const tints = names.map(n => tintOf(input.inks[n], `tint of ink '${n}'`));
    return `/${inkMixColourSpaceName(names)} ${tints.join(' ')}`;
}

/** Matches the canonical spot operand string: a colour-space name and 1+ tints. */
const SPOT_OPERANDS_RE = /^\/(Spot_|DeviceN_)\S+(?: (?:\d+(?:\.\d+)?))+$/;

// ── Public API ───────────────────────────────────────────────────────

/**
 * Parse a color input into validated PDF operands.
 *
 * An RGB input yields `"R G B"`; a CMYK input (v1.8.0) yields `"C M Y K"`;
 * a spot colour or ink mix (v1.9.0) yields its canonical
 * `"/<colour-space name> <tints>"` form, which {@link fillOp} /
 * {@link strokeOp} turn into `cs … scn` operators.
 * Every input accepted before v1.8.0 is RGB and parses exactly as it did —
 * four-component inputs were rejected until then — so appending ` rg` to
 * the result stays correct for them. Code that may receive CMYK should use
 * {@link fillOp} / {@link strokeOp}, or {@link resolveColor} for the space.
 *
 * @param input - Color in hex, RGB/CMYK tuple, or PDF operand format.
 * @returns PDF operands with values 0.0–1.0.
 * @throws Error if the input format is invalid or values are out of range.
 *
 * @example
 * ```ts
 * parseColor('#2563EB')           // "0.145 0.388 0.922"
 * parseColor([37, 99, 235])       // "0.145 0.388 0.922"
 * parseColor('0.145 0.388 0.922') // "0.145 0.388 0.922"
 * parseColor([100, 60, 0, 10])    // "1 0.6 0 0.1"
 * ```
 */
export function parseColor(input: PdfColor): string {
    if (Array.isArray(input)) {
        return parseTupleColor(input as readonly number[]);
    }
    if (typeof input === 'string') {
        if (input.startsWith('#')) return parseHexColor(input);
        if (PDF_RGB_RE.test(input) || PDF_CMYK_RE.test(input)) return parsePdfOperandString(input);
        if (SPOT_OPERANDS_RE.test(input)) return input;
    }
    if (isSpotColor(input) || isInkMix(input)) return parseSpotColor(input);
    throw new Error(
        `Invalid color format: ${JSON.stringify(input)}. ` +
        'Expected "#RRGGBB", "#RGB", [r, g, b] (0–255), "R G B" (0.0–1.0), ' +
        '[c, m, y, k] (0–100), "C M Y K" (0.0–1.0), { spot, tint } or { inks }.'
    );
}

/**
 * Parse a colour that must be a process colour (RGB or CMYK operands) —
 * an annotation's `/C` or `/IC` array, which PDF defines in device space.
 * A spot colour is rejected with the reason.
 *
 * @since 1.9.0
 */
export function processOperands(input: PdfColor, where: string): string {
    const operands = parseColor(input);
    if (operands.startsWith('/')) throw new Error(`${where} takes a process colour (RGB or CMYK), not a spot colour`);
    return operands;
}

/**
 * The colour space a resolved colour belongs to. `'separation'` and
 * `'devicen'` (v1.9.0) are the spot colour spaces of `pdf-spot.ts`.
 *
 * @since 1.8.0
 */
export type PdfColorSpace = 'rgb' | 'cmyk' | 'separation' | 'devicen';

/**
 * A colour reduced to the operands a PDF operator takes, plus the space
 * those operands are in — which is what decides the operator itself.
 *
 * @since 1.8.0
 */
export interface ResolvedColor {
    readonly space: PdfColorSpace;
    /** Space-separated operands: `"R G B"`, `"C M Y K"` or the tints of a spot space, each 0.0–1.0. */
    readonly operands: string;
    /** The colour-space resource name a spot colour selects (`cs` operand, without the slash). @since 1.9.0 */
    readonly colorSpace?: string;
}

/**
 * Resolve any accepted colour input to its operands and colour space.
 *
 * @since 1.8.0
 */
export function resolveColor(input: PdfColor): ResolvedColor {
    const parsed = parseColor(input);
    if (parsed.startsWith('/')) {
        const sp = parsed.indexOf(' ');
        const colorSpace = parsed.slice(1, sp);
        return { space: colorSpace.startsWith(SPOT_PREFIX) ? 'separation' : 'devicen', operands: parsed.slice(sp + 1), colorSpace };
    }
    return { space: spaceOf(parsed), operands: parsed };
}

/** The space of already-validated process operands, read from their count. */
function spaceOf(operands: string): PdfColorSpace {
    return operands.split(' ').length === 4 ? 'cmyk' : 'rgb';
}

/**
 * RGB operands for any colour, converting CMYK by the naive device formula
 * `R = (1 − C)(1 − K)`. For places PDF defines as RGB-only, such as an
 * outline item's `/C`: it approximates on-screen appearance, not print.
 *
 * @internal
 */
export function rgbOperands(input: PdfColor): string {
    const { space, operands } = resolveColor(input);
    if (space === 'rgb') return operands;
    if (space !== 'cmyk') throw new Error('An outline colour (/C) is a process RGB colour — a spot colour has no RGB value here');
    const [c, m, y, k] = operands.split(' ').map(Number);
    return [c, m, y].map(v => fmtChannel((1 - v) * (1 - k))).join(' ');
}

/**
 * Lighten operands toward paper white: 0 leaves them unchanged, 1 is white.
 * RGB moves toward 1; CMYK removes ink, moving toward 0.
 *
 * @internal
 */
export function tintOperands(operands: string, amount: number, format: (n: number) => string, space?: PdfColorSpace): string {
    // A canonical spot string lightens its tints (ink removed), keeping its name.
    if (operands.startsWith('/')) {
        const sp = operands.indexOf(' ');
        return `${operands.slice(0, sp)} ${tintOperands(operands.slice(sp + 1), amount, format, 'separation')}`;
    }
    const parts = operands.split(' ').map(Number);
    const removesInk = space === undefined ? spaceOf(operands) === 'cmyk' : space !== 'rgb';
    const tinted = removesInk
        ? parts.map(v => v * (1 - amount))
        : parts.map(v => v + (1 - v) * amount);
    return tinted.map(format).join(' ');
}

/** Operator suffix for each space, non-stroking then stroking. */
const FILL_OPERATOR: Record<PdfColorSpace, string> = { rgb: 'rg', cmyk: 'k', separation: 'scn', devicen: 'scn' };
const STROKE_OPERATOR: Record<PdfColorSpace, string> = { rgb: 'RG', cmyk: 'K', separation: 'SCN', devicen: 'SCN' };

/**
 * The complete non-stroking colour operator for a colour, operands included.
 *
 * ```ts
 * fillOp('#2563EB')  // "0.145 0.388 0.922 rg"
 * ```
 *
 * @since 1.8.0
 */
export function fillOp(input: PdfColor): string {
    const { space, operands, colorSpace } = resolveColor(input);
    if (colorSpace !== undefined) return `/${colorSpace} cs ${operands} ${FILL_OPERATOR[space]}`;
    return `${operands} ${FILL_OPERATOR[space]}`;
}

/**
 * The complete stroking colour operator for a colour, operands included.
 *
 * @since 1.8.0
 */
export function strokeOp(input: PdfColor): string {
    const { space, operands, colorSpace } = resolveColor(input);
    if (colorSpace !== undefined) return `/${colorSpace} CS ${operands} ${STROKE_OPERATOR[space]}`;
    return `${operands} ${STROKE_OPERATOR[space]}`;
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

/** Parse an RGB tuple [0–255] or a CMYK tuple [0–100] into PDF operands. */
function parseTupleColor(tuple: readonly number[]): string {
    if (tuple.length !== 3 && tuple.length !== 4) {
        throw new Error(
            `Invalid color tuple: expected [r, g, b] (0–255) or [c, m, y, k] (0–100), got ${tuple.length} values.`
        );
    }
    const max = tuple.length === 3 ? 255 : 100;
    for (let i = 0; i < tuple.length; i++) {
        const v = tuple[i];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
            throw new Error(
                `Invalid color tuple value at index ${i}: ${v}. Expected a number 0–${max}.`
            );
        }
    }
    return tuple.map(v => fmtChannel(v / max)).join(' ');
}

/** Validate a PDF operand string (3 or 4 space-separated values, each 0.0–1.0). */
function parsePdfOperandString(str: string): string {
    const parts = str.split(' ');
    const space = parts.length === 4 ? 'CMYK' : 'RGB';
    for (const p of parts) {
        const n = Number(p);
        if (n < 0 || n > 1) {
            throw new Error(
                `Invalid PDF ${space} value: ${p} in ${JSON.stringify(str)}. Each value must be 0.0–1.0.`
            );
        }
    }
    return str;
}
