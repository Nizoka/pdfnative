/**
 * pdfnative — PDF Text Extraction
 * =================================
 * Decodes page content streams (ISO 32000-1 §9) into per-page Unicode text
 * with optional positioned runs. Built on the reader (`openPdf`), so
 * encrypted documents work transparently via `options.password`.
 *
 * Pipeline per page:
 *   1. Join and decode the page's `/Contents` stream(s).
 *   2. Interpret the text/graphics operators that affect text placement
 *      (BT ET, Tf Td TD TL Tm T* Tc Tw Tz, Tj TJ ' ", q Q cm), tracking
 *      Tm × CTM so positions come out in device space. Form XObjects
 *      (`Do`) are recursed into (depth-capped).
 *   3. Decode each shown string through the font's `/ToUnicode` CMap,
 *      or a base-encoding table (WinAnsi / MacRoman) overlaid with
 *      `/Encoding /Differences` glyph names (compact AGL subset).
 *   4. Assemble reading-order text: lines grouped by baseline, sorted
 *      top→bottom, runs left→right.
 *
 * Documented limitations (by design, not bugs):
 *   - No OCR: image-only pages yield empty text.
 *   - Type3 fonts are decoded via their encoding/ToUnicode only (glyph
 *     procedures are not interpreted).
 *   - Non-Identity CMap `/Encoding`s (e.g. UTF-16 CJK CMaps) are decoded
 *     best-effort as 2-byte codes through `/ToUnicode`.
 *   - Vertical writing mode is treated as horizontal.
 *   - The structure tree / `/ActualText` is not consulted; order is
 *     geometric. Ligature reversal is only as good as the embedded
 *     `/ToUnicode`.
 *   - Codes with no mapping anywhere decode to U+FFFD.
 */

import { openPdf } from './pdf-reader.js';
import type { PdfReader } from './pdf-reader.js';
import { createTokenizer } from './pdf-tokenizer.js';
import {
    isDict, isName, isArray, isStream, isRef,
    dictGetName, dictGetNum,
} from './pdf-object-parser.js';
import type { PdfDict, PdfStream, PdfValue } from './pdf-object-parser.js';

// ── Public types ─────────────────────────────────────────────────────

export interface ExtractTextOptions {
    /** Password for encrypted documents (delegated to `openPdf`). */
    readonly password?: string;
    /** 0-based page indices to extract. Default: all pages. */
    readonly pages?: readonly number[];
    /** Also return positioned runs per page. Default `false`. */
    readonly includeRuns?: boolean;
    /**
     * Hard cap on total extracted characters across all pages — a memory
     * bound for adversarial inputs. Throws when exceeded. Default
     * 16 000 000. Pass `Infinity` to disable (not recommended for
     * untrusted input).
     */
    readonly maxTextLength?: number;
}

/** One text-showing operation (`Tj`, one `TJ` string, `'` or `"`). */
export interface ExtractedTextRun {
    /** Decoded Unicode text of the run. */
    readonly text: string;
    /** Device-space x of the run origin (points). */
    readonly x: number;
    /** Device-space y of the run baseline (points). */
    readonly y: number;
    /** Effective font size (Tf size scaled by Tm × CTM). */
    readonly fontSize: number;
    /** Font resource name (e.g. `'F1'`). */
    readonly fontName: string;
}

export interface ExtractedPageText {
    /** 0-based page index in the source document. */
    readonly pageIndex: number;
    /**
     * Reading-order text: lines grouped by baseline, sorted top→bottom,
     * runs within a line left→right, `'\n'` between lines.
     */
    readonly text: string;
    /** Present when `options.includeRuns` is true; content-stream order. */
    readonly runs?: readonly ExtractedTextRun[];
}

// ── Tunables / caps ──────────────────────────────────────────────────

const DEFAULT_MAX_TEXT_LENGTH = 16_000_000;
const MAX_GRAPHICS_STACK = 128;
const MAX_OPERANDS = 32;
const MAX_CMAP_ENTRIES = 65_536;
const MAX_FORM_DEPTH = 8;
/** TJ adjustment (thousandths of em) at or below which a space is implied. */
const TJ_SPACE_THRESHOLD = -180;

// ── Matrices (a b c d e f) ───────────────────────────────────────────

type Mat = readonly [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function matMul(m: Mat, n: Mat): Mat {
    return [
        m[0] * n[0] + m[1] * n[2],
        m[0] * n[1] + m[1] * n[3],
        m[2] * n[0] + m[3] * n[2],
        m[2] * n[1] + m[3] * n[3],
        m[4] * n[0] + m[5] * n[2] + n[4],
        m[4] * n[1] + m[5] * n[3] + n[5],
    ];
}

function matApply(m: Mat, x: number, y: number): readonly [number, number] {
    return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
}

// ── Encoding tables ──────────────────────────────────────────────────

// WinAnsi (CP-1252) 0x80–0x9F band; 0x20–0x7E and 0xA0–0xFF are 1:1
// Latin-1. (Local copy: the parser module must not import from fonts/.)
const WINANSI_HIGH: Readonly<Record<number, number>> = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
    0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
    0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
    0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
    0x9E: 0x017E, 0x9F: 0x0178,
};

