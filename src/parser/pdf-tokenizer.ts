/**
 * pdfnative — PDF Token Scanner
 * ===============================
 * Scans PDF byte stream into typed tokens (ISO 32000-1 §7.2).
 *
 * Token types:
 *   - number (integer/real)
 *   - string (literal or hex)
 *   - name (/SomeName)
 *   - keyword (true, false, null, R, obj, endobj, stream, endstream, xref, trailer, startxref)
 *   - arrayOpen [, arrayClose ]
 *   - dictOpen <<, dictClose >>
 */

// ── Token Types ──────────────────────────────────────────────────────

export type TokenType =
    | 'number'
    | 'string'
    | 'name'
    | 'keyword'
    | 'arrayOpen'
    | 'arrayClose'
    | 'dictOpen'
    | 'dictClose';

export interface PdfToken {
    readonly type: TokenType;
    readonly value: string | number;
    readonly offset: number;
}

// ── Character Classification ─────────────────────────────────────────

const WS = new Set([0, 9, 10, 12, 13, 32]); // NUL, TAB, LF, FF, CR, SP
const DELIM = new Set([
    0x28, 0x29, // ( )
    0x3C, 0x3E, // < >
    0x5B, 0x5D, // [ ]
    0x7B, 0x7D, // { }
    0x2F,       // /
    0x25,       // %
]);

