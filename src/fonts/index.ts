/**
 * pdfnative — Fonts Module Index
 * ================================
 * Re-exports all font-related functionality.
 */

export { toWinAnsi, pdfString, truncate, helveticaWidth } from './encoding.js';
export { createEncodingContext } from '../core/encoding-context.js';
export { registerFont, registerFonts, loadFontData, hasFontLoader, getRegisteredLangs, clearFontCache, resetFontRegistry, getDecodedFontBytes } from './font-loader.js';
export type { FontLoader } from './font-loader.js';
export { subsetTTF, ttfChecksum, uint8ToBinaryString } from './font-subsetter.js';
export { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from './font-embedder.js';
