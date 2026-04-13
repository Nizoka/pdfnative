/**
 * pdfnative — PDF Document Reader
 * ==================================
 * High-level reader that provides lazy object resolution and page access.
 *
 * Usage:
 *   const reader = openPdf(bytes);
 *   const pageCount = reader.pageCount;
 *   const page = reader.getPage(0);
 *   const info = reader.info;
 */

import { createTokenizer } from './pdf-tokenizer.js';
import { parseValue, parseIndirectObject, isDict, isRef, isName, isStream, isArray, dictGetNum, dictGetName } from './pdf-object-parser.js';
import type { PdfValue, PdfDict, PdfRef, PdfStream } from './pdf-object-parser.js';
import { parseXrefTable } from './pdf-xref-parser.js';
import type { XrefTable } from './pdf-xref-parser.js';
import { inflateSync } from './pdf-inflate.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PdfReader {
    /** Total number of pages in the document. */
    readonly pageCount: number;
    /** Document trailer dictionary. */
    readonly trailer: PdfDict;
    /** Raw bytes of the PDF file. */
    readonly bytes: Uint8Array;
    /** Xref table. */
    readonly xref: XrefTable;

    /**
     * Resolve an indirect object reference.
     * Returns the object value, resolving through xref table.
     * Caches resolved objects.
     */
    resolve(ref: PdfRef): PdfValue;

    /**
     * Resolve a value: if it's a ref, resolve it; otherwise return as-is.
     */
    resolveValue(val: PdfValue): PdfValue;

    /**
     * Get the page dictionary for the given page index (0-based).
     */
    getPage(pageIndex: number): PdfDict;

    /**
     * Get all page dictionaries.
     */
    getPages(): PdfDict[];

    /**
     * Get the document catalog dictionary.
     */
    getCatalog(): PdfDict;

    /**
     * Get the document info dictionary, if present.
     */
    getInfo(): PdfDict | null;

    /**
     * Get decoded stream data for a stream object.
     * Handles /FlateDecode and /Filter chains.
     */
    decodeStream(stream: PdfStream): Uint8Array;

    /**
     * Get the raw object at the given object number.
     */
    getObject(num: number): PdfValue | null;
}

// ── Reader Implementation ────────────────────────────────────────────

/**
 * Open a PDF file for reading.
 *
 * @param bytes - Complete PDF file bytes
 * @returns Reader interface for accessing document structure
 */
export function openPdf(bytes: Uint8Array): PdfReader {
    // Parse xref table
    const xref = parseXrefTable(bytes);
    const cache = new Map<number, PdfValue>();

    // Collect pages lazily
    let _pages: PdfDict[] | undefined;

    function resolveRef(ref: PdfRef): PdfValue {
        const key = ref.num;
        if (cache.has(key)) return cache.get(key)!;

        const entry = xref.entries.get(ref.num);
        if (!entry || entry.type === 0) return null; // free object

        let val: PdfValue;
        if (entry.type === 2) {
            // Compressed object — stored in an object stream
            val = resolveCompressedObject(bytes, xref, cache, entry.offset, entry.gen, resolveRef);
        } else {
            // Direct object at byte offset
            val = parseObjectAt(bytes, entry.offset);
        }

        cache.set(key, val);
        return val;
    }

    function resolveValue(val: PdfValue): PdfValue {
        if (isRef(val)) return resolveRef(val);
        return val;
    }

    function getCatalog(): PdfDict {
        const rootRef = xref.trailer.get('Root');
        if (rootRef === undefined) throw new Error('PDF has no /Root in trailer');
        const catalog = resolveValue(rootRef);
        if (!isDict(catalog)) throw new Error('PDF /Root is not a dictionary');
        return catalog;
    }

    function collectPages(): PdfDict[] {
        if (_pages) return _pages;
        const catalog = getCatalog();
        const pagesRef = catalog.get('Pages');
        if (pagesRef === undefined) throw new Error('PDF catalog has no /Pages');
        const pagesDict = resolveValue(pagesRef);
        if (!isDict(pagesDict)) throw new Error('/Pages is not a dictionary');

        _pages = [];
        flattenPageTree(pagesDict, resolveValue, _pages);
        return _pages;
    }

    function getObject(num: number): PdfValue | null {
        const entry = xref.entries.get(num);
        if (!entry || entry.type === 0) return null;
        return resolveRef({ type: 'ref', num, gen: entry.gen });
    }

    function decodeStreamData(stream: PdfStream): Uint8Array {
        let data = stream.data;
        const filterName = dictGetName(stream.dict, 'Filter');
        const filter = stream.dict.get('Filter');

        if (filterName === 'FlateDecode') {
            data = inflateSync(data);
            // Apply predictor if specified
            const decodeParms = stream.dict.get('DecodeParms');
            if (decodeParms !== undefined && isDict(decodeParms)) {
                const predictor = dictGetNum(decodeParms, 'Predictor');
                if (predictor && predictor >= 10) {
                    data = decodePNGPredictor(data, decodeParms);
                }
            }
        } else if (filter !== undefined && isArray(filter)) {
            // Multi-filter chain — apply in order
            for (const f of filter) {
                if (isName(f) && f.value === 'FlateDecode') {
                    data = inflateSync(data);
                }
                // Other filters (ASCII85Decode, etc.) can be added later
            }
        }

        return data;
    }

    return {
        get pageCount() { return collectPages().length; },
        trailer: xref.trailer,
        bytes,
        xref,
        resolve: resolveRef,
        resolveValue,
        getPage(pageIndex: number): PdfDict {
            const pages = collectPages();
            if (pageIndex < 0 || pageIndex >= pages.length) {
                throw new Error(`Page index ${pageIndex} out of range (0-${pages.length - 1})`);
            }
            return pages[pageIndex];
        },
        getPages: collectPages,
        getCatalog,
        getInfo(): PdfDict | null {
            const infoRef = xref.trailer.get('Info');
            if (!infoRef) return null;
            const info = resolveValue(infoRef);
            return isDict(info) ? info : null;
        },
        decodeStream: decodeStreamData,
        getObject,
    };
}

