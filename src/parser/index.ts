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
export type { PdfReader, OpenPdfOptions, PdfEncryptionInfo } from './pdf-reader.js';
export { openPdf } from './pdf-reader.js';

// ── Decryptor (Standard Security Handler) ───────────────────────────
export type { DecryptionContext, CryptFilterMethod } from './pdf-decrypt.js';
export {
    PdfPasswordError, PdfEncryptionUnsupportedError,
    authenticate, decryptString, decryptStreamData, decryptObjectValue,
} from './pdf-decrypt.js';

// ── Modifier ────────────────────────────────────────────────────────
export type { PdfModifier } from './pdf-modifier.js';
export { createModifier } from './pdf-modifier.js';

// ── Text extraction ─────────────────────────────────────────────────
export type { ExtractTextOptions, ExtractedTextRun, ExtractedPageText } from './pdf-text-extract.js';
export { extractText } from './pdf-text-extract.js';

// ── Page-tree manipulation (merge / split / extract) ────────────────
export type { PageRange, MergeOptions, PdfSourceInput, StreamMergeOptions, SplitPdfStream } from './pdf-pagetree.js';
export {
    mergePdfs, splitPdf, extractPages,
    streamMergedPdfs, streamExtractPages, streamSplitPdf,
} from './pdf-pagetree.js';
