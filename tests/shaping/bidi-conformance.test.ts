/**
 * UAX #9 conformance (v1.9.0, #92): the Unicode Character Database's
 * BidiCharacterTest run against the resolver — paragraph level, the level of
 * every character the algorithm keeps, and the visual order.
 *
 * The vendored corpus is `scripts/data/BidiCharacterTest-subset.txt`, every
 * 11th line of BidiCharacterTest-17.0.0.txt (see scripts/data/README.md).
 * Point `BIDI_CHARACTER_TEST` at a downloaded copy of the full file to run all
 * 91 707 lines — every one of them passes at 1.9.0.
 *
 * Every line must pass. A failure here is a defect in `src/shaping/bidi.ts`,
 * never a line to exclude.
 */

import { describe, it, expect } from 'vitest';
import { resolveBidiLevels, bidiRunsForLine, bidiLineLevels } from '../../src/shaping/bidi.js';
import type { BidiDirection } from '../../src/shaping/bidi.js';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';


const SUBSET = resolve(process.cwd(), 'scripts/data/BidiCharacterTest-subset.txt');
const corpusPath = process.env['BIDI_CHARACTER_TEST'] ?? SUBSET;

interface TestLine {
    readonly lineNo: number;
    readonly cps: readonly number[];
    readonly direction: BidiDirection;
    readonly paraLevel: number;
    /** Expected level per code point, or -1 for a character the algorithm removes (x). */
    readonly levels: readonly number[];
    /** Expected visual order of the retained characters (code point indices). */
    readonly order: readonly number[];
}

function parseCorpus(text: string): TestLine[] {
    const out: TestLine[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('#')) continue;
        const [f0, f1, f2, f3, f4] = line.split(';');
        out.push({
            lineNo: i + 1,
            cps: f0.trim().split(/\s+/).map(h => parseInt(h, 16)),
            direction: f1.trim() === '0' ? 'ltr' : f1.trim() === '1' ? 'rtl' : 'auto',
            paraLevel: Number(f2.trim()),
            levels: f3.trim().split(/\s+/).map(v => (v === 'x' ? -1 : Number(v))),
            order: f4.trim() === '' ? [] : f4.trim().split(/\s+/).map(Number),
        });
    }
    return out;
}

/** The directional formatting characters the runs leave out. */
function isBidiControl(cp: number): boolean {
    return cp === 0x200E || cp === 0x200F || cp === 0x061C
        || (cp >= 0x202A && cp <= 0x202E)
        || (cp >= 0x2066 && cp <= 0x2069);
}

interface Outcome {
    readonly paraLevel: number;
    readonly levels: number[];
    readonly order: number[];
}

/** Run one corpus line: the levels after L1 and the visual order of the drawn characters. */
function run(t: TestLine): Outcome {
    const text = String.fromCodePoint(...t.cps);
    // Code unit → code point index.
    const cuToCp: number[] = [];
    const cpToCu: number[] = [];
    for (let i = 0, k = 0; i < text.length; k++) {
        const cp = text.codePointAt(i) ?? 0;
        const n = cp > 0xFFFF ? 2 : 1;
        cpToCu.push(i);
        for (let j = 0; j < n; j++) cuToCp.push(k);
        i += n;
    }
    const res = resolveBidiLevels(text, t.direction);
    const lineLevels = bidiLineLevels(text, res.levels, res.paraLevel);
    const levels = t.cps.map((_, k) => lineLevels[cpToCu[k]]);
    const order: number[] = [];
    for (const r of bidiRunsForLine(text, res.levels, res.paraLevel)) {
        const idx: number[] = [];
        for (let i = r.start, consumed = 0; consumed < r.text.length;) {
            const cpIdx = cuToCp[i];
            const cp = t.cps[cpIdx];
            const n = cp > 0xFFFF ? 2 : 1;
            if (!isBidiControl(cp)) { idx.push(cpIdx); consumed += n; }
            i += n;
        }
        order.push(...(r.level % 2 === 1 ? idx.reverse() : idx));
    }
    return { paraLevel: res.paraLevel, levels, order };
}

const corpus = parseCorpus(readFileSync(corpusPath, 'utf8'));

describe(`UAX #9 BidiCharacterTest (${basename(corpusPath)}, ${corpus.length} lines)`, () => {
    it('loads a non-trivial corpus covering the three paragraph directions', () => {
        expect(corpus.length).toBeGreaterThan(8000);
        for (const d of ['ltr', 'rtl', 'auto'] as const) {
            expect(corpus.some(t => t.direction === d)).toBe(true);
        }
        expect(corpus.some(t => t.cps.some(cp => cp >= 0x2066 && cp <= 0x2069))).toBe(true); // isolates
        expect(corpus.some(t => t.cps.some(cp => cp >= 0x202A && cp <= 0x202E))).toBe(true); // embeddings and overrides
        expect(corpus.some(t => t.cps.includes(0x0028))).toBe(true); // brackets
    });

    it('resolves the paragraph level and every retained level of every line', () => {
        const failures: string[] = [];
        for (const t of corpus) {
            const got = run(t);
            const ok = got.paraLevel === t.paraLevel
                && t.levels.every((e, k) => e === -1 || e === got.levels[k]);
            if (!ok) {
                failures.push(`line ${t.lineNo}: ${t.cps.map(c => c.toString(16).toUpperCase().padStart(4, '0')).join(' ')} (${t.direction}) `
                    + `expected P${t.paraLevel} [${t.levels.map(v => (v === -1 ? 'x' : v)).join(' ')}] `
                    + `got P${got.paraLevel} [${got.levels.join(' ')}]`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('orders the drawn characters of every line as the corpus does', () => {
        const failures: string[] = [];
        for (const t of corpus) {
            const got = run(t);
            // The runs leave the invisible directional controls out; compare the
            // order of what is drawn (their levels are checked above).
            const expected = t.order.filter(i => !isBidiControl(t.cps[i]));
            // The runs keep the other BN characters (ZWJ, ZWNJ, ZWSP — the shapers
            // read them) at their neighbour's level; the corpus removes them (X9).
            const drawn = got.order.filter(i => t.levels[i] !== -1);
            if (drawn.join(' ') !== expected.join(' ')) {
                failures.push(`line ${t.lineNo}: ${t.cps.map(c => c.toString(16).toUpperCase().padStart(4, '0')).join(' ')} (${t.direction}) `
                    + `expected [${expected.join(' ')}] got [${drawn.join(' ')}]`);
            }
        }
        expect(failures).toEqual([]);
    });
});
