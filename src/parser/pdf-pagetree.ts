/**
 * pdfnative — Page-Tree Manipulation API (ISO 32000-1 §7.7.3)
 * ============================================================
 * Safe, **faithful** page-level document assembly: merge, split, and
 * extract pages across PDF documents.
 *
 * Unlike the incremental modifier (`createModifier`), these operations
 * **rebuild** a brand-new document from scratch: every kept page and its
 * transitive object graph (`/Contents`, `/Resources`, fonts, XObjects,
 * ExtGState, …) is deep-copied into a fresh, contiguous object-number
 * space, then wired into a new flat `/Pages` tree, `/Catalog`, xref, and
 * trailer. This avoids production-unsafe in-place surgery (relocating
 * `/Kids`, rewriting `/Parent` chains, merging resource pools).
 *
 * Safety guarantees (documented behaviour):
 *  - **Encrypted sources are rejected** (no Standard Security Handler
 *    writer yet) — throws.
 *  - **Signatures are always removed** — any page-tree edit invalidates a
 *    document signature's `/ByteRange`, so signature/Widget annotations and
 *    the `/AcroForm` are dropped. The `dropSignatures` flag is accepted for
 *    API clarity but the behaviour is unconditional.
 *  - **Annotations** default to URI-`/Link`-only (self-contained). Cross-page
 *    GoTo links and form widgets are dropped to guarantee no dangling
 *    references. `dropAnnotations: true` removes all annotations.
 *  - Output is **not** claimed to be PDF/A — merged OutputIntents / XMP
 *    cannot be reconciled safely.
 *
 * @since 1.4.0
 */

import { openPdf } from './pdf-reader.js';
import type { PdfReader } from './pdf-reader.js';
import {
    isRef, isName, isDict, isArray, isStream, dictGetName,
} from './pdf-object-parser.js';
import type { PdfValue, PdfDict, PdfStream } from './pdf-object-parser.js';
import { md5 } from '../core/pdf-encrypt.js';

// ── Public types ─────────────────────────────────────────────────────

/** A contiguous, inclusive page range (0-based). */
export interface PageRange {
    /** First page index (0-based, inclusive). */
    readonly start: number;
    /** Last page index (0-based, inclusive). Defaults to `start`. */
    readonly end?: number;
}

/**
 * Options for the page-tree manipulation API ({@link mergePdfs},
 * {@link splitPdf}, {@link extractPages}).
 */
export interface MergeOptions {
    /**
     * Drop signature fields/widgets. Accepted for clarity; merging always
     * removes signatures because the operation invalidates `/ByteRange`.
     */
    readonly dropSignatures?: boolean;
    /** Drop **all** annotations (default keeps self-contained URI links). */
    readonly dropAnnotations?: boolean;
    /**
     * Maximum size, in bytes, of the assembled output document. The operation
     * throws as soon as the copied object graph would exceed this limit — even
     * mid-copy, before a multi-gigabyte stream is materialised — so a malicious
     * or accidentally huge source cannot exhaust process memory.
     *
     * Defaults to `268435456` (256 MiB). Pass `Infinity` to disable the guard
     * (not recommended for untrusted input).
     *
     * @defaultValue 268435456 (256 MiB)
     */
    readonly maxOutputSize?: number;
}

const MAX_MERGE_SOURCES = 50;
const DEFAULT_MEDIA_BOX = '[0 0 612 792]'; // US Letter fallback
const INHERITABLE_KEYS = ['MediaBox', 'CropBox', 'Rotate'] as const;
/**
 * Maximum object-graph traversal depth during a copy. Guards against stack
 * overflow from pathologically deep nesting or long indirect-reference chains
 * in a malformed/adversarial source (the parser caps per-object nesting at
 * 1000; this bounds the combined ref-hop + nesting recursion).
 */
const MAX_COPY_DEPTH = 2000;
/**
 * Default output-size ceiling (256 MiB). Bounds total memory committed to the
 * assembled document so an adversarial source PDF cannot trigger an OOM. Tune
 * via {@link MergeOptions.maxOutputSize}.
 */
