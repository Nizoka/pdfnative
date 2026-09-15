import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subsetTTF } from '../../src/fonts/font-subsetter.js';
import { parseFontData } from '../../src/tools/font-compiler.js';
import type { FontDataObject } from '../../src/tools/font-compiler.js';
import { readManifest, sfntTables, sha256Of, readNameRecord } from '../../scripts/lib/font-sources.js';
import {
    parseCodepointList, formatCodepointList, gsubClosure, buildAllLatinSubsets, codepointsPath, withDerivedHashes,
} from '../../scripts/lib/latin-subsets.js';

// v1.8.0 — the five Latin source fonts are cut from the pinned NotoSans-VF.ttf
// by the library itself: a code-point list per module, a recorded command, a
// recorded hash. Nothing under fonts/ttf/ is committed any more.

const ROOT = process.cwd();
const TTF_DIR = join(ROOT, 'fonts', 'ttf');
const manifest = readManifest();
const VF = join(TTF_DIR, 'NotoSans-VF.ttf');

describe('code-point lists', () => {
    it('parses single code points and inclusive ranges, ignoring comments and blank lines', () => {
        const cps = parseCodepointList('# header\n\nU+0041\nU+0043-U+0045 # trailing comment\r\nU+1F600\n');
        expect(cps).toEqual([0x41, 0x43, 0x44, 0x45, 0x1F600]);
    });

    it('sorts and de-duplicates', () => {
        expect(parseCodepointList('U+0045\nU+0041-U+0043\nU+0042')).toEqual([0x41, 0x42, 0x43, 0x45]);
    });

    it('names the malformed line', () => {
        expect(() => parseCodepointList('U+0041\n0x42\n', 'x.txt')).toThrow(/x\.txt:2: expected U\+XXXX/);
        expect(() => parseCodepointList('U+0045-U+0041')).toThrow(/descending/);
        expect(() => parseCodepointList('U+110000')).toThrow(/beyond/);
    });

    it('formats runs as ranges and round-trips', () => {
        const cps = [0, 13, 0x20, 0x21, 0x22, 0x7E, 0xA0, 0x10780, 0x10781];
        const text = formatCodepointList(cps, ['title', '']);
        expect(text).toBe('# title\n#\nU+0000\nU+000D\nU+0020-U+0022\nU+007E\nU+00A0\nU+10780-U+10781\n');
        expect(parseCodepointList(text)).toEqual(cps);
    });
});

