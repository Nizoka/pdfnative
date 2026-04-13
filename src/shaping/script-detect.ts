/**
 * pdfnative — Script Detection
 * =============================
 * Detects Unicode script ranges in text to determine which fonts are needed.
 * Range constants imported from ./script-registry.ts (single source of truth).
 */

import {
    GREEK_START, GREEK_END, GREEK_EXT_START, GREEK_EXT_END,
    DEVANAGARI_START, DEVANAGARI_END, DEVANAGARI_EXT_START, DEVANAGARI_EXT_END,
    HIRAGANA_START, KATAKANA_END,
    HANGUL_START, HANGUL_END, JAMO_START, JAMO_END, COMPAT_JAMO_START, COMPAT_JAMO_END,
    CJK_UNIFIED_START, CJK_UNIFIED_END, CJK_EXT_A_START, CJK_EXT_A_END,
    CJK_COMPAT_START, CJK_COMPAT_END,
    isArabicCodepoint, isHebrewCodepoint, isThaiCodepoint,
    isCyrillicCodepoint, isGeorgianCodepoint, isArmenianCodepoint,
    isBengaliCodepoint, isTamilCodepoint,
} from './script-registry.js';

/**
 * Languages requiring Unicode font embedding (non-WinAnsi scripts).
 * Latin-script languages using Helvetica built-in don't need embedding.
 */
export function needsUnicodeFont(lang: string): boolean {
    return ['th', 'ja', 'zh', 'ko', 'el', 'hi', 'tr', 'vi', 'pl', 'ar', 'he', 'ru', 'ka', 'hy', 'bn', 'ta'].includes(lang);
}

/**
 * Detect which additional font languages are needed to render user text
 * containing scripts foreign to the primary language.
 *
 * @param texts - User-visible strings (labels, categories, account names)
 * @param primaryLang - Current language code
 * @returns Language codes needing fallback fonts (excluding primaryLang)
 */
export function detectFallbackLangs(texts: string[], primaryLang: string): Set<string> {
    const needed = new Set<string>();
    for (const text of texts) {
        if (!text) continue;
        for (let i = 0; i < text.length; i++) {
            const cp = text.codePointAt(i) ?? 0;
            if (cp > 0xFFFF) i++;
            // Greek and Coptic + Greek Extended → 'el'
            if ((cp >= GREEK_START && cp <= GREEK_END) || (cp >= GREEK_EXT_START && cp <= GREEK_EXT_END)) { needed.add('el'); continue; }
            // Hebrew → 'he'
            if (isHebrewCodepoint(cp)) { needed.add('he'); continue; }
            // Arabic → 'ar'
            if (isArabicCodepoint(cp)) { needed.add('ar'); continue; }
            // Devanagari + Devanagari Extended → 'hi'
            if ((cp >= DEVANAGARI_START && cp <= DEVANAGARI_END) || (cp >= DEVANAGARI_EXT_START && cp <= DEVANAGARI_EXT_END)) { needed.add('hi'); continue; }
            // Thai script → 'th'
            if (isThaiCodepoint(cp)) { needed.add('th'); continue; }
            // Cyrillic → 'ru'
            if (isCyrillicCodepoint(cp)) { needed.add('ru'); continue; }
            // Georgian → 'ka'
            if (isGeorgianCodepoint(cp)) { needed.add('ka'); continue; }
            // Armenian → 'hy'
            if (isArmenianCodepoint(cp)) { needed.add('hy'); continue; }
            // Bengali → 'bn'
            if (isBengaliCodepoint(cp)) { needed.add('bn'); continue; }
            // Tamil → 'ta'
            if (isTamilCodepoint(cp)) { needed.add('ta'); continue; }
            // Hiragana / Katakana → 'ja'
            if (cp >= HIRAGANA_START && cp <= KATAKANA_END) { needed.add('ja'); continue; }
            // Hangul Syllables + Jamo + Compat Jamo → 'ko'
            if ((cp >= HANGUL_START && cp <= HANGUL_END) || (cp >= JAMO_START && cp <= JAMO_END) ||
                (cp >= COMPAT_JAMO_START && cp <= COMPAT_JAMO_END)) { needed.add('ko'); continue; }
            // CJK Unified Ideographs → default to 'zh' (SC has broadest coverage)
            if ((cp >= CJK_UNIFIED_START && cp <= CJK_UNIFIED_END) || (cp >= CJK_EXT_A_START && cp <= CJK_EXT_A_END) ||
                (cp >= CJK_COMPAT_START && cp <= CJK_COMPAT_END)) {
                if (!['ja', 'zh', 'ko'].includes(primaryLang)) needed.add('zh');
                continue;
            }
            // Currency symbols
            if (cp === 0x20A9 || cp === 0xFFE6) { needed.add('ko'); continue; }
            if (cp === 0x20B9) { needed.add('hi'); continue; }
            if (cp === 0xFFE5) { needed.add('ja'); continue; }
            // Latin Extended Additional → Vietnamese
            if ((cp >= 0x1E00 && cp <= 0x1EFF) || cp === 0x20AB || cp === 0x0110 || cp === 0x0111 || cp === 0x0103 || cp === 0x0102) { needed.add('vi'); continue; }
            // Polish-specific Latin Extended-A chars
            if (cp === 0x0104 || cp === 0x0105 || cp === 0x0106 || cp === 0x0107 ||
                cp === 0x0118 || cp === 0x0119 || cp === 0x0141 || cp === 0x0142 ||
                cp === 0x0143 || cp === 0x0144 || cp === 0x015A || cp === 0x015B ||
                cp === 0x0179 || cp === 0x017A || cp === 0x017B || cp === 0x017C) { needed.add('pl'); continue; }
            // Latin Extended-A → Turkish special chars + Turkish Lira
            if ((cp >= 0x0100 && cp <= 0x017F) || cp === 0x20BA) { needed.add('tr'); continue; }
        }
    }
    needed.delete(primaryLang);
    return needed;
}

