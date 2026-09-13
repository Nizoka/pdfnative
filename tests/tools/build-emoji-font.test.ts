import { describe, it, expect } from 'vitest';
import { parseArgs, resolveCodepoints, resolveSequences, parseHex } from '../../scripts/lib/emoji-cli.js';
import { CURATED_FLAGS, CURATED_ZWJ, CURATED_SKIN_TONES, SKIN_TONE_BASES } from '../../scripts/lib/curated-emoji-sequences.js';
import { CURATED_EMOJI } from '../../scripts/lib/curated-emoji.js';
import { buildEmojiFontModule, allColorCodepoints } from '../../scripts/lib/emoji-font-core.js';

// Dynamic node imports via string indirection (tests avoid @types/node).
async function nodeFs(): Promise<{
    readFileSync(p: string): Uint8Array;
    existsSync(p: string): boolean;
}> {
    return (await import('node:' + 'fs')) as never;
}

const TTF_PATH = 'fonts/ttf/NotoColorEmoji-Regular.ttf';

// ── Pure CLI argument parsing ─────────────────────────────────────────

describe('emoji CLI — parseArgs', () => {
    it('parses flags and values', () => {
        const o = parseArgs(['--ttf', 'x.ttf', '--codepoints', '1F600', '--out', 'y.js', '--font-name', 'My', '--types', './t.js']);
        expect(o.ttf).toBe('x.ttf');
        expect(o.codepoints).toBe('1F600');
        expect(o.out).toBe('y.js');
        expect(o.fontName).toBe('My');
        expect(o.types).toBe('./t.js');
    });

    it('parses boolean flags and presets', () => {
        const o = parseArgs(['--download', '--all', '--preset', 'curated']);
        expect(o.download).toBe(true);
        expect(o.all).toBe(true);
        expect(o.preset).toBe('curated');
    });

    it('defaults out and types', () => {
        const o = parseArgs([]);
        expect(o.out).toBe('noto-color-emoji-data.js');
        expect(o.types).toBe('pdfnative');
        expect(o.help).toBe(false);
    });

    it('handles -h / --help', () => {
        expect(parseArgs(['-h']).help).toBe(true);
        expect(parseArgs(['--help']).help).toBe(true);
    });

    it('throws on unknown option', () => {
        expect(() => parseArgs(['--nope'])).toThrow(/Unknown option/);
    });

    it('throws on missing value', () => {
        expect(() => parseArgs(['--ttf'])).toThrow(/Missing value/);
    });
});

// ── Hex codepoint parsing ─────────────────────────────────────────────

describe('emoji CLI — parseHex', () => {
    it('tolerates U+, 0x, # and bare hex', () => {
        expect(parseHex('U+1F600')).toBe(0x1f600);
        expect(parseHex('0x1F600')).toBe(0x1f600);
        expect(parseHex('#1F600')).toBe(0x1f600);
        expect(parseHex('1f600')).toBe(0x1f600);
        expect(parseHex('  2764 ')).toBe(0x2764);
    });

    it('rejects non-hex and out-of-range', () => {
        expect(() => parseHex('zzz')).toThrow(/Invalid codepoint/);
        expect(() => parseHex('110000')).toThrow(/out of range/);
    });
});

// ── Codepoint selection resolution ────────────────────────────────────

const noColor = (): number[] => { throw new Error('allColor should not be called'); };

describe('emoji CLI — resolveCodepoints', () => {
    it('defaults to the curated set when nothing is selected', () => {
        const cps = resolveCodepoints(parseArgs([]), noColor);
        expect(cps.length).toBe(new Set(CURATED_EMOJI).size);
        expect(cps).toContain(0x1f600);
    });

    it('preset curated equals the curated set', () => {
        const cps = resolveCodepoints(parseArgs(['--preset', 'curated']), noColor);
        expect(cps.length).toBe(new Set(CURATED_EMOJI).size);
    });

    it('resolves explicit codepoints, sorted and deduped', () => {
        const cps = resolveCodepoints(parseArgs(['--codepoints', '1F680,1F600,1F600']), noColor);
        expect(cps).toEqual([0x1f600, 0x1f680]);
    });

    it('expands inclusive ranges', () => {
        const cps = resolveCodepoints(parseArgs(['--ranges', '1F600-1F602']), noColor);
        expect(cps).toEqual([0x1f600, 0x1f601, 0x1f602]);
    });

    it('merges codepoints and ranges without duplicates', () => {
        const cps = resolveCodepoints(parseArgs(['--codepoints', '2764', '--ranges', '1F600-1F601']), noColor);
        expect(cps).toEqual([0x2764, 0x1f600, 0x1f601]);
    });

    it('--all delegates to the font colour-codepoint resolver', () => {
        const cps = resolveCodepoints(parseArgs(['--all']), () => [0x1f601, 0x1f600]);
        expect(cps).toEqual([0x1f600, 0x1f601]);
    });

    it('--preset all also delegates', () => {
        const cps = resolveCodepoints(parseArgs(['--preset', 'all']), () => [0x1f600]);
        expect(cps).toEqual([0x1f600]);
    });

    it('throws on an unknown preset', () => {
        expect(() => resolveCodepoints(parseArgs(['--preset', 'weird']), noColor)).toThrow(/Unknown preset/);
    });

    it('throws when a range end precedes its start', () => {
        expect(() => resolveCodepoints(parseArgs(['--ranges', '1F602-1F600']), noColor)).toThrow(/end before start/);
    });

    it('throws on an oversized range', () => {
        expect(() => resolveCodepoints(parseArgs(['--ranges', '0-30000']), noColor)).toThrow(/too large/);
    });
});

