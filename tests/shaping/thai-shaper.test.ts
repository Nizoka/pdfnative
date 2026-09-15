import { describe, it, expect } from 'vitest';
import { buildThaiClusters, containsThai, shapeThaiText, THAI_START, THAI_END } from '../../src/shaping/thai-shaper.js';
import * as notoThai from '../../fonts/noto-thai-data.js';
import type { FontData } from '../../src/types/pdf-types.js';

describe('containsThai', () => {
    it('should return true for Thai text', () => {
        expect(containsThai('สวัสดี')).toBe(true);
    });

    it('should return false for ASCII text', () => {
        expect(containsThai('Hello World')).toBe(false);
    });

    it('should return false for empty string', () => {
        expect(containsThai('')).toBe(false);
    });

    it('should detect single Thai character', () => {
        expect(containsThai('\u0E01')).toBe(true); // ko kai
    });

    it('should detect Thai mixed with Latin', () => {
        expect(containsThai('Hello สวัสดี World')).toBe(true);
    });
});

describe('THAI_START / THAI_END', () => {
    it('should define correct Unicode range', () => {
        expect(THAI_START).toBe(0x0E00);
        expect(THAI_END).toBe(0x0E7F);
    });
});

describe('buildThaiClusters', () => {
    it('should create one cluster per base consonant', () => {
        const clusters = buildThaiClusters('\u0E01\u0E02'); // ko kai, kho khai
        expect(clusters).toHaveLength(2);
        expect(clusters[0].base).toBe(0x0E01);
        expect(clusters[1].base).toBe(0x0E02);
    });

    it('should attach above vowel to base', () => {
        // กิ = ko kai + sara i (above)
        const clusters = buildThaiClusters('\u0E01\u0E34');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base).toBe(0x0E01);
        expect(clusters[0].aboves).toContain(0x0E34);
    });

    it('should attach below vowel to base', () => {
        // กุ = ko kai + sara u (below)
        const clusters = buildThaiClusters('\u0E01\u0E38');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base).toBe(0x0E01);
        expect(clusters[0].belows).toContain(0x0E38);
    });

    it('should handle leading vowel (attaches to next base)', () => {
        // เก = sara e (leading) + ko kai
        const clusters = buildThaiClusters('\u0E40\u0E01');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].base).toBe(0x0E01);
        expect(clusters[0].leadings).toContain(0x0E40);
    });

    it('should decompose sara am into nikhahit + sara aa', () => {
        // กำ = ko kai + sara am
        const clusters = buildThaiClusters('\u0E01\u0E33');
        expect(clusters).toHaveLength(2);
        // First cluster: ko kai with nikhahit above
        expect(clusters[0].base).toBe(0x0E01);
        expect(clusters[0].aboves).toEqual([0x0E4D]);
        // Second cluster: sara aa
        expect(clusters[1].base).toBe(0x0E32);
    });

    // The Thai OpenType specification (and HarfBuzz's preprocess_text_thai)
    // draws น้ำ as น ํ ้ า: the nikhahit split off from sara am goes before
    // the tone mark so that the tone stacks on it. Until v1.8.0 the nikhahit
    // was appended after the tone and ended up drawn on top of it.
    it('orders the nikhahit of sara am before a tone mark already on the base', () => {
        // น้ำ = no nu + mai tho + sara am
        const clusters = buildThaiClusters('น้ำ');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].aboves).toEqual([0x0E4D, 0x0E49]);
        expect(clusters[1].base).toBe(0x0E32);
        // ก่ำ = ko kai + mai ek + sara am
        expect(buildThaiClusters('ก่ำ')[0].aboves).toEqual([0x0E4D, 0x0E48]);
    });

    it('moves the nikhahit before the whole trailing run of tone-class marks', () => {
        // กิ่ำ (ill-formed, but the walk-back covers every mark in HarfBuzz's set)
        expect(buildThaiClusters('กิ่ำ')[0].aboves).toEqual([0x0E4D, 0x0E34, 0x0E48]);
    });

    it('stops the walk-back at mai han-akat, which is not in the tone-mark set', () => {
        // กั้ำ → ั stays first, the nikhahit lands between it and the tone
        expect(buildThaiClusters('กั้ำ')[0].aboves).toEqual([0x0E31, 0x0E4D, 0x0E49]);
    });

    it('should attach tone mark as above mark', () => {
        // ก่ = ko kai + mai ek (tone)
        const clusters = buildThaiClusters('\u0E01\u0E48');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].aboves).toContain(0x0E48);
    });

    it('should stack multiple above marks', () => {
        // กิ่ = ko kai + sara i + mai ek
        const clusters = buildThaiClusters('\u0E01\u0E34\u0E48');
        expect(clusters).toHaveLength(1);
        expect(clusters[0].aboves).toHaveLength(2);
        expect(clusters[0].aboves[0]).toBe(0x0E34);
        expect(clusters[0].aboves[1]).toBe(0x0E48);
    });

    it('should handle empty string', () => {
        expect(buildThaiClusters('')).toEqual([]);
    });

    it('should handle ASCII (each char is a cluster base)', () => {
        const clusters = buildThaiClusters('AB');
        expect(clusters).toHaveLength(2);
        expect(clusters[0].base).toBe(65);
        expect(clusters[1].base).toBe(66);
    });
});

