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
import { applyDecodeFilter, KNOWN_DECODE_FILTERS } from './pdf-decode-filters.js';
import { authenticate, decryptObjectValue } from './pdf-decrypt.js';
import type { DecryptionContext } from './pdf-decrypt.js';
import type { PageLabelRange, PageLabelStyle } from '../core/pdf-page-labels.js';

// ── Types ────────────────────────────────────────────────────────────

/**
 * A page annotation parsed by {@link PdfReader.getAnnotations}. Covers the
 * common fields across link, text-markup and drawing annotations; the raw
 * dictionary is available for anything not surfaced here.
 *
 * @since 1.5.0
 */
export interface ParsedAnnotation {
    /** Annotation subtype (`/Subtype`), e.g. `'Link'`, `'Highlight'`, `'Text'`. */
    readonly subtype: string;
    /** Annotation rectangle `[x1, y1, x2, y2]`, or `null` when malformed. */
    readonly rect: readonly [number, number, number, number] | null;
    /** Decoded `/Contents` text (UTF-16BE or PDFDocEncoding), when present. */
    readonly contents?: string;
    /** Decoded author / title (`/T`), when present. */
    readonly title?: string;
    /** Colour components (`/C`), 0–1, when present. */
    readonly color?: readonly number[];
    /** Text-markup quadrilateral points (`/QuadPoints`), when present. */
    readonly quadPoints?: readonly number[];
    /** Target URL for URI-action link annotations, when present. */
    readonly url?: string;
}

/**
 * Options for {@link openPdf}.
 *
 * @since 1.6.0
 */
export interface OpenPdfOptions {
    /**
     * Password for encrypted documents (user or owner — both are tried).
     * Omit (or pass `''`) for documents with an empty user password, which
     * open transparently.
     */
    readonly password?: string;
}

/**
 * Encryption details of an opened document, or `null` when it is not
 * encrypted. Objects returned by the reader are already decrypted.
 *
 * @since 1.6.0
 */
export interface PdfEncryptionInfo {
    /** Content cipher. */
    readonly algorithm: 'rc4-40' | 'rc4-128' | 'aes128' | 'aes256';
    /** Standard Security Handler revision (2, 3, 4 or 6). */
    readonly revision: number;
    /** Which password opened the document. */
    readonly authenticatedAs: 'user' | 'owner';
}

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
     * Encryption details when the document is encrypted (objects are served
     * decrypted), `null` otherwise.
     *
     * @since 1.6.0
     */
    readonly encryption: PdfEncryptionInfo | null;

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
     * Read the document's `/PageLabels` number tree (ISO 32000-1 §12.4.2)
     * back into an ordered list of {@link PageLabelRange}s.
     *
     * Returns `null` when the catalog has no `/PageLabels` entry.
     * The result is the round-trip complement of `buildPageLabelsDict`.
     */
    getPageLabels(): PageLabelRange[] | null;

    /**
     * Read the `/Annots` array of the given page (0-based) and return the
     * parsed annotations (ISO 32000-1 §12.5). Link, text-markup and drawing
     * annotations are surfaced with their common fields; use
     * {@link ParsedAnnotation} for the shape.
     */
    getAnnotations(pageIndex: number): ParsedAnnotation[];

    /**
     * Get the indirect reference of the page at the given index (0-based),
     * or `null` when out of range. Useful for incremental modification
     * (e.g. attaching an annotation via `PdfModifier.addAnnotation`).
     */
    getPageRef(pageIndex: number): PdfRef | null;

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
 * Encrypted documents (Standard Security Handler) are decrypted
 * transparently: pass the password via `options.password` (documents with an
 * empty user password need no password at all). Every object served by the
 * reader is already decrypted.
 *
 * @param bytes - Complete PDF file bytes
 * @param options - Optional `{ password }` for encrypted documents
 * @returns Reader interface for accessing document structure
 * @throws {PdfPasswordError} when the document is encrypted and the password
 *         is missing or wrong
 * @throws {PdfEncryptionUnsupportedError} for unsupported encryption schemes
 */
