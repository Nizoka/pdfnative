/**
 * Colour-emoji showcase — COLR/CPAL colour glyphs (v1.3.0).
 *
 * Demonstrates native colour-emoji rendering: each colour glyph is drawn as a
 * Form XObject built from the COLR layer graph (solid + linear + radial paints
 * via PDF /Shading), with no rasterisation. Opt in by registering the curated
 * Noto Color Emoji data module under lang `'emoji'`.
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

    const params: DocumentParams = {
        title: 'Colour Emoji — Noto Color Emoji (COLR/CPAL, OFL-1.1)',
        blocks: [
            { type: 'heading', level: 1, text: 'pdfnative v1.3.0 — Colour emoji' },
            { type: 'paragraph', text: 'Native COLR/CPAL rendering — each glyph is a vector Form XObject (no bitmaps).' },
            { type: 'paragraph', text: 'Smileys: 😀 😃 😄 😁 😆 🤣 😂 🙂 😉 😊 😍 🤩 😘 😎 🥰 🤗 🤔 😴.' },
            { type: 'paragraph', text: 'Hearts & symbols: ❤️ 🧡 💛 💚 💙 💜 🖤 ⭐ ✨ 🔥 💯 ✅ ❌ ❗ ⚠️.' },
            { type: 'paragraph', text: 'Hands: 👍 👎 👌 👊 ✊ ✋ 👋 🙌 🙏 👏 🤞 🤝 💪.' },
            { type: 'paragraph', text: 'Animals & nature: 🐶 🐱 🐭 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐝 🦋 🌸 🌹 🌻 🍀 🌳.' },
            { type: 'paragraph', text: 'Food: 🍎 🍌 🍇 🍓 🍒 🍑 🍊 🍅 🍕 🍔 🌭 🍿 🍩 🎂 ☕ 🍺 🍷.' },
            { type: 'paragraph', text: 'Activity & travel: ⚽ 🏀 🏈 🎾 🎸 🎵 🎨 🚗 🚀 🚢 ✈️ ⌚ 📱 💻 💡 🎁 🎉.' },
        ],
        footerText: 'pdfnative — colour-emoji showcase (COLR/CPAL → PDF Shading)',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'color-emoji-basic.pdf'), 'emoji/color-emoji-basic.pdf', buildDocumentPDFBytes(params));

    // Mixed Latin + colour emoji in a list (font routing).
    const params2: DocumentParams = {
        title: 'Colour emoji + Latin (font routing)',
        blocks: [
            { type: 'heading', level: 1, text: 'Release checklist' },
            { type: 'list', items: [
                'Typecheck 🧪 green ✅',
                'Tests 1900+ passing 🚀',
                'Colour emoji 🎨 via COLR/CPAL',
                'Zero dependencies 📦',
                'PDF/A conformance ✔️',
            ], style: 'bullet' },
        ],
        footerText: 'pdfnative — colour emoji + Latin, single document',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'color-emoji-mixed.pdf'), 'emoji/color-emoji-mixed.pdf', buildDocumentPDFBytes(params2));
}
