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
import { md5 } from '../core/pdf-encrypt.js';
import { buildPdfMetadata, buildXMPMetadata, utf8EncodeBinaryString } from '../core/pdf-tags.js';

// ── Types ────────────────────────────────────────────────────────────

/**
 * Metadata fields applied by {@link PdfModifier.updateMetadata}.
 * Only the provided fields are changed; existing /Info entries are kept.
 *
 * @since 1.7.0
 */
export interface PdfMetadataUpdate {
    /** New /Info /Title (mirrored to XMP dc:title when the doc carries XMP). */
    readonly title?: string;
    /** New /Info /Author (mirrored to XMP dc:creator). */
    readonly author?: string;
    /** New /Info /Subject (mirrored to XMP dc:description). */
    readonly subject?: string;
    /** New /Info /Keywords (mirrored to XMP pdf:Keywords). */
    readonly keywords?: string;
    /**
     * Modification instant written to /Info /ModDate (and mirrored to
     * xmp:ModifyDate / xmp:MetadataDate when the doc carries XMP).
     * Defaults to `new Date()` — note that the default makes the output
     * non-deterministic; pass a fixed date for reproducible bytes.
     */
    readonly modDate?: Date;
}

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
     * Update the document information dictionary (and, when present, the
     * XMP metadata packet) via the incremental update.
     *
     * The /Info dictionary is re-issued with the provided fields plus a
     * /ModDate for the modification instant (ISO 32000-1 §14.3.3); when no
     * /Info exists one is created and referenced from the appended trailer.
     * When the catalog carries an XMP `/Metadata` stream, it is re-issued
     * with the same values: `xmp:CreateDate` and the `pdfaid` claim are
     * preserved from the existing packet, `xmp:ModifyDate` /
     * `xmp:MetadataDate` are set to the modification instant so Info↔XMP
     * parity holds (ISO 19005 §6.7.3-style equivalence).
     *
     * @param meta - Fields to set; omitted fields keep their current value.
     */
    updateMetadata(meta: PdfMetadataUpdate): void;

    /**
     * Serialize the modified PDF as Uint8Array.
     * Appends incremental update after the original content.
     *
     * Conformance note: the appended revision always uses a classic xref
     * *table* section, even when the source document's last revision uses a
     * cross-reference *stream*. The resulting mixed chain is valid for
     * readers that dispatch per-offset on the section type (as pdfnative's
     * own parser does, alongside desktop viewers); emitting an `/XRefStm`
     * hybrid section is out of scope.
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

    // Track next object number. Primary source: trailer /Size (ISO 32000-1
    // §7.5.5 — one greater than the highest object number). When /Size is
    // absent, indirect or malformed, fall back to the highest object number
    // present in the parsed xref, so newly allocated numbers never collide
    // with existing objects.
    const size = reader.trailer.get('Size');
    let nextNum: number;
    if (typeof size === 'number' && Number.isInteger(size) && size > 0) {
        nextNum = size;
    } else {
        let maxNum = -1;
        for (const num of reader.xref.entries.keys()) {
            if (num > maxNum) maxNum = num;
        }
        if (maxNum < 0) {
            throw new Error('pdfnative: cannot determine next object number — trailer /Size invalid and xref empty');
        }
        nextNum = maxNum + 1;
    }

    // Object number of an /Info dictionary created by updateMetadata() when
    // the source document has none — referenced from the appended trailer.
    let createdInfoNum: number | null = null;

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

    function updateMetadata(meta: PdfMetadataUpdate): void {
        const modDate = meta.modDate ?? new Date();
        const { pdfDate, xmpDate } = buildPdfMetadata(modDate);

        // ── /Info dictionary (ISO 32000-1 §14.3.3) ───────────────────
        const infoVal = reader.trailer.get('Info');
        const infoRef = isRef(infoVal) ? infoVal : undefined;
        const existing = infoRef !== undefined ? reader.resolveValue(infoRef) : (infoVal ?? null);
        const info: PdfDict = isDict(existing) ? new Map(existing) : new Map();

        if (meta.title !== undefined) info.set('Title', encodeTextValue(meta.title));
        if (meta.author !== undefined) info.set('Author', encodeTextValue(meta.author));
        if (meta.subject !== undefined) info.set('Subject', encodeTextValue(meta.subject));
        if (meta.keywords !== undefined) info.set('Keywords', encodeTextValue(meta.keywords));
        info.set('ModDate', pdfDate);

        if (infoRef !== undefined) {
            setObject(infoRef.num, info);
        } else {
            // No /Info (or a direct dict in the trailer): issue a fresh
            // object and reference it from the appended trailer.
            createdInfoNum = addObject(info);
        }

        // ── XMP resync (keep Info ↔ XMP parity) ──────────────────────
        const mdRef = reader.getCatalog().get('Metadata');
        if (!isRef(mdRef)) return;
        const mdObj = reader.resolveValue(mdRef);
        if (!isStream(mdObj)) return;

        // Preserve the creation instant and the PDF/A claim from the
        // existing packet (pdfnative's own buildXMPMetadata shape, matched
        // tolerantly so foreign packets degrade gracefully).
        const xml = bytesToBinString(reader.decodeStream(mdObj));
        const createMatch = /<xmp:CreateDate>([^<]*)<\/xmp:CreateDate>/.exec(xml);
        const partMatch = /<pdfaid:part>\s*(\d+)\s*<\/pdfaid:part>/.exec(xml);
        const confMatch = /<pdfaid:conformance>\s*([A-Za-z]+)\s*<\/pdfaid:conformance>/.exec(xml);

        const createDate = createMatch !== null ? createMatch[1] : xmpDate;
        const pdfaPart = partMatch !== null ? parseInt(partMatch[1], 10) : 2;
        const pdfaConformance = confMatch !== null ? confMatch[1] : 'B';

        // The rebuilt packet mirrors the FINAL /Info values, whether they
        // came from this call or from the pre-existing dictionary.
        const title = decodeTextValue(info.get('Title')) ?? '';
        const author = decodeTextValue(info.get('Author'));
        const subject = decodeTextValue(info.get('Subject'));
        const keywords = decodeTextValue(info.get('Keywords'));

        const packet = utf8EncodeBinaryString(buildXMPMetadata(
            title, createDate, pdfaPart, pdfaConformance,
            author, subject, keywords,
            xmpDate, xmpDate,
        ));

        // Re-issue the stream uncompressed (PDF/A validator friendliness,
        // same policy as the builders). /Length is set by the serializer;
        // stale /Filter or /DecodeParms entries must not survive.
        const dict: PdfDict = new Map(mdObj.dict);
        dict.delete('Filter');
        dict.delete('DecodeParms');
        dict.delete('DP');
        setObject(mdRef.num, { type: 'stream', dict, data: stringToBytes(packet) });
    }

    function save(): Uint8Array {
        if (modified.size === 0) {
            // No modifications — return original bytes
            return reader.bytes;
        }

        const original = reader.bytes;
        const parts: string[] = [];
        let offset = original.length;

        // §7.5.6: the appended revision must start on its own line. The
        // base writer ends files with `%%EOF` and no trailing EOL, so emit
        // one conditionally; the +1 shift is reflected in `offset`, which
        // seeds every appended object's xref entry below.
        const lastByte = original.length > 0 ? original[original.length - 1] : 0x0A;
        if (lastByte !== 0x0A && lastByte !== 0x0D) {
            parts.push('\n');
            offset += 1;
        }

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

        // Build trailer — the appended content so far (objects + xref)
        // seeds the regenerated second /ID element.
        const startxref = findStartxref(original);
        const trailerStr = buildIncrementalTrailer(
            reader.trailer, nextNum, startxref, parts.join(''), original, createdInfoNum,
        );
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
        updateMetadata,
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
    newSize: number,
    prevXref: number,
    appendedContent: string,
    originalBytes: Uint8Array,
    createdInfoNum: number | null,
): string {
    let result = 'trailer\n<<';

    // Copy relevant keys from original trailer
    const rootRef = originalTrailer.get('Root');
    if (rootRef) result += ` /Root ${serializeValue(rootRef)}`;

    if (createdInfoNum !== null) {
        result += ` /Info ${createdInfoNum} 0 R`;
    } else {
        const infoRef = originalTrailer.get('Info');
        if (infoRef) result += ` /Info ${serializeValue(infoRef)}`;
    }

    // /ID (ISO 32000-1 §14.4): the first element identifies the document
    // permanently and is preserved BYTE-EXACT — it seeds the encryption key
    // derivation, so regenerating it would break decryption. The second
    // element identifies the revision and is regenerated deterministically
    // from the appended content + the original byte length. When the source
    // has no /ID at all, a fresh pair is emitted: md5 of the original bytes
    // as the permanent element, the revision id as the second.
    const revisionId = md5(stringToBytes(appendedContent + String(originalBytes.length)));
    const idArr = originalTrailer.get('ID');
    const id0Hex = isArray(idArr) && typeof idArr[0] === 'string'
        ? binToHex(idArr[0])
        : bytesToHex(md5(originalBytes));
    result += ` /ID [<${id0Hex}> <${bytesToHex(revisionId)}>]`;

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

function bytesToBinString(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

/** Uppercase hex of raw bytes (same style as the base writer's /ID). */
function bytesToHex(bytes: Uint8Array): string {
    let h = '';
    for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, '0');
    return h.toUpperCase();
}