export function openPdf(bytes: Uint8Array, options?: OpenPdfOptions): PdfReader {
    // Parse xref table
    const xref = parseXrefTable(bytes);
    const cache = new Map<number, PdfValue>();

    // Collect pages lazily
    let _pages: PdfDict[] | undefined;

    // Decryption context — established below, BEFORE any object is resolved
    // through the decrypting path. The /Encrypt dictionary itself and the
    // trailer are exempt from encryption (ISO 32000-1 §7.6.2).
    let decryption: DecryptionContext | null = null;
    let encryptObjNum = -1;

    function resolveRef(ref: PdfRef): PdfValue {
        const key = ref.num;
        if (cache.has(key)) return cache.get(key) ?? null;

        const entry = xref.entries.get(ref.num);
        if (!entry || entry.type === 0) return null; // free object

        let val: PdfValue;
        if (entry.type === 2) {
            // Compressed object — stored in an object stream. The container
            // stream is loaded through resolveRef so it is decrypted (and
            // cached) exactly once; strings inside it are plaintext per spec.
            val = resolveCompressedObject(xref, entry.offset, entry.gen, resolveRef);
        } else {
            // Direct object at byte offset
            val = parseObjectAt(bytes, entry.offset);
            if (decryption && ref.num !== encryptObjNum) {
                val = decryptObjectValue(decryption, val, ref.num, entry.gen);
            }
        }

        cache.set(key, val);
        return val;
    }

    const encryptRef = xref.trailer.get('Encrypt');
    if (encryptRef !== undefined) {
        // Resolve the Encrypt dict with decryption still disabled.
        if (isRef(encryptRef)) encryptObjNum = encryptRef.num;
        const encryptDict = isRef(encryptRef) ? resolveRef(encryptRef) : encryptRef;
        if (isDict(encryptDict)) {
            const idVal = xref.trailer.get('ID');
            let idFirst = new Uint8Array(0);
            if (isArray(idVal) && typeof idVal[0] === 'string') {
                const s = idVal[0];
                idFirst = new Uint8Array(s.length);
                for (let i = 0; i < s.length; i++) idFirst[i] = s.charCodeAt(i) & 0xFF;
            }
            decryption = authenticate(encryptDict, idFirst, options?.password ?? '', v => (isRef(v) ? resolveRef(v) : v));
        }
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

    // Indirect refs of leaf pages, in document order (lazy, cached).
    let _pageRefs: PdfRef[] | undefined;
    function collectPageRefs(): PdfRef[] {
        if (_pageRefs) return _pageRefs;
        const catalog = getCatalog();
        const refs: PdfRef[] = [];
        const walk = (nodeVal: PdfValue, depth: number): void => {
            if (depth > 100) return; // cycle / runaway guard
            const node = resolveValue(nodeVal);
            if (!isDict(node)) return;
            if (dictGetName(node, 'Type') === 'Page') {
                if (isRef(nodeVal)) refs.push(nodeVal);
                return;
            }
            const kids = node.get('Kids');
            if (isArray(kids)) {
                for (const k of kids) walk(k, depth + 1);
            }
        };
        walk(catalog.get('Pages') ?? null, 0);
        _pageRefs = refs;
        return refs;
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
        } else if (filterName !== undefined && KNOWN_DECODE_FILTERS.has(filterName)) {
            // Single non-Flate filter (ASCII85, ASCIIHex, LZW, RunLength).
            data = applyDecodeFilter(filterName, data);
        } else if (filter !== undefined && isArray(filter)) {
            // Multi-filter chain — apply in order. Each filter consumes the
            // output of the previous one.
            for (const f of filter) {
                if (!isName(f)) continue;
                if (f.value === 'FlateDecode') {
                    data = inflateSync(data);
                } else if (KNOWN_DECODE_FILTERS.has(f.value)) {
                    data = applyDecodeFilter(f.value, data);
                }
                // Unknown filters are silently skipped to mirror prior behaviour.
            }
        }

        return data;
    }

    const encryptionInfo: PdfEncryptionInfo | null = decryption
        ? { algorithm: decryption.algorithm, revision: decryption.revision, authenticatedAs: decryption.authenticatedAs }
        : null;

    const reader: PdfReader = {
        get pageCount() { return collectPages().length; },
        trailer: xref.trailer,
        bytes,
        xref,
        encryption: encryptionInfo,
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
        getPageLabels(): PageLabelRange[] | null {
            const catalog = getCatalog();
            const plVal = resolveValue(catalog.get('PageLabels') ?? null);
            if (!isDict(plVal)) return null;

            const entries = new Map<number, PdfValue>();
            collectNumberTree(plVal, resolveValue, entries);
            if (entries.size === 0) return null;

            const ranges: PageLabelRange[] = [];
            for (const startPage of [...entries.keys()].sort((a, b) => a - b)) {
                const dict = resolveValue(entries.get(startPage) ?? null);
                if (!isDict(dict)) continue;

                const range: { -readonly [K in keyof PageLabelRange]: PageLabelRange[K] } = { startPage };
                const sOp = dictGetName(dict, 'S');
                range.style = sOp === undefined ? 'none' : (STYLE_FROM_OP[sOp] ?? 'none');

                const prefix = dict.get('P');
                if (typeof prefix === 'string') range.prefix = prefix;

                const start = dictGetNum(dict, 'St');
                if (start !== undefined) range.start = start;

                ranges.push(range);
            }
            return ranges.length > 0 ? ranges : null;
        },
        getAnnotations(pageIndex: number): ParsedAnnotation[] {
            const pages = collectPages();
            if (pageIndex < 0 || pageIndex >= pages.length) return [];
            const annotsVal = resolveValue(pages[pageIndex].get('Annots') ?? null);
            if (!isArray(annotsVal)) return [];

            const out: ParsedAnnotation[] = [];
            for (const a of annotsVal) {
                const d = resolveValue(a);
                if (!isDict(d)) continue;

                const subtype = dictGetName(d, 'Subtype') ?? '';
                const rectVal = resolveValue(d.get('Rect') ?? null);
                let rect: [number, number, number, number] | null = null;
                if (isArray(rectVal) && rectVal.length === 4 && rectVal.every(n => typeof n === 'number')) {
                    rect = [rectVal[0], rectVal[1], rectVal[2], rectVal[3]] as [number, number, number, number];
                }

                const parsed: {
                    -readonly [K in keyof ParsedAnnotation]: ParsedAnnotation[K]
                } = { subtype, rect };

                const contents = d.get('Contents');
                if (typeof contents === 'string') parsed.contents = decodePdfTextString(contents);
                const title = d.get('T');
                if (typeof title === 'string') parsed.title = decodePdfTextString(title);

                const c = resolveValue(d.get('C') ?? null);
                if (isArray(c)) {
                    const nums = c.filter((x): x is number => typeof x === 'number');
                    if (nums.length > 0) parsed.color = nums;
                }
                const qp = resolveValue(d.get('QuadPoints') ?? null);
                if (isArray(qp)) {
                    parsed.quadPoints = qp.filter((x): x is number => typeof x === 'number');
                }
                const action = resolveValue(d.get('A') ?? null);
                if (isDict(action)) {
                    const uri = action.get('URI');
                    if (typeof uri === 'string') parsed.url = uri;
                }

                out.push(parsed);
            }
            return out;
        },
        getPageRef(pageIndex: number): PdfRef | null {
            const refs = collectPageRefs();
            return pageIndex >= 0 && pageIndex < refs.length ? refs[pageIndex] : null;
        },
        decodeStream: decodeStreamData,
        getObject,
    };

    if (decryption !== null) DECRYPTION_CONTEXTS.set(reader, decryption);
    return reader;
}

