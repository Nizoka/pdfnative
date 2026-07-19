/**
 * pdfnative — PDF Binary Assembler
 * ===================================
 * Shared low-level PDF binary assembly primitives used by both
 * the table builder (pdf-builder.ts) and document builder (pdf-document.ts).
 *
 * Handles object emission, stream compression/encryption, xref table,
 * and trailer generation — the identical parts of PDF assembly.
 */

import { compressStream } from './pdf-compress.js';
import { encryptStream, encryptString, buildEncryptDict, buildIdArray, md5, type EncryptionState } from './pdf-encrypt.js';

// ── PDF Writer ───────────────────────────────────────────────────────

/**
 * Low-level PDF binary writer with offset tracking.
 * Created via `createPdfWriter()`. Provides `emit`, `emitObj`, and `emitStreamObj`.
 */
export interface PdfWriter {
    /** Append raw string to PDF output and advance byte offset. */
    readonly emit: (str: string) => void;
    /**
     * Emit a PDF indirect object (`num 0 obj ... endobj`). When the document
     * is encrypted, literal strings in `content` are encrypted with the
     * object's key unless `skipEncrypt` is set (used for the `/Encrypt` dict
     * and objects that manage their own encryption).
     */
    readonly emitObj: (num: number, content: string, skipEncrypt?: boolean) => void;
    /** Emit a stream object with optional compression and encryption. */
    readonly emitStreamObj: (num: number, dictEntries: string, streamData: string, skipCompress?: boolean) => void;
    /** Current byte offset in the output. */
    readonly offset: () => number;
    /** Adjust the tracked byte offset by a delta (for in-place catalog rewrites). */
    readonly adjustOffset: (delta: number) => void;
    /** Per-object byte offsets for xref table. */
    readonly objOffsets: number[];
    /** Accumulated output parts. Join with '' for final PDF string. */
    readonly parts: string[];
}

/**
 * Create a PDF binary writer with offset-tracked emission.
 *
 * @param compress - Whether to FlateDecode-compress streams
 * @param encState - Encryption state (null if no encryption)
 * @returns PdfWriter with emit/emitObj/emitStreamObj
 */
export function createPdfWriter(compress: boolean, encState: EncryptionState | null): PdfWriter {
    const parts: string[] = [];
    let _offset = 0;
    const objOffsets: number[] = [];

    function emit(str: string): void {
        parts.push(str);
        _offset += str.length;
    }

    function emitObj(num: number, content: string, skipEncrypt?: boolean): void {
        objOffsets[num] = _offset;
        const body = encState && !skipEncrypt ? encryptObjectStrings(content, encState, num) : content;
        emit(`${num} 0 obj\n${body}\nendobj\n\n`);
    }

    /**
     * Emit a stream object with optional compression and encryption.
     * Order: compress → encrypt (ISO 32000-1 §7.3.8).
     */
    function emitStreamObj(num: number, dictEntries: string, streamData: string, skipCompress?: boolean): void {
        let data = streamData;
        let dict = dictEntries;

        // Step 1: Compress (before encryption)
        if (compress && !skipCompress) {
            const compressed = compressStream(data);
            dict = dict.replace(/\/Length \d+/, `/Filter /FlateDecode /Length ${compressed.length}`);
            data = compressed;
        }

        // Step 2: Encrypt (after compression)
        if (encState) {
            const encrypted = encryptStream(data, encState, num, 0);
            // Encrypt any literal strings in the dict portion, but pass
            // skipEncrypt so the binary stream payload is never scanned.
            const encDict = encryptObjectStrings(dict.replace(/\/Length \d+/, `/Length ${encrypted.length}`), encState, num);
            emitObj(num, `${encDict} >>\nstream\n${encrypted}\nendstream`, true);
        } else {
            emitObj(num, `${dict} >>\nstream\n${data}\nendstream`);
        }
    }

    return { emit, emitObj, emitStreamObj, offset: () => _offset, adjustOffset: (d: number) => { _offset += d; }, objOffsets, parts };
}

// ── String encryption in serialized object bodies ────────────────────

/**
 * Encrypt every PDF string literal in a serialized object body.
 *
 * When a document is encrypted, ISO 32000-1 §7.6.2 requires **all** strings
 * (not just streams) to be encrypted with the object's key — Info metadata,
 * annotation `/Contents`, outline titles, link URIs, etc. The object bodies
 * built by the writer are already fully serialized, so this scans them and
 * replaces each literal `(...)` and hex `<...>` string with its encrypted
 * hex form, leaving names, numbers, dict delimiters (`<<` / `>>`) and the
 * binary stream payload untouched.
 *
 * Exempt objects (the `/Encrypt` dict, the trailer `/ID`) are handled by
 * their callers via `skipEncrypt` and never reach this function.
 */