const DEFAULT_MAX_OUTPUT_SIZE = 256 * 1024 * 1024;

/**
 * Validate a caller-supplied `maxOutputSize`, returning the effective limit.
 * Accepts a finite positive number or `Infinity`; rejects everything else.
 */
function resolveMaxOutputSize(value: number | undefined): number {
    if (value === undefined) return DEFAULT_MAX_OUTPUT_SIZE;
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
        throw new Error(
            `maxOutputSize must be a positive number or Infinity (got ${String(value)})`,
        );
    }
    return value;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Concatenate multiple PDF documents into one, preserving page order.
 *
 * @param sources 1–50 PDF byte arrays.
 * @param opts    See {@link MergeOptions}.
 * @returns A new, self-contained PDF.
 * @throws If `sources` is empty/too large, or any source is encrypted.
 */
export function mergePdfs(sources: readonly Uint8Array[], opts?: MergeOptions): Uint8Array {
    if (sources.length === 0) throw new Error('mergePdfs requires at least one source PDF');
    if (sources.length > MAX_MERGE_SOURCES) {
        throw new Error(`mergePdfs supports at most ${MAX_MERGE_SOURCES} sources (got ${sources.length})`);
    }
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early, before any I/O
    const specs: PageSpec[] = [];
    for (const src of sources) {
        const reader = openPdf(src);
        assertNotEncrypted(reader);
        const count = reader.pageCount;
        for (let i = 0; i < count; i++) specs.push({ reader, pageIndex: i });
    }
    return assemble(specs, opts ?? {});
}

/**
 * Extract a subset of pages from a single document into a new PDF.
 * Indices may repeat and need not be ordered — output follows the given order.
 *
 * @param src         Source PDF bytes.
 * @param pageIndices 0-based page indices to keep.
 * @param opts        See {@link MergeOptions} (e.g. `maxOutputSize`,
 *                    `dropAnnotations`).
 * @throws If `src` is encrypted, indices is empty, or an index is out of range.
 */
export function extractPages(
    src: Uint8Array,
    pageIndices: readonly number[],
    opts?: MergeOptions,
): Uint8Array {
    if (pageIndices.length === 0) throw new Error('extractPages requires at least one page index');
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early
    const reader = openPdf(src);
    assertNotEncrypted(reader);
    const count = reader.pageCount;
    const specs: PageSpec[] = [];
    for (const idx of pageIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
            throw new Error(`extractPages page index ${idx} out of range (0-${count - 1})`);
        }
        specs.push({ reader, pageIndex: idx });
    }
    return assemble(specs, opts ?? {});
}

/**
 * Split a document into multiple PDFs, one per page range.
 *
 * @param src    Source PDF bytes.
 * @param ranges Inclusive 0-based page ranges.
 * @param opts   See {@link MergeOptions} (e.g. `maxOutputSize`,
 *               `dropAnnotations`); applied to every emitted document.
 * @returns One PDF per range, in order.
 * @throws If `src` is encrypted, ranges is empty, or a range is invalid.
 */
export function splitPdf(
    src: Uint8Array,
    ranges: readonly PageRange[],
    opts?: MergeOptions,
): Uint8Array[] {
    if (ranges.length === 0) throw new Error('splitPdf requires at least one range');
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early
    const reader = openPdf(src);
    assertNotEncrypted(reader);
    const count = reader.pageCount;
    const out: Uint8Array[] = [];
    for (const range of ranges) {
        const start = range.start | 0;
        const end = (range.end ?? range.start) | 0;
        if (start < 0 || end < start || end >= count) {
            throw new Error(`splitPdf range [${start}, ${end}] invalid for ${count}-page document`);
        }
        const specs: PageSpec[] = [];
        for (let i = start; i <= end; i++) specs.push({ reader, pageIndex: i });
        out.push(assemble(specs, opts ?? {}));
    }
    return out;
}