/** MacRomanEncoding 0x80–0xFF → Unicode (ISO 32000-1 Annex D). */
const MACROMAN_HIGH: readonly number[] = [
    0x00C4, 0x00C5, 0x00C7, 0x00C9, 0x00D1, 0x00D6, 0x00DC, 0x00E1,
    0x00E0, 0x00E2, 0x00E4, 0x00E3, 0x00E5, 0x00E7, 0x00E9, 0x00E8,
    0x00EA, 0x00EB, 0x00ED, 0x00EC, 0x00EE, 0x00EF, 0x00F1, 0x00F3,
    0x00F2, 0x00F4, 0x00F6, 0x00F5, 0x00FA, 0x00F9, 0x00FB, 0x00FC,
    0x2020, 0x00B0, 0x00A2, 0x00A3, 0x00A7, 0x2022, 0x00B6, 0x00DF,
    0x00AE, 0x00A9, 0x2122, 0x00B4, 0x00A8, 0x2260, 0x00C6, 0x00D8,
    0x221E, 0x00B1, 0x2264, 0x2265, 0x00A5, 0x00B5, 0x2202, 0x2211,
    0x220F, 0x03C0, 0x222B, 0x00AA, 0x00BA, 0x03A9, 0x00E6, 0x00F8,
    0x00BF, 0x00A1, 0x00AC, 0x221A, 0x0192, 0x2248, 0x2206, 0x00AB,
    0x00BB, 0x2026, 0x00A0, 0x00C0, 0x00C3, 0x00D5, 0x0152, 0x0153,
    0x2013, 0x2014, 0x201C, 0x201D, 0x2018, 0x2019, 0x00F7, 0x25CA,
    0x00FF, 0x0178, 0x2044, 0x20AC, 0x2039, 0x203A, 0xFB01, 0xFB02,
    0x2021, 0x00B7, 0x201A, 0x201E, 0x2030, 0x00C2, 0x00CA, 0x00C1,
    0x00CB, 0x00C8, 0x00CD, 0x00CE, 0x00CF, 0x00CC, 0x00D3, 0x00D4,
    0xF8FF, 0x00D2, 0x00DA, 0x00DB, 0x00D9, 0x0131, 0x02C6, 0x02DC,
    0x00AF, 0x02D8, 0x02D9, 0x02DA, 0x00B8, 0x02DD, 0x02DB, 0x02C7,
];

/**
 * Compact Adobe-Glyph-List subset for `/Encoding /Differences` names.
 * Single-letter names (`/a` … `/Z`, digits via named entries below) and
 * the `uniXXXX` / `uXXXX[XX]` patterns are resolved structurally.
 */
