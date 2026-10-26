/**
 * A justified Malayalam paragraph (1.9.0): the glyphs of every line are the
 * ones the ragged-left build draws (no syllable is cut or re-shaped), the
 * slack widens the lines through word gaps only — the TJ adjustments the
 * justified build adds are one value per line — and the last line stays
 * ragged. Locks the behaviour the `shaping/shaping-malayalam` sample shows.
 */

import { describe, it, expect } from 'vitest';
import * as notoMalayalam from '../../fonts/noto-malayalam-data.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { isStream, dictGet } from '../../src/parser/pdf-object-parser.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const ml: FontEntry = { fontData: notoMalayalam as unknown as FontData, fontRef: '/F3', lang: 'ml' };
const PINNED = new Date('2026-01-01T00:00:00Z');
// demo-language: ml (the language document's introduction, repeated to wrap)
const INTRO = 'ഇത് pdfnative ലൈബ്രറി ഉപയോഗിച്ച് മലയാളത്തിൽ PDF നിർമ്മിക്കുന്നതിന്റെ ഒരു ഉദാഹരണമാണ്. ഈ രേഖയിൽ തലക്കെട്ടുകൾ, ഖണ്ഡികകൾ, പട്ടികകൾ, ലിസ്റ്റുകൾ എന്നിവയുണ്ട്; ഓരോ കൂട്ടക്ഷരവും ഒരേ പേജിൽ കാണാം. കോഴി കൌതുകം കൊട്ടാരം.';

interface TextObject { readonly x: number; readonly y: number; readonly hex: string[]; readonly numbers: number[] }

function textObjects(pdf: Uint8Array): TextObject[] {
    const reader = openPdf(pdf);
    const contents = reader.resolveValue(dictGet(reader.getPage(0), 'Contents')!);
    if (!isStream(contents)) throw new Error('page content is not a stream');
    const text = new TextDecoder('latin1').decode(reader.decodeStream(contents));
    const out: TextObject[] = [];
    const re = /BT \/F3 [\d.]+ Tf ([-\d.]+) ([-\d.]+) Td (.*?) ET/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const hex = [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)].map(h => h[1].toUpperCase());
        const numbers = [...m[3].matchAll(/(?:^|[\s[])(-?\d+(?:\.\d+)?)(?=[\s\]])/g)].map(n => Number(n[1]));
        out.push({ x: Number(m[1]), y: Number(m[2]), hex, numbers });
    }
    return out;
}

/** Text objects grouped by baseline, top line first, left to right. */
function lines(objects: TextObject[]): TextObject[][] {
    const byY = new Map<number, TextObject[]>();
    for (const o of objects) byY.set(o.y, [...(byY.get(o.y) ?? []), o]);
    return [...byY.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.sort((a, b) => a.x - b.x));
}

function build(align: 'justify' | 'left'): TextObject[][] {
    const params: DocumentParams = {
        title: 'Justify', fontEntries: [ml],
        blocks: [{ type: 'paragraph', text: `${INTRO} ${INTRO} ${INTRO}`, align }],
    };
    // A shaped run is drawn one positioned glyph per text object, so a line is
    // a list of glyphs; the title and the page number are single objects.
    return lines(textObjects(buildDocumentPDFBytes(params, { creationDate: PINNED }))).filter(l => l.length > 1);
}

/** Multiset difference a − b. */
function minus(a: readonly number[], b: readonly number[]): number[] {
    const rest = [...b];
    const out: number[] = [];
    for (const v of a) {
        const k = rest.indexOf(v);
        if (k >= 0) rest.splice(k, 1); else out.push(v);
    }
    return out;
}

describe('justified Malayalam paragraph', () => {
    const justified = build('justify');
    const ragged = build('left');

    it('wraps over several lines and draws the same glyphs on each line as the ragged build', () => {
        expect(justified.length).toBeGreaterThanOrEqual(3);
        expect(justified.length).toBe(ragged.length);
        for (let i = 0; i < justified.length; i++) {
            expect(justified[i].flatMap(o => o.hex).join('')).toBe(ragged[i].flatMap(o => o.hex).join(''));
        }
    });

    it('widens every line but the last, starting at the same left margin', () => {
        const last = justified.length - 1;
        for (let i = 0; i < justified.length; i++) {
            expect(justified[i][0].x).toBe(ragged[i][0].x);
            const jRight = justified[i][justified[i].length - 1].x;
            const rRight = ragged[i][ragged[i].length - 1].x;
            if (i === last) expect(jRight).toBe(rRight);
            else expect(jRight).toBeGreaterThan(rRight);
        }
    });

    it('adds TJ adjustments of one value per line — word gaps, never a syllable', () => {
        for (let i = 0; i < justified.length - 1; i++) {
            const added = minus(justified[i].flatMap(o => o.numbers), ragged[i].flatMap(o => o.numbers));
            for (const v of added) expect(v).toBe(added[0]);
            if (added.length > 0) expect(added[0]).toBeLessThan(0);
        }
    });
});