describe('gsubClosure', () => {
    const font = (over: Partial<FontDataObject>): FontDataObject => ({
        metrics: { unitsPerEm: 1000, ascent: 800, descent: -200, capHeight: 700, stemV: 80, bbox: [0, 0, 0, 0], defaultWidth: 500, numGlyphs: 20 },
        fontName: 'Closure',
        cmap: {},
        defaultWidth: 500,
        widths: {},
        gsub: {},
        ligatures: {},
        features: null,
        kern: null,
        markAnchors: { marks: {}, bases: {} },
        mark2mark: { mark1Anchors: {}, mark2Classes: {} },
        otl: null,
        pdfWidthArray: '',
        ttfBase64: '',
        ...over,
    });

    it('always keeps .notdef and follows default single substitutions', () => {
        const fd = font({ gsub: { 1: 2, 2: 3, 9: 10 } });
        expect([...gsubClosure(new Set([1]), fd)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    });

    it('follows discretionary features and ligatures whose components are all kept', () => {
        const fd = font({
            features: { smcp: { 1: 11 } },
            ligatures: { 1: [[12, 2], [13, 3]] }, // 1+2 → 12, 1+3 → 13
        });
        expect([...gsubClosure(new Set([1, 2]), fd)].sort((a, b) => a - b)).toEqual([0, 1, 2, 11, 12]);
    });

    it('applies otl lookups of type 1, 2 and 4', () => {
        const fd = font({
            otl: {
                gsub: {
                    scripts: { latn: { ccmp: [0, 1, 2] } },
                    lookups: {
                        0: { t: 1, f: 0, m: { 1: 4 } },
                        1: { t: 2, f: 0, m: { 4: [5, 6] } },
                        2: { t: 4, f: 0, m: { 5: [[7, 6]] } },
                    },
                },
            },
        });
        expect([...gsubClosure(new Set([1]), fd)].sort((a, b) => a - b)).toEqual([0, 1, 4, 5, 6, 7]);
    });

    it('fires a chain rule only when every context set has a kept glyph, and then only on the input set', () => {
        const fd = font({
            otl: {
                gsub: {
                    scripts: { latn: { calt: [0] } },
                    sets: [[1, 1], [2, 2], [1, 2]],
                    lookups: {
                        0: { t: 6, f: 0, m: [{ b: [0], i: [2], l: [], a: [[0, 1]] }] }, // backtrack {1}, input {1,2}
                        1: { t: 1, f: 0, m: { 1: 8, 2: 9, 3: 10 } },
                    },
                },
            },
        });
        // Backtrack set {1} is not kept: the rule does not fire.
        expect([...gsubClosure(new Set([2]), fd)].sort((a, b) => a - b)).toEqual([0, 2]);
        // With 1 kept the rule fires; lookup 1 applies to the input set {1,2} ∩ kept, never to 3.
        expect([...gsubClosure(new Set([1, 2, 3]), fd)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 8, 9]);
    });

    it('reaches a fixpoint across rounds', () => {
        const fd = font({ gsub: { 1: 2 }, ligatures: { 2: [[5, 3]] }, features: { sups: { 5: 6 } } });
        expect([...gsubClosure(new Set([1, 3]), fd)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6]);
    });
});

describe('fonts/SOURCES.json derived entries', () => {
    it('name an existing, parseable code-point list each, BMP-only except Cyrillic', () => {
        expect(manifest.derived).toHaveLength(5);
        for (const d of manifest.derived) {
            const path = codepointsPath(d);
            expect(existsSync(path), d.codepoints).toBe(true);
            const cps = parseCodepointList(readFileSync(path, 'utf8'), d.codepoints);
            expect(cps.length).toBeGreaterThan(400);
            expect(cps).toContain(0x20);
            if (d.local !== 'NotoSans-Cyrillic.ttf') expect(cps.every(cp => cp <= 0xFFFF), d.local).toBe(true);
        }
    });

    it('records the tool, the command and a layout choice per subset', () => {
        for (const d of manifest.derived) {
            expect(d.from).toBe('NotoSans-VF.ttf');
            expect(d.tool).toContain('subsetTTF');
            expect(d.command).toBe('npx tsx scripts/build-latin-subsets.ts');
            expect(typeof d.layout).toBe('boolean');
        }
    });

    it('withDerivedHashes replaces only the built entries', () => {
        const next = withDerivedHashes(manifest, [{ entry: manifest.derived[1], bytes: new Uint8Array(3), sha256: 'abc', glyphs: 1 }]);
        expect(next.derived[1].sha256).toBe('abc');
        expect(next.derived[1].bytes).toBe(3);
        expect(next.derived[0]).toEqual(manifest.derived[0]);
        expect(next.fonts).toBe(manifest.fonts);
    });
});

// The proof itself needs the 2 MB variable font, which `npm run fonts:download`
// fetches; without it these tests skip, like `npm run verify:fonts`.
describe.runIf(existsSync(VF))('the derived subsets, re-cut from NotoSans-VF.ttf', () => {
    const builds = buildAllLatinSubsets(manifest, TTF_DIR);
    const byName = new Map(builds.map(b => [b.entry.local, b]));

    it('hash exactly as fonts/SOURCES.json records', () => {
        for (const b of builds) {
            expect(b.sha256, b.entry.local).toBe(b.entry.sha256);
            expect(b.bytes.length, b.entry.local).toBe(b.entry.bytes);
            expect(sha256Of(b.bytes)).toBe(b.sha256);
        }
    });

    it('are static default instances: no variation tables, layout tables iff declared', () => {
        for (const b of builds) {
            const tables = sfntTables(b.bytes);
            for (const tag of ['fvar', 'gvar', 'HVAR', 'avar', 'STAT', 'MVAR']) expect(tables.has(tag), `${b.entry.local} ${tag}`).toBe(false);
            expect(tables.has('GSUB'), b.entry.local).toBe(b.entry.layout);
            expect(tables.has('GPOS'), b.entry.local).toBe(b.entry.layout);
            expect(tables.has('GDEF'), b.entry.local).toBe(b.entry.layout);
            expect(tables.has('glyf') && tables.has('cmap') && tables.has('hmtx')).toBe(true);
        }
    });

    it('compile to a cmap that is exactly the declared code-point list', () => {
        for (const b of builds) {
            const compiled = parseFontData(b.bytes);
            const declared = parseCodepointList(readFileSync(codepointsPath(b.entry), 'utf8'));
            const advertised = Object.keys(compiled.cmap).map(Number).sort((a, c) => a - c);
            expect(advertised, b.entry.local).toEqual(declared);
        }
    });

    it('keep the variable font\'s glyph ids, so the modules\' widths and cmaps do not move', () => {
        const vf = parseFontData(new Uint8Array(readFileSync(VF)));
        const polish = parseFontData(byName.get('NotoSans-Polish.ttf')!.bytes);
        expect(polish.metrics.numGlyphs).toBe(vf.metrics.numGlyphs);
        for (const cp of [0x41, 0x105, 0x141, 0x20AC]) expect(polish.cmap[cp]).toBe(vf.cmap[cp]);
    });

    it('carry the upstream copyright statement, which the manifest records', () => {
        const upstream = manifest.fonts.find(f => f.local === 'NotoSans-VF.ttf')!;
        expect(upstream.copyright).toMatch(/^Copyright \d{4} The Noto Project Authors/);
        for (const b of builds) expect(readNameRecord(b.bytes, 0)).toBe(upstream.copyright);
    });

    it('is what subsetTTF produces for the same glyph set — the recorded command, not a fixture', () => {
        const b = byName.get('NotoSans-Greek.ttf')!;
        const vfBytes = new Uint8Array(readFileSync(VF));
        const vf = parseFontData(vfBytes);
        const gids = new Set<number>([0]);
        for (const cp of parseCodepointList(readFileSync(codepointsPath(b.entry), 'utf8'))) gids.add(vf.cmap[cp]);
        const again = new Uint8Array(Buffer.from(subsetTTF(vfBytes, gids), 'latin1'));
        expect(sha256Of(again)).toBe(b.sha256);
    });
});
