/**
 * Right-to-left paragraphs (v1.9.0, #92): per-paragraph bidi resolution
 * through `EncodingContext.withParagraph()`, the `direction` option on the
 * layout and on paragraph blocks, and justification over visual runs.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { createEncodingContext, applyDocumentKerning } from '../../src/core/encoding-context.js';
import { exactBase14Width } from '../../src/fonts/base14-metrics.js';
import { toWinAnsi } from '../../src/fonts/encoding.js';
import { txt, txtJustified, txtShaped } from '../../src/core/pdf-text.js';
import { resolveBidiRuns } from '../../src/shaping/bidi.js';
import { shapeArabicText } from '../../src/shaping/arabic-shaper.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, PdfLayoutOptions } from '../../src/types/pdf-types.js';
import * as notoHebrew from '../../fonts/noto-hebrew-data.js';
import * as notoArabic from '../../fonts/noto-arabic-data.js';
import * as notoSans from '../../fonts/noto-sans-data.js';

const hebrewFont = notoHebrew as unknown as FontData;
const arabicFont = notoArabic as unknown as FontData;
const sansFont = notoSans as unknown as FontData;
const PINNED = new Date('2026-01-01T00:00:00Z');
const SZ = 11;

const hebrewEntries: FontEntry[] = [
    { fontData: hebrewFont, fontRef: '/F3', lang: 'he' },
    { fontData: sansFont, fontRef: '/F4', lang: 'latin' },
];

// demo-language: he (bidi fixtures — Hebrew words with Latin inside)
const HE_WORD = 'שלום'; // shalom
const HE_WORLD = 'עולם'; // olam

function pageContent(pdf: Uint8Array): string {
    const r = openPdf(pdf);
    const page = r.getPage(0);
    const data = r.decodeStream(r.resolveValue(page.get('Contents') ?? null) as never);
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return s;
}

/** Every `x y Td` x origin of a content stream fragment, in order (the page footer at y = 30 excluded). */
function origins(ops: string): number[] {
    return Array.from(ops.matchAll(/([\d.-]+) ([\d.-]+) Td/g))
        .filter(m => Number(m[2]) > 60)
        .map(m => Number(m[1]));
}

/** The numeric items of every `[…] TJ` array. */
function tjNumbers(ops: string): number[] {
    const out: number[] = [];
    for (const m of ops.matchAll(/\[(.*?)\] TJ/g)) {
        for (const t of m[1].matchAll(/<[0-9A-Fa-f]*>|\(((?:\\.|[^)\\])*)\)|(-?[\d.]+)/g)) {
            if (t[2] !== undefined) out.push(Number(t[2]));
        }
    }
    return out;
}

/** The hex glyph strings of a fragment, in stream order. */
function hexStrings(ops: string): string[] {
    return Array.from(ops.matchAll(/<([0-9A-Fa-f]+)>/g), m => m[1].toUpperCase());
}

function build(blocks: DocumentParams['blocks'], layout?: Partial<PdfLayoutOptions>): Uint8Array {
    // No title: every text origin in the page belongs to the paragraph under test.
    return buildDocumentPDFBytes({ title: '', blocks, fontEntries: hebrewEntries }, { creationDate: PINNED, ...layout });
}

// ── Helvetica fallback runs (ledger C17) ─────────────────────────────
//
// In Unicode mode a Latin character no registered font covers falls back
// to unembedded Helvetica. The viewer draws it with the AFM advances, and
// the next run of the line starts at penX + widthPt: until 1.9.0 widthPt
// was the bucketed estimate (500 / 680 / 556 per class), which left a gap
// — or an overlap — at every script boundary of a mixed line.

