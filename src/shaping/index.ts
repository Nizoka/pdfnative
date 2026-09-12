/**
 * pdfnative — Shaping Module Index
 * ==================================
 * Internal barrel for the shaping layer. Not a package entry point: the
 * public surface is `src/index.ts`.
 *
 * Until v1.8.0 this file re-exported Thai and nothing else, eight scripts
 * after Thai stopped being the only one. It now tracks the layer.
 */

// ── Shaper registry ──────────────────────────────────────────────────
export { SCRIPT_SHAPERS, findShaper } from './shaper-registry.js';
export type { ScriptShaper } from './shaper-registry.js';

// ── Universal Shaping Engine ─────────────────────────────────────────
export {
    useCategory, useCategories, splitUseSyllables, reorderUseCluster,
    USE_UNICODE_VERSION,
} from './use-engine.js';
export type { UseClusterCategory, UseSyllable, UseSyllableType } from './use-engine.js';

// ── Per-script shapers ───────────────────────────────────────────────
export { shapeThaiText, buildThaiClusters } from './thai-shaper.js';
export { shapeBengaliText } from './bengali-shaper.js';
export { shapeTamilText } from './tamil-shaper.js';
export { shapeTeluguText } from './telugu-shaper.js';
export { shapeSinhalaText } from './sinhala-shaper.js';
export { shapeTibetanText } from './tibetan-shaper.js';
export { shapeKhmerText } from './khmer-shaper.js';
export { shapeMyanmarText } from './myanmar-shaper.js';
export { shapeDevanagariText } from './devanagari-shaper.js';
export { shapeArabicText } from './arabic-shaper.js';

// ── Script identification ────────────────────────────────────────────
export {
    THAI_START, THAI_END,
    containsThai, containsArabic, containsHebrew,
    containsBengali, containsTamil, containsTelugu, containsDevanagari,
    containsSinhala, containsTibetan, containsKhmer, containsMyanmar,
    containsEthiopic, containsMath,
    isArabicCodepoint, isHebrewCodepoint, isThaiCodepoint,
    isBengaliCodepoint, isTamilCodepoint, isTeluguCodepoint, isDevanagariCodepoint,
    isSinhalaCodepoint, isTibetanCodepoint, isKhmerCodepoint, isMyanmarCodepoint,
    isEthiopicCodepoint, isCyrillicCodepoint, isGeorgianCodepoint,
    isArmenianCodepoint, isMathCodepoint,
} from './script-registry.js';
export { needsUnicodeFont, detectFallbackLangs, detectCharLang } from './script-detect.js';

// ── Font routing ─────────────────────────────────────────────────────
export { splitTextByFont } from './multi-font.js';
export type { FontRun } from './multi-font.js';

// ── Bidirectional text ───────────────────────────────────────────────
export {
    resolveBidiRuns, containsRTL, reverseString,
    normalizeBidiEmbeddings, stripBidiControls,
} from './bidi.js';
export type { BidiRun } from './bidi.js';

// ── OpenType drivers ─────────────────────────────────────────────────
export { hasSequenceTriggers, matchEmojiSequences } from './emoji-sequences.js';
