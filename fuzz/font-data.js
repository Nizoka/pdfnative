/**
 * pdfnative — fuzz target: the TrueType compiler
 * ==============================================
 * Coverage-guided fuzzing of `parseFontData` (`pdfnative/tools`): the sfnt
 * directory, `head`/`hhea`/`hmtx`/`maxp`/`OS/2`/`post`, every `cmap`
 * subtable format the compiler reads, `GSUB` (lookup types 1, 2, 4, 5, 6,
 * Extension), `GPOS` mark attachment and `GDEF` classes, `kern`. A font is
 * the one input a consumer feeds the library that is not a PDF, and a
 * malformed one must be refused, never followed off the end of a table.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/font-data
 */

import { parseFontData } from 'pdfnative/tools';

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
        parseFontData(new Uint8Array(data));
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}