const AGL_SUBSET: Readonly<Record<string, number>> = {
    space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23,
    dollar: 0x24, percent: 0x25, ampersand: 0x26, quotesingle: 0x27,
    parenleft: 0x28, parenright: 0x29, asterisk: 0x2A, plus: 0x2B,
    comma: 0x2C, hyphen: 0x2D, period: 0x2E, slash: 0x2F,
    zero: 0x30, one: 0x31, two: 0x32, three: 0x33, four: 0x34,
    five: 0x35, six: 0x36, seven: 0x37, eight: 0x38, nine: 0x39,
    colon: 0x3A, semicolon: 0x3B, less: 0x3C, equal: 0x3D, greater: 0x3E,
    question: 0x3F, at: 0x40, bracketleft: 0x5B, backslash: 0x5C,
    bracketright: 0x5D, asciicircum: 0x5E, underscore: 0x5F, grave: 0x60,
    braceleft: 0x7B, bar: 0x7C, braceright: 0x7D, asciitilde: 0x7E,
    exclamdown: 0xA1, cent: 0xA2, sterling: 0xA3, currency: 0xA4,
    yen: 0xA5, brokenbar: 0xA6, section: 0xA7, dieresis: 0xA8,
    copyright: 0xA9, ordfeminine: 0xAA, guillemotleft: 0xAB,
    logicalnot: 0xAC, registered: 0xAE, macron: 0xAF, degree: 0xB0,
    plusminus: 0xB1, acute: 0xB4, mu: 0xB5, paragraph: 0xB6,
    periodcentered: 0xB7, cedilla: 0xB8, ordmasculine: 0xBA,
    guillemotright: 0xBB, onequarter: 0xBC, onehalf: 0xBD,
    threequarters: 0xBE, questiondown: 0xBF,
    Agrave: 0xC0, Aacute: 0xC1, Acircumflex: 0xC2, Atilde: 0xC3,
    Adieresis: 0xC4, Aring: 0xC5, AE: 0xC6, Ccedilla: 0xC7,
    Egrave: 0xC8, Eacute: 0xC9, Ecircumflex: 0xCA, Edieresis: 0xCB,
    Igrave: 0xCC, Iacute: 0xCD, Icircumflex: 0xCE, Idieresis: 0xCF,
    Eth: 0xD0, Ntilde: 0xD1, Ograve: 0xD2, Oacute: 0xD3,
    Ocircumflex: 0xD4, Otilde: 0xD5, Odieresis: 0xD6, multiply: 0xD7,
    Oslash: 0xD8, Ugrave: 0xD9, Uacute: 0xDA, Ucircumflex: 0xDB,
    Udieresis: 0xDC, Yacute: 0xDD, Thorn: 0xDE, germandbls: 0xDF,
    agrave: 0xE0, aacute: 0xE1, acircumflex: 0xE2, atilde: 0xE3,
    adieresis: 0xE4, aring: 0xE5, ae: 0xE6, ccedilla: 0xE7,
    egrave: 0xE8, eacute: 0xE9, ecircumflex: 0xEA, edieresis: 0xEB,
    igrave: 0xEC, iacute: 0xED, icircumflex: 0xEE, idieresis: 0xEF,
    eth: 0xF0, ntilde: 0xF1, ograve: 0xF2, oacute: 0xF3,
    ocircumflex: 0xF4, otilde: 0xF5, odieresis: 0xF6, divide: 0xF7,
    oslash: 0xF8, ugrave: 0xF9, uacute: 0xFA, ucircumflex: 0xFB,
    udieresis: 0xFC, yacute: 0xFD, thorn: 0xFE, ydieresis: 0xFF,
    OE: 0x152, oe: 0x153, Scaron: 0x160, scaron: 0x161,
    Ydieresis: 0x178, Zcaron: 0x17D, zcaron: 0x17E, florin: 0x192,
    circumflex: 0x2C6, caron: 0x2C7, tilde: 0x2DC,
    endash: 0x2013, emdash: 0x2014, quoteleft: 0x2018,
    quoteright: 0x2019, quotesinglbase: 0x201A, quotedblleft: 0x201C,
    quotedblright: 0x201D, quotedblbase: 0x201E, dagger: 0x2020,
    daggerdbl: 0x2021, bullet: 0x2022, ellipsis: 0x2026,
    perthousand: 0x2030, guilsinglleft: 0x2039, guilsinglright: 0x203A,
    fraction: 0x2044, Euro: 0x20AC, trademark: 0x2122,
    minus: 0x2212, fi: 0xFB01, fl: 0xFB02,
};

/** Resolve an AGL-style glyph name to a Unicode codepoint (U+FFFD if unknown). */
function glyphNameToUnicode(name: string): number {
    if (name.length === 1) return name.charCodeAt(0);
    const listed = AGL_SUBSET[name];
    if (listed !== undefined) return listed;
    if (/^uni[0-9A-Fa-f]{4}$/.test(name)) return parseInt(name.slice(3), 16);
    if (/^u[0-9A-Fa-f]{4,6}$/.test(name)) return parseInt(name.slice(1), 16);
    return 0xFFFD;
}

// ── Font decoding ────────────────────────────────────────────────────

interface FontDecoder {
    /** Code unit width: 1 (simple fonts) or 2 (Type0). */
    readonly bytesPerCode: 1 | 2;
    /** `/ToUnicode` CMap: code → Unicode string. */
    readonly toUnicode: ReadonlyMap<number, string> | null;
    /** 256-entry byte → codepoint table for simple fonts. */
    readonly encoding: readonly number[] | null;
    /** Glyph advance for a code, in 1/1000 em. */
    readonly widthOf: (code: number) => number;
}

/** Decode a raw-byte string as UTF-16BE (used for CMap destination values). */
function utf16beToString(raw: string): string {
    if (raw.length === 1) return raw;
    let out = '';
    for (let i = 0; i + 1 < raw.length; i += 2) {
        out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
    }
    return out;
}

/** Big-endian integer value of a raw-byte string (CMap source code). */
function rawToCode(raw: string): number {
    let code = 0;
    for (let i = 0; i < raw.length; i++) code = (code << 8) | (raw.charCodeAt(i) & 0xFF);
    return code;
}

/**
 * Parse a `/ToUnicode` CMap stream (ISO 32000-1 §9.10.3): codespacerange
 * (for the code byte-length), bfchar and bfrange (hex-increment and
 * array destination forms).
 */
