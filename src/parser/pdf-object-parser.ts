/**
 * pdfnative — PDF Object Parser
 * ================================
 * Parses PDF indirect objects from a tokenized stream (ISO 32000-1 §7.3).
 *
 * Supports:
 *   - Boolean, integer, real, string, name, null
 *   - Array, dictionary
 *   - Indirect references (N G R)
 *   - Stream objects (dictionary + stream data)
 */

import type { PdfTokenizer } from './pdf-tokenizer.js';

// ── PDF Value Types ──────────────────────────────────────────────────

export interface PdfRef {
    readonly type: 'ref';
    readonly num: number;
    readonly gen: number;
}

export interface PdfName {
    readonly type: 'name';
    readonly value: string;
}

export interface PdfStream {
    readonly type: 'stream';
    readonly dict: PdfDict;
    readonly data: Uint8Array;
}

export type PdfDict = Map<string, PdfValue>;
export type PdfArray = PdfValue[];

/**
 * Union of all PDF object types (ISO 32000-1 §7.3).
 *
 * Discriminants:
 *  - `null`, `boolean`, `number`, `string` — JS primitives
 *  - `PdfName` — `{ type: 'name', value }` for PDF names (/Type, /Page)
 *  - `PdfRef` — `{ type: 'ref', num, gen }` for indirect references (5 0 R)
 *  - `PdfStream` — `{ type: 'stream', dict, data }` for stream objects
 *  - `PdfDict` — `Map<string, PdfValue>` for dictionaries
 *  - `PdfArray` — `PdfValue[]` for arrays
 *
 * @example
 * ```ts
 * if (isName(val))    console.log(val.value);   // PDF name string
 * if (isRef(val))     console.log(val.num);      // object number
 * if (isStream(val))  console.log(val.data);     // stream bytes
 * if (val instanceof Map) { ... }                // dictionary
 * ```
 */
export type PdfValue =
    | null
    | boolean
    | number
    | string
    | PdfName
    | PdfRef
    | PdfArray
    | PdfDict
    | PdfStream;

// ── Value Helpers ────────────────────────────────────────────────────

export function isRef(v: PdfValue): v is PdfRef {
    return v !== null && typeof v === 'object' && 'type' in v && v.type === 'ref';
}

export function isName(v: PdfValue | undefined): v is PdfName {
    return v !== null && v !== undefined && typeof v === 'object' && 'type' in v && v.type === 'name';
}

export function isStream(v: PdfValue): v is PdfStream {
    return v !== null && typeof v === 'object' && 'type' in v && v.type === 'stream';
}

export function isDict(v: PdfValue): v is PdfDict {
    return v instanceof Map;
}

export function isArray(v: PdfValue): v is PdfArray {
    return Array.isArray(v);
}

export function dictGet(dict: PdfDict, key: string): PdfValue | undefined {
    return dict.get(key);
}

export function dictGetName(dict: PdfDict, key: string): string | undefined {
    const v = dict.get(key);
    if (isName(v)) return v.value;
    return typeof v === 'string' ? v : undefined;
}

/** Extract the string value from a PdfName, or undefined if not a name. */
export function nameValue(v: PdfValue): string | undefined {
    return isName(v) ? v.value : undefined;
}

export function dictGetNum(dict: PdfDict, key: string): number | undefined {
    const v = dict.get(key);
    return typeof v === 'number' ? v : undefined;
}

export function dictGetRef(dict: PdfDict, key: string): PdfRef | undefined {
    const v = dict.get(key);
    return v !== undefined && isRef(v) ? v : undefined;
}

export function dictGetDict(dict: PdfDict, key: string): PdfDict | undefined {
    const v = dict.get(key);
    return v !== undefined && isDict(v) ? v : undefined;
}

export function dictGetArray(dict: PdfDict, key: string): PdfArray | undefined {
    const v = dict.get(key);
    return v !== undefined && isArray(v) ? v : undefined;
}

// ── Object Parser ────────────────────────────────────────────────────

/**
 * Maximum depth for recursive PDF object parsing (nested arrays/dicts).
 * Prevents stack-overflow DoS from malicious PDFs with deeply nested structures
 * (CWE-674: Uncontrolled Recursion).
 */
export const MAX_PARSE_DEPTH = 1000;

/**
 * Parse a single PDF value from the token stream.
 * Handles object references (num gen R) by looking ahead.
 *
 * @param tok   Tokenizer positioned at the value to parse
 * @param depth Current recursion depth (internal — do not pass from outside)
 * @throws Error if nesting exceeds {@link MAX_PARSE_DEPTH}
 */
