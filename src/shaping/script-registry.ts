/**
 * pdfnative — Script Registry
 * ============================
 * Centralised Unicode range constants and script detection predicates.
 * Single source of truth for all script identification logic.
 */

// ── Arabic ───────────────────────────────────────────────────────────

/** Arabic Unicode block start. */
export const ARABIC_START = 0x0600;
/** Arabic Unicode block end. */
export const ARABIC_END = 0x06FF;
/** Arabic Supplement block. */
export const ARABIC_SUPPLEMENT_START = 0x0750;
export const ARABIC_SUPPLEMENT_END = 0x077F;
/** Arabic Extended-A block. */
export const ARABIC_EXTENDED_A_START = 0x08A0;
export const ARABIC_EXTENDED_A_END = 0x08FF;
/** Arabic Presentation Forms-A. */
export const ARABIC_PRES_A_START = 0xFB50;
export const ARABIC_PRES_A_END = 0xFDFF;
/** Arabic Presentation Forms-B. */
export const ARABIC_PRES_B_START = 0xFE70;
export const ARABIC_PRES_B_END = 0xFEFF;

// ── Hebrew ───────────────────────────────────────────────────────────

/** Hebrew Unicode block. */
export const HEBREW_START = 0x0590;
export const HEBREW_END = 0x05FF;
/** Hebrew Presentation Forms. */
export const HEBREW_PRES_START = 0xFB1D;
export const HEBREW_PRES_END = 0xFB4F;

// ── Thai ─────────────────────────────────────────────────────────────

/** Thai Unicode block. */
export const THAI_START = 0x0E00;
export const THAI_END = 0x0E7F;

// ── Greek ────────────────────────────────────────────────────────────

export const GREEK_START = 0x0370;
export const GREEK_END = 0x03FF;
export const GREEK_EXT_START = 0x1F00;
export const GREEK_EXT_END = 0x1FFF;

// ── Devanagari ───────────────────────────────────────────────────────

export const DEVANAGARI_START = 0x0900;
export const DEVANAGARI_END = 0x097F;
export const DEVANAGARI_EXT_START = 0xA8E0;
export const DEVANAGARI_EXT_END = 0xA8FF;

// ── CJK / Kana / Hangul ─────────────────────────────────────────────

export const HIRAGANA_START = 0x3040;
export const KATAKANA_END = 0x30FF;
export const HANGUL_START = 0xAC00;
export const HANGUL_END = 0xD7AF;
export const JAMO_START = 0x1100;
export const JAMO_END = 0x11FF;
export const COMPAT_JAMO_START = 0x3130;
export const COMPAT_JAMO_END = 0x318F;
export const CJK_UNIFIED_START = 0x4E00;
export const CJK_UNIFIED_END = 0x9FFF;
export const CJK_EXT_A_START = 0x3400;
export const CJK_EXT_A_END = 0x4DBF;
export const CJK_COMPAT_START = 0xF900;
export const CJK_COMPAT_END = 0xFAFF;

// ── Cyrillic ─────────────────────────────────────────────────────────

export const CYRILLIC_START = 0x0400;
export const CYRILLIC_END = 0x04FF;
export const CYRILLIC_SUPPLEMENT_START = 0x0500;
export const CYRILLIC_SUPPLEMENT_END = 0x052F;
export const CYRILLIC_EXT_A_START = 0x2DE0;
export const CYRILLIC_EXT_A_END = 0x2DFF;
export const CYRILLIC_EXT_B_START = 0xA640;
export const CYRILLIC_EXT_B_END = 0xA69F;

// ── Georgian ─────────────────────────────────────────────────────────

export const GEORGIAN_START = 0x10A0;
export const GEORGIAN_END = 0x10FF;
export const GEORGIAN_SUPPLEMENT_START = 0x2D00;
export const GEORGIAN_SUPPLEMENT_END = 0x2D2F;

// ── Armenian ─────────────────────────────────────────────────────────

export const ARMENIAN_START = 0x0530;
export const ARMENIAN_END = 0x058F;
export const ARMENIAN_LIGATURES_START = 0xFB13;
export const ARMENIAN_LIGATURES_END = 0xFB17;

// ── Bengali ──────────────────────────────────────────────────────────