function parseToUnicodeCMap(bytes: Uint8Array): { map: Map<number, string>; codeLen: 1 | 2 } {
    const map = new Map<number, string>();
    let codeLen: 1 | 2 = 1;
    const tok = createTokenizer(bytes);
    // Pending string operands between structural keywords.
    let pending: (string | (string | number)[])[] = [];
    let inBfRange = false;
    let sawCodespace = false;

    for (let t = tok.next(); t !== null; t = tok.next()) {
        if (t.type === 'keyword') {
            const kw = t.value as string;
            if (kw === 'begincodespacerange') { pending = []; continue; }
            if (kw === 'endcodespacerange') {
                if (!sawCodespace && typeof pending[0] === 'string') {
                    codeLen = (pending[0] as string).length >= 2 ? 2 : 1;
                    sawCodespace = true;
                }
                pending = [];
                continue;
            }
            if (kw === 'beginbfchar') { pending = []; continue; }
            if (kw === 'endbfchar') {
                for (let i = 0; i + 1 < pending.length; i += 2) {
                    const src = pending[i];
                    const dst = pending[i + 1];
                    if (typeof src === 'string' && typeof dst === 'string' && map.size < MAX_CMAP_ENTRIES) {
                        map.set(rawToCode(src), utf16beToString(dst));
                    }
                }
                pending = [];
                continue;
            }
            if (kw === 'beginbfrange') { inBfRange = true; pending = []; continue; }
            if (kw === 'endbfrange') {
                for (let i = 0; i + 2 < pending.length; i += 3) {
                    const lo = pending[i];
                    const hi = pending[i + 1];
                    const dst = pending[i + 2];
                    if (typeof lo !== 'string' || typeof hi !== 'string') continue;
                    const loCode = rawToCode(lo);
                    const hiCode = Math.min(rawToCode(hi), loCode + MAX_CMAP_ENTRIES);
                    if (typeof dst === 'string') {
                        const base = utf16beToString(dst);
                        for (let c = loCode; c <= hiCode && map.size < MAX_CMAP_ENTRIES; c++) {
                            const offset = c - loCode;
                            if (base.length === 0) break;
                            const last = base.charCodeAt(base.length - 1) + offset;
                            map.set(c, base.slice(0, -1) + String.fromCharCode(last));
                        }
                    } else if (Array.isArray(dst)) {
                        for (let k = 0; k < dst.length && map.size < MAX_CMAP_ENTRIES; k++) {
                            const d = dst[k];
                            if (typeof d === 'string') map.set(loCode + k, utf16beToString(d));
                        }
                    }
                }
                inBfRange = false; pending = [];
                continue;
            }
            continue;
        }
        if (t.type === 'string') {
            pending.push(t.value as string);
        } else if (t.type === 'arrayOpen' && inBfRange) {
            // Array destination form of bfrange.
            const arr: (string | number)[] = [];
            for (let inner = tok.next(); inner !== null && inner.type !== 'arrayClose'; inner = tok.next()) {
                if (inner.type === 'string' || inner.type === 'number') arr.push(inner.value);
            }
            pending.push(arr);
        }
        // Other tokens (header names/numbers/dicts) are ignored.
    }
    return { map, codeLen };
}

/** Build the 256-entry byte → Unicode table for a simple font. */
function buildSimpleEncoding(reader: PdfReader, encodingVal: PdfValue | undefined): number[] {
    const table = new Array<number>(256);
    const applyBase = (base: string | undefined): void => {
        for (let b = 0; b < 256; b++) {
            if (b >= 0x20 && b <= 0x7E) { table[b] = b; continue; }
            if (base === 'MacRomanEncoding') {
                table[b] = b >= 0x80 ? MACROMAN_HIGH[b - 0x80] : 0xFFFD;
            } else {
                // WinAnsiEncoding — also the heuristic default for fonts
                // with no /Encoding at all (incl. symbolic TrueType).
                if (b >= 0xA0) table[b] = b;
                else table[b] = WINANSI_HIGH[b] ?? 0xFFFD;
            }
        }
    };
    const resolved = encodingVal === undefined ? undefined : reader.resolveValue(encodingVal);
    if (resolved !== undefined && isName(resolved)) {
        applyBase(resolved.value);
    } else if (resolved !== undefined && resolved !== null && isDict(resolved)) {
        applyBase(dictGetName(resolved, 'BaseEncoding'));
        const diffs = reader.resolveValue(resolved.get('Differences') ?? null);
        if (isArray(diffs)) {
            let code = 0;
            for (const entry of diffs) {
                if (typeof entry === 'number') {
                    code = entry;
                } else if (isName(entry) && code >= 0 && code < 256) {
                    table[code] = glyphNameToUnicode(entry.value);
                    code++;
                }
            }
        }
    } else {
        applyBase(undefined);
    }
    return table;
}

