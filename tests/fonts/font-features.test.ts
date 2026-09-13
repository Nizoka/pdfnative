import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, openPdf, extractText } from '../../src/index.js';
import { parseGlyfFont, extractGlyphContours } from '../../src/fonts/glyf-outline.js';
import { getDecodedFontBytes } from '../../src/fonts/font-loader.js';
import type { PdfDict, PdfRef, PdfStream, PdfValue } from '../../src/parser/pdf-object-parser.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import {
    composeFeatureMap, applyFeaturesToRuns, SUPPORTED_FEATURES,
} from '../../src/fonts/font-features.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import * as notoThai from '../../fonts/noto-thai-data.js';
import type { FontData, FontEntry, TextRun } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// v1.8.0 — declarative OpenType features (single substitutions).

const PINNED = new Date('2026-01-01T00:00:00Z');
const latin = notoSans as unknown as FontData;
const thai = notoThai as unknown as FontData;
const entries: FontEntry[] = [{ fontData: latin, fontRef: '/F3', lang: 'latin' }];

describe('bundled feature tables', () => {
    it('ships a feature table on the Latin face', () => {
        expect(latin.features).toBeTruthy();
        for (const tag of ['tnum', 'pnum', 'onum', 'lnum', 'zero', 'smcp', 'c2sc']) {
            expect(Object.keys(latin.features!)).toContain(tag);
        }
    });

    it('declares only supported tags', () => {
        for (const tag of Object.keys(latin.features!)) {
            expect(SUPPORTED_FEATURES as readonly string[]).toContain(tag);
        }
    });

    it('maps glyph ids to glyph ids', () => {
        for (const map of Object.values(latin.features!)) {
            for (const [from, to] of Object.entries(map)) {
                expect(Number.isInteger(Number(from))).toBe(true);
                expect(Number.isInteger(to)).toBe(true);
                expect(to).toBeGreaterThan(0);
                expect(to).toBeLessThan(latin.metrics.numGlyphs);
            }
        }
    });

    it('is null on a face that declares none', () => {
        expect(thai.features ?? null).toBeNull();
    });
});

describe('composeFeatureMap', () => {
    it('returns null for no tags, unknown tags or a font without a table', () => {
        expect(composeFeatureMap(latin, [])).toBeNull();
        expect(composeFeatureMap(latin, ['frac'])).toBeNull();
        expect(composeFeatureMap(thai, ['tnum'])).toBeNull();
    });

    it('merges several tags', () => {
        const merged = composeFeatureMap(latin, ['pnum', 'smcp'])!;
        const pnum = latin.features!['pnum'];
        const smcp = latin.features!['smcp'];
        expect(Object.keys(merged).length).toBeGreaterThanOrEqual(Object.keys(smcp).length);
        for (const k of Object.keys(pnum)) expect(merged[Number(k)]).toBeDefined();
    });

    it('lets a later tag win a shared glyph', () => {
        const a = composeFeatureMap(latin, ['pnum', 'onum'])!;
        const b = composeFeatureMap(latin, ['onum', 'pnum'])!;
        const shared = Object.keys(latin.features!['pnum']).find(k => latin.features!['onum'][Number(k)] !== undefined);
        expect(shared).toBeDefined();
        expect(a[Number(shared)]).toBe(latin.features!['onum'][Number(shared)]);
        expect(b[Number(shared)]).toBe(latin.features!['pnum'][Number(shared)]);
    });
});

describe('applyFeaturesToRuns', () => {
    const enc = createEncodingContext(entries, false, false);

    it('substitutes glyphs and recomputes the advance', () => {
        const before = enc.textRuns('1111', 12);
        const after = applyFeaturesToRuns(before, ['pnum'], 12);
        expect(after[0].hexStr).not.toBe(before[0].hexStr);
        // Proportional "1" is narrower than the tabular default.
        expect(after[0].widthPt).toBeLessThan(before[0].widthPt);
    });

    it('returns the runs untouched with no tags', () => {
        const runs = enc.textRuns('1111', 12);
        expect(applyFeaturesToRuns(runs, [], 12)).toBe(runs);
    });

    it('leaves shaped runs alone', () => {
        const shapedRun = {
            text: 'x', fontRef: '/F3', fontData: latin,
            shaped: [{ gid: 20, xOffset: 0, yOffset: 0, advance: 500 }],
            hexStr: '', widthPt: 6,
        } as unknown as TextRun;
        const out = applyFeaturesToRuns([shapedRun], ['pnum'], 12);
        expect(out[0]).toBe(shapedRun);
    });

    it('tolerates a malformed glyph string', () => {
        const bad = { text: 'x', fontRef: '/F3', fontData: latin, shaped: null, hexStr: '(abc)', widthPt: 6 } as unknown as TextRun;
        expect(applyFeaturesToRuns([bad], ['pnum'], 12)[0]).toBe(bad);
    });
});

