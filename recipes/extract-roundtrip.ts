/**
 * Round-trip check: shaped text — a Devanagari conjunct, Thai with a tone
 * mark over sara am, an Arabic word in its positional forms — written with
 * the bundled fonts and read back with `extractText()`. Since 1.9.0 every
 * shaper reports the code points behind each glyph it emits, the ToUnicode
 * CMap names them, and untagged Thai and Lao sara am carry an /ActualText
 * span, so the letters a reader copies are the letters the author typed.
 *
 * @task Write shaped Devanagari, Thai and Arabic text and read every letter back
 * @surface library
 * @since 1.9.0
 * @expect text of page 0 contains 'क्षमता'
 * @expect text of page 0 contains 'น้ำ'
 * @expect every letter of 'مرحبا' extracts
 */
import { buildDocumentPDFBytes, extractText } from 'pdfnative';
import type { FontData } from 'pdfnative';
import * as notoDevanagari from 'pdfnative/fonts/noto-devanagari-data.js';
import * as notoThai from 'pdfnative/fonts/noto-thai-data.js';
import * as notoArabic from 'pdfnative/fonts/noto-arabic-data.js';

export const SAMPLES = {
    devanagari: 'क्षमता और विश्वास',   // conjunct क्ष, then independent words
    thai: 'น้ำ และ ก่ำ',               // sara am under a tone mark, twice
    arabic: 'مرحبا بالعالم',           // positional forms, no ligature but lam-alef in بالعالم
};

export async function run(): Promise<{ bytes: Uint8Array; text: string }> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Round trip',
            fontEntries: [
                { fontData: notoDevanagari as unknown as FontData, fontRef: '/F3', lang: 'devanagari' },
                { fontData: notoThai as unknown as FontData, fontRef: '/F4', lang: 'thai' },
                { fontData: notoArabic as unknown as FontData, fontRef: '/F5', lang: 'arabic' },
            ],
            blocks: [
                { type: 'paragraph', text: SAMPLES.devanagari },
                { type: 'paragraph', text: SAMPLES.thai },
                { type: 'paragraph', text: SAMPLES.arabic, direction: 'rtl' },
            ],
        },
        { creationDate: new Date('2026-10-23T00:00:00Z') },
    );
    return { bytes, text: extractText(bytes)[0].text };
}
