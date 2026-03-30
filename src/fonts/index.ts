/**
 * pdfnative — Fonts Module Index
 * ================================
 * Re-exports all font-related functionality.
 */

export { toWinAnsi, pdfString, truncate, helveticaWidth, createEncodingContext } from './encoding.js';
export { registerFont, registerFonts, loadFontData, hasFontLoader, getRegisteredLangs, clearFontCache, resetFontRegistry } from './font-loader.js';
export type { FontLoader } from './font-loader.js';
export { subsetTTF, ttfChecksum } from './font-subsetter.js';
export { base64ToByteString, buildToUnicodeCMap, buildSubsetWidthArray } from './font-embedder.js';
