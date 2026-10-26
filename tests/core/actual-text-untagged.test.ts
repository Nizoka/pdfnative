/**
 * Untagged `/Span /ActualText` on reordered shaped runs (1.9.0, C20): a run
 * whose glyph order differs from its text — an Indic pre-base vowel sign, a
 * reph, a split vowel sign, a Khmer pre-base vowel — carries its source text,
 * so `extractText()` returns the logical string. Runs in order (Latin, Thai
 * without sara am) and right-to-left runs are byte-identical to 1.8.0;
 * `layout.actualText: false` switches the spans off; the tagged emitters
 * never nest a second span inside the structure span they already write.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { isStream, dictGet } from '../../src/parser/pdf-object-parser.js';
import * as sans from '../../fonts/noto-sans-data.js';
import * as devanagari from '../../fonts/noto-devanagari-data.js';
import * as tamil from '../../fonts/noto-tamil-data.js';
import * as malayalam from '../../fonts/noto-malayalam-data.js';
import * as oriya from '../../fonts/noto-oriya-data.js';
import * as khmer from '../../fonts/noto-khmer-data.js';
import * as thai from '../../fonts/noto-thai-data.js';
import * as arabic from '../../fonts/noto-arabic-data.js';
import * as taitham from '../../fonts/noto-taitham-data.js';
import { showOpsPerActualTextSpan } from '../helpers/text-objects.js';
import type { FontData, FontEntry, PdfDiagnostic, PdfLayoutOptions, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const entry = (m: unknown, lang: string): FontEntry => ({ fontData: m as FontData, fontRef: '/F3', lang });
const PINNED = new Date('2026-01-01T00:00:00Z');

function build(text: string, font: FontEntry, layout: PdfLayoutOptions = {}): Uint8Array {
    const params: DocumentParams = { title: 'ActualText', blocks: [{ type: 'paragraph', text }], fontEntries: [font] };
    return buildDocumentPDFBytes(params, { creationDate: PINNED, ...layout });
}

function content(pdf: Uint8Array): string {
    const reader = openPdf(pdf);
    const c = reader.resolveValue(dictGet(reader.getPage(0), 'Contents')!);
    if (!isStream(c)) throw new Error('no content stream');
    return new TextDecoder('latin1').decode(reader.decodeStream(c));
}

const UNTAGGED_SPAN = '/Span << /ActualText ';
const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

// demo-language: hi ta ml or km (one reordered word per script, the extraction oracle)
const WORDS: [string, FontEntry, string][] = [
    ['हिन्दी लेनदेन परीक्षण', entry(devanagari, 'hi'), 'हिन्दी'],
    ['கொடுத்த கோயில்', entry(tamil, 'ta'), 'கொடுத்த'],
    ['ക്ഷേത്രം കോഴി', entry(malayalam, 'ml'), 'ക്ഷേത്രം'],
    ['ଗୋଟିଏ ଲୋକ', entry(oriya, 'or'), 'ଗୋଟିଏ'],
    ['ខ្មែរ ភាសា', entry(khmer, 'km'), 'ខ្មែរ'],
];

describe('untagged /ActualText on reordered shaped runs (C20)', () => {
    it.each(WORDS)('%s extracts in logical order from an untagged document', (text, font, word) => {
        const pdf = build(text, font);
        expect(content(pdf)).toContain(UNTAGGED_SPAN);
        expect(extractText(pdf)[0].text.normalize('NFC')).toContain(word);
    });

    it('wraps only the runs whose glyph order differs: the reordered word, not its neighbours', () => {
        // demo-language: hi (कमल has no pre-base sign or reph; हिन्दी has ि before ह)
        const pdf = build('कमल हिन्दी', entry(devanagari, 'hi'));
        const spans = content(pdf).match(/\/Span << \/ActualText <FEFF([0-9A-F]+)> >> BDC/g) ?? [];
        expect(spans).toHaveLength(1);
        expect(spans[0]).toContain('0939093F0928094D'); // ह ि न ् … in logical order
    });

    it('leaves Latin, Thai without sara am and right-to-left runs byte-identical to the opt-out build', () => {
        const cases: [string, FontEntry][] = [
            ['Hello lean world', entry(sans, 'latin')],
            // demo-language: th (no sara am — the marks keep their order)
            ['สวัสดี ครับ', entry(thai, 'th')],
            // demo-language: ar (a right-to-left run with a lam-alef ligature)
            ['السلام عليكم', entry(arabic, 'ar')],
        ];
        for (const [text, font] of cases) {
            const on = build(text, font);
            expect(same(on, build(text, font, { actualText: false }))).toBe(true);
            expect(content(on)).not.toContain(UNTAGGED_SPAN);
        }
    });

    it('layout.actualText: false restores the bare runs and the visual-order extraction', () => {
        const pdf = build('हिन्दी', entry(devanagari, 'hi'), { actualText: false });
        expect(content(pdf)).not.toContain('/ActualText');
        expect(extractText(pdf)[0].text).not.toContain('हिन्दी');
    });

    it('justified lines carry the span per word and extract in order', () => {
        const text = Array(12).fill('हिन्दी लेनदेन परीक्षण जाँचा').join(' ');
        const params: DocumentParams = { title: 'J', blocks: [{ type: 'paragraph', text, align: 'justify' }], fontEntries: [entry(devanagari, 'hi')] };
        const pdf = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const extracted = extractText(pdf)[0].text;
        expect(extracted.split('हिन्दी').length).toBe(13);
        expect(extracted).not.toContain('िह');
    });

    it('tagged output carries one structure span with the text per cell or line, never a nested run span', () => {
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '', footerText: '',
            headers: ['हिन्दी'], rows: [{ cells: ['हिन्दी'], type: '', pointed: false }], fontEntries: [entry(devanagari, 'hi')],
        };
        const table = content(buildPDFBytes(params, { tagged: true, creationDate: PINNED }));
        expect(table).not.toContain(UNTAGGED_SPAN);
        expect(table).toContain('/ActualText <FEFF0939093F0928094D0926094000>'.slice(0, 40));

        const doc = build('हिन्दी', entry(devanagari, 'hi'), { tagged: true });
        const c = content(doc);
        expect(c).not.toContain(UNTAGGED_SPAN);
        expect(c.match(/\/Span << \/MCID \d+ \/ActualText <FEFF0939093F0928094D09260940> >> BDC/g)).toHaveLength(1);
        expect(extractText(doc)[0].text).toContain('हिन्दी');

        // A tagged justified paragraph: the structure span per line, nothing nested.
        const text = Array(12).fill('हिन्दी लेनदेन परीक्षण जाँचा').join(' ');
        const justified = buildDocumentPDFBytes(
            { title: 'J', blocks: [{ type: 'paragraph', text, align: 'justify' }], fontEntries: [entry(devanagari, 'hi')] },
            { tagged: true, creationDate: PINNED });
        const jc = content(justified);
        expect(jc).not.toContain(UNTAGGED_SPAN);
        expect((jc.match(/\/Span << \/MCID \d+ \/ActualText/g) ?? []).length).toBeGreaterThan(2);
        expect(extractText(justified)[0].text).not.toContain('िह');
    });

    it('is silent under pdfa2u and pdfa2b', () => {
        for (const tagged of ['pdfa2u', 'pdfa2b'] as const) {
            const seen: PdfDiagnostic[] = [];
            const pdf = build('हिन्दी कोयल', entry(devanagari, 'hi'), { tagged, onDiagnostic: d => seen.push(d) });
            expect(seen).toEqual([]);
            expect(extractText(pdf)[0].text).toContain('हिन्दी');
        }
    });
});

// ── One text object per span (1.9.0, C25) ────────────────────────────

/**
 * The `BT` count inside every `/ActualText` span, and whether its `ET`s
 * balance: a span either sits inside one text object (no `BT` at all, the
 * untagged C20 span) or wraps exactly one (the tagged structure span).
 * Acrobat applies the span's text once per text object — one `BT … ET` per
 * shaped glyph, as every release before 1.9.0 wrote, pasted a cell's text
 * once per glyph (nine times for a nine-glyph Thai word).
 */
