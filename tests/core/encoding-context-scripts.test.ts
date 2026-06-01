/**
 * encoding-context-scripts.test.ts
 * Covers the Sinhala / Tibetan / Khmer / Myanmar dispatch branches in
 * createEncodingContext — both the `textRuns()` path (lines ~431–478) and
 * the `ps()` shapeFn selection (lines ~547–550).
 */
import { describe, it, expect } from 'vitest';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import {
    SINHALA_START, SINHALA_END,
    TIBETAN_START, TIBETAN_END,
    KHMER_START, KHMER_END,
    MYANMAR_START, MYANMAR_END,
} from '../../src/shaping/script-registry.js';

/** Build a FontEntry whose cmap covers the given Unicode block plus ASCII space. */
function makeScriptEntry(lang: string, start: number, end: number): FontEntry {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = start; cp <= Math.min(end, start + 255); cp++) {
        const gid = cp - start + 10;
        cmap[cp] = gid;
        widths[gid] = 600;
    }
    // ASCII space
    cmap[0x20] = 3; widths[3] = 250;
    const fontData: FontData = {
        cmap,
        widths,
        defaultWidth: 500,
        gsub: {},
        metrics: {
            unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700,
            numGlyphs: 512, defaultWidth: 500,
            bbox: [0, -300, 1000, 900], stemV: 80,
        },
        markAnchors: null,
        mark2mark: null,
        fontName: `Noto-${lang}`,
        pdfWidthArray: '',
        ttfBase64: 'AAAAAAAAAA==',
    };
    return { lang, fontRef: `/F${lang}`, fontData };
}

// ── Sinhala ──────────────────────────────────────────────────────────────────

describe('createEncodingContext — Sinhala dispatch', () => {
    const entry = makeScriptEntry('si', SINHALA_START, SINHALA_END);

    it('ps() returns a non-empty PDF string for Sinhala text', () => {
        const enc = createEncodingContext([entry]);
        // U+0D85 = Sinhala letter A (independent vowel)
        const result = enc.ps('\u0D85');
        expect(result.length).toBeGreaterThan(0);
    });

    it('textRuns() produces runs for Sinhala text', () => {
        const enc = createEncodingContext([entry]);
        const runs = enc.textRuns('\u0D9A', 12); // Ka
        expect(runs.length).toBeGreaterThan(0);
        expect(runs[0].text.length).toBeGreaterThan(0);
    });
});

// ── Tibetan ───────────────────────────────────────────────────────────────────

describe('createEncodingContext — Tibetan dispatch', () => {
    const entry = makeScriptEntry('bo', TIBETAN_START, TIBETAN_END);

    it('ps() returns a non-empty PDF string for Tibetan text', () => {
        const enc = createEncodingContext([entry]);
        // U+0F40 = Tibetan letter Ka
        const result = enc.ps('\u0F40');
        expect(result.length).toBeGreaterThan(0);
    });

    it('textRuns() produces runs for Tibetan text', () => {
        const enc = createEncodingContext([entry]);
        const runs = enc.textRuns('\u0F40\u0F56', 12); // Ka Ba
        expect(runs.length).toBeGreaterThan(0);
    });
});

// ── Khmer ─────────────────────────────────────────────────────────────────────

describe('createEncodingContext — Khmer dispatch', () => {
    const entry = makeScriptEntry('km', KHMER_START, KHMER_END);

    it('ps() returns a non-empty PDF string for Khmer text', () => {
        const enc = createEncodingContext([entry]);
        // U+1780 = Khmer letter Ka
        const result = enc.ps('\u1780');
        expect(result.length).toBeGreaterThan(0);
    });

    it('textRuns() produces runs for Khmer text', () => {
        const enc = createEncodingContext([entry]);
        const runs = enc.textRuns('\u1780\u1781', 12); // Ka Kha
        expect(runs.length).toBeGreaterThan(0);
    });
});

// ── Myanmar ───────────────────────────────────────────────────────────────────

describe('createEncodingContext — Myanmar dispatch', () => {
    const entry = makeScriptEntry('my', MYANMAR_START, MYANMAR_END);

    it('ps() returns a non-empty PDF string for Myanmar text', () => {
        const enc = createEncodingContext([entry]);
        // U+1000 = Myanmar letter Ka
        const result = enc.ps('\u1000');
        expect(result.length).toBeGreaterThan(0);
    });

    it('textRuns() produces runs for Myanmar text', () => {
        const enc = createEncodingContext([entry]);
        const runs = enc.textRuns('\u1000\u1001', 12); // Ka Kha
        expect(runs.length).toBeGreaterThan(0);
    });
});
