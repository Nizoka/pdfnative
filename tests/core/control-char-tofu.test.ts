import { describe, it, expect } from 'vitest';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import { CYRILLIC_START } from '../../src/shaping/script-registry.js';

// #58 — raw C0/DEL control characters must be skipped BEFORE the cmap lookup in
// buildTextRunsWithFallback, so they never resolve to the .notdef (glyph 0)
// tofu box. Byte-safe: existing baselines contain no raw control characters.

/** Synthetic Cyrillic font entry (routes to the CIDFont / fallback path). */
function makeCyrillicEntry(): FontEntry {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    for (let cp = CYRILLIC_START; cp <= CYRILLIC_START + 0x5F; cp++) {
        const gid = cp - CYRILLIC_START + 10;
        cmap[cp] = gid;
        widths[gid] = 600;
    }
    cmap[0x20] = 3; widths[3] = 250;
    const fontData: FontData = {
        cmap, widths, defaultWidth: 500, gsub: {},
        metrics: {
            unitsPerEm: 1000, ascent: 900, descent: -300, capHeight: 700,
            numGlyphs: 512, defaultWidth: 500, bbox: [0, -300, 1000, 900], stemV: 80,
        },
        markAnchors: null, mark2mark: null,
        fontName: 'Noto-ru', pdfWidthArray: '', ttfBase64: 'AAAAAAAAAA==',
    };
    return { lang: 'ru', fontRef: '/Fru', fontData };
}

describe('control-character tofu fix (#58)', () => {
    const enc = createEncodingContext([makeCyrillicEntry()]);
    // Cyrillic А (U+0410), Б (U+0411) with interleaved control characters.
    const A = String.fromCharCode(CYRILLIC_START);      // А
    const B = String.fromCharCode(CYRILLIC_START + 1);  // Б

    it('skips C0 control chars so no glyph-0 (0000) tofu is emitted', () => {
        const runs = enc.textRuns(`${A}\x01\x1F${B}`, 12);
        const hex = runs.map(r => r.text).join('');
        // Glyph ids are Identity-H hex; gid 0 would appear as "0000".
        expect(hex).not.toContain('0000');
    });

    it('skips DEL (0x7F) between covered glyphs', () => {
        const runs = enc.textRuns(`${A}\x7F${B}`, 12);
        const hex = runs.map(r => r.text).join('');
        expect(hex).not.toContain('0000');
        expect(hex.length).toBeGreaterThan(0); // A and B still render
    });

    it('leaves ordinary text unchanged (no control chars → identical runs)', () => {
        const clean = enc.textRuns(`${A}${B}`, 12).map(r => r.text).join('');
        const withCtrl = enc.textRuns(`${A}\x08${B}`, 12).map(r => r.text).join('');
        expect(withCtrl).toBe(clean);
    });
});
