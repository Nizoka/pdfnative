/**
 * pdfnative — fuzz target: the zlib inflater
 * ==========================================
 * Coverage-guided fuzzing of `inflateSync`, the pure-TypeScript RFC 1950/1951
 * decoder behind every `/FlateDecode` stream the reader opens: stored,
 * fixed-Huffman and dynamic-Huffman blocks, the distance window, the Adler-32
 * trailer, and the output cap that turns a decompression bomb into a
 * `PdfStreamLimitError`.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/inflate
 */

import { inflateSync } from 'pdfnative';

/** @param {unknown} error @returns {boolean} */
function isRefusal(error) {
    return error instanceof Error
        && !(error instanceof TypeError) && !(error instanceof RangeError)
        && !(error instanceof ReferenceError) && !(error instanceof SyntaxError)
        && !(error instanceof URIError);
}

/**
 * @param {Buffer} data Bytes chosen by the fuzzer.
 * @returns {void}
 */
export function fuzz(data) {
    try {
        inflateSync(new Uint8Array(data));
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}
