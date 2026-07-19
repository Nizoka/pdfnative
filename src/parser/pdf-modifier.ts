/**
 * pdfnative — PDF Document Modifier
 * ====================================
 * Modify existing PDF documents using incremental save (ISO 32000-1 §7.5.6).
 *
 * Strategy: append new/modified objects after the existing PDF body,
 * followed by a new xref table and trailer with /Prev pointing to
 * the original xref. This is non-destructive — the original content
 * is preserved byte-for-byte.
 */

import type { PdfReader } from './pdf-reader.js';
import { getDecryptionContext } from './pdf-reader.js';
import type { PdfValue, PdfDict, PdfArray, PdfStream } from './pdf-object-parser.js';
import { isRef, isName, isDict, isArray, isStream, parseValue } from './pdf-object-parser.js';
import type { XrefEntry } from './pdf-xref-parser.js';
import { findStartxref } from './pdf-xref-parser.js';
import { createTokenizer } from './pdf-tokenizer.js';
import type { DecryptionContext } from './pdf-decrypt.js';
import { encryptStringData, encryptStreamData, isSignatureDict, isExemptStream } from './pdf-decrypt.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PdfModifier {
    /** The underlying reader. */
    readonly reader: PdfReader;

    /**
     * Replace an existing object (by object number).
     * The new value will be written in the incremental update.
     */
    setObject(num: number, value: PdfValue): void;

    /**
     * Allocate a new object number and set its value.
     * Returns the new object number.
     */
    addObject(value: PdfValue): number;

    /**
     * Allocate a new object number whose body is emitted **verbatim**
     * between `num gen obj` and `endobj`. The caller is responsible
     * for the body's PDF syntactic validity — used for objects that
     * need an exact byte layout the PdfValue serialiser cannot
     * express (e.g. signature `/Sig` dictionaries whose
     * `/Contents <00…>` and `/ByteRange [0 …]` placeholders must be
     * preserved byte-for-byte for `signPdfBytes()` to patch them).
     *
     * Returns the new object number.
     */
    addRawObject(body: string): number;

    /**
     * Attach an annotation to a page's `/Annots` array via incremental update.
     *
     * The annotation dictionary body (`<< /Type /Annot … >>`, without the
     * `obj`/`endobj` wrapper — as produced by `buildAnnotationBody`) is added
     * as a new object, and the target page dictionary is rewritten with the
     * new reference appended to its `/Annots` array (created if absent).
     *
     * @param pageIndex      0-based page index.
     * @param annotationBody The annotation dictionary string.
     * @returns The new annotation object number.
     * @throws Error when `pageIndex` is out of range.
     */
    addAnnotation(pageIndex: number, annotationBody: string): number;

    /**
     * Get the current value of an object (modified or original).
     */
    getObject(num: number): PdfValue | null;

    /**
     * Serialize the modified PDF as Uint8Array.
     * Appends incremental update after the original content.
     */
    save(): Uint8Array;

    /**
     * Get the next available object number.
     */
    readonly nextObjNum: number;
}

// ── Modifier Implementation ──────────────────────────────────────────

/**
 * Create a modifier for an existing PDF document.
 *
 * @param reader - Opened PDF reader
 * @returns Modifier interface for incremental updates
 */