// ── Internals ────────────────────────────────────────────────────────

interface PageSpec {
    readonly reader: PdfReader;
    readonly pageIndex: number;
}

function assertNotEncrypted(reader: PdfReader): void {
    if (reader.trailer.get('Encrypt') !== undefined) {
        throw new Error('Encrypted PDFs are not supported by the page-tree API (decrypt first)');
    }
}

/**
 * Resolve an inheritable page attribute (§7.7.3.4) by walking the `/Parent`
 * chain. Returns the first defined value or `undefined`.
 */
function resolveInherited(reader: PdfReader, page: PdfDict, key: string): PdfValue | undefined {
    let node: PdfDict | undefined = page;
    const seen = new Set<PdfDict>();
    while (node && !seen.has(node)) {
        seen.add(node);
        const v = node.get(key);
        if (v !== undefined) return v;
        const parent = node.get('Parent');
        if (parent === undefined) break;
        const resolved = reader.resolveValue(parent);
        node = isDict(resolved) ? resolved : undefined;
    }
    return undefined;
}

/** Build a new PDF from an ordered list of source pages. */
function assemble(specs: PageSpec[], opts: MergeOptions): Uint8Array {
    // Object numbers: 1 = Catalog, 2 = Pages root, 3.. = pages + graph.
    const ctx: CopyCtx = {
        nextNum: 3,
        bodies: new Map<number, string>(),
        memo: new Map<PdfReader, Map<number, number>>(),
        maxOutputSize: resolveMaxOutputSize(opts.maxOutputSize),
        totalBytes: 0,
    };

    const pageNums: number[] = [];
    for (const spec of specs) {
        pageNums.push(copyPage(ctx, spec, opts));
    }

    // Pages root + Catalog.
    const kids = pageNums.map(n => `${n} 0 R`).join(' ');
    setBody(ctx, 2, `<< /Type /Pages /Kids [${kids}] /Count ${pageNums.length} >>`);
    setBody(ctx, 1, '<< /Type /Catalog /Pages 2 0 R >>');

    return serializeDocument(ctx);
}

interface CopyCtx {
    nextNum: number;
    /** newObjNum → serialized object body (without `N 0 obj`/`endobj`). */
    readonly bodies: Map<number, string>;
    /** Per-source dedup: sourceObjNum → newObjNum. */
    readonly memo: Map<PdfReader, Map<number, number>>;
    /** Hard ceiling on cumulative serialized output size (bytes). */
    readonly maxOutputSize: number;
    /** Running total of bytes committed to {@link bodies}. */
    totalBytes: number;
}

/**
 * Account for `n` bytes about to be committed to the output, throwing before
 * the allocation happens if it would breach {@link CopyCtx.maxOutputSize}.
 * Guards against memory exhaustion from adversarial or accidentally huge
 * sources — checked *before* a large stream is materialised, not after.
 */
function accountBytes(ctx: CopyCtx, n: number): void {
    ctx.totalBytes += n;
    if (ctx.totalBytes > ctx.maxOutputSize) {
        throw new Error(
            `page-tree output exceeded the ${ctx.maxOutputSize}-byte maxOutputSize limit ` +
            '(raise MergeOptions.maxOutputSize or pass Infinity to disable)',
        );
    }
}

/** Record a serialized object body, charging its byte cost against the cap. */
function setBody(ctx: CopyCtx, num: number, body: string): void {
    accountBytes(ctx, body.length);
    ctx.bodies.set(num, body);
}

function memoFor(ctx: CopyCtx, reader: PdfReader): Map<number, number> {
    let m = ctx.memo.get(reader);
    if (!m) { m = new Map(); ctx.memo.set(reader, m); }
    return m;
}