/** Build the code → width function for a font dictionary. */
function buildWidths(reader: PdfReader, fontDict: PdfDict, isType0: boolean): (code: number) => number {
    if (isType0) {
        const desc = reader.resolveValue(fontDict.get('DescendantFonts') ?? null);
        const first = isArray(desc) ? reader.resolveValue(desc[0]) : null;
        const dw = first !== null && isDict(first) ? (dictGetNum(first, 'DW') ?? 1000) : 1000;
        const wMap = new Map<number, number>();
        if (first !== null && isDict(first)) {
            const w = reader.resolveValue(first.get('W') ?? null);
            if (isArray(w)) {
                for (let i = 0; i < w.length;) {
                    const c1 = reader.resolveValue(w[i]);
                    const nextVal = reader.resolveValue(w[i + 1] ?? null);
                    if (typeof c1 !== 'number') { i++; continue; }
                    if (isArray(nextVal)) {
                        for (let k = 0; k < nextVal.length; k++) {
                            const wk = reader.resolveValue(nextVal[k]);
                            if (typeof wk === 'number' && wMap.size < MAX_CMAP_ENTRIES) wMap.set(c1 + k, wk);
                        }
                        i += 2;
                    } else if (typeof nextVal === 'number') {
                        const c2 = nextVal;
                        const wv = reader.resolveValue(w[i + 2] ?? null);
                        if (typeof wv === 'number') {
                            const hi = Math.min(c2, c1 + MAX_CMAP_ENTRIES);
                            for (let c = c1; c <= hi && wMap.size < MAX_CMAP_ENTRIES; c++) wMap.set(c, wv);
                        }
                        i += 3;
                    } else {
                        i++;
                    }
                }
            }
        }
        return (code) => wMap.get(code) ?? dw;
    }
    const firstChar = dictGetNum(fontDict, 'FirstChar') ?? 0;
    const widthsVal = reader.resolveValue(fontDict.get('Widths') ?? null);
    const fd = reader.resolveValue(fontDict.get('FontDescriptor') ?? null);
    const missing = fd !== null && isDict(fd) ? (dictGetNum(fd, 'MissingWidth') ?? 500) : 500;
    if (!isArray(widthsVal)) return () => missing;
    const widths: number[] = [];
    for (const wv of widthsVal) {
        const n = reader.resolveValue(wv);
        widths.push(typeof n === 'number' ? n : missing);
    }
    return (code) => {
        const idx = code - firstChar;
        return idx >= 0 && idx < widths.length ? widths[idx] : missing;
    };
}

/** Build (and memoise per font object) the decoder for a resource font. */
function buildFontDecoder(reader: PdfReader, fontVal: PdfValue): FontDecoder | null {
    const fontDict = reader.resolveValue(fontVal);
    if (fontDict === null || !isDict(fontDict)) return null;
    const subtype = dictGetName(fontDict, 'Subtype');
    const isType0 = subtype === 'Type0';

    let toUnicode: Map<number, string> | null = null;
    let cmapCodeLen: 1 | 2 = isType0 ? 2 : 1;
    const tuVal = reader.resolveValue(fontDict.get('ToUnicode') ?? null);
    if (tuVal !== null && isStream(tuVal)) {
        try {
            const parsed = parseToUnicodeCMap(reader.decodeStream(tuVal));
            toUnicode = parsed.map;
            if (isType0) cmapCodeLen = parsed.codeLen === 1 ? 2 : parsed.codeLen;
        } catch {
            toUnicode = null; // malformed CMap — fall back to encoding table
        }
    }

    const encoding = isType0 ? null : buildSimpleEncoding(reader, fontDict.get('Encoding'));
    const widthOf = buildWidths(reader, fontDict, isType0);
    return { bytesPerCode: isType0 ? cmapCodeLen : 1, toUnicode, encoding, widthOf };
}

// ── Content-stream interpretation ────────────────────────────────────

type Operand = number | string | { readonly name: string } | readonly (number | string)[];

interface MutableRun {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    fontName: string;
}

interface ExtractionSink {
    readonly runs: MutableRun[];
    totalChars: number;
    readonly maxChars: number;
}

interface TextState {
    tm: Mat;
    tlm: Mat;
    fontName: string;
    decoder: FontDecoder | null;
    size: number;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    leading: number;
}

/** Skip an inline image: scan past `ID` up to a whitespace-delimited `EI`. */
function skipInlineImage(buf: Uint8Array, from: number): number {
    let i = from;
    // Find "ID" (start of binary data).
    while (i + 1 < buf.length && !(buf[i] === 0x49 && buf[i + 1] === 0x44)) i++;
    i += 3; // past "ID" + one whitespace byte
    // Find whitespace-preceded "EI" followed by whitespace/EOF.
    while (i + 1 < buf.length) {
        if (buf[i] === 0x45 && buf[i + 1] === 0x49 &&
            i > 0 && (buf[i - 1] === 0x20 || buf[i - 1] === 0x0A || buf[i - 1] === 0x0D || buf[i - 1] === 0x09) &&
            (i + 2 >= buf.length || buf[i + 2] === 0x20 || buf[i + 2] === 0x0A || buf[i + 2] === 0x0D || buf[i + 2] === 0x09)) {
            return i + 2;
        }
        i++;
    }
    return buf.length;
}

