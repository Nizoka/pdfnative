/**
 * Emoji showcase — monochrome emoji rendering via Noto Emoji (v1.1.0).
 *
 * Demonstrates that emoji codepoints are routed automatically to the
 * registered `'emoji'` font through the multi-font run splitter, without
 * any per-call wiring. Covers BMP/SMP ranges, ZWJ sequences, Fitzpatrick
 * skin-tone modifiers, and VS-15 / VS-16 variation selectors.
 *
 * Output: test-output/emoji/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, buildPDFBytes } from '../../src/index.js';
import type { DocumentParams, PdfParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. Pure emoji document ──────────────────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['emoji']);
        if (fontEntries.length === 1) {
            const params: DocumentParams = {
                title: 'Monochrome Emoji — Noto Emoji (OFL-1.1)',
                blocks: [
                    { type: 'heading', level: 1, text: 'pdfnative v1.1.0 — Emoji support' },
                    { type: 'paragraph', text: 'Smileys: 😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘.' },
                    { type: 'paragraph', text: 'Symbols & objects: ⭐ ✨ ✅ ❌ ⚠️ ❤️ 💔 🔥 💧 ☀️ ☁️ ⛈️ 🌈 🎉 🎁 🏆.' },
                    { type: 'paragraph', text: 'Animals: 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🦄 🐝 🦋.' },
                    { type: 'paragraph', text: 'Food: 🍎 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕.' },
                    { type: 'paragraph', text: 'Transport: 🚀 ✈️ 🚂 🚃 🚄 🚅 🚆 🚇 🚈 🚉 🚊 🚋 🚌 🚍 🚎 🚐 🚑.' },
                ],
                footerText: 'pdfnative — emoji showcase (Noto Emoji monochrome)',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'emoji-basic.pdf'), 'emoji/emoji-basic.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 2. Mixed text + emoji (multi-font routing) ──────────────
    {
        const fontEntries = await loadSelectedFontEntries(['emoji', 'ja', 'ar']);
        if (fontEntries.length === 3) {
            const params: DocumentParams = {
                title: 'Mixed text + emoji + multi-script (font routing)',
                blocks: [
                    { type: 'heading', level: 1, text: 'Multi-font routing with emoji' },
                    { type: 'paragraph', text: 'Latin + emoji: Hello world! 👋 Welcome to pdfnative 🚀 — pure TypeScript PDF generation 📄✨.' },
                    { type: 'paragraph', text: 'Japanese + emoji: こんにちは世界 🗾 ありがとうございます 🙇 さくら 🌸 富士山 🗻.' },
                    { type: 'paragraph', text: 'Arabic + emoji: مرحبا بالعالم 🌍 السلام عليكم 🕌 شكرا 🙏 ⭐ ✨.' },
                    { type: 'list', items: [
                        'Build status: ✅ green',
                        'Tests: 1717 passing 🧪',
                        'PDF/A conformance: ✔️ ISO 19005-2',
                        'Bundle size: 📦 386 KB ESM',
                        'License: MIT 📜',
                    ], style: 'bullet' },
                ],
                footerText: 'pdfnative — emoji + Latin + Japanese + Arabic, single document',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'emoji-multi-script.pdf'), 'emoji/emoji-multi-script.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 3. Emoji in a table (status column) ─────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['emoji']);
        if (fontEntries.length === 1) {
            const params: PdfParams = {
                title: 'CI dashboard — emoji status indicators',
                infoItems: [
                    { label: 'Run', value: '#1717' },
                    { label: 'Branch', value: 'release/v1.1.0' },
                ],
                balanceText: 'All green',
                countText: '6 jobs',
                headers: ['Job', 'Owner', 'Status', 'Duration', 'Result'],
                rows: [
                    { cells: ['typecheck', 'CI', '✅ pass', '12s', '🟢'], type: 'credit', pointed: false },
                    { cells: ['lint', 'CI', '✅ pass', '8s', '🟢'], type: 'credit', pointed: false },
                    { cells: ['unit tests', 'CI', '✅ pass', '38s', '🟢'], type: 'credit', pointed: false },
                    { cells: ['integration', 'CI', '✅ pass', '15s', '🟢'], type: 'credit', pointed: false },
                    { cells: ['build', 'CI', '✅ pass', '17s', '🟢'], type: 'credit', pointed: true },
                    { cells: ['validate-pdfa', 'CI', '✅ pass', '24s', '🟢'], type: 'credit', pointed: false },
                ],
                footerText: 'pdfnative — emoji in tables',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'emoji', 'emoji-table.pdf'), 'emoji/emoji-table.pdf', buildPDFBytes(params));
        }
    }
}