function spanObjects(c: string): { bt: number; balanced: boolean }[] {
    return [...c.matchAll(/\/ActualText[^]*?BDC([^]*?)EMC/g)].map(m => {
        const bt = (m[1].match(/\bBT\b/g) ?? []).length;
        const et = (m[1].match(/\bET\b/g) ?? []).length;
        return { bt, balanced: bt === et };
    });
}

function expectOneTextObjectPerSpan(c: string): void {
    const spans = spanObjects(c);
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
        expect(s.bt).toBeLessThanOrEqual(1);
        expect(s.balanced).toBe(true);
    }
}

describe('one text object per /ActualText span (C25)', () => {
    it.each(WORDS)('%s — the untagged span sits inside the line\'s one text object', (text, font) => {
        const c = content(build(text, font));
        expectOneTextObjectPerSpan(c);
        for (const n of showOpsPerActualTextSpan(c)) expect(n).toBeGreaterThanOrEqual(1);
    });

    it('a reordered Indic word is one TJ array: the pre-base sign and the split sign are adjustments, not objects', () => {
        // demo-language: or hi (every glyph on the baseline — the marks of these fonts carry their offsets in the outline)
        for (const [text, font] of [['ଗୋଟିଏ ଲୋକ', entry(oriya, 'or')], ['हिन्दी लेनदेन', entry(devanagari, 'hi')]] as const) {
            expect(showOpsPerActualTextSpan(content(build(text, font)))).toEqual([1]);
        }
    });

    it('a tagged table cell is one text object with one TJ or Tj (the sample-multi report)', () => {
        // demo-language: th (the two cells of the report: nine and five glyphs, no mark above the baseline)
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '', footerText: '',
            headers: ['Description', 'Category'],
            rows: [{ cells: ['รายการไทย', 'ทดสอบ'], type: '', pointed: false }],
            fontEntries: [entry(thai, 'th')],
        };
        const c = content(buildPDFBytes(params, { tagged: true, creationDate: PINNED }));
        expectOneTextObjectPerSpan(c);
        const thaiCells = [...c.matchAll(/\/ActualText <FEFF(0E[0-9A-F]{2})+> >> BDC([^]*?)EMC/g)].map(m => m[2]);
        expect(thaiCells).toHaveLength(2);
        for (const cell of thaiCells) {
            expect(cell.match(/\bBT\b/g)).toHaveLength(1);
            expect(cell.match(/\bT[jJ]\b/g)).toHaveLength(1);
        }
        expect(extractText(buildPDFBytes(params, { tagged: true, creationDate: PINNED }))[0].text.split('รายการไทย')).toHaveLength(2);
    });

    it('a tagged line mixing two fonts is still one text object, the fonts switched with Tf', () => {
        // demo-language: nod (Tai Tham words between Latin ones, as tagged-pdfa2u-taitham sets them)
        const fonts: FontEntry[] = [{ fontData: sans as unknown as FontData, fontRef: '/F3', lang: 'latin' }, { fontData: taitham as unknown as FontData, fontRef: '/F4', lang: 'nod' }];
        const params: DocumentParams = { title: 'T', blocks: [{ type: 'paragraph', text: 'Tai Tham ᨠᩮᩬᩡ ᨾᩮᩬᩥᨦ and Latin again' }], fontEntries: fonts };
        const c = content(buildDocumentPDFBytes(params, { creationDate: PINNED, tagged: 'pdfa2u' }));
        expectOneTextObjectPerSpan(c);
        const line = /\/ActualText <FEFF00540061006900200054[^]*?BDC([^]*?)EMC/.exec(c)?.[1] ?? ''; // "Tai T…"
        expect(line.match(/\bBT\b/g)).toHaveLength(1);
        // Latin in Noto Sans, Tai Tham in its font (which keeps the Latin that follows: continuation bias).
        expect((line.match(/\/F\d+ [\d.]+ Tf/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('a mark above the baseline keeps its own Tj but never a text object of its own', () => {
        // demo-language: th (a tone mark stacked on an above vowel, and the sara am that earns the run its span)
        const c = content(build('ตั้งใจ น้ำ', entry(thai, 'th')));
        expectOneTextObjectPerSpan(c);
        expect(showOpsPerActualTextSpan(c)[0]).toBeGreaterThan(1); // the stacked tone mark has its own Td + Tj
        expect(c.match(/\bBT\b/g)!.length).toBeLessThanOrEqual(3); // the title, the line, the page number
    });
});
