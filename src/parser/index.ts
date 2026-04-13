/**
 * pdfnative — Parser Module Barrel Export
 * ==========================================
 * Re-exports for PDF parsing, reading, and modification.
 */

// ── Inflate (DEFLATE decompression) ─────────────────────────────────
export { inflateSync, setInflateImpl, initNodeDecompression } from './pdf-inflate.js';

// ── Tokenizer ───────────────────────────────────────────────────────
export type { PdfToken, TokenType, PdfTokenizer } from './pdf-tokenizer.js';
export { createTokenizer } from './pdf-tokenizer.js';

// ── Object Parser ───────────────────────────────────────────────────
export type { PdfRef, PdfStream, PdfDict, PdfArray, PdfValue, PdfIndirectObject } from './pdf-object-parser.js';
export {
    isRef, isStream, isDict, isArray,
    dictGet, dictGetName, dictGetNum, dictGetRef, dictGetDict, dictGetArray,
    parseValue, parseIndirectObject,
} from './pdf-object-parser.js';

// ── Xref Parser ─────────────────────────────────────────────────────
export type { XrefEntry, XrefTable } from './pdf-xref-parser.js';
export { findStartxref, parseXrefTable, getTrailerValue, getTrailerRef } from './pdf-xref-parser.js';

// ── Reader ──────────────────────────────────────────────────────────
export type { PdfReader } from './pdf-reader.js';
export { openPdf } from './pdf-reader.js';

// ── Modifier ────────────────────────────────────────────────────────
export type { PdfModifier } from './pdf-modifier.js';
export { createModifier } from './pdf-modifier.js';