describe('emoji CLI — resolveSequences', () => {
    it('bundles no sequence by default', () => {
        expect(resolveSequences(parseArgs([]))).toEqual([]);
    });

    it('skin preset expands every curated base into the five tones (v1.8.0)', () => {
        const seqs = resolveSequences(parseArgs(['--sequences', 'skin']));
        expect(seqs).toHaveLength(SKIN_TONE_BASES.length * 5);
        expect(seqs.slice(0, 5)).toEqual([0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF].map(t => [SKIN_TONE_BASES[0], t]));
    });

    it('all preset is flags, then ZWJ, then skin tones', () => {
        const seqs = resolveSequences(parseArgs(['--sequences', 'all']));
        expect(seqs).toHaveLength(CURATED_FLAGS.length + CURATED_ZWJ.length + CURATED_SKIN_TONES.length);
        expect(seqs.slice(-CURATED_SKIN_TONES.length)).toEqual(CURATED_SKIN_TONES);
    });

    it('names the skin preset when rejecting an unknown one', () => {
        expect(() => resolveSequences(parseArgs(['--sequences', 'tones']))).toThrow(/flags, zwj, skin, all or none/);
    });

    it('accepts a hand-written toned ZWJ sequence', () => {
        expect(resolveSequences(parseArgs(['--sequence-list', 'FR,1F469-1F3FD-200D-1F4BB']))).toEqual([
            [0x1F1EB, 0x1F1F7],
            [0x1F469, 0x1F3FD, 0x200D, 0x1F4BB],
        ]);
    });
});

// ── Build core (gated on the optional 24 MB source font) ──────────────

describe('emoji build core (requires fonts/ttf/NotoColorEmoji-Regular.ttf)', async () => {
    const fs = await nodeFs();
    const present = fs.existsSync(TTF_PATH);
    const ttf = present ? new Uint8Array(fs.readFileSync(TTF_PATH)) : new Uint8Array();

    it.skipIf(!present)('builds a module for explicit codepoints', () => {
        const { js, dts, stats } = buildEmojiFontModule(ttf, [0x1f600, 0x1f680], {
            dtsTypeImport: 'pdfnative',
            makeBanner: (kept) => `/* ${kept} */`,
        });
        expect(stats.kept).toBe(2);
        expect(stats.missing).toBe(0);
        expect(js).toContain('export const colorGlyphs');
        expect(js).toContain('export const ttfBase64');
        expect(dts).toContain(`from 'pdfnative'`);
    });

    it.skipIf(!present)('is deterministic — identical inputs yield identical output', () => {
        const opts = { dtsTypeImport: 'pdfnative', makeBanner: (k: number) => `/* ${k} */` };
        const a = buildEmojiFontModule(ttf, [0x1f600, 0x2764], opts);
        const b = buildEmojiFontModule(ttf, [0x1f600, 0x2764], opts);
        expect(a.js).toBe(b.js);
        expect(a.dts).toBe(b.dts);
    });

    it.skipIf(!present)('reports missing codepoints without throwing', () => {
        const { stats } = buildEmojiFontModule(ttf, [0x1f600, 0x41], {
            dtsTypeImport: 'pdfnative',
            makeBanner: () => '/* */',
        });
        expect(stats.kept).toBe(1);
        expect(stats.missing).toBe(1);
        expect(stats.missingCodepoints).toContain(0x41);
    });

    it.skipIf(!present)('enumerates all colour codepoints, sorted ascending', () => {
        const all = allColorCodepoints(ttf);
        expect(all.length).toBeGreaterThan(200);
        for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThan(all[i - 1]);
        expect(all).toContain(0x1f600);
    });
});
