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
 *  - **Encrypted sources are decrypted on ingest** (since v1.6.0): pass the
 *    password via `MergeOptions.password` or the per-source
 *    `{ bytes, password }` form. The rebuilt output is always **unencrypted**.
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
import { createMd5 } from '../core/pdf-encrypt.js';

// ── Public types ─────────────────────────────────────────────────────

/** A contiguous, inclusive page range (0-based). */
export interface PageRange {
    /** First page index (0-based, inclusive). */
    readonly start: number;
    /** Last page index (0-based, inclusive). Defaults to `start`. */
    readonly end?: number;
}

/**
 * A merge source: raw PDF bytes, or bytes paired with the password needed to
 * decrypt an encrypted source. The per-source password takes precedence over
 * {@link MergeOptions.password}.
 *
 * @since 1.6.0
 */
export type PdfSourceInput = Uint8Array | { readonly bytes: Uint8Array; readonly password?: string };

function sourceBytes(src: PdfSourceInput): Uint8Array {
    return src instanceof Uint8Array ? src : src.bytes;
}

function sourcePassword(src: PdfSourceInput, fallback?: string): string | undefined {
    if (src instanceof Uint8Array) return fallback;
    return src.password ?? fallback;
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
    /**
     * Password used to decrypt encrypted source documents (user or owner).
     * For {@link mergePdfs} this is the default applied to every source that
     * does not carry its own `{ bytes, password }`. For {@link splitPdf} /
     * {@link extractPages} it is the single source's password.
     *
     * @since 1.6.0
     */
    readonly password?: string;
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
 * @param sources 1–50 PDF sources (raw bytes, or `{ bytes, password }` for
 *                encrypted documents).
 * @param opts    See {@link MergeOptions}.
 * @returns A new, self-contained (unencrypted) PDF.
 * @throws If `sources` is empty/too large, or a source is encrypted and no
 *         valid password is supplied.
 */
export function mergePdfs(sources: readonly PdfSourceInput[], opts?: MergeOptions): Uint8Array {
    if (sources.length === 0) throw new Error('mergePdfs requires at least one source PDF');
    if (sources.length > MAX_MERGE_SOURCES) {
        throw new Error(`mergePdfs supports at most ${MAX_MERGE_SOURCES} sources (got ${sources.length})`);
    }
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early, before any I/O
    const specs: PageSpec[] = [];
    for (const src of sources) {
        const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
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
 *                    `dropAnnotations`, `password`).
 * @throws If indices is empty, an index is out of range, or `src` is encrypted
 *         and no valid password is supplied.
 */
export function extractPages(
    src: PdfSourceInput,
    pageIndices: readonly number[],
    opts?: MergeOptions,
): Uint8Array {
    if (pageIndices.length === 0) throw new Error('extractPages requires at least one page index');
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early
    const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
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
 *               `dropAnnotations`, `password`); applied to every emitted
 *               document.
 * @returns One PDF per range, in order.
 * @throws If ranges is empty, a range is invalid, or `src` is encrypted and no
 *         valid password is supplied.
 */
export function splitPdf(
    src: PdfSourceInput,
    ranges: readonly PageRange[],
    opts?: MergeOptions,
): Uint8Array[] {
    if (ranges.length === 0) throw new Error('splitPdf requires at least one range');
    resolveMaxOutputSize(opts?.maxOutputSize); // validate early
    const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
    const count = reader.pageCount;
    return ranges.map(range => assemble(rangeToSpecs(reader, range, count), opts ?? {}));
}

/** Validate a page range against `count` and expand it to page specs. */
function rangeToSpecs(reader: PdfReader, range: PageRange, count: number): PageSpec[] {
    const start = range.start | 0;
    const end = (range.end ?? range.start) | 0;
    if (start < 0 || end < start || end >= count) {
        throw new Error(`splitPdf range [${start}, ${end}] invalid for ${count}-page document`);
    }
    const specs: PageSpec[] = [];
    for (let i = start; i <= end; i++) specs.push({ reader, pageIndex: i });
    return specs;
}

// ── Streaming variants (constant-memory) ─────────────────────────────

const DEFAULT_STREAM_CHUNK = 64 * 1024;
const MIN_STREAM_CHUNK = 1024;
const MAX_STREAM_CHUNK = 16 * 1024 * 1024;

/** Options for the streaming page-tree variants. */
export interface StreamMergeOptions extends MergeOptions {
    /**
     * Output chunk size in bytes (clamped to 1 KiB–16 MiB). Defaults to 64 KiB.
     */
    readonly chunkSize?: number;
}

function resolveChunkSize(value: number | undefined): number {
    if (value === undefined) return DEFAULT_STREAM_CHUNK;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`chunkSize must be a positive number (got ${String(value)})`);
    }
    return Math.max(MIN_STREAM_CHUNK, Math.min(MAX_STREAM_CHUNK, Math.floor(value)));
}

