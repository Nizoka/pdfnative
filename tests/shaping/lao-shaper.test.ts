import { describe, it, expect } from 'vitest';
import { shapeLaoText, buildLaoClusters } from '../../src/shaping/lao-shaper.js';
import { containsLao, isLaoCodepoint, containsThai, isThaiCodepoint, LAO_START, LAO_END } from '../../src/shaping/script-registry.js';
import { findShaper } from '../../src/shaping/shaper-registry.js';
import { needsUnicodeFont, detectFallbackLangs, detectCharLang } from '../../src/shaping/script-detect.js';
import * as notoLao from '../../fonts/noto-lao-data.js';
import type { FontData } from '../../src/types/pdf-types.js';

// v1.8.0 — Lao, the 23rd script.

const fd = notoLao as unknown as FontData;
const gid = (cp: number): number => fd.cmap[cp] ?? 0;
const gids = (text: string): number[] => shapeLaoText(text, fd).map(g => g.gid);

describe('Lao script range', () => {
    it('covers the Lao block', () => {
        expect(LAO_START).toBe(0x0E80);
        expect(LAO_END).toBe(0x0EFF);
    });

    it('starts exactly where Thai ends, so neither predicate claims the other', () => {
        expect(isThaiCodepoint(0x0E7F)).toBe(true);
        expect(isLaoCodepoint(0x0E7F)).toBe(false);
        expect(isThaiCodepoint(0x0E80)).toBe(false);
        expect(isLaoCodepoint(0x0E80)).toBe(true);
    });

    it('detects Lao in a string without claiming Thai', () => {
        expect(containsLao('ລາວ')).toBe(true);
        expect(containsLao('สวัสดี')).toBe(false);
        expect(containsThai('ລາວ')).toBe(false);
        expect(containsLao('Hello')).toBe(false);
        expect(containsLao('')).toBe(false);
    });
});

describe('Lao font routing', () => {
    it('requires an embedded font, never Helvetica', () => {
        // Without this a Lao-only document silently renders as blanks.
        expect(needsUnicodeFont('lo')).toBe(true);
    });

    it('maps a Lao code point to the Lao font', () => {
        expect(detectCharLang(0x0EA5)).toBe('lo');
        expect(detectCharLang(0x0E01)).toBe('th');
    });

    it('asks for the Lao font when Lao appears in another language', () => {
        expect(detectFallbackLangs(['Bonjour ລາວ'], 'fr')).toContain('lo');
        expect(detectFallbackLangs(['ລາວ'], 'lo').has('lo')).toBe(false);
    });

    it('is reachable through the shaper registry', () => {
        expect(findShaper('ລາວ')?.id).toBe('lao');
        expect(findShaper('สวัสดี')?.id).toBe('thai');
    });
});

describe('the bundled Lao font', () => {
    it('covers the whole living Lao block', () => {
        // Every consonant, vowel, tone and digit Lao actually uses.
        const required = [
            0x0E81, 0x0E87, 0x0E8A, 0x0E94, 0x0E99, 0x0EA1, 0x0EA5, 0x0EAA, // consonants
            0x0EB0, 0x0EB2, 0x0EB3, 0x0EBD, 0x0EC6,                          // spacing signs
            0x0EB1, 0x0EB4, 0x0EB5, 0x0EB6, 0x0EB7, 0x0EBB,                  // above vowels
            0x0EB8, 0x0EB9, 0x0EBA, 0x0EBC,                                  // below marks
            0x0EC0, 0x0EC1, 0x0EC2, 0x0EC3, 0x0EC4,                          // leading vowels
            0x0EC8, 0x0EC9, 0x0ECA, 0x0ECB, 0x0ECC, 0x0ECD,                  // tones and signs
            0x0ED0, 0x0ED9,                                                   // digits
        ];
        for (const cp of required) {
            expect(gid(cp), `U+${cp.toString(16).toUpperCase()} missing`).toBeGreaterThan(0);
        }
    });

    it('carries the pali virama, without which Lao Pali cannot be set', () => {
        expect(gid(0x0EBA)).toBeGreaterThan(0);
    });

    it('carries mark anchors for every combining mark', () => {
        const marks = [0x0EB1, 0x0EB4, 0x0EB8, 0x0EB9, 0x0EC8, 0x0ECD];
        for (const cp of marks) {
            expect(fd.markAnchors?.marks[gid(cp)], `U+${cp.toString(16).toUpperCase()}`).toBeDefined();
        }
    });
});

