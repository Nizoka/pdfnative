/**
 * pdfnative — Shaping Module Index
 * ==================================
 * Re-exports all shaping-related functionality.
 */

export { shapeThaiText, buildThaiClusters, containsThai, THAI_START, THAI_END } from './thai-shaper.js';
export { needsUnicodeFont, detectFallbackLangs } from './script-detect.js';
export { splitTextByFont } from './multi-font.js';
export type { FontRun } from './multi-font.js';