function isWhitespace(b: number): boolean { return WS.has(b); }
function isDelimiter(b: number): boolean { return DELIM.has(b); }
function isDigit(b: number): boolean { return b >= 0x30 && b <= 0x39; }
function isHexDigit(b: number): boolean {
    return (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
}

// ── Tokenizer ────────────────────────────────────────────────────────

export interface PdfTokenizer {
    /** Current byte position in the buffer. */
    pos: number;
    /** Underlying byte buffer. */
    readonly buf: Uint8Array;
    /** Read the next token, or null if at end. */
    next(): PdfToken | null;
    /** Peek at the next token without advancing. */
    peek(): PdfToken | null;
    /** Skip whitespace and comments. */
    skipWhitespace(): void;
}

/**
 * Create a PDF tokenizer for the given byte buffer.
 *
 * @param buf - PDF file bytes
 * @param startPos - Starting byte offset (default: 0)
 * @returns Tokenizer instance
 */
export function createTokenizer(buf: Uint8Array, startPos: number = 0): PdfTokenizer {
    let pos = startPos;
    let peeked: PdfToken | null | undefined;

    function skipWS(): void {
        while (pos < buf.length) {
            const b = buf[pos];
            if (isWhitespace(b)) {
                pos++;
            } else if (b === 0x25) { // % comment
                pos++;
                while (pos < buf.length && buf[pos] !== 10 && buf[pos] !== 13) pos++;
            } else {
                break;
            }
        }
    }

    function readNumber(start: number): PdfToken {
        let end = pos;
        let hasDot = false;
        if (buf[end] === 0x2B || buf[end] === 0x2D) end++; // +/-
        while (end < buf.length) {
            const b = buf[end];
            if (isDigit(b)) {
                end++;
            } else if (b === 0x2E && !hasDot) { // .
                hasDot = true;
                end++;
            } else {
                break;
            }
        }
        const str = latin1(buf, pos, end);
        pos = end;
        return { type: 'number', value: hasDot ? parseFloat(str) : parseInt(str, 10), offset: start };
    }

    function readLiteralString(start: number): PdfToken {
        pos++; // skip (
        let depth = 1;
        let result = '';
        while (pos < buf.length && depth > 0) {
            const b = buf[pos];
            if (b === 0x28) { // (
                depth++;
                result += '(';
                pos++;
            } else if (b === 0x29) { // )
                depth--;
                if (depth > 0) result += ')';
                pos++;
            } else if (b === 0x5C) { // backslash escape
                pos++;
                if (pos >= buf.length) break;
                const esc = buf[pos];
                switch (esc) {
                    case 0x6E: result += '\n'; pos++; break; // \n
                    case 0x72: result += '\r'; pos++; break; // \r
                    case 0x74: result += '\t'; pos++; break; // \t
                    case 0x62: result += '\b'; pos++; break; // \b
                    case 0x66: result += '\f'; pos++; break; // \f
                    case 0x28: result += '('; pos++; break;  // \(
                    case 0x29: result += ')'; pos++; break;  // \)
                    case 0x5C: result += '\\'; pos++; break; // \\
                    case 0x0A: pos++; break; // \<LF> line continuation
                    case 0x0D: // \<CR> or \<CR><LF>
                        pos++;
                        if (pos < buf.length && buf[pos] === 0x0A) pos++;
                        break;
                    default:
                        // Octal escape \ddd (1-3 digits)
                        if (esc >= 0x30 && esc <= 0x37) {
                            let oct = esc - 0x30;
                            pos++;
                            if (pos < buf.length && buf[pos] >= 0x30 && buf[pos] <= 0x37) {
                                oct = oct * 8 + (buf[pos++] - 0x30);
                                if (pos < buf.length && buf[pos] >= 0x30 && buf[pos] <= 0x37) {
                                    oct = oct * 8 + (buf[pos++] - 0x30);
                                }
                            }
                            result += String.fromCharCode(oct & 0xFF);
                        } else {
                            result += String.fromCharCode(esc);
                            pos++;
                        }
                }
            } else {
                result += String.fromCharCode(b);
                pos++;
            }
        }
        return { type: 'string', value: result, offset: start };
    }

    function readHexString(start: number): PdfToken {
        pos++; // skip <
        let hex = '';
        while (pos < buf.length && buf[pos] !== 0x3E) { // >
            const b = buf[pos];
            if (isHexDigit(b)) hex += String.fromCharCode(b);
            pos++;
        }
        if (pos < buf.length) pos++; // skip >
        // Pad odd-length hex with trailing 0
        if (hex.length % 2 !== 0) hex += '0';
        // Convert hex pairs to string
        let result = '';
        for (let i = 0; i < hex.length; i += 2) {
            result += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
        }
        return { type: 'string', value: result, offset: start };
    }

    function readName(start: number): PdfToken {
        pos++; // skip /
        let name = '';
        while (pos < buf.length) {
            const b = buf[pos];
            if (isWhitespace(b) || isDelimiter(b)) break;
            if (b === 0x23 && pos + 2 < buf.length) { // #XX hex escape
                const h1 = buf[pos + 1];
                const h2 = buf[pos + 2];
                if (isHexDigit(h1) && isHexDigit(h2)) {
                    name += String.fromCharCode(parseInt(String.fromCharCode(h1, h2), 16));
                    pos += 3;
                    continue;
                }
            }
            name += String.fromCharCode(b);
            pos++;
        }
        return { type: 'name', value: name, offset: start };
    }

    function readKeyword(start: number): PdfToken {
        let end = pos;
        while (end < buf.length && !isWhitespace(buf[end]) && !isDelimiter(buf[end])) end++;
        const word = latin1(buf, pos, end);
        pos = end;

        // Convert boolean/null keywords to their string values
        if (word === 'true' || word === 'false' || word === 'null') {
            return { type: 'keyword', value: word, offset: start };
        }
        return { type: 'keyword', value: word, offset: start };
    }

    function nextToken(): PdfToken | null {
        skipWS();
        if (pos >= buf.length) return null;

        const start = pos;
        const b = buf[pos];

        // Number: digit, +, -, or .digit
        if (isDigit(b) || b === 0x2B || b === 0x2D ||
            (b === 0x2E && pos + 1 < buf.length && isDigit(buf[pos + 1]))) {
            return readNumber(start);
        }

        switch (b) {
            case 0x28: return readLiteralString(start);  // (
            case 0x3C: // < or <<
                if (pos + 1 < buf.length && buf[pos + 1] === 0x3C) {
                    pos += 2;
                    return { type: 'dictOpen', value: '<<', offset: start };
                }
                return readHexString(start);
            case 0x3E: // > or >>
                if (pos + 1 < buf.length && buf[pos + 1] === 0x3E) {
                    pos += 2;
                    return { type: 'dictClose', value: '>>', offset: start };
                }
                pos++;
                return { type: 'keyword', value: '>', offset: start };
            case 0x5B: pos++; return { type: 'arrayOpen', value: '[', offset: start };
            case 0x5D: pos++; return { type: 'arrayClose', value: ']', offset: start };
            case 0x2F: return readName(start);  // /
            default: return readKeyword(start);
        }
    }

    return {
        get pos() { return pos; },
        set pos(v: number) { pos = v; peeked = undefined; },
        buf,
        next(): PdfToken | null {
            if (peeked !== undefined) {
                const t = peeked;
                peeked = undefined;
                return t;
            }
            return nextToken();
        },
        peek(): PdfToken | null {
            if (peeked !== undefined) return peeked;
            const saved = pos;
            peeked = nextToken();
            if (peeked === null) pos = saved;
            return peeked;
        },
        skipWhitespace: skipWS,
    };
}

// ── Helpers ──────────────────────────────────────────────────────────

function latin1(buf: Uint8Array, start: number, end: number): string {
    let s = '';
    for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return s;
}