describe('Helvetica fallback runs are measured with the AFM widths (C17)', () => {
    const hebrewOnly: FontEntry[] = [{ fontData: hebrewFont, fontRef: '/F3', lang: 'he' }];
    const afm = (s: string): number => exactBase14Width(toWinAnsi(s), SZ, false);

    it('gives a fallback run the exact base-14 width, whatever typography.metrics says', () => {
        for (const metrics of ['approximate', 'exact'] as const) {
            const enc = createEncodingContext(hebrewOnly, false, false, metrics);
            const runs = enc.textRuns('(abc) x', SZ);
            const hel = runs.filter(r => r.fontRef === '/F1');
            expect(hel.length).toBeGreaterThan(0);
            for (const r of hel) expect(r.widthPt).toBeCloseTo(afm(r.text), 6);
            // ( = 333, a b c = 556 500 556, ) = 333, space 278, x 500 (Helvetica AFM) — not 556 / 500 / 680 buckets.
            expect(enc.tw('(abc) x', SZ)).toBeCloseTo((333 + 556 + 500 + 556 + 333 + 278 + 500) / 1000 * SZ, 6);
        }
    });

    it('places the run after a Latin fallback run exactly at its AFM end on a mixed line', () => {
        const content = pageContent(buildDocumentPDFBytes(
            { title: '', blocks: [{ type: 'paragraph', text: `${HE_WORD} (abc) ${HE_WORLD} 100% done.` }], fontEntries: hebrewOnly },
            { creationDate: PINNED, direction: 'auto' },
        ));
        // Every text object of the paragraph line: its font, size, x origin and literal string (Helvetica) or null (hex).
        const objects = Array.from(content.matchAll(/BT \/(F\d) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td (?:\(((?:\\.|[^)\\])*)\)|<[0-9A-Fa-f]+>) Tj/g))
            .filter(m => Number(m[4]) > 60)
            .map(m => ({ font: m[1], size: Number(m[2]), x: Number(m[3]), text: m[5] ?? null }));
        const hel = objects.filter(o => o.font === 'F1');
        expect(hel.length).toBeGreaterThanOrEqual(4); // "." "done" "100%" "(" "abc" ") "
        for (const o of hel) {
            const next = objects.filter(n => n.x > o.x + 0.01).sort((a, b) => a.x - b.x)[0];
            if (!next) continue;
            const text = o.text!.replace(/\\([()\\])/g, '$1');
            expect(next.x - o.x, `after (${text})`).toBeCloseTo(exactBase14Width(toWinAnsi(text), o.size, false), 2);
        }
    });

    it('right-aligns a line holding a fallback run to the margin with the same widths', () => {
        // Forced left-to-right: the Hebrew word sits on the left, the Latin fallback run is the rightmost object.
        const bytes = buildDocumentPDFBytes(
            { title: '', blocks: [{ type: 'paragraph', text: `${HE_WORD} abc`, align: 'right', direction: 'ltr' }], fontEntries: hebrewOnly },
            { creationDate: PINNED },
        );
        const content = pageContent(bytes);
        const pageWidth = Number(/\/MediaBox \[0 0 ([\d.]+) [\d.]+\]/.exec(Buffer.from(bytes).toString('latin1'))?.[1]);
        expect(pageWidth).toBeGreaterThan(0);
        const objects = Array.from(content.matchAll(/BT \/(F\d) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td (?:\(((?:\\.|[^)\\])*)\)|<[0-9A-Fa-f]+>) Tj/g))
            .filter(m => Number(m[4]) > 60)
            .map(m => ({ font: m[1], size: Number(m[2]), x: Number(m[3]), text: m[5] ?? null }));
        const last = objects.sort((a, b) => a.x - b.x)[objects.length - 1];
        expect(last.font).toBe('F1');
        expect(last.x + exactBase14Width(toWinAnsi(last.text!), last.size, false)).toBeCloseTo(pageWidth - 36, 2); // flush with the right margin, not short of it
    });
});

// ── EncodingContext.withParagraph ────────────────────────────────────

describe('EncodingContext.withParagraph', () => {
    const enc = createEncodingContext(hebrewEntries);

    it('returns the context itself for a paragraph with nothing right-to-left', () => {
        expect(enc.withParagraph).toBeDefined();
        expect(enc.withParagraph!('Plain Latin paragraph.')).toBe(enc);
        expect(enc.withParagraph!('Plain Latin paragraph.', 'auto')).toBe(enc);
        expect(enc.withParagraph!('Plain Latin paragraph.', 'ltr')).toBe(enc);
    });

    it('derives a context for a Hebrew paragraph and reports its level', () => {
        const p = enc.withParagraph!(`${HE_WORD} ${HE_WORLD}`);
        expect(p).not.toBe(enc);
        expect(p.paragraphLevel).toBe(1);
        expect(enc.withParagraph!('Latin first', 'rtl').paragraphLevel).toBe(1);
        expect(enc.withParagraph!(`${HE_WORD} Latin`, 'ltr').paragraphLevel).toBe(0);
    });

    it('keeps a Latin-only continuation line in its RTL paragraph (its final stop takes the paragraph level)', () => {
        const para = `${HE_WORD} ${HE_WORLD} Hello world.`;
        const p = enc.withParagraph!(para);
        // Resolved per line, "Hello world." is an LTR paragraph of its own: one run.
        expect(enc.textRuns('Hello world.', SZ).map(r => r.text)).toEqual(['Hello world.']);
        // In the paragraph, the stop sits between L and the RTL paragraph end
        // (N2 → R): it is drawn first, to the left of the Latin words.
        p.textRuns(`${HE_WORD} ${HE_WORLD}`, SZ); // first line, advances the cursor
        const second = p.textRuns('Hello world.', SZ).map(r => r.text);
        expect(second[0]).toBe('.');
        expect(second.slice(1).join('')).toBe('Hello world');
    });

    it('falls back to per-line resolution for a line the wrapper rewrote', () => {
        const p = enc.withParagraph!(`${HE_WORD} ${HE_WORLD} Hello world.`);
        // Not a substring of the paragraph (a hyphenated fragment): resolved alone.
        expect(p.textRuns('Hel-', SZ).map(r => r.text)).toEqual(['Hel-']);
    });

    it('propagates through the kerning wrapper', () => {
        const kerned = applyDocumentKerning(enc, true);
        expect(kerned).not.toBe(enc);
        expect(kerned.withParagraph!('Plain Latin')).toBe(kerned);
        const p = kerned.withParagraph!(`${HE_WORD} Latin`);
        expect(p.paragraphLevel).toBe(1);
        expect(p.textRuns('Latin', SZ).length).toBeGreaterThan(0);
    });

    it('resolves directional marks instead of dropping them (an RLM pulls a trailing mark into the Hebrew run)', () => {
        // LTR paragraph "Hello שלום!": the "!" sits between R and the paragraph
        // end (L) → N2 gives it the paragraph direction, so it is drawn last, at
        // the right. With an RLM after it the "!" sits between R and R → N1 → R:
        // it joins the Hebrew run. Until 1.9.0 the mark was stripped before
        // resolution and had no effect; it still never reaches a glyph.
        const reversed = HE_WORD.split('').reverse().join('');
        const plain = enc.textRuns(`Hello ${HE_WORD}!`, SZ).map(r => r.text);
        const marked = enc.textRuns(`Hello ${HE_WORD}!‏`, SZ).map(r => r.text);
        // Font runs split the Hebrew letters (/F3) from the Latin mark (/F4):
        // the order of the pieces is the visual order.
        expect(plain).toEqual(['Hello ', reversed, '!']);
        expect(marked).toEqual(['Hello ', '!', reversed]);
    });
});

