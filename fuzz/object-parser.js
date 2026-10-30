/**
 * pdfnative — fuzz target: the PDF object parser
 * ==============================================
 * Coverage-guided fuzzing of `parseValue` over `createTokenizer`: every
 * object of ISO 32000-1 §7.3 (numbers, strings, names, arrays, dictionaries,
 * streams, references, the keywords), nested to the parser's depth cap.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/object-parser
 */

import { createTokenizer, parseValue } from 'pdfnative';

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
    const bytes = new Uint8Array(data);
    try {
        const tokenizer = createTokenizer(bytes);
        // One object after another until the tokens run out; a parser that
        // consumed nothing on some input would spin, which the cap catches.
        for (let n = 0; n < 10_000 && tokenizer.peek() !== null; n++) parseValue(tokenizer);
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}