/**
 * One emitted document from {@link streamSplitPdf}. The `pdf` generator MUST be
 * fully drained before the outer generator is advanced to the next range.
 */
export interface SplitPdfStream {
    /** 0-based index of this range within the `ranges` argument. */
    readonly index: number;
    /** The resolved inclusive page range. */
    readonly range: { readonly start: number; readonly end: number };
    /** Chunked bytes of this range's PDF. */
    readonly pdf: AsyncGenerator<Uint8Array>;
}

/**
 * Streaming {@link mergePdfs}: yields the merged PDF as fixed-size chunks.
 * Only the cross-reference offsets and small object dicts are held in memory;
 * stream payloads are emitted straight from the (in-memory) source bytes, and
 * the fully-joined document is never materialised. Compose with
 * `streamToFile()` for constant-memory disk writes.
 *
 * The output is byte-identical to {@link mergePdfs} for the same inputs.
 *
 * @since 1.6.0
 */
export async function* streamMergedPdfs(
    sources: readonly PdfSourceInput[],
    opts?: StreamMergeOptions,
): AsyncGenerator<Uint8Array> {
    if (sources.length === 0) throw new Error('streamMergedPdfs requires at least one source PDF');
    if (sources.length > MAX_MERGE_SOURCES) {
        throw new Error(`streamMergedPdfs supports at most ${MAX_MERGE_SOURCES} sources (got ${sources.length})`);
    }
    const chunkSize = resolveChunkSize(opts?.chunkSize);
    resolveMaxOutputSize(opts?.maxOutputSize);
    const specs: PageSpec[] = [];
    for (const src of sources) {
        const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
        const count = reader.pageCount;
        for (let i = 0; i < count; i++) specs.push({ reader, pageIndex: i });
    }
    // Copy phase (may throw on maxOutputSize) completes before any byte is
    // emitted, so a tripped cap never yields a partial document.
    const ctx = planDocument(specs, opts ?? {});
    yield* chunkify(documentSegments(ctx), chunkSize);
}

/**
 * Streaming {@link extractPages}: yields the extracted PDF as fixed-size
 * chunks, byte-identical to `extractPages`.
 *
 * @since 1.6.0
 */
export async function* streamExtractPages(
    src: PdfSourceInput,
    pageIndices: readonly number[],
    opts?: StreamMergeOptions,
): AsyncGenerator<Uint8Array> {
    if (pageIndices.length === 0) throw new Error('streamExtractPages requires at least one page index');
    const chunkSize = resolveChunkSize(opts?.chunkSize);
    resolveMaxOutputSize(opts?.maxOutputSize);
    const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
    const count = reader.pageCount;
    const specs: PageSpec[] = [];
    for (const idx of pageIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
            throw new Error(`streamExtractPages page index ${idx} out of range (0-${count - 1})`);
        }
        specs.push({ reader, pageIndex: idx });
    }
    const ctx = planDocument(specs, opts ?? {});
    yield* chunkify(documentSegments(ctx), chunkSize);
}