// ── layout.direction / block.direction ───────────────────────────────

describe('paragraph direction option', () => {
    const rtlPara = { type: 'paragraph' as const, text: `${HE_WORD} ${HE_WORLD} ${HE_WORD}` };

    it('leaves alignment on the left when no direction is set (1.8.0 behaviour)', () => {
        const x = origins(pageContent(build([rtlPara])));
        expect(Math.min(...x)).toBeCloseTo(36, 0); // left margin
    });

    it("right-aligns a Hebrew paragraph under direction 'auto'", () => {
        const content = pageContent(build([rtlPara], { direction: 'auto' }));
        const x = origins(content);
        // Every run of the paragraph starts right of the page centre.
        expect(Math.max(...x)).toBeGreaterThan(300);
        expect(Math.min(...x.filter(v => v > 36))).toBeGreaterThan(200);
    });

    it("keeps a Latin paragraph on the left under direction 'auto' and byte-identical", () => {
        const latin = [{ type: 'paragraph' as const, text: 'A Latin paragraph that needs no direction handling at all.' }];
        const without = build(latin);
        const withAuto = build(latin, { direction: 'auto' });
        expect(Buffer.from(withAuto).equals(Buffer.from(without))).toBe(true);
    });

    it('lets a block override the document direction', () => {
        const forcedLeft = build([{ ...rtlPara, direction: 'ltr' }], { direction: 'auto' });
        expect(Math.min(...origins(pageContent(forcedLeft)))).toBeCloseTo(36, 0);
        const forcedRight = build([{ type: 'paragraph', text: 'Latin text forced right-to-left', direction: 'rtl' }]);
        expect(Math.max(...origins(pageContent(forcedRight)))).toBeGreaterThan(300);
    });

    it('honours an explicit align over the direction default', () => {
        const centred = build([{ ...rtlPara, align: 'center' }], { direction: 'rtl' });
        const x = origins(pageContent(centred));
        expect(Math.min(...x)).toBeGreaterThan(36);
        expect(Math.max(...x)).toBeLessThan(500);
    });

    it('leaves the last line of a justified RTL paragraph ragged on the left', () => {
        const long = Array.from({ length: 40 }, (_, i) => (i % 2 ? HE_WORLD : HE_WORD)).join(' ');
        const content = pageContent(build([{ type: 'paragraph', text: long, align: 'justify' }], { direction: 'auto' }));
        // The paragraph's text lines (the page footer at y = 30 excluded).
        const lines = content.split('\n').filter(l => origins(l).length > 0);
        expect(lines.length).toBeGreaterThan(1);
        // Justified lines carry TJ gaps; the last line is a plain right-aligned Tj
        expect(tjNumbers(content).length).toBeGreaterThan(0);
        const last = lines[lines.length - 1];
        expect(last).not.toContain('TJ');
        expect(origins(last)[0]).toBeGreaterThan(36 + 1);
    });
});

// ── Justification over visual runs ───────────────────────────────────

