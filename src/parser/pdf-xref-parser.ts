/**
 * pdfnative — PDF Cross-Reference Table Parser
 * ===============================================
 * Parses traditional xref tables and xref streams (ISO 32000-1 §7.5).
 *
 * Supports:
 *   - Traditional xref table + trailer
 *   - Cross-reference streams (/Type /XRef)
 *   - Incremental updates via /Prev chains
 *   - startxref locator
 */

import { createTokenizer } from './pdf-tokenizer.js';
import { parseValue, isDict, dictGetName } from './pdf-object-parser.js';
import type { PdfDict, PdfValue, PdfRef } from './pdf-object-parser.js';
import { inflateSync } from './pdf-inflate.js';

// ── Types ────────────────────────────────────────────────────────────

export interface XrefEntry {
    readonly offset: number;  // Byte offset in file (type 1) or object number of containing stream (type 2)
    readonly gen: number;     // Generation number (type 1) or index within stream (type 2)
    readonly type: 0 | 1 | 2; // 0=free, 1=in-use, 2=compressed (xref stream)
}

export interface XrefTable {
    /** Map from object number to xref entry. Later entries override earlier ones. */
    readonly entries: Map<number, XrefEntry>;
    /** Merged trailer dictionary (last trailer wins for each key). */
    readonly trailer: PdfDict;
}

// ── startxref Locator ────────────────────────────────────────────────

/**
 * Find the startxref offset from the end of the PDF file.
 * Scans backwards for 'startxref' keyword (ISO 32000-1 §7.5.5).
 *
 * @param buf - PDF file bytes
 * @returns Byte offset of the xref section
 */
export function findStartxref(buf: Uint8Array): number {
    // Search from the end of file, within last 1024 bytes
    const searchStart = Math.max(0, buf.length - 1024);
    const tail = latin1(buf, searchStart, buf.length);
    const idx = tail.lastIndexOf('startxref');
    if (idx === -1) throw new Error('xref: startxref not found');

    // Extract the offset number after 'startxref'
    const after = tail.substring(idx + 9).trim();
    const match = after.match(/^(\d+)/);
    if (!match) throw new Error('xref: invalid startxref offset');
    return parseInt(match[1], 10);
}

// ── Traditional xref Table Parser ────────────────────────────────────

/**
 * Parse a traditional xref table starting at the given offset.
 *
 * @param buf - PDF file bytes
 * @param offset - Byte offset of 'xref' keyword
 * @returns Parsed entries and trailer dict
 */
function parseTraditionalXref(buf: Uint8Array, offset: number): { entries: Map<number, XrefEntry>; trailer: PdfDict } {
    const entries = new Map<number, XrefEntry>();

    // Verify 'xref' keyword
    const kw = latin1(buf, offset, offset + 4);
    if (kw !== 'xref') throw new Error(`xref: expected 'xref' at offset ${offset}, got '${kw}'`);

    let pos = offset + 4;
    // Skip whitespace
    while (pos < buf.length && (buf[pos] === 0x0A || buf[pos] === 0x0D || buf[pos] === 0x20)) pos++;

    // Parse subsections
    while (pos < buf.length) {
        // Check if we've reached 'trailer'
        if (buf[pos] === 0x74) { // 't' for 'trailer'
            const word = latin1(buf, pos, pos + 7);
            if (word === 'trailer') break;
        }

        // Read subsection header: firstObj numEntries
        const headerLine = readLine(buf, pos);
        pos += headerLine.length + 1;
        const headerParts = headerLine.trim().split(/\s+/);
        if (headerParts.length < 2) throw new Error(`xref: invalid subsection header at offset ${pos}`);

        const firstObj = parseInt(headerParts[0], 10);
        const numEntries = parseInt(headerParts[1], 10);

        // Read entries (each is exactly 20 bytes: "OOOOOOOOOO GGGGG X \n")
        for (let i = 0; i < numEntries; i++) {
            // Skip leading whitespace
            while (pos < buf.length && (buf[pos] === 0x0A || buf[pos] === 0x0D)) pos++;

            const entryLine = readLine(buf, pos);
            pos += entryLine.length + 1;
            const entryStr = entryLine.trim();
            if (entryStr.length < 17) continue;

            const entryOffset = parseInt(entryStr.substring(0, 10), 10);
            const entryGen = parseInt(entryStr.substring(11, 16), 10);
            const entryType = entryStr.charAt(17);

            const objNum = firstObj + i;
            if (entryType === 'n') {
                entries.set(objNum, { offset: entryOffset, gen: entryGen, type: 1 });
            } else if (entryType === 'f') {
                entries.set(objNum, { offset: entryOffset, gen: entryGen, type: 0 });
            }
        }
    }

    // Parse trailer dictionary
    const tok = createTokenizer(buf, pos);
    const trailerKw = tok.next();
    if (!trailerKw || trailerKw.value !== 'trailer') {
        throw new Error('xref: expected trailer keyword');
    }
    const trailerVal = parseValue(tok);
    if (!isDict(trailerVal)) throw new Error('xref: trailer must be a dictionary');

    return { entries, trailer: trailerVal };
}

// ── Cross-Reference Stream Parser ────────────────────────────────────

/**
 * Parse a cross-reference stream object at the given offset.
 *
 * @param buf - PDF file bytes
 * @param offset - Byte offset of the xref stream object
 * @returns Parsed entries and trailer dict (the stream dictionary is the trailer)
 */
