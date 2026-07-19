import { describe, it, expect } from 'vitest';
import { isMathCodepoint, containsMath, buildDocumentPDFBytes, extractText } from '../../src/index.js';
import { detectCharLang, needsUnicodeFont } from '../../src/shaping/script-detect.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import { MATH_OPERATORS_START } from '../../src/shaping/script-registry.js';
import * as notoSansData from '../../fonts/noto-sans-data.js';
import * as notoSansMathData from '../../fonts/noto-sans-math-data.js';

// #57 — Math symbol detection & font routing (Noto Sans Math under lang 'math').

describe('math codepoint detection (#57)', () => {
    it('recognises core mathematical operators (U+2200–U+22FF)', () => {
        expect(isMathCodepoint(0x2200)).toBe(true); // ∀ for all
        expect(isMathCodepoint(0x221A)).toBe(true); // √ square root
        expect(isMathCodepoint(0x2260)).toBe(true); // ≠ not equal
        expect(isMathCodepoint(0x2211)).toBe(true); // ∑ n-ary summation
        expect(isMathCodepoint(0x222B)).toBe(true); // ∫ integral
        expect(isMathCodepoint(0x221E)).toBe(true); // ∞ infinity
        expect(isMathCodepoint(0x22A5)).toBe(true); // ⊥ up tack
    });

    it('recognises supplemental & misc math ranges', () => {
        expect(isMathCodepoint(0x2A00)).toBe(true); // ⨀ supplemental operators
        expect(isMathCodepoint(0x25A0)).toBe(true); // ■ geometric shapes
        expect(isMathCodepoint(0x27C0)).toBe(true); // ⟀ misc math symbols A
        expect(isMathCodepoint(0x2980)).toBe(true); // ⦀ misc math symbols B
    });

    it('recognises the Arrows block (U+2190–U+21FF, since 1.6.0)', () => {
        expect(isMathCodepoint(0x2192)).toBe(true); // → rightwards arrow
        expect(isMathCodepoint(0x2190)).toBe(true); // ← leftwards arrow
        expect(isMathCodepoint(0x21D4)).toBe(true); // ⇔ left right double arrow
        expect(isMathCodepoint(0x21A6)).toBe(true); // ↦ rightwards arrow from bar
        expect(isMathCodepoint(0x21FF)).toBe(true); // block end
        expect(isMathCodepoint(0x218F)).toBe(false); // just below the block
    });

    it('does NOT classify plain Latin / digits / space as math', () => {
        expect(isMathCodepoint(0x41)).toBe(false);  // A
        expect(isMathCodepoint(0x30)).toBe(false);  // 0
        expect(isMathCodepoint(0x20)).toBe(false);  // space
        expect(isMathCodepoint(0x2013)).toBe(false); // – en-dash (typography, not math)
    });

    it('containsMath detects math within mixed strings', () => {
        expect(containsMath('x ≠ y')).toBe(true);
        expect(containsMath('area = πr²')).toBe(false); // π is Greek, ² superscript — not in math ranges
        expect(containsMath('∑ from i')).toBe(true);
        expect(containsMath('hello world')).toBe(false);
    });
});

describe('math font routing (#57)', () => {
    it('detectCharLang routes math codepoints to the "math" lang', () => {
        expect(detectCharLang(0x221A)).toBe('math'); // √
        expect(detectCharLang(0x2260)).toBe('math'); // ≠
        expect(detectCharLang(0x22A5)).toBe('math'); // ⊥
    });

    it('detectCharLang routes arrows to the "math" lang (1.6.0 regression)', () => {
        expect(detectCharLang(0x2192)).toBe('math'); // →
        expect(detectCharLang(0x21D2)).toBe('math'); // ⇒
        expect(detectCharLang(0x2044)).not.toBe('math'); // ⁄ fraction slash stays out
    });

    it('needsUnicodeFont includes "math"', () => {
        expect(needsUnicodeFont('math')).toBe(true);
    });

    it('emoji still wins its own ranges (math checked before emoji, disjoint)', () => {
        // A math operator must never be misrouted to emoji.
        expect(detectCharLang(0x2211)).not.toBe('emoji');
    });
});

describe('math font encoding integration (#57)', () => {
    function makeMathEntry(): FontEntry {
        const cmap: Record<number, number> = {};
        const widths: Record<number, number> = {};
        for (let cp = MATH_OPERATORS_START; cp <= MATH_OPERATORS_START + 0xFF; cp++) {
            const gid = cp - MATH_OPERATORS_START + 10;
            cmap[cp] = gid;
            widths[gid] = 600;
        }
        cmap[0x20] = 3; widths[3] = 250;
        const fontData: FontData = {
            cmap, widths, defaultWidth: 500, gsub: {},
            metrics: {
                unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700,
                numGlyphs: 512, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80,
            },
            markAnchors: null, mark2mark: null,
            fontName: 'Noto-math', pdfWidthArray: '', ttfBase64: 'AAAAAAAAAA==',
        };
        return { lang: 'math', fontRef: '/Fmath', fontData };
    }

    it('routes a math symbol through the registered math font', () => {
        const enc = createEncodingContext([makeMathEntry()]);
        const out = enc.ps('\u221A'); // √
        expect(out.length).toBeGreaterThan(0);
        expect(out).not.toContain('0000'); // no tofu
    });
});

describe('math sample end-to-end round trip (math-symbols.pdf regression)', () => {
    // Guards against the v1.5.0 sample bug: math text built WITHOUT the math
    // font in fontEntries fell back to base-14/WinAnsi, where every math
    // codepoint was silently replaced by '?'. The real bundled fonts are used
    // so this exercises the same path as scripts/generators/math-symbols.ts.
    const fontEntries: FontEntry[] = [
        { lang: 'latin', fontRef: '/F3', fontData: notoSansData as unknown as FontData },
        { lang: 'math', fontRef: '/F4', fontData: notoSansMathData as unknown as FontData },
    ];
    const mathLines = [
        'Set theory: A ∪ B, A ∩ B, x ∈ S, ∅ ⊆ A, A ⊂ B',
        'Logic: ∀x ∃y (P → Q), ¬P ∨ Q, P ∧ Q, ⊤ ⊢ ⊥',
        'Operators: ∑ ∏ ∫ ∮ √ ∂ ∇ ∞ ± ∓ ⊕ ⊗',
        'Arrows: → ← ↔ ⇒ ⇐ ⇔ ↦ ↑ ↓ ⇄',
    ];

    it('renders every math symbol as a real glyph — never "?"', () => {
        const pdf = buildDocumentPDFBytes({
            title: 'Math round trip',
            blocks: mathLines.map(text => ({ type: 'paragraph' as const, text })),
            fontEntries,
        });
        const text = extractText(pdf).map(p => p.text).join('\n');
        expect(text).not.toContain('?');
        for (const symbol of ['∪', '∩', '∈', '∀', '∃', '√', '∑', '∫', '∞', '→', '⇔', '↦']) {
            expect(text).toContain(symbol);
        }
    });

    it('the bundled math font covers every codepoint the sample uses', () => {
        const cmap = (notoSansMathData as unknown as FontData).cmap;
        for (const line of mathLines) {
            for (const ch of line) {
                const cp = ch.codePointAt(0)!;
                if (cp <= 0x7E || cp === 0xAC || cp === 0xB1) continue; // ASCII + WinAnsi ¬ ± handled by the latin font
                expect(cmap[cp], `U+${cp.toString(16).toUpperCase()} missing from math cmap`).toBeGreaterThan(0);
            }
        }
    });
});