describe('shapeThaiText', () => {
    // Minimal font data for testing shaping
    const mockThaiFont: FontData = {
        metrics: { unitsPerEm: 1000, numGlyphs: 200, defaultWidth: 500, ascent: 1061, descent: -450, bbox: [-691, -433, 960, 1009], capHeight: 714, stemV: 48 },
        fontName: 'TestThai',
        cmap: {
            0x0E01: 6,   // ko kai
            0x0E02: 7,   // kho khai
            0x0E34: 92,  // sara i (above)
            0x0E38: 97,  // sara u (below)
            0x0E48: 42,  // mai ek (tone)
            0x0E40: 91,  // sara e (leading)
            0x0E32: 85,  // sara aa
            0x0E4D: 59,  // nikhahit
            0x0E33: 90,  // sara am
            0x0E1B: 80,  // po pla (tall consonant)
            32: 111,     // space
        },
        defaultWidth: 500,
        widths: { 6: 594, 7: 500, 92: 0, 97: 0, 42: 0, 91: 400, 85: 500, 59: 0, 90: 500, 80: 600, 111: 260 },
        pdfWidthArray: '',
        ttfBase64: '',
        gsub: {},
        markAnchors: {
            bases: {
                6: { 0: [297, 800] },  // ko kai anchor for mark class 0
                80: { 0: [300, 900] }, // po pla anchor
            },
            marks: {
                92: [0, 200, 400],  // sara i: class 0, anchor x=200, y=400
                42: [0, 150, 500],  // mai ek: class 0
                97: [1, 200, -100], // sara u: class 1 (below)
            },
        },
        mark2mark: {
            mark1Anchors: {},
            mark2Classes: {},
        },
    };

    it('should produce shaped glyphs', () => {
        const result = shapeThaiText('\u0E01', mockThaiFont);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].gid).toBe(6);
    });

    it('should mark combining marks as zero-advance', () => {
        // กิ = ko kai + sara i
        const result = shapeThaiText('\u0E01\u0E34', mockThaiFont);
        expect(result).toHaveLength(2);
        expect(result[0].isZeroAdvance).toBe(false); // base
        expect(result[1].isZeroAdvance).toBe(true);  // mark
    });

    it('should produce leading vowel as non-zero-advance', () => {
        // เก = sara e + ko kai
        const result = shapeThaiText('\u0E40\u0E01', mockThaiFont);
        expect(result.length).toBeGreaterThanOrEqual(2);
        // Leading vowel should have advance
        expect(result[0].isZeroAdvance).toBe(false);
    });

    it('should decompose sara am', () => {
        // กำ = ko kai + sara am → ko kai + nikhahit(above) + sara aa(base)
        const result = shapeThaiText('\u0E01\u0E33', mockThaiFont);
        // Should have: base(ko kai) + mark(nikhahit) + base(sara aa)
        const gids = result.map(g => g.gid);
        expect(gids).toContain(6);  // ko kai
        expect(gids).toContain(59); // nikhahit
        expect(gids).toContain(85); // sara aa
    });

    it('should apply GPOS mark-to-base anchoring', () => {
        // กิ = ko kai + sara i → sara i should have dx/dy from anchor
        const result = shapeThaiText('\u0E01\u0E34', mockThaiFont);
        const mark = result[1]; // sara i
        // dx = baseAnchor[0] - markAnchor.x - baseAdv = 297 - 200 - 594 = -497
        // dy = baseAnchor[1] - markAnchor.y = 800 - 400 = 400
        expect(mark.dx).toBe(-497);
        expect(mark.dy).toBe(400);
    });

    it('should handle space as simple glyph', () => {
        const result = shapeThaiText(' ', mockThaiFont);
        expect(result).toHaveLength(1);
        expect(result[0].gid).toBe(111);
        expect(result[0].isZeroAdvance).toBe(false);
    });

    it('should handle empty string', () => {
        const result = shapeThaiText('', mockThaiFont);
        expect(result).toHaveLength(0);
    });

    it('should position below mark with GPOS anchoring', () => {
        // กุ = ko kai + sara u (below)
        const fontWithBelow: FontData = {
            ...mockThaiFont,
            markAnchors: {
                bases: {
                    6: { 0: [297, 800], 1: [297, -50] }, // class 0 (above) + class 1 (below)
                    80: { 0: [300, 900] },
                },
                marks: {
                    92: [0, 200, 400],
                    42: [0, 150, 500],
                    97: [1, 200, -100], // sara u: class 1, anchor x=200, y=-100
                },
            },
        };
        const result = shapeThaiText('\u0E01\u0E38', fontWithBelow);
        expect(result).toHaveLength(2);
        const below = result[1];
        expect(below.isZeroAdvance).toBe(true);
        // dx = baseAnchor[1][0] - markAnchor.x - baseAdv = 297 - 200 - 594 = -497
        // dy = baseAnchor[1][1] - markAnchor.y = -50 - (-100) = 50
        expect(below.dx).toBe(-497);
        expect(below.dy).toBe(50);
    });

    it('should apply mark-to-mark stacking for two above marks', () => {
        // กิ่ = ko kai + sara i + mai ek (m2m stacking)
        const fontWithM2M: FontData = {
            ...mockThaiFont,
            mark2mark: {
                mark1Anchors: {
                    92: { 0: [200, 700] }, // sara i GID: anchor for class 0
                },
                mark2Classes: {
                    42: [0, 150, 500], // mai ek GID: class 0, anchor x=150, y=500
                },
            },
        };
        const result = shapeThaiText('\u0E01\u0E34\u0E48', fontWithM2M);
        expect(result).toHaveLength(3);
        // First mark (sara i) → standard mark-to-base
        expect(result[1].isZeroAdvance).toBe(true);
        // Second mark (mai ek) → mark-to-mark
        const toneMark = result[2];
        expect(toneMark.isZeroAdvance).toBe(true);
        // dx = prevDx + (m1Pt[0] - m2Class[1]) = -497 + (200 - 150) = -447
        // dy = prevDy + (m1Pt[1] - m2Class[2]) = 400 + (700 - 500) = 600
        expect(toneMark.dx).toBe(-447);
        expect(toneMark.dy).toBe(600);
    });

    it('should fallback to mark-to-base when m2m data is missing', () => {
        // กิ่ with no m2m data → second mark falls back to mark-to-base
        const result = shapeThaiText('\u0E01\u0E34\u0E48', mockThaiFont);
        expect(result).toHaveLength(3);
        // Both marks use mark-to-base anchoring
        expect(result[1].dx).toBe(-497); // sara i dx
        // mai ek also uses mark-to-base (since m2m returns null)
        const tone = result[2];
        // dx = baseAnchor[0] - markAnchor.x - baseAdv = 297 - 150 - 594 = -447
        expect(tone.dx).toBe(-447);
    });

    it('stacks the tone mark on the nikhahit of sara am, not the other way round', () => {
        // ก่ำ with a font that anchors the nikhahit on the base and the tone on the nikhahit
        const fontWithSaraAmStack: FontData = {
            ...mockThaiFont,
            markAnchors: {
                bases: { 6: { 0: [297, 800] } },
                marks: { 42: [0, 150, 500], 59: [0, 150, 500] },
            },
            mark2mark: {
                mark1Anchors: { 59: { 0: [200, 700] } }, // nikhahit carries the mark-to-mark anchor
                mark2Classes: { 42: [0, 150, 500] },     // the tone attaches to it
            },
        };
        const result = shapeThaiText('ก่ำ', fontWithSaraAmStack);
        expect(result.map(g => g.gid)).toEqual([6, 59, 42, 85]);
        const [, nikhahit, tone, saraAa] = result;
        expect(nikhahit.isZeroAdvance).toBe(true);
        expect(tone.isZeroAdvance).toBe(true);
        expect(saraAa.isZeroAdvance).toBe(false);
        // nikhahit → base: dy = 800 - 500 = 300; tone → nikhahit: dy = 300 + (700 - 500) = 500
        expect(nikhahit.dy).toBe(300);
        expect(tone.dy).toBe(500);
        expect(tone.dy).toBeGreaterThan(nikhahit.dy);
    });

    it('should apply GSUB substitution for tall consonant', () => {
        const fontWithGsub: FontData = {
            ...mockThaiFont,
            gsub: { 80: 81 }, // po pla GID 80 → substituted GID 81
            widths: { ...mockThaiFont.widths, 81: 600 },
        };
        // ปิ = po pla (tall) + sara i → base GSUB: 80 → 81
        const result = shapeThaiText('\u0E1B\u0E34', fontWithGsub);
        expect(result[0].gid).toBe(81); // GSUB-substituted base
    });

    it('should apply GSUB to mark on tall consonant', () => {
        const fontWithGsub: FontData = {
            ...mockThaiFont,
            gsub: { 80: 81, 92: 93 }, // both base and mark get GSUB
            widths: { ...mockThaiFont.widths, 81: 600, 93: 0 },
            cmap: { ...mockThaiFont.cmap },
        };
        // ปิ = po pla (tall) + sara i → mark GSUB: 92 → 93
        const result = shapeThaiText('\u0E1B\u0E34', fontWithGsub);
        expect(result[1].gid).toBe(93); // GSUB-substituted mark
    });

    it('should normalize NBSP to space', () => {
        const result = shapeThaiText('\u00A0', mockThaiFont);
        expect(result).toHaveLength(1);
        expect(result[0].gid).toBe(111); // space GID
    });

    it('should handle sara am at start of string', () => {
        // Sara Am without preceding base → creates standalone nikhahit cluster
        const result = shapeThaiText('\u0E33', mockThaiFont);
        expect(result.length).toBeGreaterThanOrEqual(2);
        const gids = result.map(g => g.gid);
        expect(gids).toContain(59); // nikhahit
        expect(gids).toContain(85); // sara aa
    });
});

