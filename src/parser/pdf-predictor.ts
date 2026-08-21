/**
 * pdfnative — PNG Predictor Decoder
 * ==================================
 * Undoes PNG predictors (ISO 32000-1 §7.4.4.4) applied before FlateDecode.
 * Leaf module shared by the high-level reader and the xref-stream parser —
 * both sit above it, so neither needs the other for predictor decoding.
 */

import { dictGetNum } from './pdf-object-parser.js';
import type { PdfDict } from './pdf-object-parser.js';

/**
 * Undo a PNG predictor (ISO 32000-1 §7.4.4.4) applied before FlateDecode.
 * Reads `/Columns`, `/Colors` and `/BitsPerComponent` from `parms`
 * (defaults 1 / 1 / 8).
 *
 * @internal
 */
export function decodePNGPredictor(data: Uint8Array, parms: PdfDict): Uint8Array {
    const columns = dictGetNum(parms, 'Columns') ?? 1;
    const colors = dictGetNum(parms, 'Colors') ?? 1;
    const bpc = dictGetNum(parms, 'BitsPerComponent') ?? 8;

    const bytesPerPixel = Math.max(1, Math.floor(colors * bpc / 8));
    const rowBytes = Math.ceil(columns * colors * bpc / 8);
    const srcRowLen = rowBytes + 1; // +1 for filter byte

    if (data.length < srcRowLen) return data;

    const numRows = Math.floor(data.length / srcRowLen);
    const result = new Uint8Array(numRows * rowBytes);
    const prevRow = new Uint8Array(rowBytes);

    for (let row = 0; row < numRows; row++) {
        const srcOffset = row * srcRowLen;
        const filterType = data[srcOffset];
        const dstOffset = row * rowBytes;

        for (let i = 0; i < rowBytes; i++) {
            const raw = data[srcOffset + 1 + i];
            let val: number;

            switch (filterType) {
                case 0: // None
                    val = raw;
                    break;
                case 1: // Sub
                    val = (raw + (i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0)) & 0xFF;
                    break;
                case 2: // Up
                    val = (raw + prevRow[i]) & 0xFF;
                    break;
                case 3: // Average
                    val = (raw + Math.floor(((i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0) + prevRow[i]) / 2)) & 0xFF;
                    break;
                case 4: { // Paeth
                    const a = i >= bytesPerPixel ? result[dstOffset + i - bytesPerPixel] : 0;
                    const b = prevRow[i];
                    const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;
                    val = (raw + paethPredictor(a, b, c)) & 0xFF;
                    break;
                }
                default:
                    val = raw;
            }

            result[dstOffset + i] = val;
        }

        // Save current row as previous for next iteration
        prevRow.set(result.subarray(dstOffset, dstOffset + rowBytes));
    }

    return result;
}

function paethPredictor(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}