/** Copy a page and its graph; returns the new page object number. */
function copyPage(ctx: CopyCtx, spec: PageSpec, opts: MergeOptions): number {
    const { reader, pageIndex } = spec;
    const page = reader.getPage(pageIndex);
    const pageNum = ctx.nextNum++;

    const parts: string[] = ['/Type /Page', '/Parent 2 0 R'];

    // MediaBox / CropBox / Rotate — resolve inheritance, inline onto the page.
    for (const key of INHERITABLE_KEYS) {
        const v = resolveInherited(reader, page, key);
        if (v !== undefined) {
            parts.push(`/${key} ${serializeValue(rewrite(ctx, reader, v))}`);
        } else if (key === 'MediaBox') {
            parts.push(`/MediaBox ${DEFAULT_MEDIA_BOX}`);
        }
    }

    // Resources — inheritable; default to an empty dict.
    const res = resolveInherited(reader, page, 'Resources');
    parts.push(`/Resources ${res !== undefined ? serializeValue(rewrite(ctx, reader, res)) : '<< >>'}`);

    // Contents.
    const contents = page.get('Contents');
    if (contents !== undefined) {
        parts.push(`/Contents ${serializeValue(rewrite(ctx, reader, contents))}`);
    }

    // Annotations — keep self-contained URI links unless dropped.
    if (!opts.dropAnnotations) {
        const annots = filterAnnotations(ctx, reader, page);
        if (annots) parts.push(`/Annots ${annots}`);
    }

    setBody(ctx, pageNum, `<< ${parts.join(' ')} >>`);
    return pageNum;
}

/**
 * Keep only self-contained URI `/Link` annotations (no cross-page or form
 * references) and return the inline `/Annots` array string, or `undefined`.
 */
function filterAnnotations(ctx: CopyCtx, reader: PdfReader, page: PdfDict): string | undefined {
    const annotsVal = page.get('Annots');
    if (annotsVal === undefined) return undefined;
    const arr = reader.resolveValue(annotsVal);
    if (!isArray(arr)) return undefined;

    const kept: string[] = [];
    for (const a of arr) {
        const ad = reader.resolveValue(a);
        if (!isDict(ad)) continue;
        if (dictGetName(ad, 'Subtype') !== 'Link') continue;
        const action = reader.resolveValue(ad.get('A') ?? null);
        if (!isDict(action) || dictGetName(action, 'S') !== 'URI') continue;

        // Rebuild a clean annotation: strip /P, /Parent; rewrite the rest.
        const clean = new Map<string, PdfValue>();
        for (const [k, v] of ad) {
            if (k === 'P' || k === 'Parent') continue;
            clean.set(k, rewrite(ctx, reader, v));
        }
        kept.push(serializeValue(clean));
    }
    return kept.length > 0 ? `[${kept.join(' ')}]` : undefined;
}

/**
 * Deep-copy an indirect object into the new space, returning its new number.
 * Memoised per source so shared objects are copied once. Cycle-safe: the new
 * number is reserved before the body is serialized.
 */
function copyObject(ctx: CopyCtx, reader: PdfReader, srcNum: number, srcGen: number, depth = 0): number {
    const memo = memoFor(ctx, reader);
    const existing = memo.get(srcNum);
    if (existing !== undefined) return existing;

    const newNum = ctx.nextNum++;
    memo.set(srcNum, newNum);

    const resolved = reader.resolve({ type: 'ref', num: srcNum, gen: srcGen });
    if (isStream(resolved)) {
        ctx.bodies.set(newNum, serializeStreamBody(ctx, reader, resolved, depth));
    } else {
        const body = serializeValue(rewrite(ctx, reader, resolved, depth));
        setBody(ctx, newNum, body);
    }
    return newNum;
}