/** Decode one shown raw string through the font decoder; advances Tm. */
function showString(raw: string, st: TextState, ctm: Mat, sink: ExtractionSink): void {
    const dec = st.decoder;
    const trm = matMul(st.tm, ctm);
    const [dx, dy] = matApply(trm, 0, 0);
    const deviceSize = st.size * Math.hypot(trm[2], trm[3]);

    let text = '';
    let advance = 0; // text-space units (pre-Tm)
    const step = dec?.bytesPerCode ?? 1;
    for (let i = 0; i + step - 1 < raw.length; i += step) {
        const code = step === 2
            ? ((raw.charCodeAt(i) & 0xFF) << 8) | (raw.charCodeAt(i + 1) & 0xFF)
            : raw.charCodeAt(i) & 0xFF;
        let mapped: string | undefined = dec?.toUnicode?.get(code);
        if (mapped === undefined && dec?.encoding) {
            const cp = dec.encoding[code];
            mapped = cp === undefined || cp === 0xFFFD ? '�' : String.fromCodePoint(cp);
        }
        if (mapped === undefined) mapped = '�';
        text += mapped;
        const w = dec !== null ? dec.widthOf(code) : 500;
        advance += (w / 1000) * st.size + st.charSpacing + (code === 0x20 && step === 1 ? st.wordSpacing : 0);
    }
    advance *= st.hScale;

    sink.totalChars += text.length;
    if (sink.totalChars > sink.maxChars) {
        throw new Error(`extractText output exceeded the ${sink.maxChars}-character maxTextLength limit — raise options.maxTextLength if this document is trusted`);
    }
    if (text.length > 0) {
        sink.runs.push({ text, x: dx, y: dy, fontSize: deviceSize, fontName: st.fontName });
    }
    st.tm = matMul([1, 0, 0, 1, advance, 0], st.tm);
}

/**
 * Interpret one decoded content stream, appending runs to the sink.
 * Recurses into Form XObjects via `Do` (depth-capped).
 */