describe('buildLaoClusters', () => {
    it('returns nothing for empty input', () => {
        expect(buildLaoClusters('')).toEqual([]);
    });

    it('makes one cluster per consonant', () => {
        expect(buildLaoClusters('ລາວ')).toHaveLength(3);
    });

    it('attaches a leading vowel to the base that follows it', () => {
        const [cluster] = buildLaoClusters('ເກ');
        expect(cluster.leadings).toEqual([0x0EC0]);
        expect(cluster.base).toBe(0x0E81);
    });

    it('leaves a dangling leading vowel standing alone', () => {
        // It must not swallow a mark or another vowel as its base.
        const clusters = buildLaoClusters('ເ');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base).toBe(0x0EC0);
        expect(clusters[0].leadings).toEqual([]);
    });

    it('collects above and below marks onto their base', () => {
        const [cluster] = buildLaoClusters('ພຸ້');
        expect(cluster.base).toBe(0x0E9E);
        expect(cluster.belows).toEqual([0x0EB8]);
        expect(cluster.aboves).toEqual([0x0EC9]);
    });

    it('decomposes sara am into a niggahita and a spacing vowel', () => {
        const clusters = buildLaoClusters('ກຳ');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].aboves).toEqual([0x0ECD]);
        expect(clusters[1].base).toBe(0x0EB2);
    });

    it('treats a leading sara am as its own cluster', () => {
        const clusters = buildLaoClusters('ຳ');
        expect(clusters[0].base).toBe(0x0ECD);
        expect(clusters[1].base).toBe(0x0EB2);
    });

    it('treats the spacing signs as bases, never as marks', () => {
        // ະ າ ຽ ໆ advance the pen. Classing them as marks collapses the word.
        for (const cp of [0x0EB0, 0x0EB2, 0x0EBD, 0x0EC6]) {
            const [cluster] = buildLaoClusters(String.fromCodePoint(cp));
            expect(cluster.base, `U+${cp.toString(16).toUpperCase()}`).toBe(cp);
            expect(cluster.aboves).toEqual([]);
            expect(cluster.belows).toEqual([]);
        }
    });

    it('treats the pali virama as a below mark', () => {
        const [cluster] = buildLaoClusters('ຣ຺');
        expect(cluster.base).toBe(0x0EA3);
        expect(cluster.belows).toEqual([0x0EBA]);
    });

    it('keeps an orphan mark rather than dropping it', () => {
        const clusters = buildLaoClusters('ຸ');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base).toBe(0x0EB8);
    });
});

describe('shapeLaoText', () => {
    it('shapes nothing from nothing', () => {
        expect(shapeLaoText('', fd)).toEqual([]);
    });

    it('never emits a notdef for well-formed Lao', () => {
        for (const word of ['ສະບາຍດີ', 'ພາສາລາວ', 'ຂອບໃຈ', 'ວຽງຈັນ']) {
            expect(shapeLaoText(word, fd).every(g => g.gid > 0), word).toBe(true);
        }
    });

    it('emits a leading vowel before its base', () => {
        expect(gids('ເກ')).toEqual([gid(0x0EC0), gid(0x0E81)]);
    });

    it('gives marks no advance, so they stack instead of spacing', () => {
        const shaped = shapeLaoText('ປີ', fd);
        expect(shaped[0].isZeroAdvance).toBe(false);
        expect(shaped[1].isZeroAdvance).toBe(true);
    });

    it('substitutes the above-mark variant on a tall consonant', () => {
        // ປ has an ascender the plain vowel would collide with.
        const tall = shapeLaoText('ປີ', fd)[1].gid;
        const plain = shapeLaoText('ກີ', fd)[1].gid;
        expect(tall).not.toBe(plain);
        expect(tall).toBe(fd.gsub[plain]);
    });

    it('substitutes the below-mark variant on a descender consonant', () => {
        const descender = shapeLaoText('ຊຸ', fd)[1].gid;
        const plain = shapeLaoText('ກຸ', fd)[1].gid;
        expect(descender).not.toBe(plain);
        expect(descender).toBe(fd.gsub[plain]);
    });

    it('leaves the mark alone on a consonant that needs no variant', () => {
        expect(shapeLaoText('ກີ', fd)[1].gid).toBe(gid(0x0EB5));
        expect(shapeLaoText('ກຸ', fd)[1].gid).toBe(gid(0x0EB8));
    });

    it('anchors a mark relative to its base rather than at the origin', () => {
        const [, mark] = shapeLaoText('ກີ', fd);
        expect(mark.dx).not.toBe(0);
    });

    it('stacks a tone mark above a vowel already on the base', () => {
        const shaped = shapeLaoText('ພຸ້', fd);
        expect(shaped).toHaveLength(3);
        expect(shaped.slice(1).every(g => g.isZeroAdvance)).toBe(true);
    });

    it('renders sara am as a niggahita plus a spacing vowel', () => {
        const shaped = shapeLaoText('ກຳ', fd);
        expect(shaped).toHaveLength(3);
        expect(shaped[1].isZeroAdvance).toBe(true);   // niggahita
        expect(shaped[2].isZeroAdvance).toBe(false);  // sara aa advances
        expect(shaped[2].gid).toBe(gid(0x0EB2));
    });

    it('renders the pali virama as a below mark, not a spacing base', () => {
        const shaped = shapeLaoText('ຣ຺', fd);
        expect(shaped).toHaveLength(2);
        expect(shaped[1].isZeroAdvance).toBe(true);
    });

    it('is deterministic', () => {
        expect(shapeLaoText('ສະບາຍດີ', fd)).toEqual(shapeLaoText('ສະບາຍດີ', fd));
    });

    it('passes a space through as a spacing glyph', () => {
        const shaped = shapeLaoText('ກ ກ', fd);
        expect(shaped).toHaveLength(3);
        expect(shaped.every(g => !g.isZeroAdvance)).toBe(true);
    });
});