/**
 * Map a single code point to its preferred font language based on Unicode script.
 * Returns the language code for script-specific characters, or null for
 * common/shared characters (Latin, digits, punctuation, spaces) that should
 * use continuation bias in multi-font splitting.
 */
export function detectCharLang(cp: number): string | null {
    // Greek and Coptic + Greek Extended
    if ((cp >= GREEK_START && cp <= GREEK_END) || (cp >= GREEK_EXT_START && cp <= GREEK_EXT_END)) return 'el';
    // Hebrew
    if (isHebrewCodepoint(cp)) return 'he';
    // Arabic
    if (isArabicCodepoint(cp)) return 'ar';
    // Devanagari
    if ((cp >= DEVANAGARI_START && cp <= DEVANAGARI_END) || (cp >= DEVANAGARI_EXT_START && cp <= DEVANAGARI_EXT_END)) return 'hi';
    // Thai
    if (isThaiCodepoint(cp)) return 'th';
    // Cyrillic
    if (isCyrillicCodepoint(cp)) return 'ru';
    // Georgian
    if (isGeorgianCodepoint(cp)) return 'ka';
    // Armenian
    if (isArmenianCodepoint(cp)) return 'hy';
    // Bengali
    if (isBengaliCodepoint(cp)) return 'bn';
    // Tamil
    if (isTamilCodepoint(cp)) return 'ta';
    // Japanese Kana
    if (cp >= HIRAGANA_START && cp <= KATAKANA_END) return 'ja';
    // Korean Hangul
    if ((cp >= HANGUL_START && cp <= HANGUL_END) || (cp >= JAMO_START && cp <= JAMO_END) ||
        (cp >= COMPAT_JAMO_START && cp <= COMPAT_JAMO_END)) return 'ko';
    // CJK Ideographs → default to zh
    if ((cp >= CJK_UNIFIED_START && cp <= CJK_UNIFIED_END) || (cp >= CJK_EXT_A_START && cp <= CJK_EXT_A_END) ||
        (cp >= CJK_COMPAT_START && cp <= CJK_COMPAT_END)) return 'zh';
    // Vietnamese-specific (Latin Extended Additional + specific chars)
    if ((cp >= 0x1E00 && cp <= 0x1EFF) || cp === 0x20AB ||
        cp === 0x0110 || cp === 0x0111 || cp === 0x0103 || cp === 0x0102) return 'vi';
    // Polish-specific
    if (cp === 0x0104 || cp === 0x0105 || cp === 0x0106 || cp === 0x0107 ||
        cp === 0x0118 || cp === 0x0119 || cp === 0x0141 || cp === 0x0142 ||
        cp === 0x0143 || cp === 0x0144 || cp === 0x015A || cp === 0x015B ||
        cp === 0x0179 || cp === 0x017A || cp === 0x017B || cp === 0x017C) return 'pl';
    // Turkish-specific (Latin Extended-A remainder + Lira sign)
    if ((cp >= 0x0100 && cp <= 0x017F) || cp === 0x20BA) return 'tr';
    // Common Latin, digits, punctuation, spaces → no preferred font
    return null;
}
