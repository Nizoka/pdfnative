/**
 * A right-to-left document: Arabic and Hebrew paragraphs whose base
 * direction is detected from their first strong letter (`direction: 'auto'`,
 * UAX #9 P2–P3), aligned to the right margin, with a Latin product name and
 * figures kept in reading order inside the Arabic sentence. The text comes
 * back through the embedded ToUnicode CMaps.
 *
 * @task Render Arabic and Hebrew paragraphs with detected base direction and right alignment
 * @surface library
 * @since 1.9.0
 * @expect pages === 1
 * @expect pdf contains '/Identity-H'
 * @expect every letter of the Arabic heading extracts
 */
import { buildDocumentPDFBytes, extractText, openPdf } from 'pdfnative';
import type { FontData } from 'pdfnative';
import * as notoArabic from 'pdfnative/fonts/noto-arabic-data.js';
import * as notoHebrew from 'pdfnative/fonts/noto-hebrew-data.js';

export const HEADING = 'الفصل الأول (المقدمة)';

export async function run(): Promise<{ bytes: Uint8Array; pages: number; text: string }> {
    const bytes = buildDocumentPDFBytes(
        {
            title: 'Quarterly report',
            fontEntries: [
                { fontData: notoArabic as unknown as FontData, fontRef: '/F3', lang: 'arabic' },
                { fontData: notoHebrew as unknown as FontData, fontRef: '/F4', lang: 'hebrew' },
            ],
            blocks: [
                { type: 'heading', text: HEADING, level: 1 },
                // Figures and the percent sign keep their reading order inside the right-to-left run (W1–W7).
                { type: 'paragraph', text: 'بلغت الإيرادات 1,250 مليون ريال في عام 2026، أي بزيادة 12% مقارنة بالعام السابق.' },
                // A Latin product name inside an Arabic sentence: a forced right-to-left paragraph.
                { type: 'paragraph', text: 'المنتج pdfnative يعمل بلا تبعيات.', direction: 'rtl' },
                // Hebrew, detected from its first letter; the full stop lands at the line's left end (N1).
                { type: 'paragraph', text: 'שלום עולם. דוח רבעוני לשנת 2026.' },
            ],
            footerText: 'Quarterly report',
        },
        { direction: 'auto', creationDate: new Date('2026-10-23T00:00:00Z') },
    );
    return { bytes, pages: openPdf(bytes).pageCount, text: extractText(bytes).map(p => p.text).join('\n') };
}