/** Bengali Unicode block. */
export const BENGALI_START = 0x0980;
export const BENGALI_END = 0x09FF;

// ── Tamil ────────────────────────────────────────────────────────────

/** Tamil Unicode block. */
export const TAMIL_START = 0x0B80;
export const TAMIL_END = 0x0BFF;

// ── Script Predicates ────────────────────────────────────────────────

/** Check if a codepoint falls in any Arabic Unicode block. */
export function isArabicCodepoint(cp: number): boolean {
    return (cp >= ARABIC_START && cp <= ARABIC_END) ||
           (cp >= ARABIC_SUPPLEMENT_START && cp <= ARABIC_SUPPLEMENT_END) ||
           (cp >= ARABIC_EXTENDED_A_START && cp <= ARABIC_EXTENDED_A_END) ||
           (cp >= ARABIC_PRES_A_START && cp <= ARABIC_PRES_A_END) ||
           (cp >= ARABIC_PRES_B_START && cp <= ARABIC_PRES_B_END);
}

/** Check if a codepoint falls in any Hebrew Unicode block. */
export function isHebrewCodepoint(cp: number): boolean {
    return (cp >= HEBREW_START && cp <= HEBREW_END) ||
           (cp >= HEBREW_PRES_START && cp <= HEBREW_PRES_END);
}

/** Check if a codepoint falls in the Thai Unicode block. */
export function isThaiCodepoint(cp: number): boolean {
    return cp >= THAI_START && cp <= THAI_END;
}

/** Check if a codepoint falls in any Cyrillic Unicode block. */
export function isCyrillicCodepoint(cp: number): boolean {
    return (cp >= CYRILLIC_START && cp <= CYRILLIC_END) ||
           (cp >= CYRILLIC_SUPPLEMENT_START && cp <= CYRILLIC_SUPPLEMENT_END) ||
           (cp >= CYRILLIC_EXT_A_START && cp <= CYRILLIC_EXT_A_END) ||
           (cp >= CYRILLIC_EXT_B_START && cp <= CYRILLIC_EXT_B_END);
}

/** Check if a codepoint falls in any Georgian Unicode block. */
export function isGeorgianCodepoint(cp: number): boolean {
    return (cp >= GEORGIAN_START && cp <= GEORGIAN_END) ||
           (cp >= GEORGIAN_SUPPLEMENT_START && cp <= GEORGIAN_SUPPLEMENT_END);
}

/** Check if a codepoint falls in any Armenian Unicode block. */
export function isArmenianCodepoint(cp: number): boolean {
    return (cp >= ARMENIAN_START && cp <= ARMENIAN_END) ||
           (cp >= ARMENIAN_LIGATURES_START && cp <= ARMENIAN_LIGATURES_END);
}

/** Check if a codepoint falls in the Bengali Unicode block. */
export function isBengaliCodepoint(cp: number): boolean {
    return cp >= BENGALI_START && cp <= BENGALI_END;
}

/** Check if a codepoint falls in the Tamil Unicode block. */
export function isTamilCodepoint(cp: number): boolean {
    return cp >= TAMIL_START && cp <= TAMIL_END;
}

// ── Text-Level Detection ─────────────────────────────────────────────

/** Check if text contains Arabic characters requiring shaping. */
export function containsArabic(text: string): boolean {
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        if (isArabicCodepoint(cp)) return true;
        i += cp > 0xFFFF ? 2 : 1;
    }
    return false;
}

/** Check if text contains Hebrew characters. */
export function containsHebrew(text: string): boolean {
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        if (isHebrewCodepoint(cp)) return true;
        i += cp > 0xFFFF ? 2 : 1;
    }
    return false;
}

/** Check whether a string contains any Thai characters. */
export function containsThai(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        if (isThaiCodepoint(str.charCodeAt(i))) return true;
    }
    return false;
}

/** Check whether a string contains any Bengali characters. */
export function containsBengali(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        if (isBengaliCodepoint(str.charCodeAt(i))) return true;
    }
    return false;
}

/** Check whether a string contains any Tamil characters. */
export function containsTamil(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
        if (isTamilCodepoint(str.charCodeAt(i))) return true;
    }
    return false;
}
