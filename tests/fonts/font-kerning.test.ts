import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/index.js';
import { createEncodingContext, applyDocumentKerning } from '../../src/core/encoding-context.js';
import { buildKernedTJ, applyKerningToRuns, kernPair } from '../../src/fonts/font-kerning.js';
import { txt } from '../../src/core/pdf-text.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import type { FontData, FontEntry, TextRun, KernTable } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// v1.8.0 — GPOS pair kerning.

const PINNED = new Date('2026-01-01T00:00:00Z');
const latin = notoSans as unknown as FontData;
const entries: FontEntry[] = [{ fontData: latin, fontRef: '/F3', lang: 'latin' }];
const base = createEncodingContext(entries, false, false);
const kerned = applyDocumentKerning(base, true);

describe('bundled kern table', () => {
    it('ships pair kerning on the Latin face', () => {
        expect(latin.kern).toBeTruthy();
        expect(latin.kern!.c?.length).toBeGreaterThan(0);
        expect(Object.keys(latin.kern!.p ?? {}).length).toBeGreaterThan(100);
    });

    it('kerns the pairs everyone checks', () => {
        const gid = (ch: string): number => latin.cmap[ch.codePointAt(0)!];
        for (const [l, r] of [['A', 'V'], ['T', 'o'], ['Y', 'o'], ['V', 'A']]) {
            expect(kernPair(latin.kern!, gid(l), gid(r)), `${l}${r} should kern`).toBeLessThan(0);
        }
    });

    it('holds integer design-unit adjustments, never zero', () => {
        let checked = 0;
        for (const row of Object.values(latin.kern!.p ?? {})) {
            for (const v of Object.values(row)) {
                expect(Number.isInteger(v)).toBe(true);
                expect(v).not.toBe(0);
                if (++checked > 500) return;
            }
        }
        for (const sub of latin.kern!.c ?? []) {
            for (const v of Object.values(sub.m)) {
                expect(Number.isInteger(v)).toBe(true);
                expect(v).not.toBe(0);
                if (++checked > 500) return;
            }
        }
    });

    it('stays in class form rather than expanding to glyph pairs', () => {
        // Expanding Noto Sans cost 594 KB — a fifth of the module — paid at
        // parse time by every consumer, kerning enabled or not.
        const pairs = Object.values(latin.kern!.p ?? {})
            .reduce((n, row) => n + Object.keys(row).length, 0);
        expect(pairs).toBeLessThan(2000);
    });
});

describe('kernPair', () => {
    const gid = (ch: string): number => latin.cmap[ch.codePointAt(0)!];

    it('returns 0 for a pair in no subtable', () => {
        expect(kernPair(latin.kern!, gid('n'), gid('n'))).toBe(0);
    });

    it('returns 0 for glyph ids outside every class', () => {
        expect(kernPair(latin.kern!, 0xFFFE, 0xFFFF)).toBe(0);
    });

    it('lets an explicit glyph pair win over the class subtables', () => {
        const table = {
            p: { 10: { 20: -99 } },
            c: [{ l: { 10: 1 }, r: { 20: 1 }, n: 2, m: { 3: -5 } }],
        };
        expect(kernPair(table, 10, 20)).toBe(-99);
        expect(kernPair(table, 11, 20)).toBe(0);
    });

    it('treats a right glyph the ClassDef omits as class 0', () => {
        const table: KernTable = {
            p: null,
            c: [{ l: { 7: 1 }, r: {}, n: 3, m: { 3: -8 } }],
        };
        expect(kernPair(table, 7, 4242)).toBe(-8);
    });

    it('reads the sparse matrix at leftClass * n + rightClass', () => {
        const table = {
            p: null,
            c: [{ l: { 7: 2 }, r: { 8: 3 }, n: 4, m: { 11: -12 } }],
        };
        expect(kernPair(table, 7, 8)).toBe(-12);
    });

    it('falls through a subtable that yields no adjustment', () => {
        const table: KernTable = {
            p: null,
            c: [
                { l: { 7: 1 }, r: { 8: 1 }, n: 2, m: {} },
                { l: { 7: 1 }, r: { 8: 1 }, n: 2, m: { 3: -7 } },
            ],
        };
        expect(kernPair(table, 7, 8)).toBe(-7);
    });
});

