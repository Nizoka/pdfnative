/**
 * pdfnative — Streaming PDF Output
 * ==================================
 * AsyncGenerator-based PDF output for progressive chunk emission.
 *
 * Memory savings: instead of converting the full PDF binary string into a
 * single Uint8Array via `toBytes()`, the stream yields fixed-size chunks.
 * For a 100 MB PDF this halves peak memory (no string + full Uint8Array).
 *
 * Constraints (validated at boundary):
 * - TOC blocks require multi-pass pagination → incompatible with streaming
 * - `{pages}` placeholder requires total page count before first page render
 *
 * Future: page-by-page assembly for constant-memory generation.
 */

import { buildPDF, assembleTableParts } from './pdf-builder.js';
import { buildDocumentPDF, assembleDocumentParts } from './pdf-document.js';
import type { PdfParams, PdfLayoutOptions } from '../types/pdf-types.js';
import type { DocumentParams, DocumentBlock } from '../types/pdf-document-types.js';
// Type-only import — erased at compile, keeps the browser bundle free of node:fs.
import type * as NodeFs from 'node:fs';

// ── Types ────────────────────────────────────────────────────────────

/** Options for streaming PDF output. */
export interface StreamOptions {
    /**
     * Maximum size of each yielded chunk in bytes.
     * Smaller chunks reduce peak memory but may increase overhead.
     * Default: 65536 (64 KB).
     */
    readonly chunkSize?: number;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validate that document params are compatible with streaming output.
 * Throws if TOC blocks are present (multi-pass pagination required).
 *
 * @param params - Document content parameters
 * @param layoutOptions - Optional layout customization
 */
export function validateDocumentStreamable(params: DocumentParams, layoutOptions?: Partial<PdfLayoutOptions>): void {
    const blocks: readonly DocumentBlock[] = params.blocks;
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].type === 'toc') {
            throw new Error(
                'Streaming output is incompatible with TOC blocks (multi-pass pagination required). ' +
                'Remove TOC blocks or use buildDocumentPDFBytes() instead.',
            );
        }
    }

    // Check layout for {pages} placeholder in templates
    const layout = layoutOptions ?? params.layout;
    if (layout) {
        checkTemplatePages(layout.headerTemplate, 'headerTemplate');
        checkTemplatePages(layout.footerTemplate, 'footerTemplate');
    }
}

/**
 * Validate that table params are compatible with streaming output.
 * Table builder has no TOC, so only template checks apply.
 *
 * @param _params - PDF table parameters (currently unused, reserved for future validation)
 * @param layoutOptions - Optional layout customization
 */
export function validateTableStreamable(_params: PdfParams, layoutOptions?: Partial<PdfLayoutOptions>): void {
    if (layoutOptions) {
        checkTemplatePages(layoutOptions.headerTemplate, 'headerTemplate');
        checkTemplatePages(layoutOptions.footerTemplate, 'footerTemplate');
    }
}

// ── Template validation helper ───────────────────────────────────────

interface TemplateZones {
    readonly left?: string;
    readonly center?: string;
    readonly right?: string;
}

function checkTemplatePages(template: TemplateZones | undefined, name: string): void {
    if (!template) return;
    const zones = [template.left, template.center, template.right];
    for (const zone of zones) {
        if (zone && zone.includes('{pages}')) {
            throw new Error(
                `Streaming output is incompatible with {pages} placeholder in ${name}. ` +
                'The total page count is unknown during progressive emission. ' +
                'Use {page} instead or use buildDocumentPDFBytes()/buildPDFBytes().',
            );
        }
    }
}

// ── Chunked binary string conversion ─────────────────────────────────

/**
 * Convert a binary string to Uint8Array chunks without allocating
 * the full Uint8Array at once. Each character is masked to 0xFF.
 *
 * @param str - Binary PDF string (each char ≤ 0xFF)
 * @param chunkSize - Bytes per yielded chunk
 * @yields Uint8Array chunks of the binary string
 */