export function parseValue(tok: PdfTokenizer, depth = 0): PdfValue {
    if (depth > MAX_PARSE_DEPTH) {
        throw new Error(`parseValue: PDF nesting exceeds maximum depth of ${MAX_PARSE_DEPTH}`);
    }
    const t = tok.next();
    if (!t) throw new Error('parseValue: unexpected end of tokens');

    switch (t.type) {
        case 'number': {
            // Look ahead for "gen R" (indirect reference)
            const savedPos = tok.pos; // save BEFORE peek advances pos
            const peek1 = tok.peek();
            if (peek1 && peek1.type === 'number') {
                tok.next(); // consume gen
                const peek2 = tok.peek();
                if (peek2 && peek2.type === 'keyword' && peek2.value === 'R') {
                    tok.next(); // consume R
                    return { type: 'ref', num: t.value as number, gen: peek1.value as number };
                }
                // Not a reference — rewind
                tok.pos = savedPos;
            }
            return t.value as number;
        }
        case 'string':
            return t.value as string;
        case 'name':
            return { type: 'name', value: t.value as string } as PdfName;
        case 'keyword':
            switch (t.value) {
                case 'true': return true;
                case 'false': return false;
                case 'null': return null;
                default:
                    throw new Error(`parseValue: unexpected keyword '${t.value}' at offset ${t.offset}`);
            }
        case 'arrayOpen':
            return parseArray(tok, depth + 1);
        case 'dictOpen':
            return parseDictOrStream(tok, depth + 1);
        default:
            throw new Error(`parseValue: unexpected token type '${t.type}' at offset ${t.offset}`);
    }
}

function parseArray(tok: PdfTokenizer, depth: number): PdfArray {
    const arr: PdfArray = [];
    while (true) {
        const peek = tok.peek();
        if (!peek) throw new Error('parseArray: unexpected end of tokens');
        if (peek.type === 'arrayClose') {
            tok.next(); // consume ]
            return arr;
        }
        arr.push(parseValue(tok, depth));
    }
}

function parseDictOrStream(tok: PdfTokenizer, depth: number): PdfDict | PdfStream {
    const dict: PdfDict = new Map();

    while (true) {
        const peek = tok.peek();
        if (!peek) throw new Error('parseDict: unexpected end of tokens');
        if (peek.type === 'dictClose') {
            tok.next(); // consume >>
            break;
        }

        // Key must be a name
        const keyToken = tok.next();
        if (!keyToken || keyToken.type !== 'name') {
            throw new Error(`parseDict: expected name key, got ${keyToken?.type} at offset ${keyToken?.offset}`);
        }
        const key = keyToken.value as string;

        // Value
        dict.set(key, parseValue(tok, depth));
    }

    // Check for stream keyword after >>
    const afterDict = tok.peek();
    if (afterDict && afterDict.type === 'keyword' && afterDict.value === 'stream') {
        tok.next(); // consume 'stream'

        // Stream data starts after stream keyword + EOL
        let dataStart = tok.pos;
        // Skip EOL after 'stream': CR, LF, or CRLF
        if (tok.buf[dataStart] === 0x0D) dataStart++;
        if (dataStart < tok.buf.length && tok.buf[dataStart] === 0x0A) dataStart++;

        // Use /Length to find stream end
        const lengthVal = dict.get('Length');
        let streamLen: number;
        if (typeof lengthVal === 'number') {
            streamLen = lengthVal;
        } else {
            // /Length is an indirect reference — search for 'endstream'
            streamLen = findEndstream(tok.buf, dataStart);
        }

        const data = tok.buf.subarray(dataStart, dataStart + streamLen);
        tok.pos = dataStart + streamLen;

        // Skip to after 'endstream'
        tok.skipWhitespace();
        const endKw = tok.peek();
        if (endKw && endKw.type === 'keyword' && endKw.value === 'endstream') {
            tok.next();
        }

        return { type: 'stream', dict, data };
    }

    return dict;
}

/**
 * Search for 'endstream' marker when /Length is an indirect reference.
 */
function findEndstream(buf: Uint8Array, start: number): number {
    // Search for \nendstream or \r\nendstream or \rendstream
    const target = [101, 110, 100, 115, 116, 114, 101, 97, 109]; // 'endstream'
    for (let i = start; i < buf.length - target.length; i++) {
        if ((buf[i] === 0x0A || buf[i] === 0x0D) || i === start) {
            let checkPos = i;
            if (buf[checkPos] === 0x0A || buf[checkPos] === 0x0D) {
                checkPos++;
                if (checkPos < buf.length && buf[checkPos - 1] === 0x0D && buf[checkPos] === 0x0A) checkPos++;
            }
            let match = true;
            for (let j = 0; j < target.length; j++) {
                if (checkPos + j >= buf.length || buf[checkPos + j] !== target[j]) {
                    match = false;
                    break;
                }
            }
            if (match) return i - start;
        }
    }
    throw new Error('parseStream: could not find endstream marker');
}

// ── Indirect Object Parser ──────────────────────────────────────────

export interface PdfIndirectObject {
    readonly num: number;
    readonly gen: number;
    readonly value: PdfValue;
}

/**
 * Parse a PDF indirect object definition: `num gen obj ... endobj`
 *
 * @param tok - Tokenizer positioned before the object number
 * @returns Parsed indirect object, or null if no object at current position
 */
export function parseIndirectObject(tok: PdfTokenizer): PdfIndirectObject | null {
    const numToken = tok.next();
    if (!numToken || numToken.type !== 'number') return null;

    const genToken = tok.next();
    if (!genToken || genToken.type !== 'number') return null;

    const objToken = tok.next();
    if (!objToken || objToken.type !== 'keyword' || objToken.value !== 'obj') return null;

    const value = parseValue(tok);

    // Skip endobj
    const endToken = tok.peek();
    if (endToken && endToken.type === 'keyword' && endToken.value === 'endobj') {
        tok.next();
    }

    return { num: numToken.value as number, gen: genToken.value as number, value };
}