function interpretContent(
    reader: PdfReader,
    content: Uint8Array,
    resources: PdfDict | null,
    baseCtm: Mat,
    sink: ExtractionSink,
    depth: number,
): void {
    const tok = createTokenizer(content);
    const fontCache = new Map<string, FontDecoder | null>();
    const ctmStack: Mat[] = [];
    let ctm = baseCtm;
    const operands: Operand[] = [];

    const fontsDict = ((): PdfDict | null => {
        if (resources === null) return null;
        const f = reader.resolveValue(resources.get('Font') ?? null);
        return f !== null && isDict(f) ? f : null;
    })();
    const xobjDict = ((): PdfDict | null => {
        if (resources === null) return null;
        const x = reader.resolveValue(resources.get('XObject') ?? null);
        return x !== null && isDict(x) ? x : null;
    })();

    const st: TextState = {
        tm: IDENTITY, tlm: IDENTITY, fontName: '', decoder: null, size: 0,
        charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0,
    };

    const num = (idx: number): number => {
        const v = operands[operands.length + idx];
        return typeof v === 'number' ? v : 0;
    };
    const nextLine = (tx: number, ty: number): void => {
        st.tlm = matMul([1, 0, 0, 1, tx, ty], st.tlm);
        st.tm = st.tlm;
    };

    for (let t = tok.next(); t !== null; t = tok.next()) {
        switch (t.type) {
            case 'number':
            case 'string':
                operands.push(t.value as number | string);
                break;
            case 'name':
                operands.push({ name: t.value as string });
                break;
            case 'arrayOpen': {
                const arr: (number | string)[] = [];
                for (let inner = tok.next(); inner !== null && inner.type !== 'arrayClose'; inner = tok.next()) {
                    if (inner.type === 'number' || inner.type === 'string') arr.push(inner.value as number | string);
                }
                operands.push(arr);
                break;
            }
            case 'dictOpen': {
                // Balanced skip (BDC/DP property dicts etc.).
                let nesting = 1;
                for (let inner = tok.next(); inner !== null && nesting > 0; inner = tok.next()) {
                    if (inner.type === 'dictOpen') nesting++;
                    else if (inner.type === 'dictClose') nesting--;
                }
                break;
            }
            case 'keyword': {
                const op = t.value as string;
                switch (op) {
                    case 'BT': st.tm = IDENTITY; st.tlm = IDENTITY; break;
                    case 'ET': break;
                    case 'Tf': {
                        const nameOp = operands[operands.length - 2];
                        st.size = num(-1);
                        if (typeof nameOp === 'object' && nameOp !== null && 'name' in nameOp) {
                            st.fontName = nameOp.name;
                            if (!fontCache.has(nameOp.name)) {
                                const fv = fontsDict?.get(nameOp.name);
                                fontCache.set(nameOp.name, fv !== undefined ? buildFontDecoder(reader, fv) : null);
                            }
                            st.decoder = fontCache.get(nameOp.name) ?? null;
                        }
                        break;
                    }
                    case 'Td': nextLine(num(-2), num(-1)); break;
                    case 'TD': st.leading = -num(-1); nextLine(num(-2), num(-1)); break;
                    case 'TL': st.leading = num(-1); break;
                    case 'Tm': {
                        st.tlm = [num(-6), num(-5), num(-4), num(-3), num(-2), num(-1)];
                        st.tm = st.tlm;
                        break;
                    }
                    case 'T*': nextLine(0, -st.leading); break;
                    case 'Tc': st.charSpacing = num(-1); break;
                    case 'Tw': st.wordSpacing = num(-1); break;
                    case 'Tz': st.hScale = num(-1) / 100; break;
                    case 'Ts': break; // text rise — tracked as no-op for extraction
                    case 'Tj': {
                        const s = operands[operands.length - 1];
                        if (typeof s === 'string') showString(s, st, ctm, sink);
                        break;
                    }
                    case '\'': {
                        nextLine(0, -st.leading);
                        const s = operands[operands.length - 1];
                        if (typeof s === 'string') showString(s, st, ctm, sink);
                        break;
                    }
                    case '"': {
                        st.wordSpacing = num(-3);
                        st.charSpacing = num(-2);
                        nextLine(0, -st.leading);
                        const s = operands[operands.length - 1];
                        if (typeof s === 'string') showString(s, st, ctm, sink);
                        break;
                    }
                    case 'TJ': {
                        const arr = operands[operands.length - 1];
                        if (Array.isArray(arr)) {
                            for (const el of arr) {
                                if (typeof el === 'string') {
                                    showString(el, st, ctm, sink);
                                } else if (typeof el === 'number') {
                                    const tx = (-el / 1000) * st.size * st.hScale;
                                    st.tm = matMul([1, 0, 0, 1, tx, 0], st.tm);
                                    if (el <= TJ_SPACE_THRESHOLD && sink.runs.length > 0) {
                                        const last = sink.runs[sink.runs.length - 1];
                                        if (!last.text.endsWith(' ')) {
                                            last.text += ' ';
                                            sink.totalChars++;
                                        }
                                    }
                                }
                            }
                        }
                        break;
                    }
                    case 'q':
                        if (ctmStack.length < MAX_GRAPHICS_STACK) ctmStack.push(ctm);
                        break;
                    case 'Q': {
                        const popped = ctmStack.pop();
                        if (popped !== undefined) ctm = popped;
                        break;
                    }
                    case 'cm':
                        ctm = matMul([num(-6), num(-5), num(-4), num(-3), num(-2), num(-1)], ctm);
                        break;
                    case 'BI':
                        tok.pos = skipInlineImage(content, tok.pos);
                        break;
                    case 'Do': {
                        const nameOp = operands[operands.length - 1];
                        if (depth < MAX_FORM_DEPTH && typeof nameOp === 'object' && nameOp !== null && 'name' in nameOp && xobjDict !== null) {
                            const xo = reader.resolveValue(xobjDict.get(nameOp.name) ?? null);
                            if (xo !== null && isStream(xo) && dictGetName(xo.dict, 'Subtype') === 'Form') {
                                let formCtm = ctm;
                                const mtx = reader.resolveValue(xo.dict.get('Matrix') ?? null);
                                if (isArray(mtx) && mtx.length === 6 && mtx.every((v): v is number => typeof v === 'number')) {
                                    formCtm = matMul([mtx[0], mtx[1], mtx[2], mtx[3], mtx[4], mtx[5]], ctm);
                                }
                                const formRes = reader.resolveValue(xo.dict.get('Resources') ?? null);
                                let decoded: Uint8Array | null = null;
                                try { decoded = reader.decodeStream(xo); } catch { decoded = null; }
                                if (decoded !== null) {
                                    interpretContent(
                                        reader, decoded,
                                        formRes !== null && isDict(formRes) ? formRes : resources,
                                        formCtm, sink, depth + 1,
                                    );
                                }
                            }
                        }
                        break;
                    }
                    default:
                        break; // painting/colour/shading operators — irrelevant to text
                }
                operands.length = 0;
                break;
            }
            default:
                break;
        }
        if (operands.length > MAX_OPERANDS) operands.splice(0, operands.length - MAX_OPERANDS);
    }
}

// ── Reading-order assembly ───────────────────────────────────────────

