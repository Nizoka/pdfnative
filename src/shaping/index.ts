/**
 * pdfnative — Shaping Module Index
 * ==================================
 * Re-exports all shaping-related functionality.
 */

export { shapeThaiText, buildThaiClusters, containsThai, THAI_START, THAI_END } from './thai-shaper.js';
export { needsUnicodeFont, detectFallbackLangs } from './script-detect.js';
export { splitTextByFont } from './multi-font.js';
export type { FontRun } from './multi-font.js';
export type { BidiType, BidiRun } from './bidi.js';
export { classifyBidiType, detectParagraphLevel, resolveBidiRuns, containsRTL, mirrorCodePoint, reverseString } from './bidi.js';
export { shapeArabicText, containsArabic, containsHebrew, isLamAlef, ARABIC_START, ARABIC_END, HEBREW_START, HEBREW_END } from './arabic-shaper.js';
