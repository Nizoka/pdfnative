/**
 * pdfnative — Shaping Module Index
 * ==================================
 * Re-exports all shaping-related functionality.
 */

export { shapeThaiText, buildThaiClusters } from './thai-shaper.js';
export { shapeBengaliText, buildBengaliClusters } from './bengali-shaper.js';
export { shapeTamilText, buildTamilClusters } from './tamil-shaper.js';
export { needsUnicodeFont, detectFallbackLangs, detectCharLang } from './script-detect.js';
export { splitTextByFont } from './multi-font.js';
export type { FontRun } from './multi-font.js';
export type { BidiType, BidiRun } from './bidi.js';
export { classifyBidiType, detectParagraphLevel, resolveBidiRuns, containsRTL, mirrorCodePoint, reverseString } from './bidi.js';
export { shapeArabicText, isLamAlef } from './arabic-shaper.js';
export {
    ARABIC_START, ARABIC_END, ARABIC_SUPPLEMENT_START, ARABIC_SUPPLEMENT_END,
    ARABIC_EXTENDED_A_START, ARABIC_EXTENDED_A_END, ARABIC_PRES_A_START, ARABIC_PRES_A_END,
    ARABIC_PRES_B_START, ARABIC_PRES_B_END,
    HEBREW_START, HEBREW_END, HEBREW_PRES_START, HEBREW_PRES_END,
    THAI_START, THAI_END,
    GREEK_START, GREEK_END, GREEK_EXT_START, GREEK_EXT_END,
    DEVANAGARI_START, DEVANAGARI_END, DEVANAGARI_EXT_START, DEVANAGARI_EXT_END,
    HIRAGANA_START, KATAKANA_END,
    HANGUL_START, HANGUL_END, JAMO_START, JAMO_END, COMPAT_JAMO_START, COMPAT_JAMO_END,
    CJK_UNIFIED_START, CJK_UNIFIED_END, CJK_EXT_A_START, CJK_EXT_A_END,
    CJK_COMPAT_START, CJK_COMPAT_END,
    CYRILLIC_START, CYRILLIC_END, CYRILLIC_SUPPLEMENT_START, CYRILLIC_SUPPLEMENT_END,
    CYRILLIC_EXT_A_START, CYRILLIC_EXT_A_END, CYRILLIC_EXT_B_START, CYRILLIC_EXT_B_END,
    GEORGIAN_START, GEORGIAN_END, GEORGIAN_SUPPLEMENT_START, GEORGIAN_SUPPLEMENT_END,
    ARMENIAN_START, ARMENIAN_END, ARMENIAN_LIGATURES_START, ARMENIAN_LIGATURES_END,
    BENGALI_START, BENGALI_END,
    TAMIL_START, TAMIL_END,
    isArabicCodepoint, isHebrewCodepoint, isThaiCodepoint,
    isCyrillicCodepoint, isGeorgianCodepoint, isArmenianCodepoint,
    isBengaliCodepoint, isTamilCodepoint,
    containsArabic, containsHebrew, containsThai,
    containsBengali, containsTamil,
} from './script-registry.js';