describe('EncodingContext.withFeatures', () => {
    const enc = createEncodingContext(entries, false, false);

    it('is absent in base-14 mode, where there are no OpenType tables', () => {
        const latin14 = createEncodingContext([], false, false);
        expect(latin14.withFeatures).toBeUndefined();
    });

    it('returns the same context for a tag no font declares', () => {
        expect(enc.withFeatures!(['frac'])).toBe(enc);
    });

    it('changes both measurement and emission consistently', () => {
        const pnum = enc.withFeatures!(['pnum']);
        const plain = enc.tw('1111', 12);
        const prop = pnum.tw('1111', 12);
        expect(prop).toBeLessThan(plain);
        const runs = pnum.textRuns('1111', 12);
        expect(runs.reduce((n, r) => n + r.widthPt, 0)).toBeCloseTo(prop, 9);
    });

    it('replaces rather than stacks when derived again', () => {
        const a = enc.withFeatures!(['pnum']);
        const b = a.withFeatures!(['onum']);
        expect(b.tw('1111', 12)).toBe(enc.withFeatures!(['onum']).tw('1111', 12));
    });

    it('turns small capitals on', () => {
        const smcp = enc.withFeatures!(['smcp']);
        expect(smcp.textRuns('abc', 12)[0].hexStr).not.toBe(enc.textRuns('abc', 12)[0].hexStr);
    });
});

describe('layout.typography.fontFeatures', () => {
    function doc(): DocumentParams {
        return {
            title: 'Figures',
            blocks: [{ type: 'paragraph', text: 'Total 1111 and 8888 and 1234567890' }],
            fontEntries: entries,
        };
    }

    it('leaves output byte-identical when unset', () => {
        const a = buildDocumentPDFBytes(doc(), { creationDate: PINNED });
        const b = buildDocumentPDFBytes(doc(), { creationDate: PINNED, typography: {} });
        const c = buildDocumentPDFBytes(doc(), { creationDate: PINNED, typography: { fontFeatures: [] } });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
        expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
    });

    it('changes the emitted glyphs when set', () => {
        const plain = buildDocumentPDFBytes(doc(), { creationDate: PINNED });
        const prop = buildDocumentPDFBytes(doc(), { creationDate: PINNED, typography: { fontFeatures: ['pnum'] } });
        expect(Buffer.from(prop).equals(Buffer.from(plain))).toBe(false);
    });

    it('is a no-op for a tag the font does not declare', () => {
        const plain = buildDocumentPDFBytes(doc(), { creationDate: PINNED });
        const frac = buildDocumentPDFBytes(doc(), { creationDate: PINNED, typography: { fontFeatures: ['frac'] } });
        expect(Buffer.from(frac).equals(Buffer.from(plain))).toBe(true);
    });

    it('is a no-op without a registered font', () => {
        const base14: DocumentParams = { title: 'F', blocks: [{ type: 'paragraph', text: '1111' }] };
        const plain = buildDocumentPDFBytes(base14, { creationDate: PINNED });
        const asked = buildDocumentPDFBytes(base14, { creationDate: PINNED, typography: { fontFeatures: ['pnum'] } });
        expect(Buffer.from(asked).equals(Buffer.from(plain))).toBe(true);
    });

    it('is deterministic', () => {
        const opts = { creationDate: PINNED, typography: { fontFeatures: ['pnum'] } };
        const a = buildDocumentPDFBytes(doc(), opts);
        const b = buildDocumentPDFBytes(doc(), opts);
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });
});

/**
 * A feature-substituted glyph is reachable only through GSUB, never through
 * the cmap, so it has to be tracked explicitly or it silently vanishes from
 * the subset (blank on the page), from `/W` (advance falls back to `/DW`) and
 * from ToUnicode (extracts as U+FFFD). These tests read the emitted file back
 * and assert all three, which is what the 1.8.0 release audit found missing.
 */
