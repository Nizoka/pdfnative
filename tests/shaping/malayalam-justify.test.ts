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
import { interpretGlyphs } from '../helpers/text-objects.js';

const malayalam = notoMalayalam as unknown as FontData;
const ml: FontEntry = { fontData: malayalam, fontRef: '/F3', lang: 'ml' };
const PINNED = new Date('2026-01-01T00:00:00Z');
// demo-language: ml (the language document's introduction, repeated to wrap)
const INTRO = 'ഇത് pdfnative ലൈബ്രറി ഉപയോഗിച്ച് മലയാളത്തിൽ PDF നിർമ്മിക്കുന്നതിന്റെ ഒരു ഉദാഹരണമാണ്. ഈ രേഖയിൽ തലക്കെട്ടുകൾ, ഖണ്ഡികകൾ, പട്ടികകൾ, ലിസ്റ്റുകൾ എന്നിവയുണ്ട്; ഓരോ കൂട്ടക്ഷരവും ഒരേ പേജിൽ കാണാം. കോഴി കൌതുകം കൊട്ടാരം.';

/** One line of the paragraph: its glyphs left to right, as the viewer places them, and the TJ numbers of its text object. */
interface Line { readonly y: number; readonly gids: number[]; readonly xs: number[]; readonly numbers: number[] }

function pageContent(pdf: Uint8Array): string {
    const reader = openPdf(pdf);
    const contents = reader.resolveValue(dictGet(reader.getPage(0), 'Contents')!);
    if (!isStream(contents)) throw new Error('page content is not a stream');
    return new TextDecoder('latin1').decode(reader.decodeStream(contents));
}

/**
 * The paragraph's lines, top line first. Since 1.9.0 (C25) a line is one
 * text object: its first `Td` is the baseline, its `TJ` arrays carry the
 * mark adjustments of the shaped runs and, when justified, the word gaps.
 */
function lines(content: string): Line[] {
    const numbersByY = new Map<number, number[]>();
    for (const m of content.matchAll(/\bBT\b([^]*?)\bET\b/g)) {
        const td = /(-?[\d.]+) (-?[\d.]+) Td/.exec(m[1]);
        if (!td) continue;
        const y = Number(td[2]);
        const numbers: number[] = [];
        for (const arr of m[1].matchAll(/\[(.*?)\] TJ/g)) {
            for (const n of arr[1].matchAll(/(?:^|\s)(-?\d+(?:\.\d+)?)(?=\s|$)/g)) numbers.push(Number(n[1]));
        }
        numbersByY.set(y, [...(numbersByY.get(y) ?? []), ...numbers]);
    }
    const widthOf = (_font: string, gid: number): number => malayalam.widths[gid] ?? malayalam.defaultWidth;
    const byY = new Map<number, { gids: number[]; xs: number[] }>();
    for (const g of interpretGlyphs(content, widthOf)) {
        const line = byY.get(g.y) ?? { gids: [], xs: [] };
        line.gids.push(g.gid);
        line.xs.push(g.x);
        byY.set(g.y, line);
    }
    return [...byY.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([y, l]) => ({ y, gids: l.gids, xs: [...l.xs].sort((a, b) => a - b), numbers: numbersByY.get(y) ?? [] }));
}

function build(align: 'justify' | 'left'): Line[] {
    const params: DocumentParams = {
        title: 'Justify', fontEntries: [ml],
        blocks: [{ type: 'paragraph', text: `${INTRO} ${INTRO} ${INTRO}`, align }],
    };
    // The title and the page number are single short lines; the paragraph's lines hold many glyphs.
    return lines(pageContent(buildDocumentPDFBytes(params, { creationDate: PINNED }))).filter(l => l.gids.length > 20);
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
            expect(justified[i].gids.join(',')).toBe(ragged[i].gids.join(','));
        }
    });

    it('widens every line but the last, starting at the same left margin', () => {
        const last = justified.length - 1;
        for (let i = 0; i < justified.length; i++) {
            expect(justified[i].xs[0]).toBeCloseTo(ragged[i].xs[0], 2);
            const jRight = justified[i].xs[justified[i].xs.length - 1];
            const rRight = ragged[i].xs[ragged[i].xs.length - 1];
            if (i === last) expect(jRight).toBeCloseTo(rRight, 2);
            else expect(jRight).toBeGreaterThan(rRight + 1);
        }
    });

    it('adds TJ adjustments of one value per line — word gaps, never a syllable', () => {
        for (let i = 0; i < justified.length - 1; i++) {
            // The justified layout shapes word by word, so a word is its own
            // run placed by a `Td`; the gap between two Latin words of the
            // line's font is the one TJ number the justified build adds. A
            // shaped word carries no adjustment of its own in either build:
            // the font's advances place its glyphs, and the rounding of a
            // word's origin shifts the whole word, never a glyph inside it.
            const added = minus(justified[i].numbers, ragged[i].numbers);
            for (const v of added) expect(v).toBe(added[0]);
            if (added.length > 0) expect(added[0]).toBeLessThan(-1);
        }
    });
});