export function createModifier(reader: PdfReader): PdfModifier {
    const modified = new Map<number, PdfValue>();
    const rawBodies = new Map<number, string>();

    // Recovered decryption context of an encrypted source (null otherwise).
    // The reader serves objects DECRYPTED, so everything in `modified` is
    // plaintext; save() re-encrypts appended objects under the document's
    // existing scheme (same /Encrypt dict, same file key — no downgrade or
    // upgrade is possible by construction).
    const encCtx = getDecryptionContext(reader);

    // Track next object number (from trailer /Size)
    const size = reader.trailer.get('Size');
    let nextNum = typeof size === 'number' ? size : 1;

    function setObject(num: number, value: PdfValue): void {
        modified.set(num, value);
    }

    function addObject(value: PdfValue): number {
        const num = nextNum++;
        modified.set(num, value);
        return num;
    }

    function addRawObject(body: string): number {
        if (encCtx !== null) {
            throw new Error(
                'pdfnative: addRawObject cannot be used on an encrypted document — a verbatim body ' +
                'cannot be transparently encrypted without breaking its byte layout. Use addObject ' +
                'with a structured value instead.',
            );
        }
        const num = nextNum++;
        rawBodies.set(num, body);
        // Sentinel: insert null so the iteration order in save() is
        // preserved and the raw body is emitted in its allocation
        // slot. The save() loop checks rawBodies first.
        modified.set(num, null);
        return num;
    }

    function getObject(num: number): PdfValue | null {
        if (modified.has(num)) return modified.get(num) ?? null;
        return reader.getObject(num);
    }

    function addAnnotation(pageIndex: number, annotationBody: string): number {
        const pageRef = reader.getPageRef(pageIndex);
        if (!pageRef) throw new Error(`addAnnotation: no page at index ${pageIndex}`);

        // Unencrypted: emit the body verbatim (byte-stable with ≤ v1.5.0).
        // Encrypted: parse it into a structured value so save()'s encrypting
        // serializer can protect its strings.
        let objNum: number;
        if (encCtx === null) {
            objNum = addRawObject(annotationBody);
        } else {
            const parsed = parseValue(createTokenizer(stringToBytes(annotationBody)));
            if (!isDict(parsed)) {
                throw new Error('addAnnotation: annotation body did not parse to a dictionary');
            }
            objNum = addObject(parsed);
        }

        const page = getObject(pageRef.num);
        if (!isDict(page)) throw new Error(`addAnnotation: page ${pageIndex} is not a dictionary`);

        const clone: PdfDict = new Map(page);
        const existing = clone.get('Annots');
        const resolved = isRef(existing) ? reader.resolveValue(existing) : existing;
        const annots: PdfArray = isArray(resolved) ? [...resolved] : [];
        annots.push({ type: 'ref', num: objNum, gen: 0 });
        clone.set('Annots', annots);
        setObject(pageRef.num, clone);

        return objNum;
    }

    function save(): Uint8Array {
        if (modified.size === 0) {
            // No modifications — return original bytes
            return reader.bytes;
        }

        const original = reader.bytes;
        const parts: string[] = [];
        let offset = original.length;

        // Ensure original ends cleanly
        parts.push('');

        // New xref entries
        const newEntries = new Map<number, XrefEntry>();

        // Serialize modified objects
        for (const [num, value] of modified) {
            const objOffset = offset;

            const rawBody = rawBodies.get(num);
            const serialized = rawBody !== undefined
                ? `${num} 0 obj\n${rawBody}\nendobj\n\n`
                : serializeObject(num, 0, value, encCtx ?? undefined);
            parts.push(serialized);
            offset += byteLength(serialized);

            newEntries.set(num, { offset: objOffset, gen: 0, type: 1 });
        }

        // Build xref table
        const xrefOffset = offset;
        const xrefStr = buildIncrementalXref(newEntries, nextNum);
        parts.push(xrefStr);
        offset += byteLength(xrefStr);

        // Build trailer
        const startxref = findStartxref(original);
        const trailerStr = buildIncrementalTrailer(reader.trailer, newEntries, nextNum, startxref);
        parts.push(trailerStr);
        offset += byteLength(trailerStr);

        // startxref
        parts.push(`startxref\n${xrefOffset}\n%%EOF\n`);

        // Concatenate original + incremental parts
        const appendStr = parts.join('');
        const appendBytes = stringToBytes(appendStr);

        const result = new Uint8Array(original.length + appendBytes.length);
        result.set(original, 0);
        result.set(appendBytes, original.length);

        return result;
    }

    return {
        reader,
        setObject,
        addObject,
        addRawObject,
        addAnnotation,
        getObject,
        save,
        get nextObjNum() { return nextNum; },
    };
}

// ── Object Serialization ─────────────────────────────────────────────

/**
 * Encryption context threaded through serialization when appending to an
 * encrypted document. The serializers build strings only — they NEVER
 * mutate the input value tree, which may share sub-objects with the
 * reader's decrypted cache (shallow clones), so a second save() call
 * still sees plaintext and encrypt-exactly-once holds.
 */
interface SerializeEnc {
    readonly ctx: DecryptionContext;
    readonly num: number;
    readonly gen: number;
}

function serializeObject(num: number, gen: number, value: PdfValue, encCtx?: DecryptionContext): string {
    const enc: SerializeEnc | undefined = encCtx !== undefined ? { ctx: encCtx, num, gen } : undefined;
    if (isStream(value)) {
        return serializeStreamObject(num, gen, value, enc);
    }
    return `${num} ${gen} obj\n${serializeValue(value, enc)}\nendobj\n\n`;
}

function serializeStreamObject(num: number, gen: number, stream: PdfStream, enc?: SerializeEnc): string {
    // Encrypt the payload unless the stream is exempt (XRef, unencrypted
    // Metadata, /Crypt-filtered — ISO 32000-1 §7.6.2). /Length reflects
    // the ciphertext.
    const payload = enc !== undefined && !isExemptStream(stream.dict, enc.ctx)
        ? encryptStreamData(enc.ctx, stream.data, num, gen)
        : stream.data;

    // Update /Length in dict
    const dict = new Map(stream.dict);
    dict.set('Length', payload.length);

    let result = `${num} ${gen} obj\n`;
    result += serializeDict(dict, enc);
    result += '\nstream\n';
    // Stream data as binary string
    for (let i = 0; i < payload.length; i++) {
        result += String.fromCharCode(payload[i]);
    }
    result += '\nendstream\nendobj\n\n';
    return result;
}

