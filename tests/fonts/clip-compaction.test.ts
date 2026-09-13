import { describe, it, expect } from 'vitest';
import { compactClips, pruneClipSet } from '../../scripts/lib/clip-compaction.js';
import { parseGlyfFont } from '../../src/fonts/glyf-outline.js';
import * as colorEmoji from '../../fonts/noto-color-emoji-data.js';
import type { ClipOutline, ColorGlyph, ColorLayer } from '../../src/types/pdf-types.js';

// v1.8.0 — build-time pruning of clip sets, checked against the data that
// actually ships: the embedded subset font and the curated flag glyphs.

const mod = colorEmoji as unknown as { ttfBase64: string; colorGlyphs: Record<number, ColorGlyph> };
const glyf = parseGlyfFont(new Uint8Array(Buffer.from(mod.ttfBase64, 'base64')))!;

const flags = Object.entries(mod.colorGlyphs)
    .filter(([, g]) => g.layers.some(l => l.clip))
    .map(([gid, g]) => ({ gid: Number(gid), glyph: g }));

/** The opaque, unclipped layers of a glyph, as the outlines a mask would list. */
function bodyOf(glyph: ColorGlyph): ClipOutline[] {
    return glyph.layers
        .filter((l: ColorLayer) => !l.clip && l.paint.kind === 'solid' && l.paint.color[3] === 255)
        .map(l => (l.transform ? { glyphId: l.glyphId, transform: l.transform } : { glyphId: l.glyphId }));
}

describe('the shipped module', () => {
    it('carries clipped layers for the curated flags', () => {
        expect(flags.length).toBeGreaterThanOrEqual(50);
    });

    it('is already compacted: pruning again changes nothing', () => {
        for (const { gid, glyph } of flags) {
            expect(compactClips(glyph, glyf), `gid ${gid}`).toEqual(glyph);
        }
    });

    it('keeps every clip small', () => {
        for (const { gid, glyph } of flags) {
            for (const layer of glyph.layers) {
                for (const set of layer.clip ?? []) {
                    expect(set.length, `gid ${gid}`).toBeGreaterThan(0);
                    expect(set.length, `gid ${gid}`).toBeLessThanOrEqual(8);
                }
            }
        }
    });
});

describe('pruneClipSet', () => {
    it('drops outlines contained in a larger one', () => {
        // Brazil's artwork: a field, a diamond inside it, a disc inside that,
        // and stars and lettering inside the disc.
        const brazil = mod.colorGlyphs[1863];
        const body = bodyOf(brazil);
        expect(body.length).toBeGreaterThan(50);
        const pruned = pruneClipSet(body, glyf);
        expect(pruned.length).toBeGreaterThan(0);
        expect(pruned.length).toBeLessThan(body.length / 10);
    });

    it('returns a subset of its input, in the original order', () => {
        const body = bodyOf(mod.colorGlyphs[1863]);
        const pruned = pruneClipSet(body, glyf);
        let cursor = 0;
        for (const kept of pruned) {
            const at = body.indexOf(kept, cursor);
            expect(at).toBeGreaterThanOrEqual(cursor);
            cursor = at + 1;
        }
    });

    it('is idempotent', () => {
        const once = pruneClipSet(bodyOf(mod.colorGlyphs[1863]), glyf);
        expect(pruneClipSet(once, glyf)).toEqual(once);
    });

    it('collapses a duplicated outline to one', () => {
        const [first] = bodyOf(mod.colorGlyphs[1863]);
        expect(pruneClipSet([first, first], glyf)).toEqual([first]);
    });

    it('leaves a single outline alone', () => {
        const [first] = bodyOf(mod.colorGlyphs[1863]);
        expect(pruneClipSet([first], glyf)).toEqual([first]);
    });
});

describe('compactClips', () => {
    it('returns a glyph without clips as the same object', () => {
        const plain: ColorGlyph = { layers: [{ glyphId: 1, paint: { kind: 'solid', color: [0, 0, 0, 255] } }] };
        expect(compactClips(plain, glyf)).toBe(plain);
    });
});
