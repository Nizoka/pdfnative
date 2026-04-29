/**
 * Tests for Phase 3 v1.1.0 emoji monochrome support.
 *
 * Covers:
 *   - EMOJI_RANGES constant + isEmojiCodepoint() predicate
 *   - containsEmoji() string scanner
 *   - script-detect routing: detectCharLang() returns 'emoji'
 *   - detectFallbackLangs() picks up 'emoji' for relevant strings
 *   - needsUnicodeFont('emoji') === true
 *   - Noto Emoji baked module exposes expected metrics + cmap entries
 */

import { describe, it, expect } from 'vitest';
import {
    isEmojiCodepoint,
    containsEmoji,
    EMOJI_RANGES,
    FITZPATRICK_START,
    FITZPATRICK_END,
    ZWJ,
    VS15,
    VS16,
} from '../../src/shaping/script-registry.js';
import {
    detectCharLang,
    detectFallbackLangs,
    needsUnicodeFont,
} from '../../src/shaping/script-detect.js';
import * as notoEmojiData from '../../fonts/noto-emoji-data.js';

describe('Emoji ranges and predicates', () => {
    it('exposes EMOJI_RANGES with all expected blocks', () => {
        expect(EMOJI_RANGES.length).toBeGreaterThanOrEqual(13);
        // Check key blocks are covered
        const flat = EMOJI_RANGES.flat();
        expect(flat).toContain(0x1F600); // Emoticons start
        expect(flat).toContain(0x1F64F); // Emoticons end
        expect(flat).toContain(0x1F300); // Misc Symbols and Pictographs start
    });

    it('isEmojiCodepoint matches emoticons (U+1F600 GRINNING FACE)', () => {
        expect(isEmojiCodepoint(0x1F600)).toBe(true);
    });

    it('isEmojiCodepoint matches dingbats (U+2728 SPARKLES)', () => {
        expect(isEmojiCodepoint(0x2728)).toBe(true);
    });

    it('isEmojiCodepoint matches Fitzpatrick skin-tone modifiers', () => {
        expect(isEmojiCodepoint(FITZPATRICK_START)).toBe(true);
        expect(isEmojiCodepoint(FITZPATRICK_END)).toBe(true);
        expect(isEmojiCodepoint(0x1F3FC)).toBe(true);
    });

    it('isEmojiCodepoint rejects Latin / digits / Hebrew / Arabic', () => {
        expect(isEmojiCodepoint(0x0041)).toBe(false); // A
        expect(isEmojiCodepoint(0x0030)).toBe(false); // 0
        expect(isEmojiCodepoint(0x05D0)).toBe(false); // alef
        expect(isEmojiCodepoint(0x0628)).toBe(false); // beh
    });

    it('exposes ZWJ + VS-15 + VS-16 constants', () => {
        expect(ZWJ).toBe(0x200D);
        expect(VS15).toBe(0xFE0E);
        expect(VS16).toBe(0xFE0F);
    });

    it('containsEmoji finds emoji in plane-1 surrogate pairs', () => {
        expect(containsEmoji('Hello \u{1F600} world')).toBe(true);
        expect(containsEmoji('Plain ASCII text')).toBe(false);
        expect(containsEmoji('No emoji \u{2728}')).toBe(true); // dingbat
    });
});

describe('Emoji integration with script-detect', () => {
    it('detectCharLang returns "emoji" for emoji codepoints', () => {
        expect(detectCharLang(0x1F600)).toBe('emoji');
        expect(detectCharLang(0x2728)).toBe('emoji');
        expect(detectCharLang(0x1F3FC)).toBe('emoji'); // skin tone
    });

    it('detectCharLang still returns null for plain Latin', () => {
        expect(detectCharLang(0x0041)).toBeNull(); // A
        expect(detectCharLang(0x0030)).toBeNull(); // 0
    });

    it('detectFallbackLangs adds "emoji" when emoji codepoints appear', () => {
        const langs = detectFallbackLangs(['Hi \u{1F44B} there'], 'en');
        expect(langs.has('emoji')).toBe(true);
    });

    it('detectFallbackLangs omits "emoji" when no emoji are present', () => {
        const langs = detectFallbackLangs(['plain English text'], 'en');
        expect(langs.has('emoji')).toBe(false);
    });

    it('needsUnicodeFont("emoji") returns true', () => {
        expect(needsUnicodeFont('emoji')).toBe(true);
    });
});

describe('Noto Emoji baked module', () => {
    it('exports a CIDFontType2-compatible FontData shape', () => {
        expect(notoEmojiData.fontName).toBe('NotoEmoji-Regular');
        expect(notoEmojiData.metrics.unitsPerEm).toBeGreaterThan(0);
        expect(notoEmojiData.metrics.numGlyphs).toBeGreaterThan(1000);
    });

    it('includes common emoji codepoints in cmap', () => {
        expect(notoEmojiData.cmap[0x1F600]).toBeGreaterThan(0); // grinning face
        expect(notoEmojiData.cmap[0x2728]).toBeGreaterThan(0);  // sparkles
    });

    it('exposes ttfBase64 + pdfWidthArray for embedding', () => {
        expect(notoEmojiData.ttfBase64.length).toBeGreaterThan(1000);
        expect(typeof notoEmojiData.pdfWidthArray).toBe('string');
    });
});