describe('shapeThaiText on Noto Sans Thai', () => {
    const fd = notoThai as unknown as FontData;
    const gid = (cp: number): number => fd.cmap[cp] ?? 0;

    it('draws น้ำ as no nu, nikhahit, mai tho, sara aa', () => {
        const shaped = shapeThaiText('น้ำ', fd);
        expect(shaped.map(g => g.gid)).toEqual([gid(0x0E19), gid(0x0E4D), gid(0x0E49), gid(0x0E32)]);
        expect(shaped.map(g => g.isZeroAdvance)).toEqual([false, true, true, false]);
    });

    it('sets the tone mark on the nikhahit through the font\'s own mark-to-mark anchor', () => {
        const [, nikhahit, tone] = shapeThaiText('น้ำ', fd);
        // The nikhahit carries a mark-to-mark anchor of the tone's class; the
        // tone's vertical offset is exactly that anchor minus its own anchor.
        const toneClass = fd.mark2mark!.mark2Classes[tone.gid];
        const nikhahitAnchor = fd.mark2mark!.mark1Anchors[nikhahit.gid][toneClass[0]];
        expect(nikhahitAnchor).toBeDefined();
        expect(tone.dy - nikhahit.dy).toBe(nikhahitAnchor[1] - toneClass[2]);
        expect(tone.dy).toBeGreaterThan(nikhahit.dy);
    });

    it('leaves a sara am with no tone mark exactly as before', () => {
        const shaped = shapeThaiText('ทำ', fd); // ทำ
        expect(shaped.map(g => g.gid)).toEqual([gid(0x0E17), gid(0x0E4D), gid(0x0E32)]);
    });
});
