/**
 * pdfnative — Colour-Emoji Collector
 * ====================================
 * De-duplicates the colour-emoji glyphs used across a document's content
 * streams into a shared set of Form XObjects, rendered on first use via the
 * COLR/CPAL engine. Each unique glyph becomes one indirect Form XObject whose
 * `/Shading` and `/ExtGState` resources are inlined (so no extra indirect
 * objects are needed per glyph).
 *
 * Activated only when an `'emoji-color'` font (a {@link FontData} carrying
 * `colorGlyphs`) is registered — otherwise the document builders behave
 * exactly as before (byte-identical output).
 */

import type { ColorEmojiCollector, ColorEmojiForm, FontData } from '../types/pdf-types.js';
import { getDecodedFontBytes } from '../fonts/font-loader.js';
import { parseGlyfFont, extractGlyphContours, type GlyfFont } from '../fonts/glyf-outline.js';
import { renderColorGlyph } from './pdf-color-glyph.js';

/**
 * Create a colour-emoji collector. The returned object renders and caches a
 * Form XObject the first time each `(fontData, gid)` colour glyph is used.
 */
export function createColorEmojiCollector(): ColorEmojiCollector {
    const forms: ColorEmojiForm[] = [];
    // (fontData, gid) → resource name
    const nameByGlyph = new WeakMap<FontData, Map<number, string>>();
    // Parsed glyf font per FontData (lazy).
    const glyfByFont = new WeakMap<FontData, GlyfFont | null>();

    function glyfFor(fontData: FontData): GlyfFont | null {
        let g = glyfByFont.get(fontData);
        if (g === undefined) {
            g = parseGlyfFont(getDecodedFontBytes(fontData));
            glyfByFont.set(fontData, g);
        }
        return g;
    }

    function useGlyph(fontData: FontData, gid: number): string | null {
        const colorGlyph = fontData.colorGlyphs?.[gid];
        if (!colorGlyph) return null;

        let perFont = nameByGlyph.get(fontData);
        if (!perFont) { perFont = new Map(); nameByGlyph.set(fontData, perFont); }
        const cached = perFont.get(gid);
        if (cached) return cached;

        const glyf = glyfFor(fontData);
        if (!glyf) return null; // font has no glyf outlines → fall back

        const rendered = renderColorGlyph(
            colorGlyph,
            (baseGid) => extractGlyphContours(glyf, baseGid),
            fontData.metrics.unitsPerEm,
        );
        if (rendered.content.trim() === '') return null; // nothing drawable

        const name = `CEm${forms.length}`;
        const resParts: string[] = [];
        if (rendered.shadings.length > 0) {
            resParts.push(`/Shading << ${rendered.shadings.map((s) => `/${s.name} ${s.dict}`).join(' ')} >>`);
        }
        if (rendered.extGStates.length > 0) {
            resParts.push(`/ExtGState << ${rendered.extGStates.map((g) => `/${g.name} ${g.dict}`).join(' ')} >>`);
        }
        forms.push({ name, content: rendered.content, resources: resParts.join(' '), bbox: rendered.bbox });
        perFont.set(gid, name);
        return name;
    }

    return { useGlyph, forms };
}