/**
 * Streaming {@link splitPdf}: yields one {@link SplitPdfStream} per range, in
 * order. Each range's `pdf` generator is byte-identical to the corresponding
 * `splitPdf` output and must be fully drained before advancing to the next
 * range (enforced — advancing early throws).
 *
 * @since 1.6.0
 */
export async function* streamSplitPdf(
    src: PdfSourceInput,
    ranges: readonly PageRange[],
    opts?: StreamMergeOptions,
): AsyncGenerator<SplitPdfStream> {
    if (ranges.length === 0) throw new Error('streamSplitPdf requires at least one range');
    const chunkSize = resolveChunkSize(opts?.chunkSize);
    resolveMaxOutputSize(opts?.maxOutputSize);
    const reader = openPdf(sourceBytes(src), { password: sourcePassword(src, opts?.password) });
    const count = reader.pageCount;

    let previousDrained = true;
    for (let index = 0; index < ranges.length; index++) {
        if (!previousDrained) {
            throw new Error(
                'streamSplitPdf: the previous range generator was not fully drained before advancing — ' +
                'consume each SplitPdfStream.pdf completely before requesting the next range',
            );
        }
        const range = ranges[index];
        const specs = rangeToSpecs(reader, range, count);
        const resolvedRange = { start: range.start | 0, end: (range.end ?? range.start) | 0 };
        previousDrained = false;
        const ctx = planDocument(specs, opts ?? {});
        const inner = chunkify(documentSegments(ctx), chunkSize);
        const guarded = (async function* (): AsyncGenerator<Uint8Array> {
            yield* inner;
            previousDrained = true;
        })();
        yield { index, range: resolvedRange, pdf: guarded };
    }
}

// ── Internals ────────────────────────────────────────────────────────

