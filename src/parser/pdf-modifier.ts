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
import type { PdfValue, PdfDict, PdfArray, PdfStream } from './pdf-object-parser.js';
import { isRef, isName, isDict, isArray, isStream } from './pdf-object-parser.js';
import type { XrefEntry } from './pdf-xref-parser.js';
import { findStartxref } from './pdf-xref-parser.js';

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

    function getObject(num: number): PdfValue | null {
        if (modified.has(num)) return modified.get(num)!;
        return reader.getObject(num);
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

            const serialized = serializeObject(num, 0, value);
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
        getObject,
        save,
        get nextObjNum() { return nextNum; },
    };
}

// ── Object Serialization ─────────────────────────────────────────────

function serializeObject(num: number, gen: number, value: PdfValue): string {
    if (isStream(value)) {
        return serializeStreamObject(num, gen, value);
    }
    return `${num} ${gen} obj\n${serializeValue(value)}\nendobj\n\n`;
}

function serializeStreamObject(num: number, gen: number, stream: PdfStream): string {
    // Update /Length in dict
    const dict = new Map(stream.dict);
    dict.set('Length', stream.data.length);

    let result = `${num} ${gen} obj\n`;
    result += serializeDict(dict);
    result += '\nstream\n';
    // Stream data as binary string
    for (let i = 0; i < stream.data.length; i++) {
        result += String.fromCharCode(stream.data[i]);
    }
    result += '\nendstream\nendobj\n\n';
    return result;
}

function serializeValue(val: PdfValue): string {
    if (val === null) return 'null';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (typeof val === 'number') {
        if (Number.isInteger(val)) return String(val);
        return val.toFixed(4).replace(/\.?0+$/, '');
    }
    if (typeof val === 'string') return `(${escapePdfStr(val)})`;
    if (isName(val)) return `/${val.value}`;
    if (isRef(val)) return `${val.num} ${val.gen} R`;
    if (isArray(val)) return serializeArray(val);
    if (isDict(val)) return serializeDict(val);
    if (isStream(val)) return serializeDict(val.dict); // Streams handled at object level
    return 'null';
}

function escapePdfStr(s: string): string {
    return s.replace(/[\\()]/g, c => '\\' + c);
}

function serializeArray(arr: PdfArray): string {
    return '[' + arr.map(serializeValue).join(' ') + ']';
}

function serializeDict(dict: PdfDict): string {
    let s = '<<';
    for (const [key, val] of dict) {
        s += ` /${key} ${serializeValue(val)}`;
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
            const entry = entries.get(num)!;
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