function serializeValue(val: PdfValue, enc?: SerializeEnc, skipStrings = false): string {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return String(val);
        return val.toFixed(4).replace(/\.?0+$/, '');
    }
    if (typeof val === 'string') {
        // Encrypted strings are emitted as hex (`<…>`): literal-string EOL
        // normalisation would corrupt the ciphertext.
        if (enc !== undefined && !skipStrings) {
            return `<${binToHex(encryptStringData(enc.ctx, val, enc.num, enc.gen))}>`;
        }
        return `(${escapePdfStr(val)})`;
    }
    if (isName(val)) return `/${val.value}`;
    if (isRef(val)) return `${val.num} ${val.gen} R`;
    if (isArray(val)) return serializeArray(val, enc, skipStrings);
    if (isDict(val)) return serializeDict(val, enc, skipStrings);
    if (isStream(val)) return serializeDict(val.dict, enc, skipStrings); // Streams handled at object level
    return 'null';
}

/** Escape PDF special characters (backslash, parentheses) in string literals. */
function escapePdfStr(s: string): string {
    return s.replace(/[\\()]/g, c => '\\' + c);
}

/** Uppercase hex of a raw-binary string. */
function binToHex(s: string): string {
    let h = '';
    for (let i = 0; i < s.length; i++) h += (s.charCodeAt(i) & 0xFF).toString(16).padStart(2, '0');
    return h.toUpperCase();
}

function serializeArray(arr: PdfArray, enc?: SerializeEnc, skipStrings = false): string {
    return '[' + arr.map(v => serializeValue(v, enc, skipStrings)).join(' ') + ']';
}

function serializeDict(dict: PdfDict, enc?: SerializeEnc, skipStrings = false): string {
    // Signature /Contents holds the raw CMS blob and is written outside
    // encryption so /ByteRange stays valid (§7.6.2 note 3).
    const sig = enc !== undefined && isSignatureDict(dict);
    let s = '<<';
    for (const [key, val] of dict) {
        const skip = skipStrings || (sig && key === 'Contents');
        s += ` /${key} ${serializeValue(val, enc, skip)}`;
    }
    s += ' >>';
    return s;
}

// ── Incremental Xref Table ───────────────────────────────────────────

function buildIncrementalXref(entries: Map<number, XrefEntry>, _size: number): string {
    // Group consecutive object numbers into subsections
    const sorted = [...entries.keys()].sort((a, b) => a - b);
    if (sorted.length === 0) return 'xref\n0 0\n';

    let result = 'xref\n';

    let i = 0;
    while (i < sorted.length) {
        const start = sorted[i];
        let end = start;
        while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
            i++;
            end = sorted[i];
        }
        const count = end - start + 1;
        result += `${start} ${count}\n`;

        for (let num = start; num <= end; num++) {
            const entry = entries.get(num) ?? { offset: 0, gen: 0, type: 1 as const };
            const offsetStr = String(entry.offset).padStart(10, '0');
            const genStr = String(entry.gen).padStart(5, '0');
            result += `${offsetStr} ${genStr} n \n`;
        }
        i++;
    }

    return result;
}

function buildIncrementalTrailer(
    originalTrailer: PdfDict,
    _newEntries: Map<number, XrefEntry>,
    newSize: number,
    prevXref: number,
): string {
    let result = 'trailer\n<<';

    // Copy relevant keys from original trailer
    const rootRef = originalTrailer.get('Root');
    if (rootRef) result += ` /Root ${serializeValue(rootRef)}`;

    const infoRef = originalTrailer.get('Info');
    if (infoRef) result += ` /Info ${serializeValue(infoRef)}`;

    const idArr = originalTrailer.get('ID');
    if (idArr) result += ` /ID ${serializeValue(idArr)}`;

    // Carry /Encrypt forward: the appended revision is read under the same
    // scheme as the original (required for encrypted incremental updates;
    // previously dropped, which broke any encrypted append).
    const encryptRef = originalTrailer.get('Encrypt');
    if (encryptRef) result += ` /Encrypt ${serializeValue(encryptRef)}`;

    result += ` /Size ${newSize}`;
    result += ` /Prev ${prevXref}`;
    result += ' >>\n';

    return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

function byteLength(str: string): number {
    // Each char in our binary string is 1 byte (Latin-1 encoding)
    return str.length;
}

function stringToBytes(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF;
    }
    return bytes;
}