// ── Page Tree Flattener ──────────────────────────────────────────────

function flattenPageTree(
    node: PdfDict,
    resolve: (val: PdfValue) => PdfValue,
    pages: PdfDict[],
): void {
    const type = dictGetName(node, 'Type');
    if (type === 'Page') {
        pages.push(node);
        return;
    }

    // /Pages node — recurse into /Kids
    const kidsVal = node.get('Kids');
    if (kidsVal === undefined || !isArray(kidsVal)) return;
    const kids = kidsVal;

    for (const kid of kids) {
        const childDict = resolve(kid);
        if (isDict(childDict)) {
            flattenPageTree(childDict, resolve, pages);
        }
    }
}

// ── Compressed Object Stream Reader ──────────────────────────────────

function resolveCompressedObject(
    buf: Uint8Array,
    xref: XrefTable,
    _cache: Map<number, PdfValue>,
    streamObjNum: number,
    indexInStream: number,
    _resolveRef: (ref: PdfRef) => PdfValue,
): PdfValue {
    // Get the object stream
    const streamEntry = xref.entries.get(streamObjNum);
    if (!streamEntry || streamEntry.type !== 1) {
        throw new Error(`Object stream ${streamObjNum} not found in xref`);
    }

    const streamObj = parseObjectAt(buf, streamEntry.offset);
    if (!isStream(streamObj)) throw new Error(`Object ${streamObjNum} is not a stream`);

    // Decode stream data
    let data = streamObj.data;
    const filter = dictGetName(streamObj.dict, 'Filter');
    if (filter === 'FlateDecode') {
        data = inflateSync(data);
    }

    // Parse object stream header: pairs of (objNum offset) ...
    const n = dictGetNum(streamObj.dict, 'N') ?? 0;
    const first = dictGetNum(streamObj.dict, 'First') ?? 0;

    const headerTok = createTokenizer(data, 0);
    const objectOffsets: { num: number; offset: number }[] = [];
    for (let i = 0; i < n; i++) {
        const numTok = headerTok.next();
        const offTok = headerTok.next();
        if (!numTok || !offTok) break;
        objectOffsets.push({
            num: numTok.value as number,
            offset: offTok.value as number,
        });
    }

    // Parse the specific object at indexInStream
    if (indexInStream >= objectOffsets.length) {
        throw new Error(`Compressed object index ${indexInStream} out of range`);
    }

    const objEntry = objectOffsets[indexInStream];
    const tok = createTokenizer(data, first + objEntry.offset);
    return parseValue(tok);
}

// ── Object Parser at Offset ──────────────────────────────────────────

function parseObjectAt(buf: Uint8Array, offset: number): PdfValue {
    const tok = createTokenizer(buf, offset);
    const obj = parseIndirectObject(tok);
    return obj ? obj.value : parseValue(tok);
}

// ── PNG Predictor Decoder ────────────────────────────────────────────

function decodePNGPredictor(data: Uint8Array, parms: PdfDict): Uint8Array {
    const columns = dictGetNum(parms, 'Columns') ?? 1;
    const colors = dictGetNum(parms, 'Colors') ?? 1;
    const bpc = dictGetNum(parms, 'BitsPerComponent') ?? 8;

    const bytesPerPixel = Math.max(1, Math.floor(colors * bpc / 8));
    const rowBytes = Math.ceil(columns * colors * bpc / 8);
    const srcRowLen = rowBytes + 1; // +1 for filter byte

    if (data.length < srcRowLen) return data;

    const numRows = Math.floor(data.length / srcRowLen);
    const result = new Uint8Array(numRows * rowBytes);
    const prevRow = new Uint8Array(rowBytes);

    for (let row = 0; row < numRows; row++) {
        const srcOffset = row * srcRowLen;
        const filterType = data[srcOffset];
        const dstOffset = row * rowBytes;

        for (let i = 0; i < rowBytes; i++) {
            const raw = data[srcOffset + 1 + i];
            let val: number;

            switch (filterType) {
                case 0: // None
                    val = raw;
                    break;
                case 1: // Sub
                    val = (raw + (i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0)) & 0xFF;
                    break;
                case 2: // Up
                    val = (raw + prevRow[i]) & 0xFF;
                    break;
                case 3: // Average
                    val = (raw + Math.floor(((i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0) + prevRow[i]) / 2)) & 0xFF;
                    break;
                case 4: { // Paeth
                    const a = i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0;
                    const b = prevRow[i];
                    const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;
                    val = (raw + paethPredictor(a, b, c)) & 0xFF;
                    break;
                }
                default:
                    val = raw;
            }

            result[dstOffset + i] = val;
        }

        // Save current row as previous for next iteration
        prevRow.set(result.subarray(dstOffset, dstOffset + rowBytes));
    }

    return result;
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}