function encryptObjectStrings(content: string, encState: EncryptionState, objNum: number): string {
    let out = '';
    let i = 0;
    const n = content.length;
    while (i < n) {
        const ch = content[i];
        if (ch === '(') {
            // Literal string — consume with balanced parens + backslash escapes.
            const { raw, next } = readLiteralString(content, i);
            out += encryptString(raw, encState, objNum, 0);
            i = next;
        } else if (ch === '<' && content[i + 1] === '<') {
            out += '<<';
            i += 2;
        } else if (ch === '<') {
            // Hex string — up to the next '>'.
            const end = content.indexOf('>', i + 1);
            if (end === -1) { out += content.slice(i); break; }
            const hex = content.slice(i + 1, end).replace(/\s+/g, '');
            out += encryptString(hexToRaw(hex), encState, objNum, 0);
            i = end + 1;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

/** Parse a PDF literal string starting at `content[start] === '('`. */
function readLiteralString(content: string, start: number): { raw: string; next: number } {
    let raw = '';
    let depth = 0;
    let i = start + 1; // skip the opening '('
    for (; i < content.length; i++) {
        const c = content[i];
        if (c === '\\') {
            const e = content[i + 1];
            i++;
            switch (e) {
                case 'n': raw += '\n'; break;
                case 'r': raw += '\r'; break;
                case 't': raw += '\t'; break;
                case 'b': raw += '\b'; break;
                case 'f': raw += '\f'; break;
                case '(': raw += '('; break;
                case ')': raw += ')'; break;
                case '\\': raw += '\\'; break;
                case '\r': if (content[i + 1] === '\n') i++; break; // line continuation
                case '\n': break; // line continuation
                default:
                    if (e >= '0' && e <= '7') {
                        let oct = e;
                        for (let k = 0; k < 2 && content[i + 1] >= '0' && content[i + 1] <= '7'; k++) {
                            oct += content[++i];
                        }
                        raw += String.fromCharCode(parseInt(oct, 8) & 0xFF);
                    } else {
                        raw += e; // unknown escape → literal char
                    }
            }
            continue;
        }
        if (c === '(') { depth++; raw += c; continue; }
        if (c === ')') {
            if (depth === 0) { i++; break; } // closing paren of the string
            depth--; raw += c; continue;
        }
        raw += c;
    }
    return { raw, next: i };
}

function hexToRaw(hex: string): string {
    const even = hex.length % 2 === 0 ? hex : hex + '0';
    let s = '';
    for (let k = 0; k < even.length; k += 2) s += String.fromCharCode(parseInt(even.substr(k, 2), 16));
    return s;
}

// ── Xref & Trailer ──────────────────────────────────────────────────

/**
 * Write the xref table, trailer, startxref, and %%EOF to finalize a PDF.
 * If encryption is active, the encryption dict object is emitted first.
 *
 * @param w - PDF writer
 * @param totalObjs - Total number of objects emitted so far
 * @param infoObjNum - Object number of the /Info dictionary
 * @param encState - Encryption state (null if no encryption)
 * @param idSeed - Seed string used to derive a stable trailer `/ID` for
 *   unencrypted PDFs. Typically `infoTitle + '|' + pdfDate`. Equal seeds
 *   produce equal IDs (deterministic, ISO 32000-1 §14.4 friendly).
 *   Required when `encState` is null.
 * @returns Final totalObjs count (may increase if encryption dict was added)
 */
export function writeXrefTrailer(
    w: PdfWriter,
    totalObjs: number,
    infoObjNum: number,
    encState: EncryptionState | null,
    idSeed: string = '',
): number {
    let encryptObjNum = 0;
    if (encState) {
        encryptObjNum = totalObjs + 1;
        // The /Encrypt dict itself is never encrypted (ISO 32000-1 §7.6.1).
        w.emitObj(encryptObjNum, buildEncryptDict(encState), true);
        totalObjs = encryptObjNum;
    }

    const xrefOffset = w.offset();
    w.emit('xref\n');
    w.emit(`0 ${totalObjs + 1}\n`);
    w.emit('0000000000 65535 f \n');
    for (let i = 1; i <= totalObjs; i++) {
        if (w.objOffsets[i] >= 10_000_000_000) throw new Error('PDF exceeds maximum xref offset (10 GB)');
        w.emit(`${String(w.objOffsets[i]).padStart(10, '0')} 00000 n \n`);
    }

    w.emit('trailer\n');
    // ISO 19005-1 §6.1.3 / ISO 32000-1 §14.4: trailer /ID is required for PDF/A
    // and strongly recommended for all PDFs. For unencrypted PDFs we derive a
    // stable 16-byte ID from the seed string (MD5 of title + creation date)
    // so byte-equal inputs produce byte-equal outputs. Encrypted PDFs reuse
    // the random docId already generated for the encryption key.
    const docId = encState
        ? encState.docId
        : md5(new TextEncoder().encode(`pdfnative|${idSeed}|${totalObjs}`));
    const idArray = buildIdArray(docId);
    if (encState) {
        w.emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R /Encrypt ${encryptObjNum} 0 R /ID ${idArray} >>\n`);
    } else {
        w.emit(`<< /Size ${totalObjs + 1} /Root 1 0 R /Info ${infoObjNum} 0 R /ID ${idArray} >>\n`);
    }
    w.emit('startxref\n');
    w.emit(`${xrefOffset}\n`);
    w.emit('%%EOF');

    return totalObjs;
}