export function* chunkBinaryString(str: string, chunkSize: number): Generator<Uint8Array> {
    const len = str.length;
    for (let i = 0; i < len; i += chunkSize) {
        const end = Math.min(i + chunkSize, len);
        const chunk = new Uint8Array(end - i);
        for (let j = 0; j < chunk.length; j++) {
            chunk[j] = str.charCodeAt(i + j) & 0xff;
        }
        yield chunk;
    }
}

// ── Streaming Document Builder ───────────────────────────────────────

/**
 * Build a free-form PDF document and yield Uint8Array chunks progressively.
 *
 * Same output as `buildDocumentPDFBytes()`, but emitted in fixed-size
 * chunks to reduce peak memory usage.
 *
 * Constraints:
 * - TOC blocks are not allowed (require multi-pass pagination)
 * - `{pages}` placeholder is not allowed in header/footer templates
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization
 * @param streamOptions - Chunk size configuration
 * @yields Uint8Array chunks of the PDF
 *
 * @example
 * ```ts
 * import { createWriteStream } from 'fs';
 * const stream = createWriteStream('out.pdf');
 * for await (const chunk of buildDocumentPDFStream(params)) {
 *     stream.write(chunk);
 * }
 * stream.end();
 * ```
 */
export async function* buildDocumentPDFStream(
    params: DocumentParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
    streamOptions?: StreamOptions,
): AsyncGenerator<Uint8Array> {
    validateDocumentStreamable(params, layoutOptions);
    const chunkSize = resolveChunkSize(streamOptions?.chunkSize);
    const binary = buildDocumentPDF(params, layoutOptions);
    yield* chunkBinaryString(binary, chunkSize);
}

// ── Object-boundary Streaming (Page-by-Page Semantic) ───────────────

/**
 * Yield a binary PDF string in chunks aligned at PDF object boundaries
 * (`\nendobj\n`). Each yielded chunk contains one or more complete
 * indirect objects — never a partial object. The PDF header is yielded
 * as its own chunk; the trailing xref/trailer/startxref section is
 * yielded as the final chunk.
 *
 * This is the building block for object-granular streaming: consumers
 * can persist each chunk and discard it before the next is produced,
 * keeping peak memory bounded by the size of the largest single object
 * (typically the largest content stream or embedded font).
 *
 * @internal
 */
export function* chunkAtObjectBoundaries(binary: string): Generator<Uint8Array> {
    const len = binary.length;
    if (len === 0) return;

    // Find the position immediately after the PDF header signature.
    // Header is `%PDF-x.y\n%XXXXX\n\n` followed by the first object.
    // We yield everything up to the start of the first `N 0 obj` as the
    // header chunk so the consumer can stream it to disk first.
    let cursor = 0;
    const firstObj = binary.search(/^\d+\s+0\s+obj/m);
    if (firstObj > 0) {
        yield encodeBinarySlice(binary, 0, firstObj);
        cursor = firstObj;
    }

    // Find each `endobj\n` boundary and yield the slice ending at it.
    const ENDOBJ = 'endobj\n';
    while (cursor < len) {
        const end = binary.indexOf(ENDOBJ, cursor);
        if (end < 0) break;
        const chunkEnd = end + ENDOBJ.length;
        yield encodeBinarySlice(binary, cursor, chunkEnd);
        cursor = chunkEnd;
    }

    // Trailing xref/trailer/startxref section.
    if (cursor < len) {
        yield encodeBinarySlice(binary, cursor, len);
    }
}

function encodeBinarySlice(binary: string, start: number, end: number): Uint8Array {
    const out = new Uint8Array(end - start);
    for (let i = 0; i < out.length; i++) {
        out[i] = binary.charCodeAt(start + i) & 0xff;
    }
    return out;
}