describe('buildKernedTJ', () => {
    const gid = (ch: string): number => latin.cmap[ch.codePointAt(0)!];

    it('returns null when no pair kerns', () => {
        expect(buildKernedTJ([gid('n'), gid('n')], latin)).toBeNull();
    });

    it('returns null for a single glyph', () => {
        expect(buildKernedTJ([gid('A')], latin)).toBeNull();
    });

    it('inverts the sign, because TJ subtracts', () => {
        const out = buildKernedTJ([gid('A'), gid('V')], latin)!;
        expect(out.adjustDesign).toBeLessThan(0);
        // A negative kern must appear as a positive TJ number.
        expect(/\s(\d+)\s/.test(out.tj)).toBe(true);
        expect(out.tj).not.toContain('-');
    });

    it('groups unkerned glyphs into one hex string', () => {
        const out = buildKernedTJ([gid('n'), gid('n'), gid('A'), gid('V')], latin)!;
        // "nnA" travels together, then the adjustment, then "V".
        expect(out.tj.split('<').length - 1).toBe(2);
    });

    it('accumulates several adjustments', () => {
        const one = buildKernedTJ([gid('A'), gid('V')], latin)!;
        const many = buildKernedTJ([gid('A'), gid('V'), gid('A'), gid('V')], latin)!;
        expect(many.adjustDesign).toBeLessThan(one.adjustDesign);
    });

    it('is null on a font without a kern table', () => {
        const bare = { ...latin, kern: null } as unknown as FontData;
        expect(buildKernedTJ([gid('A'), gid('V')], bare)).toBeNull();
    });
});

describe('applyKerningToRuns', () => {
    it('attaches a TJ operand and tightens the advance', () => {
        const before = base.textRuns('AV', 12);
        const after = applyKerningToRuns(before, 12);
        expect(after[0].tjStr).toBeDefined();
        expect(after[0].widthPt).toBeLessThan(before[0].widthPt);
    });

    it('leaves a run without kerning pairs untouched', () => {
        const runs = base.textRuns('nn', 12);
        expect(applyKerningToRuns(runs, 12)[0]).toBe(runs[0]);
    });

    it('leaves shaped runs alone', () => {
        const shaped = {
            text: 'x', fontRef: '/F3', fontData: latin,
            shaped: [{ gid: 20, xOffset: 0, yOffset: 0, advance: 500 }],
            hexStr: '', widthPt: 6,
        } as unknown as TextRun;
        expect(applyKerningToRuns([shaped], 12)[0]).toBe(shaped);
    });
});

describe('layout.typography.kerning', () => {
    it('is a no-op when off, or without a kern-carrying font', () => {
        expect(applyDocumentKerning(base, false)).toBe(base);
        expect(applyDocumentKerning(base, undefined)).toBe(base);
        const base14 = createEncodingContext([], false, false);
        expect(applyDocumentKerning(base14, true)).toBe(base14);
    });

    it('measures and emits consistently', () => {
        const width = kerned.tw('AWAY', 12);
        const runs = kerned.textRuns('AWAY', 12);
        expect(runs.reduce((n, r) => n + r.widthPt, 0)).toBeCloseTo(width, 9);
        expect(width).toBeLessThan(base.tw('AWAY', 12));
    });

    it('emits TJ rather than Tj for a kerned run', () => {
        expect(txt('AV', 0, 0, '/F3', 12, base)).toContain(' Tj ');
        const out = txt('AV', 0, 0, '/F3', 12, kerned);
        expect(out).toContain('] TJ ');
        expect(out).not.toContain(' Tj ');
    });

    it('keeps a kerned run inside a single text-showing operator', () => {
        // Per-glyph placement would fragment viewer selection and extraction.
        const out = txt('AWAY', 0, 0, '/F3', 12, kerned);
        expect((out.match(/BT /g) ?? []).length).toBe(1);
        expect((out.match(/TJ/g) ?? []).length).toBe(1);
    });

    it('changes document output only when enabled', () => {
        const params: DocumentParams = {
            title: 'Kerning',
            blocks: [{ type: 'paragraph', text: 'AVATAR To Yo Wave AWAY '.repeat(20) }],
            fontEntries: entries,
        };
        const off = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const offExplicit = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { kerning: false } });
        const on = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { kerning: true } });
        expect(Buffer.from(offExplicit).equals(Buffer.from(off))).toBe(true);
        expect(Buffer.from(on).equals(Buffer.from(off))).toBe(false);
    });

    it('is deterministic', () => {
        const params: DocumentParams = {
            title: 'K', blocks: [{ type: 'paragraph', text: 'AV To Yo' }], fontEntries: entries,
        };
        const opts = { creationDate: PINNED, typography: { kerning: true } };
        expect(Buffer.from(buildDocumentPDFBytes(params, opts))
            .equals(Buffer.from(buildDocumentPDFBytes(params, opts)))).toBe(true);
    });

    it('composes with OpenType features', () => {
        const params: DocumentParams = {
            title: 'Both',
            blocks: [{ type: 'paragraph', text: 'AV 1111 To 8888' }],
            fontEntries: entries,
        };
        const both = buildDocumentPDFBytes(params, {
            creationDate: PINNED,
            typography: { kerning: true, fontFeatures: ['pnum'] },
        });
        const neither = buildDocumentPDFBytes(params, { creationDate: PINNED });
        expect(Buffer.from(both).equals(Buffer.from(neither))).toBe(false);
    });
});