function parseXrefStream(buf: Uint8Array, offset: number): { entries: Map<number, XrefEntry>; trailer: PdfDict } {
    const tok = createTokenizer(buf, offset);
    const numTok = tok.next();
    const genTok = tok.next();
    const objTok = tok.next();

    if (!numTok || !genTok || !objTok || objTok.value !== 'obj') {
        throw new Error(`xref stream: invalid object header at offset ${offset}`);
    }

    const val = parseValue(tok);
    if (!val || typeof val !== 'object' || !('type' in val) || val.type !== 'stream') {
        throw new Error('xref stream: expected stream object');
    }

    const dict = val.dict;
    const typeVal = dictGetName(dict, 'Type');
    if (typeVal !== 'XRef') throw new Error('xref stream: /Type must be /XRef');

    // Decode stream data
    let streamData = val.data;
    const filterName = dictGetName(dict, 'Filter');
    if (filterName === 'FlateDecode') {
        streamData = inflateSync(streamData);
    }

    // Parse /W array (field widths)
    const wArr = dict.get('W');
    if (!Array.isArray(wArr) || wArr.length < 3) throw new Error('xref stream: invalid /W array');
    const w = wArr.map(Number);

    // Parse /Size
    const size = Number(dict.get('Size'));

    // Parse /Index array (default: [0 Size])
    const indexArr = dict.get('Index');
    const index: number[] = Array.isArray(indexArr)
        ? indexArr.map(Number)
        : [0, size];

    const entries = new Map<number, XrefEntry>();
    const rowSize = w[0] + w[1] + w[2];
    let dataPos = 0;

    for (let s = 0; s < index.length; s += 2) {
        const first = index[s];
        const count = index[s + 1];

        for (let i = 0; i < count; i++) {
            if (dataPos + rowSize > streamData.length) break;

            const type = w[0] > 0 ? readFieldValue(streamData, dataPos, w[0]) : 1;
            dataPos += w[0];
            const field2 = readFieldValue(streamData, dataPos, w[1]);
            dataPos += w[1];
            const field3 = readFieldValue(streamData, dataPos, w[2]);
            dataPos += w[2];

            entries.set(first + i, {
                offset: field2,
                gen: field3,
                type: type as 0 | 1 | 2,
            });
        }
    }

    return { entries, trailer: dict };
}

function readFieldValue(data: Uint8Array, offset: number, width: number): number {
    let val = 0;
    for (let i = 0; i < width; i++) {
        val = (val << 8) | data[offset + i];
    }
    return val;
}

// ── Full xref Chain Parser ───────────────────────────────────────────

/**
 * Maximum depth of the xref `/Prev` chain.
 * Prevents CPU-exhaustion DoS from PDFs with excessively chained incremental
 * updates (CWE-400: Uncontrolled Resource Consumption). Legitimate PDFs
 * rarely have more than a handful of incremental updates.
 */
export const MAX_XREF_CHAIN = 100;

/**
 * Parse the complete xref table including incremental updates (via /Prev chain).
 *
 * @param buf - PDF file bytes
 * @returns Merged xref table with all entries and trailer
 */
export function parseXrefTable(buf: Uint8Array): XrefTable {
    const startxref = findStartxref(buf);
    return parseXrefChain(buf, startxref);
}

/**
 * Parse xref chain starting from the given offset, following /Prev pointers.
 */
function parseXrefChain(buf: Uint8Array, startOffset: number): XrefTable {
    const allEntries = new Map<number, XrefEntry>();
    let mergedTrailer: PdfDict = new Map();
    let offset: number | undefined = startOffset;
    const visited = new Set<number>();
    let chainCount = 0;

    // Follow /Prev chain (newest first)
    const trailers: PdfDict[] = [];

    while (offset !== undefined) {
        if (chainCount++ >= MAX_XREF_CHAIN) {
            throw new Error(`xref: /Prev chain exceeds maximum depth of ${MAX_XREF_CHAIN}`);
        }
        if (visited.has(offset)) {
            throw new Error(`xref: cycle detected at offset ${offset}`);
        }
        visited.add(offset);

        let result: { entries: Map<number, XrefEntry>; trailer: PdfDict };

        // Detect xref type: traditional starts with 'xref', streams start with object number
        const firstByte = buf[offset];
        if (firstByte >= 0x30 && firstByte <= 0x39) {
            // Starts with a digit — xref stream
            result = parseXrefStream(buf, offset);
        } else {
            // Traditional xref table
            result = parseTraditionalXref(buf, offset);
        }

        trailers.push(result.trailer);

        // Merge entries (don't overwrite — first occurrence (newest) wins)
        for (const [num, entry] of result.entries) {
            if (!allEntries.has(num)) {
                allEntries.set(num, entry);
            }
        }

        // Follow /Prev chain
        const prev = result.trailer.get('Prev');
        offset = typeof prev === 'number' ? prev : undefined;
    }

    // Merge trailers (first/newest wins for each key)
    mergedTrailer = new Map();
    for (const t of trailers) {
        for (const [key, val] of t) {
            if (!mergedTrailer.has(key)) {
                mergedTrailer.set(key, val);
            }
        }
    }

    return { entries: allEntries, trailer: mergedTrailer };
}

// ── Helpers ──────────────────────────────────────────────────────────

function latin1(buf: Uint8Array, start: number, end: number): string {
    let s = '';
    for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return s;
}

function readLine(buf: Uint8Array, start: number): string {
    let end = start;
    while (end < buf.length && buf[end] !== 0x0A && buf[end] !== 0x0D) end++;
    return latin1(buf, start, end);
}

// ── Exported Helpers ─────────────────────────────────────────────────

export function getTrailerValue(trailer: PdfDict, key: string): PdfValue | undefined {
    return trailer.get(key);
}

export function getTrailerRef(trailer: PdfDict, key: string): PdfRef | undefined {
    const v = trailer.get(key);
    if (v && typeof v === 'object' && 'type' in v && v.type === 'ref') return v;
    return undefined;
}
