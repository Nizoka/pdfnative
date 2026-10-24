/**
 * BiDi algorithm walkthrough — UAX #9 (full since v1.9.0): neutrals, bracket pairs, isolates, per-paragraph resolution.
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
                { type: 'paragraph', text: 'PDF text layout for Arabic and Hebrew requires the Unicode Bidirectional Algorithm. Since v1.9.0 pdfnative implements UAX #9 in full: paragraph level detection (P2–P3), explicit embeddings, overrides and isolates (X1–X10), the weak and neutral rules (W1–W7, N0–N2), level assignment (I1–I2) and per-line reordering with glyph mirroring (L1–L4). Every line of the Unicode BidiCharacterTest passes.' },

                { type: 'heading', text: 'Arabic — Right-to-Left Paragraph', level: 2 },
                { type: 'paragraph', text: 'مرحباً بكم في مكتبة pdfnative لإنشاء ملفات PDF' },
                { type: 'paragraph', text: 'Arabic text flows right-to-left. Embedded Latin words ("pdfnative", "PDF") are isolated as LTR runs within the RTL paragraph.' },

                { type: 'heading', text: 'Hebrew — Right-to-Left Paragraph', level: 2 },
                { type: 'paragraph', text: 'שלום עולם! ברוכים הבאים ל-pdfnative — ספריית PDF מודרנית' },
                { type: 'paragraph', text: 'Hebrew shares the same RTL base direction. The algorithm detects the paragraph level from the first strong character.' },

                { type: 'heading', text: 'Mixed LTR + RTL in One Paragraph', level: 2 },
                { type: 'paragraph', text: 'The library مكتبة generates PDF files ملفات with Arabic مع العربية inline.' },
                { type: 'paragraph', text: 'In this LTR paragraph, Arabic segments are reversed to visual order while Latin stays left-to-right.' },

                { type: 'heading', text: 'Neutral Punctuation (N1–N2)', level: 2 },
                { type: 'paragraph', text: 'هذه جملة عربية. And this is English. والمزيد بالعربية.' },
                { type: 'paragraph', text: 'Punctuation between two right-to-left words, or between a right-to-left word and the paragraph edge, follows the paragraph direction (UAX #9 N1–N2): the full stop that ends the Arabic sentence is drawn at its left end. Between a Latin word and an Arabic one it takes the paragraph level, never the Latin word.' },

                { type: 'heading', text: 'Bracket Pairing (N0)', level: 2 },
                { type: 'paragraph', text: 'النتيجة هي (pdfnative library) للاستخدام' },
                { type: 'paragraph', text: 'Paired brackets — the 64 pairs of BidiBrackets.txt — resolve as a pair (UAX #9 N0): both brackets take the direction of the strong text they enclose, so (pdfnative library) keeps its parentheses around the Latin words inside the Arabic sentence, and the brackets are mirrored only when the pair itself is right-to-left.' },

                { type: 'heading', text: 'Glyph Mirroring', level: 2 },
                { type: 'paragraph', text: 'RTL runs mirror bracket characters: ( becomes ), [ becomes ], « becomes ». This ensures visual consistency when direction changes.' },
            ],
            fontEntries,
            footerText: 'pdfnative – BiDi Algorithm Walkthrough',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi', 'bidi-algorithm.pdf'), 'bidi/bidi-algorithm.pdf', buildDocumentPDFBytes(params, { direction: 'auto' }));
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
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi', 'bidi-arabic-shaping.pdf'), 'bidi/bidi-arabic-shaping.pdf', buildDocumentPDFBytes(params));
    }

    // ── 3. Digit ordering + glyph mirroring (v1.7.0) ────────────
    {
        const params: DocumentParams = {
            title: 'BiDi Digits & Mirroring — UAX #9 I1/I2 + L4',
            blocks: [
                { type: 'heading', text: 'Native Digits in RTL Text (UAX #9 I1/I2)', level: 1 },
                { type: 'paragraph', text: 'Digit runs always resolve to an even embedding level, so multi-digit numbers keep their logical order — most significant digit first — in both paragraph directions.' },

                { type: 'heading', text: 'Extended Arabic-Indic (Persian) Digits', level: 2 },
                { type: 'paragraph', text: 'سال ۱۴۰۵ هجری خورشیدی — قیمت: ۱۲۳۴۵ ریال' },
                { type: 'paragraph', text: 'The Persian year ۱۴۰۵ must read 1-4-0-5, never reversed. Extended Arabic-Indic digits (U+06F0–U+06F9) are classified EN and converted to AN by W2 in Arabic-letter context.' },

                { type: 'heading', text: 'Arabic-Indic Digits', level: 2 },
                { type: 'paragraph', text: 'الفاتورة رقم ٤٥٦٧ — المبلغ ١٢٣٫٤٥ دينار' },
                { type: 'paragraph', text: 'Invoice and amount figures in Arabic-Indic digits (U+0660–U+0669) keep logical order inside the RTL sentence.' },

                { type: 'heading', text: 'ASCII Digits Between RTL Words', level: 2 },
                { type: 'paragraph', text: 'מחיר 123 שקל — טלפון 0501234567' },
                { type: 'paragraph', text: 'European digits between Hebrew words behave identically: an even-level island in the RTL flow.' },

                { type: 'heading', text: 'Glyph Mirroring (UAX #9 L4)', level: 1 },
                { type: 'paragraph', text: 'Paired delimiters in odd-level runs are replaced by their Bidi_Mirroring_Glyph so they keep facing their content.' },

                { type: 'heading', text: 'Parentheses Around RTL Content', level: 2 },
                { type: 'paragraph', text: 'این کتابخانه (بدون وابستگی) است' },
                { type: 'paragraph', text: 'הספרייה (ללא תלות) לחלוטין' },

                { type: 'heading', text: 'Brackets and Guillemets', level: 2 },
                { type: 'paragraph', text: 'القائمة [العنصر الأول] والاقتباس «مرحبا» هنا' },
                { type: 'paragraph', text: 'The full BidiMirroring.txt table (428 mappings) covers parentheses, brackets, braces, guillemets, and mathematical delimiters.' },
            ],
            fontEntries,
            footerText: 'pdfnative – BiDi Digits & Mirroring',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi', 'bidi-digits-mirroring.pdf'), 'bidi/bidi-digits-mirroring.pdf', buildDocumentPDFBytes(params));
    }
    // ── 4. UAX #9 conformance (v1.9.0): neutrals, brackets, isolates, direction, justified RTL ──
    {
        const params: DocumentParams = {
            title: 'BiDi — UAX #9 Conformance (v1.9.0)',
            blocks: [
                { type: 'heading', text: 'UAX #9 in full — what changed in 1.9.0', level: 1 },
                { type: 'paragraph', text: 'Every paragraph below is resolved once, as a whole, with direction: \'auto\': its base direction comes from its first strong letter, a right-to-left paragraph is aligned to the right margin, and the lines are reordered after wrapping. The constructions are the ones the pre-1.9.0 resolver got wrong.' },

                { type: 'heading', text: 'Neutral punctuation follows the paragraph (N1–N2)', level: 2 },
                { type: 'paragraph', text: 'هذه جملة عربية. وهذه جملة ثانية، مع فاصلة؛ ونقطتين: وعلامة تعجب! وسؤال؟' },
                { type: 'paragraph', text: 'שלום עולם. זו פסקה בעברית, עם פסיק; ונקודתיים: וסימן קריאה! ושאלה?' },
                { type: 'paragraph', text: 'A left-to-right paragraph quoting Arabic: "مرحبا بالعالم", then English again. The quotation marks stay with the English frame.' },

                { type: 'heading', text: 'Bracket pairs (N0) and mirroring (L4)', level: 2 },
                { type: 'paragraph', text: 'النتيجة هي (pdfnative library) للاستخدام — والقائمة [العنصر الأول] والاقتباس «مرحبا» هنا.' },
                { type: 'paragraph', text: 'שלום (abcא) x — a Latin run with a Hebrew letter inside the parentheses, inside a Hebrew paragraph.' },
                { type: 'paragraph', text: 'Nested: الفصل (الأول [الجزء {الأهم}]) انتهى.' },

                { type: 'heading', text: 'Isolates, marks and overrides (X1–X10)', level: 2 },
                { type: 'paragraph', text: 'User \u2067محمد العربي\u2069 posted 3 comments — the Arabic name is isolated (RLI … PDI), so "posted" keeps its place.' },
                { type: 'paragraph', text: 'المنتج \u2066pdfnative CLI\u2069 يعمل — a Latin name isolated (LRI … PDI) inside Arabic.' },
                { type: 'paragraph', text: 'Trailing mark: العدد 100\u200f.' },
                { type: 'paragraph', text: 'Override: \u202eabc def\u202c — forced right-to-left Latin, read "fed cba".' },

                { type: 'heading', text: 'Numbers and separators (W1–W7)', level: 2 },
                { type: 'paragraph', text: 'السعر 1,234.56 دولار، التاريخ 2026-10-23، النسبة 12% — الهاتف +966 55 123 4567.' },
                { type: 'paragraph', text: 'سال ۱۴۰۵ — قیمت ۱۲٬۳۴۵ ریال — نسبت ٪۱۲' },

                { type: 'heading', text: 'A justified right-to-left paragraph', level: 2 },
                { type: 'paragraph', text: 'تُعدّ المكتبة pdfnative أداة لإنشاء ملفات PDF من دون أي تبعيات في وقت التشغيل. تُوزَّع المسافات الزائدة على فجوات الكلمات بالترتيب البصري، ويبقى السطر الأخير غير ممتلئ من اليسار كما يتوقع القارئ العربي. تحتوي هذه الفقرة على اسم لاتيني واحد وعلى أرقام 2026 كي يُرى أثر القواعد الضعيفة والمحايدة في سطر ممتلئ.', align: 'justify' },
                { type: 'paragraph', text: 'פסקה מיושרת לשני הצדדים: הספרייה pdfnative יוצרת קובצי PDF ללא תלויות בזמן ריצה. המרווחים העודפים מתפזרים בין המילים לפי הסדר החזותי, והשורה האחרונה נותרת לא מלאה משמאל. השורה כוללת מספר 2026 ושם לטיני אחד.', align: 'justify' },

                { type: 'heading', text: 'Forced direction', level: 2 },
                // A trailing full stop of a forced-RTL Latin paragraph lands at
                // the LEFT of its last word (".order"): N2 gives a neutral between
                // a Latin letter and the paragraph edge the paragraph direction
                // (level 1), and L2 places it before the level-2 Latin run.
                // Chrome, ICU and fribidi draw the same — it is the proof, not a bug.
                { type: 'paragraph', text: 'pdfnative 1.9.0 — forced right-to-left paragraph of Latin text: aligned to the right margin, letters in reading order.', direction: 'rtl' },
                { type: 'paragraph', text: 'مرحبا — forced left-to-right paragraph of Arabic text: aligned to the left margin, words still read right to left.', direction: 'ltr' },
            ],
            fontEntries,
            footerText: 'pdfnative – UAX #9 conformance',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'bidi', 'bidi-uax9-conformance.pdf'), 'bidi/bidi-uax9-conformance.pdf', buildDocumentPDFBytes(params, { direction: 'auto' }));
    }
}