/**
 * Build a free-form PDF document and yield Uint8Array chunks aligned
 * at PDF object boundaries (one indirect object per chunk, plus a
 * header chunk and a trailing xref/trailer chunk).
 *
 * Use this variant when the consumer benefits from receiving
 * semantically meaningful PDF segments rather than fixed-size byte
 * slices — for example, persisting each page object directly to disk
 * before the next one is produced, or for diagnostic tooling that
 * wants to inspect individual objects.
 *
 * **Scope note (v1.2.x):** the underlying assembler still buffers the
 * full PDF binary in memory before chunking; constant-memory
 * generation (true progressive assembly) is staged for v1.3. The
 * public API surface, however, is stable from v1.2 onward — code
 * written against `buildDocumentPDFStreamPageByPage()` will keep
 * working without changes when the internal refactor lands.
 *
 * Constraints (same as `buildDocumentPDFStream`):
 * - TOC blocks are not allowed (require multi-pass pagination)
 * - `{pages}` placeholder is not allowed in header/footer templates
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization
 * @yields Uint8Array chunks of the PDF, one PDF indirect object per chunk
 *
 * @example
 * ```ts
 * import { createWriteStream } from 'fs';
 * const out = createWriteStream('large.pdf');
 * for await (const chunk of buildDocumentPDFStreamPageByPage(params)) {
 *     out.write(chunk);
 * }
 * out.end();
 * ```
 */
export async function* buildDocumentPDFStreamPageByPage(
    params: DocumentParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
): AsyncGenerator<Uint8Array> {
    validateDocumentStreamable(params, layoutOptions);
    const binary = buildDocumentPDF(params, layoutOptions);
    yield* chunkAtObjectBoundaries(binary);
}

/**
 * Build a table-centric PDF and yield Uint8Array chunks aligned at
 * PDF object boundaries. See {@link buildDocumentPDFStreamPageByPage}
 * for the full semantic contract.
 *
 * @param params - PDF content (title, rows, headers, etc.)
 * @param layoutOptions - Optional layout customization
 * @yields Uint8Array chunks of the PDF, one PDF indirect object per chunk
 */
export async function* buildPDFStreamPageByPage(
    params: PdfParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
): AsyncGenerator<Uint8Array> {
    validateTableStreamable(params, layoutOptions);
    const binary = buildPDF(params, layoutOptions);
    yield* chunkAtObjectBoundaries(binary);
}

// ── Streaming Table Builder ──────────────────────────────────────────

/**
 * Build a table-centric PDF and yield Uint8Array chunks progressively.
 *
 * Same output as `buildPDFBytes()`, but emitted in fixed-size
 * chunks to reduce peak memory usage.
 *
 * @param params - PDF content (title, rows, headers, etc.)
 * @param layoutOptions - Optional layout customization
 * @param streamOptions - Chunk size configuration
 * @yields Uint8Array chunks of the PDF
 *
 * @example
 * ```ts
 * const chunks: Uint8Array[] = [];
 * for await (const chunk of buildPDFStream(params)) {
 *     chunks.push(chunk);
 * }
 * const pdf = concatChunks(chunks);
 * ```
 */
export async function* buildPDFStream(
    params: PdfParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
    streamOptions?: StreamOptions,
): AsyncGenerator<Uint8Array> {
    validateTableStreamable(params, layoutOptions);
    const chunkSize = resolveChunkSize(streamOptions?.chunkSize);
    const binary = buildPDF(params, layoutOptions);
    yield* chunkBinaryString(binary, chunkSize);
}

// ── True Constant-Memory Streaming (parts-progressive) ───────────────

/**
 * Iterate an assembled `parts[]` array, encode each part to bytes, and
 * yield fixed-size `Uint8Array` chunks — freeing each consumed part
 * (`parts[i] = ''`) immediately so the fully-joined PDF binary never
 * materialises in memory.
 *
 * Memory profile, stated precisely: from the first yield onwards this
 * generator holds only the chunk buffer plus the parts it has not reached
 * yet, so memory falls monotonically as it drains. It does **not** make the
 * whole pipeline constant-memory — the callers below build the complete
 * `parts[]` array up front, so peak usage is still proportional to total
 * output size (~2 bytes per output character, JS strings being UTF-16).
 * What is avoided is the second full copy that joining would cost, and the
 * ~512 MB per-string ceiling that `buildDocumentPDFStream` runs into.
 *
 * @param parts - Assembled PDF parts in emission order (mutated: freed)
 * @param chunkSize - Bytes per yielded chunk
 * @yields Uint8Array chunks of the PDF
 * @internal
 */
