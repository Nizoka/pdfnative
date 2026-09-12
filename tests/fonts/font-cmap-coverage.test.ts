import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FontData } from '../../src/types/pdf-types.js';
import * as notoPolish from '../../fonts/noto-polish-data.js';
import * as notoGreek from '../../fonts/noto-greek-data.js';
import * as notoSans from '../../fonts/noto-sans-data.js';

// v1.8.0 — a bundled module must not advertise glyphs its font cannot draw.
//
// Subsetted fonts routinely keep their full glyph count and full cmap while
// emptying the outlines they dropped (pyftsubset --retain-gids). Trusting the
// cmap alone made three modules advertise roughly 2 650 code points each that
// rendered blank instead of falling through to another registered font.

const REPO = join(process.cwd());
const TTF_DIR = join(REPO, 'fonts', 'ttf');

/** Glyph ids with a non-empty outline, read from `loca`. */
function outlineFlags(ttfPath: string): { numGlyphs: number; has: Uint8Array } {
    const buf = readFileSync(ttfPath);
    const numTables = buf.readUInt16BE(4);
    const tables: Record<string, number> = {};
    for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        tables[buf.toString('ascii', o, o + 4)] = buf.readUInt32BE(o + 8);
    }
    const fmt = buf.readInt16BE(tables['head'] + 50);
    const numGlyphs = buf.readUInt16BE(tables['maxp'] + 4);
    const loca = tables['loca'];
    const has = new Uint8Array(numGlyphs);
    for (let g = 0; g < numGlyphs; g++) {
        const a = fmt === 0 ? buf.readUInt16BE(loca + g * 2) * 2 : buf.readUInt32BE(loca + g * 4);
        const b = fmt === 0 ? buf.readUInt16BE(loca + (g + 1) * 2) * 2 : buf.readUInt32BE(loca + (g + 1) * 4);
        if (b > a) has[g] = 1;
    }
    return { numGlyphs, has };
}

/** Characters that are meant to be blank; mirrors the generator's rule. */
function intentionallyBlank(cp: number): boolean {
    return cp <= 0x20
        || cp === 0xA0
        || (cp >= 0x2000 && cp <= 0x200F)
        || (cp >= 0x2028 && cp <= 0x202F)
        || (cp >= 0x205F && cp <= 0x206F)
        || cp === 0x3000
        || cp === 0xFEFF;
}

describe('bundled cmap coverage', () => {
    const cases: readonly [string, FontData, string][] = [
        ['polish', notoPolish as unknown as FontData, 'NotoSans-Polish.ttf'],
        ['greek', notoGreek as unknown as FontData, 'NotoSans-Greek.ttf'],
        ['sans', notoSans as unknown as FontData, 'NotoSans-VF.ttf'],
    ];

    for (const [name, fd, ttf] of cases) {
        const ttfPath = join(TTF_DIR, ttf);

        it.runIf(existsSync(ttfPath))(`${name}: every mapped glyph is drawable or deliberately blank`, () => {
            const { has } = outlineFlags(ttfPath);
            const offenders: string[] = [];
            for (const [cpStr, gid] of Object.entries(fd.cmap)) {
                const cp = Number(cpStr);
                if (has[gid] !== 1 && !intentionallyBlank(cp)) {
                    offenders.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}→${gid}`);
                }
            }
            expect(offenders.slice(0, 20), 'code points mapped to an empty glyph').toEqual([]);
        });
    }

    it('keeps the space family, which is blank on purpose', () => {
        // Dropping these would break wrapping and measurement outright.
        for (const cp of [0x20, 0xA0]) {
            expect(notoSans.cmap[cp], `U+${cp.toString(16)} must stay mapped`).toBeGreaterThan(0);
        }
    });

    it('no longer advertises the whole Unicode range on a Latin subset', () => {
        // Polish covers Latin, not Cyrillic or Devanagari. Before the fix it
        // claimed both, and drew blanks for them.
        const polish = notoPolish as unknown as FontData;
        expect(polish.cmap[0x0410]).toBeUndefined(); // CYRILLIC CAPITAL A
        expect(polish.cmap[0x0915]).toBeUndefined(); // DEVANAGARI KA
        expect(polish.cmap[0x0141]).toBeGreaterThan(0); // Ł — what it is actually for
        expect(polish.cmap[0x0179]).toBeGreaterThan(0); // Ź
    });
});

describe('bundled module contract', () => {
    const FONTS = join(REPO, 'fonts');
    const modules = readdirSync(FONTS).filter(f => f.endsWith('-data.js'));

    it('every module declares the source font it was built from', () => {
        for (const m of modules) {
            const text = readFileSync(join(FONTS, m), 'utf8');
            expect(/\* Source: \S+\.ttf/.test(text), `${m} has no Source header`).toBe(true);
        }
    });

    it('every module ships a matching type declaration', () => {
        for (const m of modules) {
            const dts = join(FONTS, m.replace(/\.js$/, '.d.ts'));
            expect(existsSync(dts), `${m} has no .d.ts`).toBe(true);
            const js = readFileSync(join(FONTS, m), 'utf8');
            const d = readFileSync(dts, 'utf8');
            for (const name of ['cmap', 'widths', 'gsub', 'ligatures', 'features', 'kern', 'metrics', 'ttfBase64']) {
                const inJs = js.includes(`export const ${name} =`);
                const inDts = d.includes(`export declare const ${name}`);
                expect(inDts, `${m}: ${name} declared=${inDts} but exported=${inJs}`).toBe(inJs);
            }
        }
    });
});
