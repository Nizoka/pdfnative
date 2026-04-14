/**
 * BiDi algorithm walkthrough — UAX #9, punctuation affinity, bracket pairing.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const fontEntries = await loadSelectedFontEntries(['ar', 'he']);

    // ── 1. BiDi fundamentals — Arabic & Hebrew ──────────────────
    {
        const params: DocumentParams = {
            title: 'BiDi Algorithm – UAX #9 Walkthrough',
            blocks: [
                { type: 'heading', text: 'Unicode Bidirectional Algorithm (UAX #9)', level: 1 },
                { type: 'paragraph', text: 'PDF text layout for Arabic and Hebrew requires the Unicode Bidirectional Algorithm. pdfnative implements a simplified UAX #9 with paragraph-level detection, weak/neutral type resolution, and run reordering.' },

                { type: 'heading', text: 'Arabic — Right-to-Left Paragraph', level: 2 },
                { type: 'paragraph', text: 'مرحباً بكم في مكتبة pdfnative لإنشاء ملفات PDF' },
                { type: 'paragraph', text: 'Arabic text flows right-to-left. Embedded Latin words ("pdfnative", "PDF") are isolated as LTR runs within the RTL paragraph.' },

                { type: 'heading', text: 'Hebrew — Right-to-Left Paragraph', level: 2 },
                { type: 'paragraph', text: 'שלום עולם! ברוכים הבאים ל-pdfnative — ספריית PDF מודרנית' },
                { type: 'paragraph', text: 'Hebrew shares the same RTL base direction. The algorithm detects the paragraph level from the first strong character.' },

                { type: 'heading', text: 'Mixed LTR + RTL in One Paragraph', level: 2 },
                { type: 'paragraph', text: 'The library مكتبة generates PDF files ملفات with Arabic مع العربية inline.' },
                { type: 'paragraph', text: 'In this LTR paragraph, Arabic segments are reversed to visual order while Latin stays left-to-right.' },

                { type: 'heading', text: 'Punctuation Affinity', level: 2 },
                { type: 'paragraph', text: 'هذه جملة عربية. And this is English. والمزيد بالعربية.' },
                { type: 'paragraph', text: 'Sentence-ending punctuation (. , ; : ! ?) stays with the preceding LTR word when in an RTL paragraph — this is punctuation affinity.' },

                { type: 'heading', text: 'Bracket Pairing', level: 2 },
                { type: 'paragraph', text: 'النتيجة هي (pdfnative library) للاستخدام' },
                { type: 'paragraph', text: 'Matching brackets () [] {} enclosing LTR content are kept together as a single LTR run, preventing visual break-up of parenthesized expressions.' },

                { type: 'heading', text: 'Glyph Mirroring', level: 2 },
                { type: 'paragraph', text: 'RTL runs mirror bracket characters: ( → ), [ → ], « → ». This ensures visual consistency when direction changes.' },
            ],
            fontEntries,
            footerText: 'pdfnative – BiDi Algorithm Walkthrough',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi-algorithm.pdf'), 'bidi-algorithm.pdf', buildDocumentPDFBytes(params));
    }

    // ── 2. Arabic positional shaping + BiDi ─────────────────────
    {
        const params: DocumentParams = {
            title: 'Arabic Positional Shaping + BiDi',
            blocks: [
                { type: 'heading', text: 'Arabic Positional Shaping', level: 1 },
                { type: 'paragraph', text: 'Arabic letters change shape based on their position in a word. GSUB tables provide isolated, initial, medial, and final forms.' },

                { type: 'heading', text: 'Positional Forms', level: 2 },
                { type: 'paragraph', text: 'ب — isolated: ب, initial: بـ, medial: ـبـ, final: ـب' },
                { type: 'paragraph', text: 'ع — isolated: ع, initial: عـ, medial: ـعـ, final: ـع' },
                { type: 'paragraph', text: 'The joining type of each character (right-joining, dual-joining, non-joining) determines which positional form to select.' },

                { type: 'heading', text: 'Lam-Alef Ligatures', level: 2 },
                { type: 'paragraph', text: 'لا لأ لإ لآ' },
                { type: 'paragraph', text: 'Lam + Alef combinations are mandatory ligatures in Arabic typography. GSUB replaces the two-character sequence with a single ligature glyph.' },

                { type: 'heading', text: 'Numbers in Arabic Context', level: 2 },
                { type: 'paragraph', text: 'السعر: 1,234.56 دولار — تاريخ: 2026/04/13' },
                { type: 'paragraph', text: 'Arabic (European) numerals are weak LTR characters. In an RTL paragraph, they form LTR runs that display in left-to-right order.' },

                { type: 'heading', text: 'Full Document Example', level: 2 },
                { type: 'paragraph', text: 'بسم الله الرحمن الرحيم. هذا مستند PDF تم إنشاؤه باستخدام مكتبة pdfnative بدون أي تبعيات خارجية. يدعم النص العربي مع التشكيل الموضعي وخوارزمية BiDi.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Arabic Shaping + BiDi',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi-arabic-shaping.pdf'), 'bidi-arabic-shaping.pdf', buildDocumentPDFBytes(params));
    }
}