interface PageSpec {
    readonly reader: PdfReader;
    readonly pageIndex: number;
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

/**
 * Phase 1 — copy every kept page's object graph into a fresh, contiguous
 * object-number space and wire up the flat `/Pages` tree + `/Catalog`.
 * Returns the fully-populated {@link CopyCtx}; emission (phase 2) is separate
 * so the buffered and streaming writers can share it.
 */
function planDocument(specs: PageSpec[], opts: MergeOptions): CopyCtx {
    // Object numbers: 1 = Catalog, 2 = Pages root, 3.. = pages + graph.
    const ctx: CopyCtx = {
        nextNum: 3,
        bodies: new Map<number, ObjBody>(),
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
    return ctx;
}

/** Build a new PDF from an ordered list of source pages (buffered). */
function assemble(specs: PageSpec[], opts: MergeOptions): Uint8Array {
    return serializeDocument(planDocument(specs, opts));
}

/**
 * A serialized stream object body kept in split form so the (potentially
 * large) payload stays a zero-copy view of the source PDF bytes and can be
 * emitted directly rather than folded into a giant Latin-1 string.
 */
interface StreamBody {
    /** Dict + `\nstream\n`. */
    readonly head: string;
    /** Raw stream payload (a subarray view of the source bytes). */
    readonly data: Uint8Array;
    /** `\nendstream`. */
    readonly tail: string;
}

/** newObjNum → serialized body: a plain string, or a split stream body. */
type ObjBody = string | StreamBody;

interface CopyCtx {
    nextNum: number;
    /** newObjNum → serialized object body (without `N 0 obj`/`endobj`). */
    readonly bodies: Map<number, ObjBody>;
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

/**
 * Serialize a stream object body into split form (dict head + payload view +
 * endstream tail). The payload is a zero-copy subarray of the source bytes, so
 * even multi-gigabyte streams cost nothing until emission — where they are
 * yielded directly instead of being folded into a Latin-1 string.
 */
function serializeStreamBody(ctx: CopyCtx, reader: PdfReader, stream: PdfStream, depth = 0): StreamBody {
    // Pre-flight the raw payload against the cap *before* the wrapper is built,
    // so an oversized stream is rejected up front.
    accountBytes(ctx, stream.data.length);
    const dict: PdfDict = new Map();
    for (const [k, v] of stream.dict) {
        if (k === 'Length') continue; // recomputed below
        dict.set(k, rewrite(ctx, reader, v, depth + 1));
    }
    dict.set('Length', stream.data.length);
    const head = serializeDict(dict) + '\nstream\n';
    const tail = '\nendstream';
    accountBytes(ctx, head.length + tail.length);
    return { head, data: stream.data, tail };
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

/** Convert a Latin-1 string to its byte array. */
function latin1ToBytes(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
}

// ── Document writer (header + body + xref + trailer) ─────────────────

/**
 * Emit the assembled document as a sequence of byte segments (header, each
 * object, xref, trailer). Both the buffered and streaming writers consume
 * this, so their output is byte-identical by construction. The deterministic
 * `/ID` (ISO 32000-1 §7.5.5) is a content-addressed MD5 of everything up to
 * (but not including) the trailer, computed incrementally so no full copy of
 * the document is needed. Each object body is dropped from `ctx.bodies` as it
 * is emitted, so peak memory stays flat for large documents.
 */
function* documentSegments(ctx: CopyCtx): Generator<Uint8Array> {
    const maxNum = ctx.nextNum - 1;
    const offsets = new Array<number>(maxNum + 1).fill(0);
    const md5h = createMd5();
    let offset = 0;

    // Hash + advance the offset for every pre-trailer segment.
    function seg(part: string | Uint8Array): Uint8Array {
        const bytes = typeof part === 'string' ? latin1ToBytes(part) : part;
        md5h.update(bytes);
        offset += bytes.length;
        return bytes;
    }

    yield seg('%PDF-1.7\n');
    yield seg('%\xE2\xE3\xCF\xD3\n');

    for (let num = 1; num <= maxNum; num++) {
        const body = ctx.bodies.get(num);
        if (body === undefined) continue; // gap (should not happen)
        offsets[num] = offset;
        yield seg(`${num} 0 obj\n`);
        if (typeof body === 'string') {
            yield seg(body);
        } else {
            yield seg(body.head);
            yield seg(body.data);
            yield seg(body.tail);
        }
        yield seg('\nendobj\n');
        ctx.bodies.delete(num); // free as we go
    }

    // Cross-reference table.
    const xrefOffset = offset;
    const size = maxNum + 1;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num <= maxNum; num++) {
        xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
    }
    yield seg(xref);

    // Trailer (not part of the hash — the /ID digests only the body + xref).
    const id = bytesToHex(md5h.digest());
    yield latin1ToBytes(`trailer\n<< /Size ${size} /Root 1 0 R /ID [<${id}> <${id}>] >>\n`);
    yield latin1ToBytes(`startxref\n${xrefOffset}\n%%EOF\n`);
}

/** Buffered writer: concatenate every document segment into one PDF. */
function serializeDocument(ctx: CopyCtx): Uint8Array {
    const segments: Uint8Array[] = [];
    let total = 0;
    for (const s of documentSegments(ctx)) { segments.push(s); total += s.length; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const s of segments) { out.set(s, o); o += s.length; }
    return out;
}

/**
 * Re-chunk a segment stream into fixed-size `Uint8Array`s of at most
 * `chunkSize` bytes (the final chunk may be smaller). Only one chunk buffer is
 * held at a time, so peak memory is `chunkSize` + the current source segment.
 */
async function* chunkify(segments: Generator<Uint8Array>, chunkSize: number): AsyncGenerator<Uint8Array> {
    let buf = new Uint8Array(chunkSize);
    let len = 0;
    for (const seg of segments) {
        let i = 0;
        while (i < seg.length) {
            const take = Math.min(chunkSize - len, seg.length - i);
            buf.set(seg.subarray(i, i + take), len);
            len += take;
            i += take;
            if (len === chunkSize) { yield buf; buf = new Uint8Array(chunkSize); len = 0; }
        }
    }
    if (len > 0) yield buf.subarray(0, len);
}

/** Lowercase hex encoding of a byte array. */
function bytesToHex(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
    return s;
}
