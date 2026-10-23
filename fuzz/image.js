/**
 * pdfnative — fuzz target: the image header parsers
 * =================================================
 * Coverage-guided fuzzing of `parseImage` (format detection, the JPEG SOF
 * walk, the PNG IHDR/PLTE/tRNS/IDAT chain and its inflate, the JPEG 2000
 * box walk and SIZ header) and of `parseJPX` called directly, so the JP2 box
 * reader sees inputs the signature check would otherwise turn away.
 *
 * Contract (shared by every target in this directory): an `Error` the library
 * throws on purpose is a result; a `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError` or `URIError` is a bug and is rethrown.
 * See fuzz/tokenizer.js for the reasoning and for why the specifier is the
 * package's own name.
 *
 * @module fuzz/image
 */

import { parseImage, parseJPX } from 'pdfnative';

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
    for (const parse of [parseImage, parseJPX]) {
        try {
            parse(bytes);
        } catch (error) {
            if (!isRefusal(error)) throw error;
        }
    }
}
