/**
 * pdfnative — fuzz target: the cross-reference parser
 * ===================================================
 * Coverage-guided fuzzing of `parseXrefTable`: `startxref`, classic tables,
 * cross-reference streams (`/W`, `/Index`, PNG predictors), `/Prev` and
 * `/XRefStm` chains, hybrid files, and the reconstruction a damaged file
 * falls back to.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/xref
 */

import { parseXrefTable } from 'pdfnative';

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
        parseXrefTable(new Uint8Array(data));
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}
