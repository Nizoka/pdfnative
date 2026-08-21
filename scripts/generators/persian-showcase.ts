/**
 * Persian (Farsi) showcase — joining, digits, mirroring (v1.7.0).
 *
 * Locks down the three v1.7.0 RTL fixes with real Persian content:
 *   1. Extended-Arabic joining — the Persian letters پ چ ژ ک گ ی now shape
 *      through their Presentation Forms-A positional glyphs (and ALEF is
 *      right-joining, so سال no longer collapses to سل).
 *   2. Digit order — Extended Arabic-Indic digits (۰–۹) resolve to even
 *      bidi levels (UAX #9 I1/I2) and keep logical order.
 *   3. Glyph mirroring — paired delimiters mirror in odd-level runs
 *      (UAX #9 L4, full BidiMirroring.txt table).
 *
 * Output: test-output/bidi/persian-showcase.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const fontEntries = await loadSelectedFontEntries(['ar']);

    const params: DocumentParams = {
        title: 'Persian (Farsi) — Joining, Digits & Mirroring',
        blocks: [
            { type: 'heading', text: 'Persian letter joining', level: 1 },
            { type: 'paragraph', text: 'The six Persian-specific letters in joined words - each must connect to its neighbours:' },
            { type: 'paragraph', text: 'پ : پدر — پنجره — توپ' },
            { type: 'paragraph', text: 'چ : چای — چهارشنبه — قارچ' },
            { type: 'paragraph', text: 'ژ : ژاله — مژده — دژ' },
            { type: 'paragraph', text: 'ک : کتاب — شکر — کمک' },
            { type: 'paragraph', text: 'گ : گل — گفتگو — رنگ' },
            { type: 'paragraph', text: 'ی : یار — قیمت — ریال — بازی' },
            { type: 'paragraph', text: 'Alef never joins leftward: سال — کتاب — بازار — السلام' },

            { type: 'heading', text: 'Sentences', level: 2 },
            { type: 'paragraph', text: 'زبان فارسی یکی از زبان‌های هند و اروپایی است.' },
            { type: 'paragraph', text: 'کتابخانه pdfnative بدون وابستگی خارجی است.' },

            { type: 'heading', text: 'Digits & figures (UAX #9 I1/I2)', level: 1 },
            { type: 'paragraph', text: 'سال ۱۴۰۵ هجری خورشیدی' },
            { type: 'paragraph', text: 'تاریخ: ۱۴۰۵/۰۵/۳۰ — ساعت ۱۴:۳۰' },
            { type: 'paragraph', text: 'قیمت: ۱۲۳۴۵ ریال — تخفیف ۲۵٪' },
            { type: 'paragraph', text: 'شماره فاکتور ۴۵۶۷ — کد پستی ۱۹۵۸۶' },
            { type: 'paragraph', text: 'Mixed: invoice IR-2026 totals ۹۸۷۶۵ rials.' },

            { type: 'heading', text: 'Mirrored delimiters (UAX #9 L4)', level: 1 },
            { type: 'paragraph', text: 'Parentheses: این کتابخانه (بدون وابستگی) است' },
            { type: 'paragraph', text: 'Brackets: فهرست [عنصر اول] و [عنصر دوم]' },
            { type: 'paragraph', text: 'Guillemets: نقل قول «سلام دنیا» اینجا' },
            { type: 'paragraph', text: 'Nested: مقدار {الف [ب (ج)]} تو در تو' },
            { type: 'paragraph', text: 'LTR island untouched: متن با (English text) داخل آن' },
        ],
        fontEntries,
        footerText: 'pdfnative – Persian showcase',
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'bidi', 'persian-showcase.pdf'), 'bidi/persian-showcase.pdf', buildDocumentPDFBytes(params));
}