describe('feature-substituted glyphs are embedded, measured and mapped', () => {
    const TEXT = 'Old Style Figures 0123456789 and Small Caps abcdef';
    const FULL_FONT = parseGlyfFont(getDecodedFontBytes(latin));

    function build(tags: string[]): Uint8Array {
        return buildDocumentPDFBytes(
            { title: 'Features', blocks: [{ type: 'paragraph', text: TEXT }], fontEntries: entries },
            { creationDate: PINNED, typography: { fontFeatures: tags } },
        );
    }

    interface FontFacts {
        cids: Set<number>;          // every CID the page content shows
        widths: Map<number, number>; // /W as CID → width
        toUnicode: Map<number, number>; // bfchar CID → codepoint
        glyf: ReturnType<typeof parseGlyfFont>;
    }

    function facts(bytes: Uint8Array): FontFacts {
        const reader = openPdf(bytes);
        const page = reader.getPage(0);
        const res = reader.resolveValue(page.get('Resources') as PdfValue) as PdfDict;
        const fonts = reader.resolveValue(res.get('Font') as PdfValue) as PdfDict;
        const f3 = reader.resolveValue(fonts.get('F3') as PdfRef) as PdfDict;
        const desc = reader.resolveValue((reader.resolveValue(f3.get('DescendantFonts') as PdfValue) as PdfValue[])[0]) as PdfDict;

        const widths = new Map<number, number>();
        const w = reader.resolveValue(desc.get('W') as PdfValue) as PdfValue[];
        for (let i = 0; i < w.length; i += 2) {
            const start = w[i] as number;
            const arr = w[i + 1] as number[];
            arr.forEach((wd, k) => widths.set(start + k, wd));
        }

        const fdesc = reader.resolveValue(desc.get('FontDescriptor') as PdfValue) as PdfDict;
        const ff2 = reader.resolveValue(fdesc.get('FontFile2') as PdfValue) as PdfStream;
        const glyf = parseGlyfFont(reader.decodeStream(ff2));

        const tu = reader.resolveValue(f3.get('ToUnicode') as PdfValue) as PdfStream;
        const cmapText = Buffer.from(reader.decodeStream(tu)).toString('latin1');
        const toUnicode = new Map<number, number>();
        for (const m of cmapText.matchAll(/<([0-9A-F]{4})> <([0-9A-F]{4,8})>/g)) {
            toUnicode.set(parseInt(m[1], 16), parseInt(m[2].slice(0, 4), 16));
        }

        const contents = reader.resolveValue(page.get('Contents') as PdfValue) as PdfStream;
        const stream = Buffer.from(reader.decodeStream(contents)).toString('latin1');
        const cids = new Set<number>();
        for (const m of stream.matchAll(/<([0-9A-Fa-f]+)>/g)) {
            for (let i = 0; i + 4 <= m[1].length; i += 4) cids.add(parseInt(m[1].slice(i, i + 4), 16));
        }
        return { cids, widths, toUnicode, glyf };
    }

    for (const tags of [['onum'], ['smcp'], ['onum', 'smcp'], ['pnum']]) {
        describe(`fontFeatures: ${JSON.stringify(tags)}`, () => {
            const f = facts(build(tags));

            it('substitutes at least one glyph', () => {
                const plain = facts(build([]));
                expect([...f.cids].some(c => !plain.cids.has(c))).toBe(true);
            });

            it('lists every shown CID in /W', () => {
                // A glyph the font itself gives no width (the space, gid 3)
                // is covered by /DW, which is the documented contract.
                const missing = [...f.cids].filter(c => latin.widths[c] !== undefined && !f.widths.has(c));
                expect(missing).toEqual([]);
            });

            it('declares the advance the layout engine measured with', () => {
                for (const c of f.cids) {
                    if (latin.widths[c] === undefined) continue;
                    expect(f.widths.get(c)).toBe(latin.widths[c]);
                }
            });

            it('maps every shown CID in ToUnicode', () => {
                const missing = [...f.cids].filter(c => !f.toUnicode.has(c));
                expect(missing).toEqual([]);
            });

            it('embeds an outline for every shown CID that has one in the source font', () => {
                expect(f.glyf).not.toBeNull();
                const blank = [...f.cids].filter(c =>
                    extractGlyphContours(f.glyf!, c).length === 0
                    && extractGlyphContours(FULL_FONT!, c).length > 0);
                expect(blank).toEqual([]);
            });
        });
    }

    it('maps a substituted glyph back to the character it replaced', () => {
        const f = facts(build(['smcp']));
        // Every lowercase letter of the source text becomes a small capital;
        // ToUnicode must still name the lowercase letter it stood for.
        const recovered = new Set([...f.cids].map(c => f.toUnicode.get(c)));
        for (const ch of new Set(TEXT.replace(/[^a-z]/g, ''))) {
            expect(recovered.has(ch.codePointAt(0)!)).toBe(true);
        }
    });

    it('round-trips through extractText under every tag', () => {
        for (const tags of [['onum'], ['smcp'], ['pnum'], ['onum', 'smcp', 'zero']]) {
            const text = extractText(build(tags)).map(p => p.text).join('\n');
            expect(text).not.toContain('�');
            expect(text).toContain('0123456789');
            expect(text.toLowerCase()).toContain('small caps abcdef');
        }
    });
});
