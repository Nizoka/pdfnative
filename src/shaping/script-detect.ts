/**
 * pdfnative — Script Detection
 * =============================
 * Detects Unicode script ranges in text to determine which fonts are needed.
 */

import { isEmojiCodepoint } from './script-registry.js';

/**
 * Languages requiring Unicode font embedding (non-WinAnsi scripts).
 * Latin-script languages using Helvetica built-in don't need embedding.
 */
export function needsUnicodeFont(lang: string): boolean {
    return ['th', 'ja', 'zh', 'ko', 'el', 'hi', 'tr', 'vi', 'pl', 'ar', 'he', 'ru', 'ka', 'hy', 'emoji'].includes(lang);
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
            if ((cp >= 0x0370 && cp <= 0x03FF) || (cp >= 0x1F00 && cp <= 0x1FFF)) { needed.add('el'); continue; }
            // Devanagari + Devanagari Extended → 'hi'
            if ((cp >= 0x0900 && cp <= 0x097F) || (cp >= 0xA8E0 && cp <= 0xA8FF)) { needed.add('hi'); continue; }
            // Thai script → 'th'
            if (cp >= 0x0E00 && cp <= 0x0E7F) { needed.add('th'); continue; }
            // Hiragana / Katakana → 'ja'
            if (cp >= 0x3040 && cp <= 0x30FF) { needed.add('ja'); continue; }
            // Hangul Syllables + Jamo + Compat Jamo → 'ko'
            if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) ||
                (cp >= 0x3130 && cp <= 0x318F)) { needed.add('ko'); continue; }
            // CJK Unified Ideographs → default to 'zh' (SC has broadest coverage)
            if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
                (cp >= 0xF900 && cp <= 0xFAFF)) {
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
            // Hebrew → 'he'
            if (cp >= 0x0590 && cp <= 0x05FF) { needed.add('he'); continue; }
            // Arabic → 'ar'
            if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) { needed.add('ar'); continue; }
            // Cyrillic + Cyrillic Supplement → 'ru'
            if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F)) { needed.add('ru'); continue; }
            // Georgian + Georgian Supplement → 'ka'
            if ((cp >= 0x10A0 && cp <= 0x10FF) || (cp >= 0x2D00 && cp <= 0x2D2F)) { needed.add('ka'); continue; }
            // Armenian + Armenian Ligatures → 'hy'
            if ((cp >= 0x0530 && cp <= 0x058F) || (cp >= 0xFB13 && cp <= 0xFB17)) { needed.add('hy'); continue; }
            // Emoji ranges → 'emoji'  (v1.1.0)
            if (isEmojiCodepoint(cp)) { needed.add('emoji'); continue; }
        }
    }
    needed.delete(primaryLang);
    return needed;
}

/**
 * Detect the preferred font language for a single Unicode codepoint.
 * Returns the language code of the font most appropriate for rendering.
 *
 * @param cp - Unicode codepoint
 * @returns Language code ('el', 'hi', 'th', 'ja', 'ko', 'zh', 'vi', 'pl', 'tr', 'he', 'ar', 'ru', 'ka', 'hy', 'emoji') or null for Latin/common
 */
export function detectCharLang(cp: number): string | null {
    if ((cp >= 0x0370 && cp <= 0x03FF) || (cp >= 0x1F00 && cp <= 0x1FFF)) return 'el';
    if ((cp >= 0x0900 && cp <= 0x097F) || (cp >= 0xA8E0 && cp <= 0xA8FF)) return 'hi';
    if (cp >= 0x0E00 && cp <= 0x0E7F) return 'th';
    if (cp >= 0x3040 && cp <= 0x30FF) return 'ja';
    if ((cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F)) return 'ko';
    if ((cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0xF900 && cp <= 0xFAFF)) return 'zh';
    if ((cp >= 0x1E00 && cp <= 0x1EFF) || cp === 0x20AB || cp === 0x0110 || cp === 0x0111 || cp === 0x0103 || cp === 0x0102) return 'vi';
    if (cp === 0x0104 || cp === 0x0105 || cp === 0x0106 || cp === 0x0107 ||
        cp === 0x0118 || cp === 0x0119 || cp === 0x0141 || cp === 0x0142 ||
        cp === 0x0143 || cp === 0x0144 || cp === 0x015A || cp === 0x015B ||
        cp === 0x0179 || cp === 0x017A || cp === 0x017B || cp === 0x017C) return 'pl';
    if ((cp >= 0x0100 && cp <= 0x017F) || cp === 0x20BA) return 'tr';
    // Hebrew
    if (cp >= 0x0590 && cp <= 0x05FF) return 'he';
    // Arabic + Arabic Supplement + Arabic Presentation Forms
    if ((cp >= 0x0600 && cp <= 0x06FF) || (cp >= 0x0750 && cp <= 0x077F) || (cp >= 0xFB50 && cp <= 0xFDFF) || (cp >= 0xFE70 && cp <= 0xFEFF)) return 'ar';
    // Cyrillic + Cyrillic Supplement
    if ((cp >= 0x0400 && cp <= 0x04FF) || (cp >= 0x0500 && cp <= 0x052F)) return 'ru';
    // Georgian + Georgian Supplement
    if ((cp >= 0x10A0 && cp <= 0x10FF) || (cp >= 0x2D00 && cp <= 0x2D2F)) return 'ka';
    // Armenian + Armenian Ligatures
    if ((cp >= 0x0530 && cp <= 0x058F) || (cp >= 0xFB13 && cp <= 0xFB17)) return 'hy';
    // Emoji — must come last so plane-0 ranges (Greek, Hebrew, Arabic, etc.)
    // win for codepoints they share with the dingbats/symbols blocks. (v1.1.0)
    if (isEmojiCodepoint(cp)) return 'emoji';
    return null;
}
