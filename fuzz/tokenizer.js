/**
 * pdfnative — fuzz target: the PDF tokenizer
 * ==========================================
 * Coverage-guided fuzzing of `createTokenizer` (ISO 32000-1 §7.2 lexical
 * conventions), token by token to the end of the input.
 *
 * The contract every target in this directory shares, and the only thing a
 * crash here ever means: **an `Error` the library throws on purpose is a
 * result; an engine error is a bug.** A `TypeError` from a field that was
 * not there, a `RangeError` from an unchecked `DataView` read or from
 * recursion, an out-of-memory from a declared length — each of those is the
 * parser failing to refuse rather than refusing, and each is what the fuzzer
 * is looking for. Swallowing them would make this file decorative.
 *
 * The specifier is the package's own name, not a relative path: Node
 * resolves it through the `exports` map by self-reference, so the container
 * fuzzes `dist/`, the bytes a consumer installs, while `tests/fuzzing/
 * targets.test.ts` runs the same file against `src/` through the vitest
 * alias. One target, two engines, no second copy to keep in step.
 *
 * @module fuzz/tokenizer
 */

import { createTokenizer } from 'pdfnative';

/**
 * A refusal the library wrote (`throw new Error('…')`, or one of its named
 * error classes) is a result; the five engine error classes are bugs.
 * @param {unknown} error
 * @returns {boolean}
 */
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
        // Every token to the end: a tokenizer that stops making progress on
        // some byte would loop here, which the cap turns into a result.
        for (let n = 0; n < 1_000_000 && tokenizer.next() !== null; n++) { /* next */ }
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}
