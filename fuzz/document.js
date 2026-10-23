/**
 * pdfnative — fuzz target: a whole document
 * =========================================
 * Coverage-guided fuzzing of the reader as a consumer uses it: `openPdf`
 * (xref, trailer, decryption), every object the cross-reference table names,
 * the page tree, the Info dictionary, `extractText` (content streams, fonts,
 * ToUnicode CMaps, marked content), `listSignatures` (AcroForm, /Sig
 * dictionaries) and the two validators, which read the whole file again on
 * their own terms.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/document
 */

import { extractText, listSignatures, openPdf, validatePdfUA, validatePdfX } from 'pdfnative';

/** @param {unknown} error @returns {boolean} */
function isRefusal(error) {
    return error instanceof Error
        && !(error instanceof TypeError) && !(error instanceof RangeError)
        && !(error instanceof ReferenceError) && !(error instanceof SyntaxError)
        && !(error instanceof URIError);
}

/** Run one reader entry point; a refusal ends it, a bug propagates. @param {() => unknown} step */
function attempt(step) {
    try {
        step();
    } catch (error) {
        if (!isRefusal(error)) throw error;
    }
}

/**
 * @param {Buffer} data Bytes chosen by the fuzzer.
 * @returns {void}
 */
export function fuzz(data) {
    const bytes = new Uint8Array(data);
    attempt(() => {
        const reader = openPdf(bytes);
        // Every object the xref names, capped: a table that declares a
        // million entries is a result, not an invitation.
        let n = 0;
        for (const num of reader.xref.entries.keys()) {
            if (++n > 4096) break;
            attempt(() => reader.getObject(num));
        }
        for (let i = 0; i < Math.min(reader.pageCount, 16); i++) attempt(() => reader.getPage(i));
        attempt(() => reader.getInfo());
    });
    // The text cap is lowered from the 16 million default: the fuzzer's job
    // is the parser, not a memory benchmark.
    attempt(() => extractText(bytes, { maxTextLength: 1 << 20 }));
    attempt(() => listSignatures(bytes));
    attempt(() => validatePdfX(bytes));
    attempt(() => validatePdfUA(bytes));
}