function* streamPartsChunked(parts: string[], chunkSize: number): Generator<Uint8Array> {
    let buf = new Uint8Array(chunkSize);
    let filled = 0;
    for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        parts[p] = ''; // free as we go — memory falls monotonically once draining
        const len = part.length;
        for (let i = 0; i < len; i++) {
            buf[filled++] = part.charCodeAt(i) & 0xff;
            if (filled === chunkSize) {
                yield buf;
                buf = new Uint8Array(chunkSize);
                filled = 0;
            }
        }
    }
    if (filled > 0) {
        yield buf.subarray(0, filled);
    }
}

/**
 * Build a free-form PDF document, streaming it out **without ever joining
 * the binary**.
 *
 * Unlike {@link buildDocumentPDFStream} (which assembles the full binary
 * then chunks it), this variant assembles the PDF into its raw parts and
 * yields them progressively, freeing each part as it is emitted. The
 * fully-joined PDF binary never exists in memory at once, which lifts the
 * ~512 MB JS string ceiling that caps the other variant. Byte output is
 * identical to {@link buildDocumentPDFBytes}.
 *
 * Note that `assembleDocumentParts` still runs to completion before the
 * first chunk is yielded, so peak memory remains proportional to the total
 * output size and no progress signal is available during assembly.
 *
 * Constraints (same as `buildDocumentPDFStream`):
 * - TOC blocks are not allowed (require multi-pass pagination)
 * - `{pages}` placeholder is not allowed in header/footer templates
 *
 * @param params - Document content (title, blocks, footer, fonts)
 * @param layoutOptions - Optional layout customization
 * @param streamOptions - Chunk size configuration
 * @yields Uint8Array chunks of the PDF
 */
export async function* buildDocumentPDFStreamTrue(
    params: DocumentParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
    streamOptions?: StreamOptions,
): AsyncGenerator<Uint8Array> {
    validateDocumentStreamable(params, layoutOptions);
    const chunkSize = resolveChunkSize(streamOptions?.chunkSize);
    const parts = assembleDocumentParts(params, layoutOptions);
    yield* streamPartsChunked(parts, chunkSize);
}

/**
 * Build a table-centric PDF, streaming it out **without ever joining the
 * binary**. See {@link buildDocumentPDFStreamTrue} for the full contract,
 * including its memory profile. Byte output is identical to
 * {@link buildPDFBytes}.
 *
 * @param params - PDF content (title, rows, headers, etc.)
 * @param layoutOptions - Optional layout customization
 * @param streamOptions - Chunk size configuration
 * @yields Uint8Array chunks of the PDF
 */
export async function* buildPDFStreamTrue(
    params: PdfParams,
    layoutOptions?: Partial<PdfLayoutOptions>,
    streamOptions?: StreamOptions,
): AsyncGenerator<Uint8Array> {
    validateTableStreamable(params, layoutOptions);
    const chunkSize = resolveChunkSize(streamOptions?.chunkSize);
    const parts = assembleTableParts(params, layoutOptions);
    yield* streamPartsChunked(parts, chunkSize);
}

// ── Chunk Utilities ──────────────────────────────────────────────────

/**
 * Concatenate an array of Uint8Array chunks into a single Uint8Array.
 *
 * @param chunks - Array of chunks to concatenate
 * @returns Single Uint8Array containing all chunk data
 */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
    let totalLen = 0;
    for (let i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
        result.set(chunks[i], offset);
        offset += chunks[i].length;
    }
    return result;
}

/**
 * Count total byte length from streaming chunks without buffering.
 *
 * @param stream - Async generator of Uint8Array chunks
 * @returns Total byte count
 */