/**
 * Encode a JS string as a PDF text-string VALUE (raw bytes, one char per
 * byte — ISO 32000-1 §7.9.2): ASCII stays as-is (PDFDocEncoding-compatible),
 * anything else becomes UTF-16BE with a BOM. The serializer handles literal
 * escaping / encryption downstream.
 */
function encodeTextValue(text: string): string {
    let ascii = true;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) > 0x7E || text.charCodeAt(i) < 0x20) { ascii = false; break; }
    }
    if (ascii) return text;
    let out = '\xFE\xFF';
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out += String.fromCharCode(c >> 8) + String.fromCharCode(c & 0xFF);
    }
    return out;
}

/**
 * Decode a PDF text-string VALUE back to JS text: UTF-16BE when it carries
 * the `FE FF` BOM, otherwise as-is (PDFDocEncoding ≈ Latin-1 for the common
 * ASCII case). Non-strings yield `undefined`.
 */
function decodeTextValue(val: PdfValue | undefined): string | undefined {
    if (typeof val !== 'string') return undefined;
    if (val.length >= 2 && val.charCodeAt(0) === 0xFE && val.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < val.length; i += 2) {
            out += String.fromCharCode((val.charCodeAt(i) << 8) | val.charCodeAt(i + 1));
        }
        return out;
    }
    return val;
}
