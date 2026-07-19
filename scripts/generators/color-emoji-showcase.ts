/**
 * Colour-emoji showcase — COLR/CPAL colour glyphs (v1.3.0, expanded v1.6.0).
 *
 * Demonstrates native colour-emoji rendering: each colour glyph is drawn as a
 * Form XObject built from the COLR layer graph (solid + linear + radial paints
 * via PDF /Shading), with no rasterisation. Opt in by registering the curated
 * Noto Color Emoji data module under lang `'emoji'`.
 *
 * Every emoji used below is in the curated subset, so all render in colour with
 * zero `.notdef` tofu — tests/fonts/color-emoji-data.test.ts cross-checks this
 * file against the bundled cmap. Non-emoji separators use ASCII (`-`, `->`)
 * rather than typographic dashes/arrows, which the colour-emoji font does not
 * cover.
 *
 * Output: test-output/emoji/color-*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, FontEntry } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontData } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // The colour font is registered under 'emoji-color' but bound to lang
    // 'emoji' on the FontEntry so emoji codepoints route to it automatically.
    const colorFont = await loadFontData('emoji-color');
    const latinFont = await loadFontData('latin');
    if (!colorFont || !latinFont) return;

    const fontEntries: FontEntry[] = [
        { fontData: latinFont, fontRef: '/F3', lang: 'latin' },
        { fontData: colorFont, fontRef: '/F4', lang: 'emoji' },
    ];

    // ── 1. Basic palette (curated subset only) ──────────────────────
    const params: DocumentParams = {
        title: 'Colour Emoji - Noto Color Emoji (COLR/CPAL, OFL-1.1)',
        blocks: [
            { type: 'heading', level: 1, text: 'pdfnative - Colour emoji' },
            { type: 'paragraph', text: 'Native COLR/CPAL rendering - each glyph is a vector Form XObject (no bitmaps). The Form /BBox is computed from the glyph outline so nothing is clipped.' },
            { type: 'paragraph', text: 'Smileys: 😀 😃 😄 😁 😆 🤣 😂 🙂 😉 😊 😍 🤩 😘 😎 🥰 🤗 🤔 😴' },
            { type: 'paragraph', text: 'Hearts & symbols: ❤ 🧡 💛 💚 💙 💜 🖤 ⭐ ✨ 🔥 💯 ✅ ❌ ❗ ❗ ♻' },
            { type: 'paragraph', text: 'Hands: 👍 👎 👌 👊 ✊ ✋ 👋 👐 🙌 🙏 👏 🤘 🤝 🤞 🤟 💪' },
            { type: 'paragraph', text: 'Animals & nature: 🐶 🐱 🐭 🐹 🐰 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐝 🦋 🐌 🐞 🐢 🐍 🐳 🐬 🐟 🍄 🌺 🌷 🌸 🌹 🌻 🍃 🌲 🌳 🌴' },
            { type: 'paragraph', text: 'Food: 🍎 🍌 🍇 🍉 🍓 🍒 🍑 🍊 🍅 🥕 🌽 🍔 🍕 🍟 🌭 🍿 🍦 🍰 🍫 🍪 ☕ 🍺 🍷' },
            { type: 'paragraph', text: 'Activity, travel & objects: ⚽ 🏀 🏈 🎾 🏐 🎸 🎵 🎨 🚗 🚕 🚌 ✈ 🚀 🚢 ⌚ 📱 💡 💡 ✏ 📌 🔒 🔑 🏠 🎁 🎈 🎉 🎶 💰 💵' },
            { type: 'paragraph', text: 'Transport & Map (complete block, v1.6.0): 🚁 🚂 🚆 🚇 🚉 🚊 🚋 🚎 🚑 🚒 🚓 🚙 🚚 🚛 🚜 🚠 🚡 🚤 🚥 🚧 🚨 🚲 🛑 🛴 🛵 🛶 🛸 🛹 🛺' },
        ],
        footerText: 'pdfnative - colour-emoji showcase (COLR/CPAL -> PDF Shading)',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'color-emoji-basic.pdf'), 'emoji/color-emoji-basic.pdf', buildDocumentPDFBytes(params));

    // ── 2. Mixed Latin + colour emoji in a list (font routing) ──────
    const params2: DocumentParams = {
        title: 'Colour emoji + Latin (font routing)',
        blocks: [
            { type: 'heading', level: 1, text: 'Release checklist' },
            { type: 'list', items: [
                'Typecheck green ✅',
                'Tests passing 🚀',
                'Colour emoji 🎨 via COLR/CPAL',
                'Zero dependencies 💯',
                'PDF/A conformance ✅',
            ], style: 'bullet' },
        ],
        footerText: 'pdfnative - colour emoji + Latin, single document',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'color-emoji-mixed.pdf'), 'emoji/color-emoji-mixed.pdf', buildDocumentPDFBytes(params2));

    // ── 3. Real-world document (sprint status report) ───────────────
    // Emoji appear naturally in headings, prose, a bulleted list and a table.
    // Every glyph is in the curated subset, so the document renders with no tofu.
    const params3: DocumentParams = {
        title: 'Sprint 42 - Status Report',
        blocks: [
            { type: 'heading', level: 1, text: '🚀 Sprint 42 - Status Report' },
            { type: 'paragraph', text: 'Team velocity is up and morale is high 😎. We shipped the colour-emoji engine ✅ and closed the last accessibility blockers ♻.' },

            { type: 'heading', level: 2, text: '✅ Done this sprint' },
            { type: 'list', items: [
                'Colour emoji rendering 🎨 - COLR/CPAL -> PDF Shading',
                'Configurable document limits 💡 for very large reports',
                'Currency symbols 💰 verified (€ £ ¥ all extractable)',
                'Docs & guides 💡 refreshed',
            ], style: 'bullet' },

            { type: 'heading', level: 2, text: '❗ Risks & follow-ups' },
            { type: 'paragraph', text: 'Watch the font-subset size budget. Travel ✈ for the offsite may slip the review by a day. Love the progress though ❤.' },

            { type: 'heading', level: 2, text: '💡 Burndown' },
            { type: 'table',
              headers: ['Area', 'Owner', 'Status'],
              rows: [
                { cells: ['Colour emoji 🎨', 'Ana', 'Done ✅'], type: '', pointed: false },
                { cells: ['Large docs 💡', 'Bo', 'Done ✅'], type: '', pointed: false },
                { cells: ['Telugu script ✨', 'Cy', 'In review ✏'], type: '', pointed: false },
                { cells: ['Release notes ⭐', 'Di', 'Done ✅'], type: '', pointed: false },
              ],
            },

            { type: 'paragraph', text: 'Thanks team 🙏 - great work this sprint 🎉.' },
        ],
        footerText: 'pdfnative - real-world colour-emoji document',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'color-emoji-real.pdf'), 'emoji/color-emoji-real.pdf', buildDocumentPDFBytes(params3));
}