export async function streamByteLength(stream: AsyncGenerator<Uint8Array>): Promise<number> {
    let total = 0;
    for await (const chunk of stream) {
        total += chunk.length;
    }
    return total;
}

/** Result of {@link streamToFile}. */
export interface StreamToFileResult {
    /** Total number of bytes written to the file. */
    readonly bytesWritten: number;
    /** The path the stream was written to. */
    readonly path: string;
}

/**
 * Write a streaming PDF (any of the `streamPdf`/`buildPDFStream*` generators)
 * directly to a file on disk in **constant memory**, honouring write
 * back-pressure. Node.js-only convenience wrapper.
 *
 * The dependency on `node:fs` is loaded **dynamically** so this module stays
 * tree-shakeable and bundler-safe for the browser; calling `streamToFile` in
 * a non-Node environment throws a descriptive error.
 *
 * @example
 * ```ts
 * await streamToFile(streamDocumentPdf({ blocks }), './out.pdf');
 * ```
 *
 * @param stream   An async generator of PDF byte chunks.
 * @param filePath Destination path. The caller is responsible for validating
 *                 untrusted paths (path traversal, allowed directories).
 * @param opts     Optional `AbortSignal` to cancel mid-write.
 * @returns Bytes written and the destination path.
 * @since 1.4.0
 */
export async function streamToFile(
    stream: AsyncGenerator<Uint8Array>,
    filePath: string,
    opts?: { readonly signal?: AbortSignal },
): Promise<StreamToFileResult> {
    let fs: typeof NodeFs;
    try {
        fs = await import('node:fs');
    } catch {
        throw new Error('streamToFile requires a Node.js environment (node:fs is unavailable)');
    }

    const signal = opts?.signal;
    if (signal?.aborted) throw new Error('streamToFile aborted before start');

    const ws = fs.createWriteStream(filePath);
    let bytesWritten = 0;

    const onAbort = (): void => {
        ws.destroy(new Error('streamToFile aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
        await new Promise<void>((resolve, reject) => {
            ws.on('error', reject);
            ws.on('open', () => resolve());
        });

        for await (const chunk of stream) {
            if (signal?.aborted) throw new Error('streamToFile aborted');
            bytesWritten += chunk.length;
            // Honour back-pressure: wait for 'drain' when the buffer is full.
            const ok = ws.write(chunk);
            if (!ok) {
                await new Promise<void>((resolve, reject) => {
                    const onErr = (e: Error): void => { ws.off('drain', onDrain); reject(e); };
                    const onDrain = (): void => { ws.off('error', onErr); resolve(); };
                    ws.once('drain', onDrain);
                    ws.once('error', onErr);
                });
            }
        }

        // A late abort (e.g. after the final chunk) must surface as an abort,
        // not as a downstream "stream destroyed" error from end().
        if (signal?.aborted) throw new Error('streamToFile aborted');

        await new Promise<void>((resolve, reject) => {
            ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
        });
    } catch (err) {
        // Best-effort: release the file descriptor, then remove the
        // partially-written file so an aborted or failed write never leaves an
        // orphaned partial PDF on disk.
        await new Promise<void>((resolve) => {
            if (ws.closed) { resolve(); return; }
            ws.once('close', () => resolve());
            ws.destroy();
        });
        try { fs.rmSync(filePath, { force: true }); } catch { /* best-effort cleanup */ }
        throw err;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }

    return { bytesWritten, path: filePath };
}

// ── Internal ─────────────────────────────────────────────────────────

const DEFAULT_CHUNK_SIZE = 65536; // 64 KB
const MIN_CHUNK_SIZE = 1024;      // 1 KB
const MAX_CHUNK_SIZE = 16777216;  // 16 MB

function resolveChunkSize(size: number | undefined): number {
    if (size === undefined) return DEFAULT_CHUNK_SIZE;
    if (size < MIN_CHUNK_SIZE) return MIN_CHUNK_SIZE;
    if (size > MAX_CHUNK_SIZE) return MAX_CHUNK_SIZE;
    return size;
}