// ── Decryption-context access (internal) ─────────────────────────────

const DECRYPTION_CONTEXTS = new WeakMap<PdfReader, DecryptionContext>();

/**
 * The recovered {@link DecryptionContext} of an encrypted reader (carries the
 * file key), or `null` for unencrypted documents.
 *
 * @internal Consumed by the incremental modifier to encrypt appended
 * objects under the document's existing scheme. Deliberately NOT re-exported
 * from the package root — key material stays off the public API surface.
 */
export function getDecryptionContext(reader: PdfReader): DecryptionContext | null {
    return DECRYPTION_CONTEXTS.get(reader) ?? null;
}

// ── Page-Label Number Tree ───────────────────────────────────────────

/**
 * Decode a PDF text string (ISO 32000-1 §7.9.2) that the tokenizer returned as
 * a raw byte string (one JS char per byte). UTF-16BE strings (starting with the
 * `FE FF` BOM) are decoded to their Unicode text; otherwise the string is
 * returned as-is (PDFDocEncoding ≈ Latin-1 for the common ASCII case).
 */
function decodePdfTextString(raw: string): string {
    if (raw.length >= 2 && raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < raw.length; i += 2) {
            out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
        }
        return out;
    }
    return raw;
}

/** Reverse of the `/S` numbering-style operator → {@link PageLabelStyle}. */
const STYLE_FROM_OP: Record<string, PageLabelStyle> = {
    D: 'decimal',
    r: 'roman',
    R: 'Roman',
    a: 'alpha',
    A: 'Alpha',
};

/**
 * Walk a PDF number tree (ISO 32000-1 §7.9.7), collecting every
 * integer-key → value pair from `/Nums` leaves, recursing through `/Kids`.
 */
function collectNumberTree(
    node: PdfDict,
    resolve: (val: PdfValue) => PdfValue,
    out: Map<number, PdfValue>,
): void {
    const nums = resolve(node.get('Nums') ?? null);
    if (isArray(nums)) {
        for (let i = 0; i + 1 < nums.length; i += 2) {
            const key = resolve(nums[i]);
            if (typeof key === 'number') out.set(key, nums[i + 1]);
        }
    }
    const kids = resolve(node.get('Kids') ?? null);
    if (isArray(kids)) {
        for (const kid of kids) {
            const kd = resolve(kid);
            if (isDict(kd)) collectNumberTree(kd, resolve, out);
        }
    }
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
    xref: XrefTable,
    streamObjNum: number,
    indexInStream: number,
    resolveRef: (ref: PdfRef) => PdfValue,
): PdfValue {
    // Get the object stream
    const streamEntry = xref.entries.get(streamObjNum);
    if (!streamEntry || streamEntry.type !== 1) {
        throw new Error(`Object stream ${streamObjNum} not found in xref`);
    }

    // Load the container through resolveRef so that, for encrypted files, its
    // payload is decrypted (and the container cached) exactly once. Object
    // streams are always uncompressed-object-number type-1 entries.
    const streamObj = resolveRef({ type: 'ref', num: streamObjNum, gen: streamEntry.gen });
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
