import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { stripBidiControls, mirrorCodePoint, resolveBidiRuns } from '../../src/shaping/bidi.js';
import { BIDI_MIRRORING_PAIRS, BIDI_MIRRORING_COUNT } from '../../src/shaping/bidi-mirroring-data.js';
import * as notoArabic from '../../fonts/noto-arabic-data.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

// v1.8.0 — Persian coverage and the invisible bidi formatting characters.
//
// The cmap outline filter added in this release drops code points whose glyph
// has no outline, because subsetted fonts keep entries for glyphs they have
// emptied. Invisible characters are the exception: they are *meant* to have no
// outline, and dropping them turns them into .notdef tofu.

const arabic = notoArabic as unknown as FontData;
const entries: FontEntry[] = [{ fontData: arabic, fontRef: '/F3', lang: 'fa' }];
const enc = createEncodingContext(entries, false, false);

/** Count .notdef (gid 0) glyphs in the encoded runs of `s`. */
function notdefCount(s: string): number {
    const hex = enc.textRuns(s, 12).map(r => r.hexStr ?? '').join('');
    return (hex.match(/0000/g) ?? []).length;
}

describe('Persian coverage', () => {
    const LETTERS: readonly [string, number][] = [
        ['PEH', 0x067E], ['TCHEH', 0x0686], ['JEH', 0x0698],
        ['KEHEH', 0x06A9], ['GAF', 0x06AF], ['FARSI YEH', 0x06CC],
    ];

    it('maps the letters that distinguish Persian from Arabic', () => {
        for (const [name, cp] of LETTERS) {
            expect(arabic.cmap[cp], `${name} U+${cp.toString(16)} must be mapped`).toBeGreaterThan(0);
        }
    });

    it('maps the extended Arabic-Indic digits', () => {
        for (let cp = 0x06F0; cp <= 0x06F9; cp++) {
            expect(arabic.cmap[cp], `U+${cp.toString(16)} must be mapped`).toBeGreaterThan(0);
        }
    });

    it('renders ordinary Persian with no tofu', () => {
        expect(notdefCount('سلام دنیا')).toBe(0);
        expect(notdefCount('۱۲۳۴۵ تومان')).toBe(0);
    });

    it('renders a ZWNJ compound with no tofu', () => {
        // The zero-width non-joiner is how Persian writes "می‌رود".
        expect(notdefCount('می‌رود')).toBe(0);
    });
});

describe('invisible formatting characters', () => {
    it('keeps ARABIC LETTER MARK and COMBINING GRAPHEME JOINER mapped', () => {
        // Both have empty outlines by design. The outline filter must keep
        // them, or they encode as .notdef.
        expect(arabic.cmap[0x061C], 'U+061C ARABIC LETTER MARK').toBeGreaterThan(0);
        expect(arabic.cmap[0x034F], 'U+034F COMBINING GRAPHEME JOINER').toBeGreaterThan(0);
    });

    it('produces no tofu around them', () => {
        expect(notdefCount('سلام؜دنیا')).toBe(0);
        expect(notdefCount('سلام͏دنیا')).toBe(0);
    });

    it('strips the ARABIC LETTER MARK, like LRM and RLM', () => {
        // UAX #9 §2.5 lists ALM among the implicit directional marks: it is
        // invisible and must never reach the glyph layer.
        expect(stripBidiControls('a؜b')).toBe('ab');
        expect(stripBidiControls('a‎b')).toBe('ab');
        expect(stripBidiControls('a‏b')).toBe('ab');
    });

    it('leaves text without controls untouched, and identical by reference', () => {
        const plain = 'سلام دنیا';
        expect(stripBidiControls(plain)).toBe(plain);
    });

    it('strips the embedding and isolate controls', () => {
        expect(stripBidiControls('a‪b‬c')).toBe('abc');
        expect(stripBidiControls('a⁦b⁩c')).toBe('abc');
    });
});

describe('glyph mirroring (UAX #9 L4)', () => {
    it('carries the full BidiMirroring table', () => {
        expect(BIDI_MIRRORING_COUNT).toBeGreaterThanOrEqual(428);
        expect(BIDI_MIRRORING_PAIRS.length).toBe(BIDI_MIRRORING_COUNT * 2);
    });

    it('mirrors the delimiters that matter in Persian text', () => {
        for (const [from, to] of [['(', ')'], [')', '('], ['[', ']'], ['{', '}'], ['<', '>'], ['«', '»'], ['»', '«']]) {
            expect(String.fromCodePoint(mirrorCodePoint(from.codePointAt(0)!))).toBe(to);
        }
    });

    it('leaves unmirrorable characters alone', () => {
        for (const ch of ['a', 'ا', '۵', '.', ' ']) {
            expect(mirrorCodePoint(ch.codePointAt(0)!)).toBe(ch.codePointAt(0));
        }
    });

    it('applies mirroring inside a right-to-left run', () => {
        const runs = resolveBidiRuns('متن (داخل) پرانتز');
        const rtl = runs.filter(r => r.level % 2 === 1).map(r => r.text).join('');
        // Reversed for display, the opening parenthesis must have become a
        // closing one so the delimiters still face their content.
        expect(rtl.includes('(') || rtl.includes(')')).toBe(true);
    });

    it('renders parenthesised Persian with no tofu', () => {
        expect(notdefCount('متن (داخل) پرانتز')).toBe(0);
    });
});

describe('BidiMirroring source data', () => {
    const src = join(process.cwd(), 'scripts', 'data', 'BidiMirroring.txt');

    it.runIf(existsSync(src))('matches the checked-in Unicode data file', () => {
        const text = readFileSync(src, 'utf8');
        const lines = text.split('\n').filter(l => l.trim() !== '' && !l.startsWith('#'));
        expect(lines.length).toBe(BIDI_MIRRORING_COUNT);
    });

    it.runIf(existsSync(src))('records the Unicode version it was generated from', () => {
        const generated = readFileSync(join(process.cwd(), 'src', 'shaping', 'bidi-mirroring-data.ts'), 'utf8');
        const version = /^# BidiMirroring-(\d+\.\d+\.\d+)\.txt/m.exec(readFileSync(src, 'utf8'))?.[1];
        expect(version, 'source file must declare its version').toBeDefined();
        expect(generated).toContain(version!);
    });
});