function assembleReadingOrder(runs: readonly MutableRun[]): string {
    if (runs.length === 0) return '';
    interface Line { y: number; size: number; runs: MutableRun[] }
    const lines: Line[] = [];
    for (const run of runs) {
        const tol = Math.max(run.fontSize, 1) * 0.4;
        let line = lines.find((l) => Math.abs(l.y - run.y) <= Math.max(tol, Math.max(l.size, 1) * 0.4));
        if (line === undefined) {
            line = { y: run.y, size: run.fontSize, runs: [] };
            lines.push(line);
        }
        line.runs.push(run);
    }
    lines.sort((a, b) => b.y - a.y);
    const parts: string[] = [];
    for (const line of lines) {
        line.runs.sort((a, b) => a.x - b.x);
        let lineText = '';
        let prevEnd: MutableRun | null = null;
        for (const run of line.runs) {
            if (prevEnd !== null && lineText.length > 0 && !lineText.endsWith(' ') && !run.text.startsWith(' ')) {
                // Insert a space when there is a visible horizontal gap.
                const gap = run.x - prevEnd.x;
                const approxPrevWidth = prevEnd.text.length * prevEnd.fontSize * 0.5;
                if (gap - approxPrevWidth > Math.max(run.fontSize, prevEnd.fontSize) * 0.25) {
                    lineText += ' ';
                }
            }
            lineText += run.text;
            prevEnd = run;
        }
        parts.push(lineText);
    }
    return parts.join('\n');
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Extract Unicode text from a PDF document, page by page.
 *
 * Works on documents produced by any conformant writer, including
 * encrypted ones (pass `options.password`; decryption is transparent).
 * Text is decoded through each font's `/ToUnicode` CMap when present,
 * else through its base encoding (WinAnsi / MacRoman / `/Differences`);
 * codes with no mapping decode to U+FFFD. See the module header for the
 * documented limitations (no OCR, geometric order, …).
 *
 * @param bytes - Complete PDF file bytes
 * @param options - Password, page selection, positioned runs, memory cap
 * @returns One {@link ExtractedPageText} per requested page, in ascending
 *          page order
 * @throws {Error} for invalid `pages` indices or when `maxTextLength` is
 *         exceeded
 * @throws {PdfPasswordError} when the document is encrypted and the
 *         password is missing or wrong
 * @since 1.6.0
 */
export function extractText(bytes: Uint8Array, options?: ExtractTextOptions): ExtractedPageText[] {
    const maxChars = options?.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
    if (!(maxChars > 0)) {
        throw new Error(`extractText: maxTextLength must be a positive number or Infinity, got ${String(options?.maxTextLength)}`);
    }
    const reader = openPdf(bytes, options?.password !== undefined ? { password: options.password } : undefined);

    let indices: number[];
    if (options?.pages !== undefined) {
        for (const p of options.pages) {
            if (!Number.isInteger(p) || p < 0 || p >= reader.pageCount) {
                throw new Error(`extractText: page index ${String(p)} out of range 0..${reader.pageCount - 1}`);
            }
        }
        indices = [...new Set(options.pages)].sort((a, b) => a - b);
    } else {
        indices = Array.from({ length: reader.pageCount }, (_, i) => i);
    }

    const sink: ExtractionSink = { runs: [], totalChars: 0, maxChars };
    const results: ExtractedPageText[] = [];

    for (const pageIndex of indices) {
        const page = reader.getPage(pageIndex);
        sink.runs.length = 0;

        // Contents: single stream or array of streams, joined with '\n'.
        const contentsVal = reader.resolveValue(page.get('Contents') ?? null);
        const streams: PdfStream[] = [];
        if (contentsVal !== null && isStream(contentsVal)) {
            streams.push(contentsVal);
        } else if (isArray(contentsVal)) {
            for (const c of contentsVal) {
                const s = reader.resolveValue(c);
                if (s !== null && isStream(s)) streams.push(s);
            }
        }
        const decodedParts: Uint8Array[] = [];
        let total = 0;
        for (const s of streams) {
            try {
                const d = reader.decodeStream(s);
                decodedParts.push(d);
                total += d.length + 1;
            } catch {
                // Undecodable content stream — skip it, keep the rest.
            }
        }
        const content = new Uint8Array(total === 0 ? 0 : total);
        let off = 0;
        for (const part of decodedParts) {
            content.set(part, off);
            off += part.length;
            if (off < content.length) { content[off] = 0x0A; off++; }
        }

        // Resources: inheritable via the /Parent chain (§7.7.3.4).
        let resources: PdfDict | null = null;
        let node: PdfDict | null = page;
        for (let hops = 0; node !== null && hops < 64; hops++) {
            const res = reader.resolveValue(node.get('Resources') ?? null);
            if (res !== null && isDict(res)) { resources = res; break; }
            const parent: PdfValue | undefined = node.get('Parent');
            const parentVal: PdfValue = parent !== undefined && isRef(parent) ? reader.resolveValue(parent) : null;
            node = parentVal !== null && isDict(parentVal) ? parentVal : null;
        }

        interpretContent(reader, content, resources, IDENTITY, sink, 0);

        const pageRuns = sink.runs.map((r) => ({ ...r }));
        results.push({
            pageIndex,
            text: assembleReadingOrder(pageRuns),
            ...(options?.includeRuns === true
                ? { runs: pageRuns.map((r): ExtractedTextRun => ({ text: r.text, x: r.x, y: r.y, fontSize: r.fontSize, fontName: r.fontName })) }
                : {}),
        });
    }
    return results;
}