describe('txtJustified with right-to-left runs', () => {
    const enc = createEncodingContext(hebrewEntries);
    const line = `${HE_WORD} ${HE_WORLD} ${HE_WORD} ${HE_WORLD}`;

    it('widens every word gap and keeps the glyph order of the unjustified line', () => {
        const natural = enc.tw(line, SZ);
        const ops = txtJustified(line, 50, 700, '/F3', SZ, enc, natural + 15);
        const gaps = tjNumbers(ops);
        expect(gaps.length).toBe(3);
        expect(new Set(gaps).size).toBe(1);
        expect(gaps[0]).toBeLessThan(0);
        // Same glyphs in the same visual order as txt() — only the gaps changed.
        expect(hexStrings(ops).join('')).toBe(hexStrings(txt(line, 50, 700, '/F3', SZ, enc)).join(''));
    });

    it('spans the target width', () => {
        const natural = enc.tw(line, SZ);
        const target = natural + 15;
        const ops = txtJustified(line, 50, 700, '/F3', SZ, enc, target);
        const span = tjNumbers(ops).reduce((n, g) => n - g * SZ / 1000, natural);
        expect(span).toBeCloseTo(target, 3);
    });

    it('leaves an unstretchable line ragged', () => {
        const natural = enc.tw(line, SZ);
        const ops = txtJustified(line, 50, 700, '/F3', SZ, enc, natural + 400);
        expect(ops).not.toContain('TJ');
    });

    it('justifies a mixed Hebrew and Latin line over its visual runs', () => {
        const mixed = `${HE_WORD} Hello ${HE_WORLD} world`;
        const natural = enc.tw(mixed, SZ);
        const ops = txtJustified(mixed, 50, 700, '/F3', SZ, enc, natural + 12);
        expect(tjNumbers(ops).length).toBe(3);
        expect(hexStrings(ops).join('')).toBe(hexStrings(txt(mixed, 50, 700, '/F3', SZ, enc)).join(''));
    });
});

describe('txtShaped spaceExtra', () => {
    it('advances the pen by the extra after each space glyph of a shaped Arabic run', () => {
        // demo-language: ar (two Arabic words around one space)
        const shaped = shapeArabicText('مرحبا بك', arabicFont);
        const plain = origins(txtShaped(shaped, 10, 500, '/F3', SZ, arabicFont));
        const spaced = origins(txtShaped(shaped, 10, 500, '/F3', SZ, arabicFont, 7));
        expect(spaced.length).toBe(plain.length);
        const spaceAt = shaped.findIndex(g => g.cps?.[0] === 0x20 || g.gid === arabicFont.cmap[0x20]);
        expect(spaceAt).toBeGreaterThan(0);
        for (let i = 0; i <= spaceAt; i++) expect(spaced[i]).toBeCloseTo(plain[i], 3);
        for (let i = spaceAt + 1; i < plain.length; i++) expect(spaced[i]).toBeCloseTo(plain[i] + 7, 3);
    });
});

// ── Issue #92: the two 1.8.0 fix-ups are gone ────────────────────────

describe('UAX #9 N1/N2 and N0 without fix-ups (#92)', () => {
    it('gives sentence punctuation after a Latin word the paragraph direction in an RTL paragraph', () => {
        // "שלום pdfnative." — the stop sits between L and the paragraph end (R):
        // N2 → R, so it is drawn at the far left, as every conformant engine does.
        const runs = resolveBidiRuns(`${HE_WORD} pdfnative.`);
        expect(runs.map(r => [r.level, r.text])).toEqual([
            [1, '.'],
            [2, 'pdfnative'],
            [1, ` ${HE_WORD.split('').reverse().join('')}`],
        ]);
    });

    it('keeps punctuation with the Latin word when Latin follows it too (N1)', () => {
        const runs = resolveBidiRuns(`${HE_WORD} pdfnative. Fast`);
        expect(runs.find(r => r.level === 2)?.text).toBe('pdfnative. Fast');
    });

    it('resolves brackets around Latin content to the paragraph direction (N0 c.2) and mirrors them', () => {
        const runs = resolveBidiRuns(`${HE_WORD} (abc) ${HE_WORLD}`);
        expect(runs.map(r => r.level)).toEqual([1, 2, 1]);
        expect(runs[1].text).toBe('abc');
        // Odd-level brackets are mirrored: the glyphs still face the content.
        expect(runs[0].text.endsWith(' (')).toBe(true);
        expect(runs[2].text.startsWith(') ')).toBe(true);
    });

    it('keeps brackets with the Latin content when the context before them is Latin (N0 c.1)', () => {
        const runs = resolveBidiRuns(`${HE_WORD} abc (def) ${HE_WORLD}`);
        expect(runs.find(r => r.level === 2)?.text).toBe('abc (def)');
    });
});
