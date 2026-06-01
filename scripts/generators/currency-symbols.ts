/**
 * Currency-symbols showcase (v1.3.0).
 *
 * Verifies the two distinct currency rendering paths:
 *
 *  1. WinAnsi base-14 currencies — €, £, ¥, ¢ render with the built-in
 *     Helvetica metrics and are *text-extractable* thanks to the `/ToUnicode`
 *     CMap (issue #48: the Euro sign maps WinAnsi byte 0x80 → U+20AC).
 *
 *  2. Beyond-WinAnsi currencies — ₹ ₩ ₪ ₫ ₺ ₽ ₿ ฿ ¤ are not in WinAnsi, so they
 *     require an embedded Unicode font (Noto Sans, lang `'latin'`) to render.
 *
 * The multi sample mixes both in a realistic price table.
 *
 * Output: test-output/currency/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, FontEntry, PdfRow } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontData } from '../helpers/fonts.js';

const row = (cells: string[]): PdfRow => ({ cells, type: '', pointed: false });

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. Base-14 currencies (no embedded font needed, still extractable) ──
    const base14: DocumentParams = {
        title: 'Currency symbols — WinAnsi base-14 (extractable)',
        blocks: [
            { type: 'heading', level: 1, text: 'WinAnsi currency symbols' },
            { type: 'paragraph', text: 'These four symbols ship with the built-in Helvetica encoding and render without any embedded font. They remain copy/paste- and search-extractable via the /ToUnicode CMap.' },
            { type: 'table',
              headers: ['Symbol', 'Currency', 'Example'],
              rows: [
                row(['\u20AC', 'Euro', '\u20AC1,299.00']),
                row(['\u00A3', 'Pound sterling', '\u00A3 949.99']),
                row(['\u00A5', 'Yen', '\u00A5 189,000']),
                row(['\u00A2', 'Cent', '\u00A2 75']),
              ],
            },
            { type: 'paragraph', text: 'Issue #48 verification: the Euro sign \u20AC maps WinAnsi byte 0x80 to U+20AC in /ToUnicode, so selecting it in a viewer yields the correct codepoint.' },
        ],
        footerText: 'pdfnative — base-14 currency symbols (\u20AC \u00A3 \u00A5 \u00A2)',
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'currency', 'currency-base14.pdf'), 'currency/currency-base14.pdf', buildDocumentPDFBytes(base14));

    // ── 2 & 3. Beyond-WinAnsi currencies + mixed price table ────────────────
    const latinFont = await loadFontData('latin');
    if (!latinFont) return;
    // The Thai baht (U+0E3F) lives in the Thai Unicode block, so it needs the
    // Thai font — script-aware run splitting routes it there automatically.
    const thaiFont = await loadFontData('th');
    const fontEntries: FontEntry[] = [{ fontData: latinFont, fontRef: '/F3', lang: 'latin' }];
    if (thaiFont) fontEntries.push({ fontData: thaiFont, fontRef: '/F4', lang: 'th' });

    const extended: DocumentParams = {
        title: 'Currency symbols — beyond WinAnsi (embedded Noto Sans)',
        blocks: [
            { type: 'heading', level: 1, text: 'Extended currency symbols' },
            { type: 'paragraph', text: 'These symbols are outside the WinAnsi range and require an embedded Unicode font (Noto Sans, OFL-1.1) to render as glyphs. The Thai baht (U+0E3F) sits in the Thai block, so it is routed to the embedded Thai font via script-aware run splitting.' },
            { type: 'table',
              headers: ['Symbol', 'Currency', 'Example'],
              rows: [
                row(['\u20B9', 'Indian rupee', '\u20B9 84,990']),
                row(['\u20A9', 'Korean won', '\u20A9 1,290,000']),
                row(['\u20AA', 'Israeli new shekel', '\u20AA 3,499']),
                row(['\u20AB', 'Vietnamese dong', '\u20AB 29,990,000']),
                row(['\u20BA', 'Turkish lira', '\u20BA 12,499']),
                row(['\u20BD', 'Russian ruble', '\u20BD 99,900']),
                row(['\u20BF', 'Bitcoin', '\u20BF 0.0125']),
                row(['\u0E3F', 'Thai baht', '\u0E3F 7,500']),
                row(['\u00A4', 'Generic currency', '\u00A4 100']),
              ],
            },
        ],
        footerText: 'pdfnative — extended currency symbols (embedded Noto Sans)',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'currency', 'currency-extended.pdf'), 'currency/currency-extended.pdf', buildDocumentPDFBytes(extended));

    const mixed: DocumentParams = {
        title: 'Multi-currency invoice',
        blocks: [
            { type: 'heading', level: 1, text: 'Multi-currency price list' },
            { type: 'paragraph', text: 'A single document mixing base-14 and embedded-font currencies in one table.' },
            { type: 'table',
              headers: ['Product', 'EUR', 'GBP', 'JPY', 'INR', 'KRW'],
              rows: [
                row(['Starter',      '\u20AC 9',   '\u00A3 8',   '\u00A5 1,400',  '\u20B9 799',    '\u20A9 12,000']),
                row(['Professional', '\u20AC 29',  '\u00A3 25',  '\u00A5 4,500',  '\u20B9 2,499',  '\u20A9 39,000']),
                row(['Enterprise',   '\u20AC 99',  '\u00A3 85',  '\u00A5 15,000', '\u20B9 8,499',  '\u20A9 129,000']),
              ],
            },
            { type: 'paragraph', text: 'Totals: \u20AC 137  \u00A3 118  \u00A5 20,900  \u20B9 11,797  \u20A9 180,000  \u20BF 0.0021' },
        ],
        footerText: 'pdfnative — multi-currency document',
        fontEntries,
    };
    ctx.writeSafe(resolve(ctx.outputDir, 'currency', 'currency-multi.pdf'), 'currency/currency-multi.pdf', buildDocumentPDFBytes(mixed));
}
