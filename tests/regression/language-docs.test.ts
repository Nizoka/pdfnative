/**
 * Language conformance documents (v1.8.0): one page per language, every
 * sample drawn with real glyphs.
 *
 * `scripts/data/language-docs-data.ts` is the source; `inspectDocumentLayout`
 * is the one planner the builder uses, so a page count of one here is a
 * page count of one in the sample. Each edge-case sample is also shaped with
 * the language's bundled font and must produce no `.notdef`.
 */

import { describe, it, expect } from 'vitest';
import { inspectDocumentLayout } from '../../src/core/pdf-layout-inspect.js';
import { findShaper } from '../../src/shaping/shaper-registry.js';
import { splitTextByFont } from '../../src/shaping/multi-font.js';
import { toWinAnsi } from '../../src/fonts/encoding.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';
import { LANGUAGE_DOCS } from '../../scripts/data/language-docs-data.js';
import { languageDocParams } from '../../scripts/generators/document-builder.js';
import { registerAllFonts, loadFontData } from '../../scripts/helpers/fonts.js';

registerAllFonts();

async function entryFor(lang: string): Promise<FontEntry> {
    const fd = await loadFontData(lang);
    if (!fd) throw new Error(`no font registered for ${lang}`);
    return { fontData: fd, fontRef: '/F3', lang };
}

/**
 * Glyph ids of `text` as the builder would emit them: a shaped run, or the
 * cmap glyph per code point. A code point the font lacks but WinAnsi has
 * (an en dash in an Arabic title) goes to the base-14 fallback in the
 * builder, so it counts as drawn.
 */
function glyphsOf(text: string, fd: FontData): number[] {
    const shaper = findShaper(text);
    if (shaper) return shaper.shape(text, fd).map(g => g.gid);
    return Array.from(text).map(c => {
        const cp = (c === ' ' || c === ' ') ? 0x20 : (c.codePointAt(0) ?? 0);
        const gid = fd.cmap[cp] ?? 0;
        return gid === 0 && toWinAnsi(c) !== '?' ? -1 : gid;
    });
}

describe('language conformance documents', () => {
    it('name every language once and every file once', () => {
        expect(new Set(LANGUAGE_DOCS.map(d => d.lang)).size).toBe(LANGUAGE_DOCS.length);
        expect(new Set(LANGUAGE_DOCS.map(d => d.filename)).size).toBe(LANGUAGE_DOCS.length);
        for (const d of LANGUAGE_DOCS) expect(d.filename).toMatch(/^doc-[a-z-]+$/);
    });

    it('keep their English labels in ASCII (the native text is the sample column)', () => {
        for (const d of LANGUAGE_DOCS) {
            for (const c of d.edgeCases) {
                expect(c.what, `${d.filename}: ${c.what}`).toMatch(/^[\x20-\x7E–’]+$/);
                // A note may quote the sign it describes, but it is written in English.
                expect(c.note, `${d.filename}: ${c.note}`).toMatch(/[A-Za-z]{3,}/);
            }
        }
    });

    // Loading a CJK module (Noto Sans KR is 14 MB of data) under coverage
    // instrumentation exceeds vitest's 5 s default; the per-test timeout is
    // raised here rather than globally (testing.instructions.md).
    for (const doc of LANGUAGE_DOCS) {
        describe(doc.filename, () => {
            it('fits on one page', async () => {
                const entry = await entryFor(doc.lang);
                const report = inspectDocumentLayout(languageDocParams(doc, [entry]));
                expect(report.pages.length).toBe(1);
            }, 60_000);

            // A glyph the font neither anchors (mark-to-base or mark-to-mark)
            // nor made zero-width is a spacing sign; emitted at zero advance it
            // is drawn under the next glyph and disappears — Noto Sans Lao's
            // pali virama U+0EBA did until v1.8.0. Held for the Thai and Lao
            // shapers, whose marks are all anchored or zero-width by contract.
            // Run over every shaper it also trips on Khmer subjoined, Myanmar
            // medial and Tai Tham medial-ra glyphs, which those shapers emit
            // at zero advance although the font gives them one — an open
            // audit item (ROADMAP), not asserted here.
            it('swallows no spacing sign as a mark', async () => {
                const entry = await entryFor(doc.lang);
                const fd = entry.fontData;
                const texts = [doc.title, doc.intro, ...doc.edgeCases.map(c => c.sample), ...doc.list, doc.footer];
                for (const text of texts) {
                    for (const run of splitTextByFont(text, [entry])) {
                        const shaper = findShaper(run.text);
                        if (!shaper || (shaper.id !== 'thai' && shaper.id !== 'lao')) continue;
                        for (const g of shaper.shape(run.text, fd)) {
                            if (!g.isZeroAdvance) continue;
                            const width = fd.widths[g.gid] ?? fd.defaultWidth;
                            const anchored = fd.markAnchors?.marks[g.gid] !== undefined
                                || fd.mark2mark?.mark2Classes[g.gid] !== undefined;
                            expect(width > 0 && !anchored, `${doc.filename}: "${text}" gid ${g.gid} (width ${width}) is a spacing glyph emitted at zero advance`).toBe(false);
                        }
                    }
                }
            }, 60_000);

            it('draws every sample with real glyphs', async () => {
                const entry = await entryFor(doc.lang);
                const texts = [doc.title, doc.intro, ...doc.edgeCases.map(c => c.sample), ...doc.list, doc.footer];
                for (const text of texts) {
                    // The builder splits a run across the registered fonts; a
                    // single font here, so every code point must resolve in it,
                    // except the ASCII the base-14 fallback would take.
                    for (const run of splitTextByFont(text, [entry])) {
                        const gids = glyphsOf(run.text, entry.fontData);
                        const notdef = gids.filter(g => g === 0).length;
                        expect(notdef, `${doc.filename}: "${text}"`).toBe(0);
                    }
                }
            }, 60_000);
        });
    }
});
