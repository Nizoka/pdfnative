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

import { buildPDF } from './pdf-builder.js';
import { buildDocumentPDF } from './pdf-document.js';
import type { PdfParams, PdfLayoutOptions } from '../types/pdf-types.js';
import type { DocumentParams, DocumentBlock } from '../types/pdf-document-types.js';

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