/** Rewrite a value, replacing every indirect reference with a copied one. */
function rewrite(ctx: CopyCtx, reader: PdfReader, val: PdfValue, depth = 0): PdfValue {
    if (depth > MAX_COPY_DEPTH) {
        throw new Error(
            `page-tree copy exceeded maximum object nesting depth (${MAX_COPY_DEPTH}) — malformed or adversarial PDF`,
        );
    }
    if (isRef(val)) {
        const entry = reader.xref.entries.get(val.num);
        if (!entry || entry.type === 0) return null; // dangling → null (safe)
        const newNum = copyObject(ctx, reader, val.num, val.gen, depth + 1);
        return { type: 'ref', num: newNum, gen: 0 };
    }
    if (isArray(val)) return val.map(v => rewrite(ctx, reader, v, depth + 1));
    if (isStream(val)) {
        // Inline streams cannot exist; streams are always indirect. Defensive.
        return val;
    }
    if (isDict(val)) {
        const out: PdfDict = new Map();
        for (const [k, v] of val) out.set(k, rewrite(ctx, reader, v, depth + 1));
        return out;
    }
    return val;
}

/** Serialize a stream object body: dict (with corrected /Length) + raw data. */
function serializeStreamBody(ctx: CopyCtx, reader: PdfReader, stream: PdfStream, depth = 0): string {
    // Pre-flight the raw payload against the cap *before* the (potentially
    // multi-gigabyte) Latin-1 conversion, so an oversized stream is rejected
    // rather than first materialised into a huge JS string.
    accountBytes(ctx, stream.data.length);
    const dict: PdfDict = new Map();
    for (const [k, v] of stream.dict) {
        if (k === 'Length') continue; // recomputed below
        dict.set(k, rewrite(ctx, reader, v, depth + 1));
    }
    dict.set('Length', stream.data.length);
    let body = serializeDict(dict);
    body += '\nstream\n';
    body += bytesToLatin1(stream.data);
    body += '\nendstream';
    // Charge the wrapper overhead (dict + stream markers); the payload itself
    // was already accounted above.
    accountBytes(ctx, body.length - stream.data.length);
    return body;
}

// ── PDF value serialization (binary-safe, Latin-1) ───────────────────

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
    if (isArray(val)) return '[' + val.map(serializeValue).join(' ') + ']';
    if (isStream(val)) return serializeDict(val.dict);
    if (isDict(val)) return serializeDict(val);
    return 'null';
}

function serializeDict(dict: PdfDict): string {
    let s = '<<';
    for (const [key, val] of dict) s += ` /${key} ${serializeValue(val)}`;
    s += ' >>';
    return s;
}

function escapePdfStr(s: string): string {
    return s.replace(/[\\()]/g, c => '\\' + c);
}

function bytesToLatin1(bytes: Uint8Array): string {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return s;
}

// ── Document writer (header + body + xref + trailer) ─────────────────

function serializeDocument(ctx: CopyCtx): Uint8Array {
    const maxNum = ctx.nextNum - 1;
    const parts: string[] = [];
    const offsets = new Array<number>(maxNum + 1).fill(0);
    let offset = 0;

    function push(s: string): void { parts.push(s); offset += s.length; }

    push('%PDF-1.7\n');
    push('%\xE2\xE3\xCF\xD3\n');

    for (let num = 1; num <= maxNum; num++) {
        const body = ctx.bodies.get(num);
        if (body === undefined) continue; // gap (should not happen)
        offsets[num] = offset;
        push(`${num} 0 obj\n${body}\nendobj\n`);
    }

    // Cross-reference table.
    const xrefOffset = offset;
    const size = maxNum + 1;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num <= maxNum; num++) {
        xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);

    // Deterministic /ID (ISO 32000-1 §7.5.5): content-addressed MD5 of the
    // assembled body. Same input → same ID, so re-running merge is byte-stable.
    const id = bytesToHex(md5(latin1ToBytes(parts.join(''))));
    push(`trailer\n<< /Size ${size} /Root 1 0 R /ID [<${id}> <${id}>] >>\n`);
    push(`startxref\n${xrefOffset}\n%%EOF\n`);

    const full = parts.join('');
    const out = new Uint8Array(full.length);
    for (let i = 0; i < full.length; i++) out[i] = full.charCodeAt(i) & 0xff;
    return out;
}

/** Convert a Latin-1 binary string to its byte array (for hashing). */
function latin1ToBytes(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

/** Lowercase hex encoding of a byte array. */
function bytesToHex(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
}
