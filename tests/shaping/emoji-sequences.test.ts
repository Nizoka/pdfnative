import { describe, it, expect } from 'vitest';
import { hasSequenceTriggers, matchEmojiSequences, isSequenceCodepoint } from '../../src/shaping/emoji-sequences.js';
import { splitTextByFont } from '../../src/shaping/multi-font.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

// Synthetic sequence-capable font: FR/DE flags + 👨‍💻 + ❤️‍🔥.
const ZWJ = 0x200D, VS16 = 0xFE0F;
const seqFont = {
    metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, capHeight: 700, stemV: 80, bbox: [0, 0, 1000, 1000], defaultWidth: 600, numGlyphs: 100 },
    fontName: 'SeqTest',
    cmap: { 0x20: 3, 0x1F600: 10, 0x2764: 11 },
    defaultWidth: 600,
    widths: { 3: 250, 10: 1275, 11: 1275, 90: 1275, 91: 1275, 92: 1275, 93: 1275 },
    pdfWidthArray: '',
    ttfBase64: '',
    gsub: {},
    ligatures: null,
    markAnchors: null,
    mark2mark: null,
    sequences: {
        0x1F1EB: [[90, 0x1F1F7]],                    // 🇫🇷 → gid 90
        0x1F1E9: [[91, 0x1F1EA]],                    // 🇩🇪 → gid 91
        0x1F468: [[92, ZWJ, 0x1F4BB]],               // 👨‍💻 → gid 92
        0x2764: [[93, VS16, ZWJ, 0x1F525]],          // ❤️‍🔥 → gid 93
    },
} as unknown as FontData;

const plainFont = { ...(seqFont as object), sequences: null } as unknown as FontData;

describe('hasSequenceTriggers', () => {
    it('detects ZWJ, VS-16, regional indicators and skin tones', () => {
        expect(hasSequenceTriggers('a‍b')).toBe(true);
        expect(hasSequenceTriggers('❤️')).toBe(true);
        expect(hasSequenceTriggers('\u{1F1EB}\u{1F1F7}')).toBe(true);
        expect(hasSequenceTriggers('\u{1F44D}\u{1F3FD}')).toBe(true);
    });

    it('stays false for ordinary text and single-codepoint emoji', () => {
        expect(hasSequenceTriggers('hello world')).toBe(false);
        expect(hasSequenceTriggers('\u{1F600}')).toBe(false);
    });
});

describe('isSequenceCodepoint', () => {
    it('covers joiners, VS-16, skin tones, and regional indicators', () => {
        expect(isSequenceCodepoint(0x200D)).toBe(true);
        expect(isSequenceCodepoint(0xFE0F)).toBe(true);
        expect(isSequenceCodepoint(0x1F3FB)).toBe(true);
        expect(isSequenceCodepoint(0x1F1E6)).toBe(true);
        expect(isSequenceCodepoint(0x41)).toBe(false);
        expect(isSequenceCodepoint(0x1F600)).toBe(false);
    });
});

describe('matchEmojiSequences', () => {
    it('matches a flag pair to its ligature gid', () => {
        const pieces = matchEmojiSequences('\u{1F1EB}\u{1F1F7}', seqFont);
        expect(pieces).toEqual([{ gid: 90, text: '\u{1F1EB}\u{1F1F7}' }]);
    });

    it('matches back-to-back flags without bleeding across pairs', () => {
        const pieces = matchEmojiSequences('\u{1F1EB}\u{1F1F7}\u{1F1E9}\u{1F1EA}', seqFont);
        expect(pieces.map(p => p.gid)).toEqual([90, 91]);
    });

    it('matches a ZWJ sequence and keeps surrounding text', () => {
        const pieces = matchEmojiSequences('hi \u{1F468}‍\u{1F4BB}!', seqFont);
        expect(pieces).toEqual([
            { gid: null, text: 'hi ' },
            { gid: 92, text: '\u{1F468}‍\u{1F4BB}' },
            { gid: null, text: '!' },
        ]);
    });

    it('prefers the longest entry (greedy longest-match)', () => {
        const twoTier = {
            ...(seqFont as object),
            sequences: {
                0x1F468: [
                    [95, ZWJ, 0x1F469, ZWJ, 0x1F467], // 👨‍👩‍👧 (longest first)
                    [92, ZWJ, 0x1F469],
                ],
            },
        } as unknown as FontData;
        const pieces = matchEmojiSequences('\u{1F468}‍\u{1F469}‍\u{1F467}', twoTier);
        expect(pieces.map(p => p.gid)).toEqual([95]);
    });

    it('drops unmatched joiners exactly like the historical pipeline', () => {
        // 👨‍🚀 is not in this font's table: components pass through, joiners drop.
        const pieces = matchEmojiSequences('\u{1F468}‍\u{1F680}', seqFont);
        expect(pieces).toEqual([{ gid: null, text: '\u{1F468}\u{1F680}' }]);
    });

    it('passes unmatched regional indicators through for cmap fallback', () => {
        const pieces = matchEmojiSequences('\u{1F1FF}\u{1F1FF}', seqFont);
        expect(pieces).toEqual([{ gid: null, text: '\u{1F1FF}\u{1F1FF}' }]);
    });

    it('handles a font without a table as pure passthrough', () => {
        const pieces = matchEmojiSequences('\u{1F1EB}\u{1F1F7}', plainFont);
        expect(pieces).toEqual([{ gid: null, text: '\u{1F1EB}\u{1F1F7}' }]);
    });
});

describe('splitTextByFont with sequence fonts', () => {
    const latin = {
        ...(seqFont as object),
        sequences: null,
        cmap: { 0x20: 3, 0x41: 4, 0x42: 5, 0x61: 6, 0x62: 7, 0x69: 8, 0x68: 9 },
    } as unknown as FontData;
    const latinEntry: FontEntry = { fontData: latin, fontRef: '/F2', lang: 'latin' };
    const seqEntry: FontEntry = { fontData: seqFont, fontRef: '/F3', lang: 'emoji' };

    it('routes a flag pair to the sequence font and keeps it intact', () => {
        const runs = splitTextByFont('hi \u{1F1EB}\u{1F1F7}', [latinEntry, seqEntry]);
        const emojiRun = runs.find(r => r.entry === seqEntry);
        expect(emojiRun).toBeDefined();
        expect(emojiRun!.text).toContain('\u{1F1EB}\u{1F1F7}');
    });

    it('keeps ZWJ inside the sequence-font run', () => {
        const runs = splitTextByFont('\u{1F468}‍\u{1F4BB}', [latinEntry, seqEntry]);
        // Wait: 1F468 is not in seqFont.cmap — selection must come from sequences key.
        const emojiRun = runs.find(r => r.entry === seqEntry);
        expect(emojiRun).toBeDefined();
        expect(emojiRun!.text).toBe('\u{1F468}‍\u{1F4BB}');
    });

    it('still drops joiners for fonts without sequence tables', () => {
        const runs = splitTextByFont('a‍b', [latinEntry, { fontData: plainFont, fontRef: '/F3', lang: 'emoji' }]);
        const joined = runs.map(r => r.text).join('');
        expect(joined).toBe('ab');
    });
});
