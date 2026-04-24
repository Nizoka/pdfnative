/**
 * Document builder samples — DOC_SAMPLES loop + Unicode document generation.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, loadFontData } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { makeMinimalJPEG } from '../helpers/images.js';
import { loadMultiFontEntries } from '../helpers/fonts.js';
import { DOC_SAMPLES } from '../data/doc-samples-data.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── DOC_SAMPLES loop ─────────────────────────────────────────
    for (const doc of DOC_SAMPLES) {
        const bytes = buildDocumentPDFBytes(doc.params, doc.options);
        const filename = `${doc.filename}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'document', filename), `document/${filename}`, bytes);
    }

    // ── Unicode: Japanese ────────────────────────────────────────
    {
        const jaFd = await loadFontData('ja');
        if (jaFd) {
            const params: DocumentParams = {
                title: 'ドキュメントビルダー – 日本語',
                blocks: [
                    { type: 'heading', text: '第1章：はじめに', level: 1 },
                    { type: 'paragraph', text: 'これはpdfnativeのドキュメントビルダーAPIのデモンストレーションです。日本語テキストの見出し、段落、リスト、テーブルの自動レンダリングをサポートしています。' },
                    { type: 'heading', text: '機能一覧', level: 2 },
                    { type: 'list', items: ['多言語サポート（11スクリプト以上）', 'PDF/A-2b準拠（ISO 19005-2）', 'AES-128/256暗号化', 'JPEG/PNG画像埋め込み', 'FlateDecode圧縮'], style: 'bullet' },
                    { type: 'heading', text: 'サンプルテーブル', level: 2 },
                    { type: 'table', headers: ['番号', '機能', 'フェーズ', 'ステータス'], rows: [
                        { cells: ['1', 'コアPDF生成', '1', '完了'], type: 'credit', pointed: false },
                        { cells: ['2', 'フォント埋め込み', '2', '完了'], type: 'credit', pointed: false },
                        { cells: ['3', 'タグ付きPDF/A', '3', '完了'], type: 'credit', pointed: true },
                        { cells: ['4', '暗号化', '9', '完了'], type: 'credit', pointed: true },
                        { cells: ['5', '圧縮', '11', '完了'], type: 'credit', pointed: true },
                    ] },
                    { type: 'paragraph', text: '上記のテーブルはpdfnativeの開発フェーズを示しています。すべての機能はISO 32000-1に準拠しています。' },
                ],
                footerText: 'pdfnative – 日本語ドキュメントサンプル',
                fontEntries: [{ fontData: jaFd, fontRef: '/F3', lang: 'ja' }],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-japanese.pdf'), 'document/doc-japanese.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── Unicode: Arabic RTL ──────────────────────────────────────
    {
        const arFd = await loadFontData('ar');
        if (arFd) {
            const params: DocumentParams = {
                title: 'منشئ المستندات – العربية',
                blocks: [
                    { type: 'heading', text: 'الفصل الأول: مقدمة', level: 1 },
                    { type: 'paragraph', text: 'هذا المستند يوضح قدرات منشئ المستندات في pdfnative للنصوص العربية من اليمين إلى اليسار. يدعم المحرك تشكيل الحروف العربية تلقائياً بما في ذلك الأشكال المعزولة والابتدائية والوسطى والنهائية.' },
                    { type: 'heading', text: 'الميزات الرئيسية', level: 2 },
                    { type: 'list', items: ['دعم ثنائي الاتجاه (BiDi) وفق معيار UAX #9', 'تشكيل الحروف العربية (GSUB) مع ربطات لام-ألف', 'ترميز CIDFont Type2 مع Identity-H', 'توافق مع PDF/A-2b (ISO 19005-2)', 'تشفير AES-128 و AES-256'], style: 'bullet' },
                    { type: 'heading', text: 'جدول الميزات', level: 2 },
                    { type: 'table', headers: ['الرقم', 'الميزة', 'المرحلة', 'الحالة'], rows: [
                        { cells: ['١', 'توليد PDF الأساسي', '١', 'مكتمل'], type: 'credit', pointed: false },
                        { cells: ['٢', 'تضمين الخطوط', '٢', 'مكتمل'], type: 'credit', pointed: false },
                        { cells: ['٣', 'دعم العربية', '٧', 'مكتمل'], type: 'credit', pointed: true },
                        { cells: ['٤', 'التشفير', '٩', 'مكتمل'], type: 'credit', pointed: true },
                    ] },
                    { type: 'paragraph', text: 'يوضح الجدول أعلاه مراحل تطوير pdfnative. جميع الميزات متوافقة مع معيار ISO 32000-1.' },
                ],
                footerText: 'pdfnative – نموذج مستند عربي',
                fontEntries: [{ fontData: arFd, fontRef: '/F3', lang: 'ar' }],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-arabic.pdf'), 'document/doc-arabic.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── Unicode: Hebrew RTL ──────────────────────────────────────
    {
        const heFd = await loadFontData('he');
        if (heFd) {
            const params: DocumentParams = {
                title: 'בונה מסמכים – עברית',
                blocks: [
                    { type: 'heading', text: 'פרק ראשון: מבוא', level: 1 },
                    { type: 'paragraph', text: 'מסמך זה מדגים את יכולות בונה המסמכים של pdfnative עבור טקסט עברי מימין לשמאל. המנוע תומך בזיהוי כיוון דו-כיווני אוטומטי לפי תקן UAX #9 ובצורות סופיות של אותיות כגון: כ/ך, מ/ם, נ/ן, פ/ף, צ/ץ.' },
                    { type: 'heading', text: 'תכונות עיקריות', level: 2 },
                    { type: 'list', items: ['תמיכה בכיוון דו-כיווני (BiDi)', 'צורות סופיות אוטומטיות – Sofit', 'קידוד CIDFont Type2 עם Identity-H', 'תאימות PDF/A-2b (ISO 19005-2)', 'הצפנת AES-128 ו-AES-256'], style: 'bullet' },
                    { type: 'heading', text: 'טבלת תכונות', level: 2 },
                    { type: 'table', headers: ['מספר', 'תכונה', 'שלב', 'מצב'], rows: [
                        { cells: ['1', 'יצירת PDF בסיסי', '1', 'הושלם'], type: 'credit', pointed: false },
                        { cells: ['2', 'הטמעת גופנים', '2', 'הושלם'], type: 'credit', pointed: false },
                        { cells: ['3', 'תמיכה בעברית', '7', 'הושלם'], type: 'credit', pointed: true },
                        { cells: ['4', 'הצפנה', '9', 'הושלם'], type: 'credit', pointed: true },
                    ] },
                    { type: 'paragraph', text: 'הטבלה לעיל מציגה את שלבי הפיתוח של pdfnative. כל התכונות תואמות לתקן ISO 32000-1.' },
                ],
                footerText: 'pdfnative – דוגמת מסמך בעברית',
                fontEntries: [{ fontData: heFd, fontRef: '/F3', lang: 'he' }],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-hebrew.pdf'), 'document/doc-hebrew.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── Unicode: Multi-language (all 16 scripts) ─────────────────
    {
        const fontEntries = await loadMultiFontEntries();
        if (fontEntries.length === 16) {
            const params: DocumentParams = {
                title: 'Multi-Language Document \u2013 16 Scripts',
                blocks: [
                    { type: 'heading', text: 'pdfnative \u2013 16 Scripts, One Engine', level: 1 },
                    { type: 'paragraph', text: 'This document renders every script supported by pdfnative in a single PDF. Each section contains a native heading, a sample paragraph, and uses automatic font switching via script-aware Unicode block detection. All content is produced from a single DocumentParams object with a shared fontEntries array.' },

                    { type: 'heading', text: 'Supported Scripts', level: 2 },
                    { type: 'table', headers: ['Script', 'Code', 'Direction', 'Shaping'], rows: [
                        { cells: ['Latin (Helvetica)', '\u2013', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Thai', 'th', 'LTR', 'GSUB + GPOS'], type: 'credit', pointed: false },
                        { cells: ['Japanese', 'ja', 'LTR', 'CIDFont'], type: 'credit', pointed: false },
                        { cells: ['Chinese (SC)', 'zh', 'LTR', 'CIDFont'], type: 'credit', pointed: false },
                        { cells: ['Korean', 'ko', 'LTR', 'CIDFont'], type: 'credit', pointed: false },
                        { cells: ['Greek', 'el', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Hindi (Devanagari)', 'hi', 'LTR', 'GSUB + GPOS'], type: 'credit', pointed: true },
                        { cells: ['Turkish', 'tr', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Vietnamese', 'vi', 'LTR', 'Combining marks'], type: 'credit', pointed: false },
                        { cells: ['Polish', 'pl', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Arabic', 'ar', 'RTL', 'GSUB positional'], type: 'credit', pointed: true },
                        { cells: ['Hebrew', 'he', 'RTL', 'BiDi'], type: 'credit', pointed: true },
                        { cells: ['Cyrillic (Russian)', 'ru', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Georgian', 'ka', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Armenian', 'hy', 'LTR', 'None'], type: 'credit', pointed: false },
                        { cells: ['Bengali', 'bn', 'LTR', 'GSUB + GPOS'], type: 'credit', pointed: true },
                        { cells: ['Tamil', 'ta', 'LTR', 'GSUB + GPOS'], type: 'credit', pointed: true },
                    ] },

                    // Latin
                    { type: 'heading', text: 'English (Latin)', level: 2 },
                    { type: 'paragraph', text: 'The quick brown fox jumps over the lazy dog. pdfnative renders Latin text using the Helvetica built-in font with full Windows-1252 encoding.' },

                    // Greek
                    { type: 'heading', text: '\u0395\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC \u2013 Greek', level: 2 },
                    { type: 'paragraph', text: '\u0397 pdfnative \u03C0\u03B1\u03C1\u03AC\u03B3\u03B5\u03B9 \u03AD\u03B3\u03B3\u03C1\u03B1\u03C6\u03B1 PDF \u03C3\u03C4\u03B1 \u03B5\u03BB\u03BB\u03B7\u03BD\u03B9\u03BA\u03AC \u03BC\u03B5 \u03C0\u03BB\u03AE\u03C1\u03B7 \u03C5\u03C0\u03BF\u03C3\u03C4\u03AE\u03C1\u03B9\u03BE\u03B7 Unicode.' },

                    // Cyrillic
                    { type: 'heading', text: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439 \u2013 Russian (Cyrillic)', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u0433\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0435\u0442 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u044B PDF \u043D\u0430 \u0440\u0443\u0441\u0441\u043A\u043E\u043C \u044F\u0437\u044B\u043A\u0435 \u0441 \u043F\u043E\u043B\u043D\u043E\u0439 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u043E\u0439 \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u044B.' },

                    // Turkish
                    { type: 'heading', text: 'T\u00FCrk\u00E7e \u2013 Turkish', level: 2 },
                    { type: 'paragraph', text: 'pdfnative, T\u00FCrk\u00E7e karakterleri (\u0130stanbul, I\u011Fd\u0131r, g\u00F6zl\u00FCk) tam destekler. Noktal\u0131/noktas\u0131z I/\u0131 ayr\u0131m\u0131 korunur.' },

                    // Vietnamese
                    { type: 'heading', text: 'Ti\u1EBFng Vi\u1EC7t \u2013 Vietnamese', level: 2 },
                    { type: 'paragraph', text: 'pdfnative h\u1ED7 tr\u1EE3 \u0111\u1EA7y \u0111\u1EE7 ti\u1EBFng Vi\u1EC7t v\u1EDBi d\u1EA5u thanh v\u00E0 c\u00E1c k\u00FD t\u1EF1 k\u1EBFt h\u1EE3p Unicode.' },

                    // Polish
                    { type: 'heading', text: 'Polski \u2013 Polish', level: 2 },
                    { type: 'paragraph', text: 'pdfnative generuje dokumenty PDF w j\u0119zyku polskim z pe\u0142n\u0105 obs\u0142ug\u0105 znak\u00F3w diakrytycznych (\u0105, \u0107, \u0119, \u0142, \u0144, \u00F3, \u015B, \u017A, \u017C).' },

                    // Georgian
                    { type: 'heading', text: '\u10E5\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8 \u2013 Georgian', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u10E5\u10DB\u10DC\u10D8\u10E1 PDF \u10D3\u10DD\u10D9\u10E3\u10DB\u10D4\u10DC\u10E2\u10D4\u10D1\u10E1 \u10E5\u10D0\u10E0\u10D7\u10E3\u10DA \u10D4\u10DC\u10D0\u10D6\u10D4 (\u10DB\u10EE\u10D4\u10D3\u10E0\u10E3\u10DA\u10D8).' },

                    // Armenian
                    { type: 'heading', text: '\u0540\u0561\u0575\u0565\u0580\u0565\u0576 \u2013 Armenian', level: 2 },
                    { type: 'paragraph', text: 'pdfnative-\u0568 \u057D\u057F\u0565\u0572\u056E\u0578\u0582\u0574 \u0567 PDF \u0583\u0561\u057D\u057F\u0561\u0569\u0572\u0569\u0565\u0580 \u0570\u0561\u0575\u0565\u0580\u0565\u0576 \u056C\u0565\u0566\u057E\u0578\u057E:' },

                    { type: 'pageBreak' },

                    // Thai
                    { type: 'heading', text: '\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22 \u2013 Thai', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u0E2A\u0E23\u0E49\u0E32\u0E07\u0E40\u0E2D\u0E01\u0E2A\u0E32\u0E23 PDF \u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E01\u0E32\u0E23\u0E08\u0E31\u0E14\u0E27\u0E32\u0E07\u0E2A\u0E23\u0E30\u0E41\u0E25\u0E30\u0E27\u0E23\u0E23\u0E13\u0E22\u0E38\u0E01\u0E15\u0E4C\u0E17\u0E35\u0E48\u0E16\u0E39\u0E01\u0E15\u0E49\u0E2D\u0E07 (GSUB + GPOS).' },

                    // Hindi (Devanagari)
                    { type: 'heading', text: '\u0939\u093F\u0928\u094D\u0926\u0940 \u2013 Hindi (Devanagari)', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u0939\u093F\u0928\u094D\u0926\u0940 \u092E\u0947\u0902 PDF \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u095B \u092C\u0928\u093E\u0924\u093E \u0939\u0948 \u091C\u093F\u0938\u092E\u0947\u0902 \u0938\u0902\u092F\u0941\u0915\u094D\u0924\u093E\u0915\u094D\u0937\u0930, \u0930\u0947\u092B, \u0914\u0930 \u092E\u093E\u0924\u094D\u0930\u093E\u0913\u0902 \u0915\u093E \u092A\u0942\u0930\u094D\u0923 \u0938\u092E\u0930\u094D\u0925\u0928 \u0939\u0948.' },

                    // Bengali
                    { type: 'heading', text: '\u09AC\u09BE\u0982\u09B2\u09BE \u2013 Bengali', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u09AC\u09BE\u0982\u09B2\u09BE\u09AD\u09BE\u09B7\u09BE\u09AF\u09BC PDF \u09A8\u09A5\u09BF\u09AA\u09A4\u09CD\u09B0 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7 \u09AF\u09C1\u0995\u09CD\u09A4\u09BE\u0995\u09CD\u09B7\u09B0, \u09B0\u09C7\u09AB \u098F\u09AC\u0982 \u09AE\u09BE\u09A4\u09CD\u09B0\u09BE\u09B0 \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u09B8\u09AE\u09B0\u09CD\u09A5\u09A8 \u09B8\u09B9.' },

                    // Tamil
                    { type: 'heading', text: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u2013 Tamil', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u0BA4\u0BAE\u0BBF\u0BB4\u0BCD PDF \u0B86\u0BB5\u0BA3\u0B99\u0BCD\u0B95\u0BB3\u0BC8 \u0B89\u0BB0\u0BC1\u0BB5\u0BBE\u0B95\u0BCD\u0B95\u0BC1\u0B95\u0BBF\u0BB1\u0BA4\u0BC1, \u0B87\u0BA3\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD \u0BAE\u0BB1\u0BCD\u0BB1\u0BC1\u0BAE\u0BCD \u0BAA\u0BBF\u0BB0\u0BBF\u0BA8\u0BCD\u0BA4 \u0B89\u0BAF\u0BBF\u0BB0\u0BCD\u0B95\u0BB3\u0BC1\u0B9F\u0BA9\u0BCD \u0BAE\u0BC1\u0BB4\u0BC1 \u0B86\u0BA4\u0BB0\u0BB5\u0BC1.' },

                    // Japanese
                    { type: 'heading', text: '\u65E5\u672C\u8A9E \u2013 Japanese', level: 2 },
                    { type: 'paragraph', text: 'pdfnative\u306F\u65E5\u672C\u8A9E\u306EPDF\u6587\u66F8\u3092\u751F\u6210\u3057\u307E\u3059\u3002\u6F22\u5B57\u3001\u3072\u3089\u304C\u306A\u3001\u30AB\u30BF\u30AB\u30CA\u3092CIDFont Type2\u3068Identity-H\u30A8\u30F3\u30B3\u30FC\u30C7\u30A3\u30F3\u30B0\u3067\u5B8C\u5168\u306B\u30B5\u30DD\u30FC\u30C8\u3057\u307E\u3059\u3002' },

                    // Chinese
                    { type: 'heading', text: '\u4E2D\u6587 \u2013 Chinese (Simplified)', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u652F\u6301\u751F\u6210\u4E2D\u6587\u7B80\u4F53 PDF \u6587\u6863\uFF0C\u4F7F\u7528 CIDFont Type2 \u7F16\u7801\u548C Identity-H \u6620\u5C04\u5B9E\u73B0\u7CBE\u786E\u7684\u5B57\u5F62\u5B9A\u4F4D\u548C\u81EA\u52A8\u6362\u884C\u3002' },

                    // Korean
                    { type: 'heading', text: '\uD55C\uAD6D\uC5B4 \uB2E8\uC5B4 \u2013 Korean', level: 2 },
                    { type: 'paragraph', text: 'pdfnative\uB294 \uD55C\uAD6D\uC5B4 PDF \uBB38\uC11C\uB97C \uC0DD\uC131\uD569\uB2C8\uB2E4. CIDFont Type2 \uC778\uCF54\uB529\uACFC Identity-H \uB9E4\uD551\uC744 \uD1B5\uD574 \uC644\uBCBD\uD55C \uD55C\uAE00 \uC9C0\uC6D0\uC744 \uC81C\uACF5\uD569\uB2C8\uB2E4.' },

                    // Arabic (RTL)
                    { type: 'heading', text: '\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u2013 Arabic (RTL)', level: 2 },
                    { type: 'paragraph', text: '\u064A\u062F\u0639\u0645 pdfnative \u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0645\u0639 \u062A\u0634\u0643\u064A\u0644 GSUB \u0644\u0644\u0623\u0634\u0643\u0627\u0644 \u0627\u0644\u0645\u0646\u0641\u0631\u062F\u0629 \u0648\u0627\u0644\u0628\u062F\u0626\u064A\u0629 \u0648\u0627\u0644\u0648\u0633\u0637\u0649 \u0648\u0627\u0644\u0646\u0647\u0627\u0626\u064A\u0629\u060C \u0648\u062F\u0645\u062C \u0644\u0627\u0645-\u0623\u0644\u0641.' },

                    // Hebrew (RTL)
                    { type: 'heading', text: '\u05E2\u05D1\u05E8\u05D9\u05EA \u2013 Hebrew (RTL)', level: 2 },
                    { type: 'paragraph', text: 'pdfnative \u05EA\u05D5\u05DE\u05DA \u05DE\u05DC\u05D0 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u05D5\u05D1\u05DB\u05EA\u05D9\u05D1\u05D4 \u05DE\u05D9\u05DE\u05D9\u05DF \u05DC\u05E9\u05DE\u05D0\u05DC \u05E2\u05DD \u05D9\u05D9\u05E9\u05D5\u05DD \u05D0\u05DC\u05D2\u05D5\u05E8\u05D9\u05EA\u05DD BiDi \u05DC\u05E4\u05D9 Unicode UAX #9.' },

                    { type: 'heading', text: 'Conclusion', level: 2 },
                    { type: 'paragraph', text: 'pdfnative handles all 16 scripts with zero external dependencies, full BiDi support, OpenType shaping, and a single shared fontEntries array. This demonstrates the width of the library, not its depth \u2013 script-specific sample PDFs in the same folder show the depth of each implementation.' },
                ],
                footerText: 'pdfnative \u2013 Multi-language document sample (16 scripts)',
                fontEntries,
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-multi-language.pdf'), 'document/doc-multi-language.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── Invoice template ─────────────────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Invoice #INV-2026-0042',
            blocks: [
                { type: 'heading', text: 'INVOICE', level: 1, color: '#1E3A5F' },
                { type: 'heading', text: 'Invoice Details', level: 3 },
                { type: 'paragraph', text: 'Invoice Number: INV-2026-0042' },
                { type: 'paragraph', text: 'Date: March 15, 2026' },
                { type: 'paragraph', text: 'Due Date: April 14, 2026' },
                { type: 'paragraph', text: 'Payment Terms: Net 30' },
                { type: 'spacer', height: 10 },
                { type: 'heading', text: 'Bill To', level: 3 },
                { type: 'paragraph', text: 'Acme Corporation' },
                { type: 'paragraph', text: '123 Business Avenue, Suite 456' },
                { type: 'paragraph', text: 'San Francisco, CA 94102, United States' },
                { type: 'spacer', height: 15 },
                { type: 'heading', text: 'Line Items', level: 2 },
                { type: 'table', headers: ['#', 'Description', 'Qty', 'Unit Price', 'Amount'], columns: [
                    { f: 0.06, a: 'c', mx: 4, mxH: 4 },
                    { f: 0.40, a: 'l', mx: 50, mxH: 50 },
                    { f: 0.08, a: 'c', mx: 6, mxH: 6 },
                    { f: 0.22, a: 'r', mx: 16, mxH: 16 },
                    { f: 0.24, a: 'r', mx: 16, mxH: 16 },
                ], rows: [
                    { cells: ['1', 'PDF Generation License (Annual)', '1', '$2,400.00', '$2,400.00'], type: 'credit', pointed: false },
                    { cells: ['2', 'Priority Support Package', '1', '$600.00', '$600.00'], type: 'credit', pointed: false },
                    { cells: ['3', 'Custom Font Integration', '3', '$150.00', '$450.00'], type: 'credit', pointed: false },
                    { cells: ['4', 'API Rate Limit Upgrade (10K/day)', '1', '$300.00', '$300.00'], type: 'credit', pointed: false },
                    { cells: ['5', 'Training Session (2 hours)', '2', '$200.00', '$400.00'], type: 'credit', pointed: false },
                ] },
                { type: 'spacer', height: 10 },
                { type: 'paragraph', text: 'Subtotal: $4,150.00' },
                { type: 'paragraph', text: 'Tax (8.5%): $352.75' },
                { type: 'heading', text: 'Total Due: $4,502.75', level: 2, color: '#1E3A5F' },
                { type: 'spacer', height: 20 },
                { type: 'heading', text: 'Payment Instructions', level: 3 },
                { type: 'paragraph', text: 'Bank: First National Bank – Account: 9876543210 – Routing: 021000021' },
                { type: 'paragraph', text: 'Please include invoice number INV-2026-0042 in the payment reference.' },
                { type: 'link', text: 'Pay online via secure portal', url: 'https://example.com/pay/INV-2026-0042' },
                { type: 'spacer', height: 20 },
                { type: 'paragraph', text: 'Thank you for your business.', color: '#6B7280' },
            ],
            footerText: 'pdfnative – Invoice template sample',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-invoice.pdf'), 'document/doc-invoice.pdf', buildDocumentPDFBytes(params));
    }

    // ── Multi-page technical report ──────────────────────────────
    await generateReport(ctx);

    // ── Bilingual contract (EN + Arabic) ─────────────────────────
    await generateContract(ctx);

    // ── CJK catalog (Chinese) ────────────────────────────────────
    await generateChineseCatalog(ctx);

    // ── Thai with complex script ─────────────────────────────────
    await generateThaiDoc(ctx);

    // ── Bengali with Indic shaping ───────────────────────────────
    await generateBengaliDoc(ctx);

    // ── Tamil with Indic shaping ─────────────────────────────────
    await generateTamilDoc(ctx);

    // ── Devanagari (Hindi) with Indic shaping ────────────────────
    await generateDevanagariDoc(ctx);

    // ── All block types showcase ─────────────────────────────────
    generateShowcase(ctx);
}

// ── Sub-generators for complex Unicode documents ─────────────────────

async function generateReport(ctx: GenerateContext): Promise<void> {
    const params: DocumentParams = {
        title: 'Q1 2026 Technical Performance Report',
        blocks: [
            { type: 'heading', text: 'Q1 2026 Technical Performance Report', level: 1, color: '#1E3A5F' },
            { type: 'paragraph', text: 'Prepared by: Engineering Division – Date: April 1, 2026 – Classification: Internal' },
            { type: 'heading', text: 'Executive Summary', level: 2 },
            { type: 'paragraph', text: 'This report summarizes the technical performance metrics for Q1 2026 across all production systems. Key highlights include 99.97% uptime achievement, 23% reduction in average response time, and successful migration of 3 legacy services to the new microservice architecture. The engineering team completed 47 planned deployments with zero critical incidents.' },
            { type: 'heading', text: '1. System Availability', level: 2 },
            { type: 'paragraph', text: 'System availability remained above the 99.95% SLA target throughout the quarter.' },
            { type: 'table', headers: ['Region', 'January', 'February', 'March', 'Q1 Average'], rows: [
                { cells: ['US-East', '99.98%', '99.99%', '99.97%', '99.98%'], type: 'credit', pointed: false },
                { cells: ['US-West', '99.96%', '99.98%', '99.99%', '99.98%'], type: 'credit', pointed: false },
                { cells: ['EU-West', '99.95%', '99.97%', '99.98%', '99.97%'], type: 'credit', pointed: false },
                { cells: ['AP-Southeast', '99.93%', '99.96%', '99.98%', '99.96%'], type: 'credit', pointed: true },
                { cells: ['Global Average', '99.96%', '99.98%', '99.98%', '99.97%'], type: 'credit', pointed: true },
            ] },
            { type: 'heading', text: '2. Response Time Analysis', level: 2 },
            { type: 'paragraph', text: 'Average response time decreased from 245ms in Q4 2025 to 189ms in Q1 2026, a 23% improvement.' },
            { type: 'list', items: ['API Gateway: 45ms average (down from 62ms)', 'Authentication Service: 28ms average (down from 41ms)', 'Data Processing Pipeline: 156ms average (down from 230ms)', 'Search Engine: 89ms average (down from 112ms)', 'Report Generation: 340ms average (down from 520ms)'], style: 'bullet' },
            { type: 'heading', text: '3. Deployment Metrics', level: 2 },
            { type: 'table', headers: ['Month', 'Deployments', 'Rollbacks', 'Success Rate', 'Avg Duration'], rows: [
                { cells: ['January', '14', '1', '92.9%', '12 min'], type: 'credit', pointed: false },
                { cells: ['February', '16', '0', '100.0%', '10 min'], type: 'credit', pointed: false },
                { cells: ['March', '17', '0', '100.0%', '9 min'], type: 'credit', pointed: true },
            ] },
            { type: 'pageBreak' },
            { type: 'heading', text: '4. Infrastructure Costs', level: 2 },
            { type: 'paragraph', text: 'Total infrastructure spend for Q1 was $287,450, a 12% reduction from Q4 2025.' },
            { type: 'table', headers: ['Category', 'January', 'February', 'March', 'Q1 Total'], rows: [
                { cells: ['Compute', '$42,300', '$40,800', '$39,200', '$122,300'], type: 'debit', pointed: false },
                { cells: ['Storage', '$18,500', '$19,200', '$19,800', '$57,500'], type: 'debit', pointed: false },
                { cells: ['Database', '$22,100', '$21,600', '$20,950', '$64,650'], type: 'debit', pointed: false },
                { cells: ['Network/CDN', '$8,400', '$8,200', '$8,100', '$24,700'], type: 'debit', pointed: false },
                { cells: ['Monitoring', '$6,100', '$6,100', '$6,100', '$18,300'], type: 'debit', pointed: false },
            ] },
            { type: 'heading', text: '5. Security & Compliance', level: 2 },
            { type: 'list', items: ['Security incidents: 0 (target: 0)', 'Vulnerability patches: 23 (all within SLA)', 'SOC 2 Type II: Passed', 'Penetration test: Completed Feb 2026', 'GDPR requests processed: 142 (avg 3.2 days)'], style: 'numbered' },
            { type: 'heading', text: '6. Team Velocity', level: 2 },
            { type: 'table', headers: ['Team', 'Sprint 1', 'Sprint 2', 'Sprint 3', 'Sprint 4', 'Sprint 5', 'Sprint 6'], rows: [
                { cells: ['Platform', '34', '36', '38', '37', '40', '42'], type: 'credit', pointed: false },
                { cells: ['Frontend', '28', '30', '29', '32', '31', '34'], type: 'credit', pointed: false },
                { cells: ['Data', '22', '24', '25', '26', '28', '27'], type: 'credit', pointed: false },
                { cells: ['DevOps', '18', '20', '19', '22', '21', '23'], type: 'credit', pointed: true },
            ] },
            { type: 'pageBreak' },
            { type: 'heading', text: '7. Q2 2026 Roadmap', level: 2 },
            { type: 'list', items: ['Complete migration of remaining 5 legacy services', 'Implement GraphQL API gateway', 'Deploy multi-region active-active replication', 'Launch automated performance regression testing', 'Achieve ISO 27001 certification', 'Reduce P99 latency to under 800ms', 'Implement cost allocation tagging', 'Hire 4 additional engineers'], style: 'numbered' },
            { type: 'heading', text: '8. Risks & Mitigations', level: 2 },
            { type: 'table', headers: ['Risk', 'Probability', 'Impact', 'Mitigation', 'Owner'], rows: [
                { cells: ['Cloud vendor price increase', 'Medium', 'High', 'Multi-cloud strategy evaluation', 'CTO'], type: 'debit', pointed: false },
                { cells: ['Key personnel departure', 'Low', 'High', 'Knowledge sharing + documentation', 'VP Eng'], type: 'debit', pointed: false },
                { cells: ['Legacy system failure', 'Medium', 'Medium', 'Accelerate migration timeline', 'Platform Lead'], type: 'debit', pointed: true },
                { cells: ['Regulatory change (DORA)', 'Low', 'Medium', 'Compliance gap analysis started', 'Security Lead'], type: 'credit', pointed: false },
            ] },
            { type: 'heading', text: 'Conclusion', level: 2 },
            { type: 'paragraph', text: 'Q1 2026 was a strong quarter. All key metrics improved QoQ, no critical incidents. The team is well-positioned for Q2.' },
        ],
        footerText: 'pdfnative – Q1 2026 Technical Performance Report – Confidential',
        metadata: { author: 'Engineering Division', subject: 'Quarterly Report', keywords: 'performance, infrastructure, security' },
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-report-multipage.pdf'), 'document/doc-report-multipage.pdf', buildDocumentPDFBytes(params));
}

async function generateContract(ctx: GenerateContext): Promise<void> {
    const arFd = await loadFontData('ar');
    if (!arFd) return;
    const params: DocumentParams = {
        title: 'Service Agreement – اتفاقية الخدمة',
        blocks: [
            { type: 'heading', text: 'Service Agreement', level: 1, color: '#1E3A5F' },
            { type: 'heading', text: 'اتفاقية الخدمة', level: 1, color: '#1E3A5F' },
            { type: 'heading', text: 'Article 1: Definitions', level: 2 },
            { type: 'paragraph', text: '"Service Provider" means TechSolutions Inc., a company registered under the laws of the State of California, with its principal place of business at 789 Innovation Drive, San Jose, CA 95112.' },
            { type: 'heading', text: 'المادة الأولى: التعريفات', level: 2 },
            { type: 'paragraph', text: '"مزود الخدمة" يعني شركة تك سوليوشنز المحدودة، وهي شركة مسجلة بموجب قوانين ولاية كاليفورنيا، ومقرها الرئيسي في 789 طريق الابتكار، سان خوسيه، كاليفورنيا 95112.' },
            { type: 'heading', text: 'Article 2: Scope of Services', level: 2 },
            { type: 'list', items: ['PDF document generation API with multi-language support', 'Technical support during business hours (9:00 AM – 6:00 PM PST)', 'Monthly usage reports and performance dashboards', 'Custom font integration and TTF subsetting', 'Encryption (AES-128/256) and PDF/A compliance'], style: 'numbered' },
            { type: 'heading', text: 'المادة الثانية: نطاق الخدمات', level: 2 },
            { type: 'list', items: ['واجهة برمجة تطبيقات لتوليد مستندات PDF مع دعم متعدد اللغات', 'دعم فني خلال ساعات العمل', 'تقارير الاستخدام الشهرية', 'تكامل الخطوط المخصصة', 'التشفير والتوافق مع PDF/A'], style: 'numbered' },
            { type: 'heading', text: 'Article 3: Fees', level: 2 },
            { type: 'table', headers: ['Tier', 'API Calls/Month', 'Monthly Fee', 'Overage Rate'], rows: [
                { cells: ['Basic', 'Up to 10,000', '$99/mo', '$0.015/call'], type: 'credit', pointed: false },
                { cells: ['Professional', 'Up to 100,000', '$499/mo', '$0.008/call'], type: 'credit', pointed: false },
                { cells: ['Enterprise', 'Unlimited', '$1,999/mo', 'Included'], type: 'credit', pointed: true },
            ] },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Article 4: Term & Termination', level: 2 },
            { type: 'paragraph', text: 'This Agreement shall be effective for an initial term of twelve (12) months. Either party may terminate upon sixty (60) days written notice.' },
            { type: 'heading', text: 'المادة الرابعة: المدة والإنهاء', level: 2 },
            { type: 'paragraph', text: 'تكون هذه الاتفاقية سارية لمدة أولية قدرها اثنا عشر (12) شهراً. يجوز لأي طرف إنهاء هذه الاتفاقية بإشعار خطي مدته ستون (60) يوماً.' },
            { type: 'heading', text: 'Signatures', level: 2 },
            { type: 'spacer', height: 10 },
            { type: 'paragraph', text: 'Service Provider: _________________________    Date: _______________' },
            { type: 'paragraph', text: 'Client: _________________________    Date: _______________' },
        ],
        footerText: 'pdfnative – Service Agreement – اتفاقية الخدمة',
        fontEntries: [{ fontData: arFd, fontRef: '/F3', lang: 'ar' }],
        metadata: { author: 'TechSolutions Inc.', subject: 'Service Agreement', keywords: 'contract, bilingual' },
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-contract-bilingual.pdf'), 'document/doc-contract-bilingual.pdf', buildDocumentPDFBytes(params));
}

async function generateChineseCatalog(ctx: GenerateContext): Promise<void> {
    const zhFd = await loadFontData('zh');
    if (!zhFd) return;
    const params: DocumentParams = {
        title: '产品目录 – 2026年春季',
        blocks: [
            { type: 'heading', text: '产品目录 – 2026年春季', level: 1, color: '#B91C1C' },
            { type: 'paragraph', text: '本目录展示了pdfnative库在中文简体环境下的文档生成能力。中日韩（CJK）字符使用CIDFont Type2编码，配合Identity-H映射，实现精确的字形定位和自动换行。' },
            { type: 'heading', text: '第一章：电子产品', level: 2 },
            { type: 'table', headers: ['编号', '产品名称', '规格', '单价', '库存'], rows: [
                { cells: ['E001', '智能手机 Pro Max', '6.7英寸 OLED, 256GB', '¥6,999', '1,200'], type: 'credit', pointed: false },
                { cells: ['E002', '轻薄笔记本电脑', '14英寸, i7, 16GB RAM', '¥8,499', '580'], type: 'credit', pointed: false },
                { cells: ['E003', '无线降噪耳机', '蓝牙5.3, 40小时续航', '¥1,299', '3,400'], type: 'credit', pointed: false },
                { cells: ['E004', '4K智能电视', '65英寸, HDR10+, WiFi6', '¥4,599', '420'], type: 'credit', pointed: false },
                { cells: ['E005', '智能手表运动版', 'GPS, 心率监测, 防水', '¥2,199', '2,100'], type: 'credit', pointed: true },
            ] },
            { type: 'heading', text: '第二章：办公用品', level: 2 },
            { type: 'table', headers: ['编号', '产品名称', '规格', '单价', '库存'], rows: [
                { cells: ['O001', '多功能激光打印机', '自动双面, WiFi, 30页/分', '¥2,899', '340'], type: 'credit', pointed: false },
                { cells: ['O002', '人体工学办公椅', '网布靠背, 可调节扶手', '¥1,599', '520'], type: 'credit', pointed: false },
                { cells: ['O003', '电动升降桌', '120×60cm, 记忆高度', '¥3,299', '180'], type: 'credit', pointed: false },
                { cells: ['O004', '高清网络摄像头', '4K, 自动对焦, 降噪麦克风', '¥699', '1,800'], type: 'credit', pointed: false },
                { cells: ['O005', '机械键盘静音版', '87键, PBT键帽, Type-C', '¥499', '4,200'], type: 'credit', pointed: true },
            ] },
            { type: 'heading', text: '第三章：订购说明', level: 2 },
            { type: 'list', items: ['所有价格均为含税价格（人民币）', '订单满¥500免运费', '支持7天无理由退换货', '企业客户享受批量折扣', '发票类型：增值税普通/专用发票'], style: 'numbered' },
            { type: 'link', text: '访问在线商城', url: 'https://example.com/catalog/2026-spring' },
        ],
        footerText: 'pdfnative – 2026年春季产品目录',
        fontEntries: [{ fontData: zhFd, fontRef: '/F3', lang: 'zh' }],
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-chinese-catalog.pdf'), 'document/doc-chinese-catalog.pdf', buildDocumentPDFBytes(params));
}

async function generateThaiDoc(ctx: GenerateContext): Promise<void> {
    const thFd = await loadFontData('th');
    if (!thFd) return;
    const params: DocumentParams = {
        title: 'คู่มือผู้ใช้ – ระบบจัดการเอกสาร',
        blocks: [
            { type: 'heading', text: 'คู่มือผู้ใช้ – ระบบจัดการเอกสาร', level: 1 },
            { type: 'paragraph', text: 'ยินดีต้อนรับสู่ระบบจัดการเอกสารอัจฉริยะ เอกสารฉบับนี้จะแนะนำขั้นตอนการใช้งานระบบอย่างละเอียด ระบบรองรับการสร้างเอกสาร PDF หลายภาษา รวมถึงภาษาไทยที่มีสระ วรรณยุกต์ และเครื่องหมายเฉพาะ' },
            { type: 'heading', text: 'คุณสมบัติหลัก', level: 2 },
            { type: 'list', items: ['สร้างเอกสาร PDF คุณภาพสูงแบบอัตโนมัติ', 'รองรับภาษาไทยพร้อมการจัดวางตัวอักษรที่ถูกต้อง (GSUB + GPOS)', 'เข้ารหัส AES-128 และ AES-256', 'เป็นไปตามมาตรฐาน PDF/A-2b', 'บีบอัดข้อมูลด้วย FlateDecode'], style: 'bullet' },
            { type: 'heading', text: 'ตารางราคาบริการ', level: 2 },
            { type: 'table', headers: ['แพ็กเกจ', 'จำนวนเอกสาร/เดือน', 'ราคา', 'หมายเหตุ'], rows: [
                { cells: ['เริ่มต้น', '1,000', '฿990', 'เหมาะสำหรับธุรกิจขนาดเล็ก'], type: 'credit', pointed: false },
                { cells: ['มืออาชีพ', '10,000', '฿4,990', 'รวมการสนับสนุนทางเทคนิค'], type: 'credit', pointed: false },
                { cells: ['องค์กร', 'ไม่จำกัด', '฿14,990', 'รวมทุกบริการ + SLA 99.9%'], type: 'credit', pointed: true },
            ] },
            { type: 'link', text: 'ติดต่อฝ่ายสนับสนุน', url: 'https://example.com/support/th' },
        ],
        footerText: 'pdfnative – คู่มือผู้ใช้ระบบจัดการเอกสาร',
        fontEntries: [{ fontData: thFd, fontRef: '/F3', lang: 'th' }],
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-thai.pdf'), 'document/doc-thai.pdf', buildDocumentPDFBytes(params));
}

async function generateBengaliDoc(ctx: GenerateContext): Promise<void> {
    const bnFd = await loadFontData('bn');
    if (!bnFd) return;
    const params: DocumentParams = {
        title: '\u09AC\u09BE\u0982\u09B2\u09BE \u09A8\u09A5\u09BF\u09AA\u09A4\u09CD\u09B0 \u2013 \u09AA\u09CD\u09B0\u09A4\u09BF\u09AC\u09C7\u09A6\u09A8',
        blocks: [
            { type: 'heading', text: '\u09AA\u09CD\u09B0\u09A5\u09AE \u0985\u09A7\u09CD\u09AF\u09BE\u09AF\u09BC: \u09AD\u09C2\u09AE\u09BF\u0995\u09BE', level: 1 },
            { type: 'paragraph', text: '\u098F\u099F\u09BF pdfnative \u09B2\u09BE\u0987\u09AC\u09CD\u09B0\u09C7\u09B0\u09BF\u09B0 \u09AC\u09BE\u0982\u09B2\u09BE \u09A8\u09A5\u09BF\u09AA\u09A4\u09CD\u09B0 \u09A8\u09BF\u09B0\u09CD\u09AE\u09BE\u09A3\u09C7\u09B0 \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09A8\u0964 \u098F\u0987 \u09A8\u09A5\u09BF\u09AA\u09A4\u09CD\u09B0\u09C7 \u09B6\u09BF\u09B0\u09CB\u09A8\u09BE\u09AE, \u0985\u09A8\u09C1\u099A\u09CD\u099B\u09C7\u09A6, \u09A4\u09BE\u09B2\u09BF\u0995\u09BE \u098F\u09AC\u0982 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE \u09B0\u09AF\u09BC\u09C7\u099B\u09C7\u0964' },
            { type: 'heading', text: '\u09AA\u09CD\u09B0\u09A7\u09BE\u09A8 \u09AC\u09C8\u09B6\u09BF\u09B7\u09CD\u099F\u09CD\u09AF', level: 2 },
            { type: 'list', items: [
                '\u09AC\u09BE\u0982\u09B2\u09BE OpenType \u09B6\u09C7\u09AA\u09BF\u0982 (GSUB + GPOS)',
                '\u09B0\u09C7\u09AB \u09AA\u09C1\u09A8\u09B0\u09CD\u09AC\u09BF\u09A8\u09CD\u09AF\u09BE\u09B8 (\u09B0 + \u09CD)',
                '\u09B9\u09B2\u09A8\u09CD\u09A4-\u09AE\u09A7\u09CD\u09AF\u09B8\u09CD\u09A5 \u09AF\u09C1\u0995\u09CD\u09A4\u09BE\u0995\u09CD\u09B7\u09B0',
                '\u09AC\u09BF\u09AD\u0995\u09CD\u09A4 \u09B8\u09CD\u09AC\u09B0\u09AC\u09B0\u09CD\u09A3 (\u09CB, \u09CC)',
                'PDF/A-2b \u09B8\u09AE\u09B0\u09CD\u09A5\u09A8',
            ], style: 'bullet' },
            { type: 'heading', text: '\u09AE\u09C2\u09B2\u09CD\u09AF \u09A4\u09BE\u09B2\u09BF\u0995\u09BE', level: 2 },
            { type: 'table', headers: ['\u0995\u09CD\u09B0\u09AE', '\u09AA\u09B0\u09BF\u09B7\u09C7\u09AC\u09BE', '\u09AE\u09C2\u09B2\u09CD\u09AF', '\u0985\u09AC\u09B8\u09CD\u09A5\u09BE'], rows: [
                { cells: ['\u09E7', '\u09AC\u09C7\u09B8\u09BF\u0995 PDF', '\u09E7,\u09E6\u09E6\u09E6 \u099F\u09BE\u0995\u09BE', '\u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8'], type: 'credit', pointed: false },
                { cells: ['\u09E8', '\u09AC\u09BE\u0982\u09B2\u09BE \u09B6\u09C7\u09AA\u09BF\u0982', '\u09E8,\u09E6\u09E6\u09E6 \u099F\u09BE\u0995\u09BE', '\u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8'], type: 'credit', pointed: false },
                { cells: ['\u09E9', '\u098F\u09A8\u0995\u09CD\u09B0\u09BF\u09AA\u09B6\u09A8', '\u09E9,\u09E6\u09E6\u09E6 \u099F\u09BE\u0995\u09BE', '\u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8'], type: 'credit', pointed: true },
            ] },
            { type: 'paragraph', text: '\u0989\u09AA\u09B0\u09C7\u09B0 \u09A4\u09BE\u09B2\u09BF\u0995\u09BE\u099F\u09BF pdfnative-\u098F\u09B0 \u09AA\u09B0\u09BF\u09B7\u09C7\u09AC\u09BE\u09B0 \u09AE\u09C2\u09B2\u09CD\u09AF \u09A6\u09C7\u0996\u09BE\u099A\u09CD\u099B\u09C7\u0964' },
        ],
        footerText: 'pdfnative \u2013 \u09AC\u09BE\u0982\u09B2\u09BE \u09A8\u09A5\u09BF\u09AA\u09A4\u09CD\u09B0 \u09A8\u09AE\u09C1\u09A8\u09BE',
        fontEntries: [{ fontData: bnFd, fontRef: '/F3', lang: 'bn' }],
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-bengali.pdf'), 'document/doc-bengali.pdf', buildDocumentPDFBytes(params));
}

async function generateTamilDoc(ctx: GenerateContext): Promise<void> {
    const taFd = await loadFontData('ta');
    if (!taFd) return;
    const params: DocumentParams = {
        title: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0B86\u0BB5\u0BA3\u0BAE\u0BCD \u2013 \u0BAE\u0BC1\u0BA9\u0BCD\u0BAE\u0BBE\u0BA4\u0BBF\u0BB0\u0BBF',
        blocks: [
            { type: 'heading', text: '\u0B85\u0BA4\u0BCD\u0BA4\u0BBF\u0BAF\u0BBE\u0BAF\u0BAE\u0BCD \u0B92\u0BA9\u0BCD\u0BB1\u0BC1: \u0BAE\u0BC1\u0BA9\u0BCD\u0BA9\u0BC1\u0BB0\u0BC8', level: 1 },
            { type: 'paragraph', text: '\u0B87\u0BA4\u0BC1 pdfnative \u0BA8\u0BC2\u0BB2\u0B95\u0BA4\u0BCD\u0BA4\u0BBF\u0BA9\u0BCD \u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0B86\u0BB5\u0BA3\u0BAE\u0BCD \u0B89\u0BB0\u0BC1\u0BB5\u0BBE\u0B95\u0BCD\u0B95\u0BA4\u0BCD\u0BA4\u0BBF\u0BA9\u0BCD \u0BAE\u0BC1\u0BA9\u0BCD\u0BAE\u0BBE\u0BA4\u0BBF\u0BB0\u0BBF\u0BAF\u0BBE\u0B95\u0BC1\u0BAE\u0BCD. \u0B87\u0BA8\u0BCD\u0BA4 \u0B86\u0BB5\u0BA3\u0BA4\u0BCD\u0BA4\u0BBF\u0BB2\u0BCD \u0BA4\u0BB2\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1\u0B95\u0BB3\u0BCD, \u0BAA\u0BA4\u0BCD\u0BA4\u0BBF\u0B95\u0BB3\u0BCD, \u0BAA\u0B9F\u0BCD\u0B9F\u0BBF\u0BAF\u0BB2\u0BCD\u0B95\u0BB3\u0BCD \u0BAE\u0BB1\u0BCD\u0BB1\u0BC1\u0BAE\u0BCD \u0B85\u0B9F\u0BCD\u0B9F\u0BB5\u0BA3\u0BC8 \u0B89\u0BB3\u0BCD\u0BB3\u0BA9.' },
            { type: 'heading', text: '\u0BAE\u0BC1\u0B95\u0BCD\u0B95\u0BBF\u0BAF \u0B85\u0BAE\u0BCD\u0B9A\u0B99\u0BCD\u0B95\u0BB3\u0BCD', level: 2 },
            { type: 'list', items: [
                '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD OpenType \u0BB5\u0B9F\u0BBF\u0BB5\u0BAE\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1 (GSUB + GPOS)',
                '\u0BAE\u0BC1\u0BA9\u0BCD-\u0B85\u0B9F\u0BBF\u0BAA\u0BCD\u0BAA\u0B9F\u0BC8 \u0BAE\u0BBE\u0BA4\u0BCD\u0BA4\u0BBF\u0BB0\u0BC8 \u0BAE\u0BB1\u0BC1\u0B9A\u0BC0\u0BB0\u0BAE\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1',
                '\u0BAA\u0BBF\u0BB0\u0BBF\u0BA8\u0BCD\u0BA4 \u0B89\u0BAF\u0BBF\u0BB0\u0BCD\u0B95\u0BB3\u0BCD (\u0BCA, \u0BCB, \u0BCC)',
                '\u0BAA\u0BC1\u0BB3\u0BCD\u0BB3\u0BBF-\u0BAE\u0BC1\u0B9F\u0BBF\u0BAA\u0BCD\u0BAA\u0BC1 \u0B87\u0BA3\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1',
                'PDF/A-2b \u0B86\u0BA4\u0BB0\u0BB5\u0BC1',
            ], style: 'bullet' },
            { type: 'heading', text: '\u0BB5\u0BBF\u0BB2\u0BC8 \u0BAA\u0B9F\u0BCD\u0B9F\u0BBF\u0BAF\u0BB2\u0BCD', level: 2 },
            { type: 'table', headers: ['\u0B8E\u0BA3\u0BCD', '\u0B9A\u0BC7\u0BB5\u0BC8', '\u0BB5\u0BBF\u0BB2\u0BC8', '\u0BA8\u0BBF\u0BB2\u0BC8'], rows: [
                { cells: ['\u0BE7', '\u0B85\u0B9F\u0BBF\u0BAA\u0BCD\u0BAA\u0B9F\u0BC8 PDF', '\u0BE7,\u0BE6\u0BE6\u0BE6 \u0BB0\u0BC2', '\u0BAE\u0BC1\u0B9F\u0BBF\u0BA8\u0BCD\u0BA4\u0BA4\u0BC1'], type: 'credit', pointed: false },
                { cells: ['\u0BE8', '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0BB5\u0B9F\u0BBF\u0BB5\u0BAE\u0BC8\u0BAA\u0BCD\u0BAA\u0BC1', '\u0BE8,\u0BE6\u0BE6\u0BE6 \u0BB0\u0BC2', '\u0BAE\u0BC1\u0B9F\u0BBF\u0BA8\u0BCD\u0BA4\u0BA4\u0BC1'], type: 'credit', pointed: false },
                { cells: ['\u0BE9', '\u0BAE\u0BB1\u0BC1\u0B95\u0BC1\u0BB1\u0BBF\u0BAF\u0BBE\u0B95\u0BCD\u0B95\u0BAE\u0BCD', '\u0BE9,\u0BE6\u0BE6\u0BE6 \u0BB0\u0BC2', '\u0BAE\u0BC1\u0B9F\u0BBF\u0BA8\u0BCD\u0BA4\u0BA4\u0BC1'], type: 'credit', pointed: true },
            ] },
            { type: 'paragraph', text: '\u0BAE\u0BC7\u0BB2\u0BC7 \u0B89\u0BB3\u0BCD\u0BB3 \u0B85\u0B9F\u0BCD\u0B9F\u0BB5\u0BA3\u0BC8 pdfnative-\u0BA9\u0BCD \u0B9A\u0BC7\u0BB5\u0BC8 \u0BB5\u0BBF\u0BB2\u0BC8\u0B95\u0BB3\u0BC8\u0B95\u0BCD \u0B95\u0BBE\u0B9F\u0BCD\u0B9F\u0BC1\u0B95\u0BBF\u0BB1\u0BA4\u0BC1.' },
        ],
        footerText: 'pdfnative \u2013 \u0BA4\u0BAE\u0BBF\u0BB4\u0BCD \u0B86\u0BB5\u0BA3 \u0BAE\u0BBE\u0BA4\u0BBF\u0BB0\u0BBF',
        fontEntries: [{ fontData: taFd, fontRef: '/F3', lang: 'ta' }],
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-tamil.pdf'), 'document/doc-tamil.pdf', buildDocumentPDFBytes(params));
}

async function generateDevanagariDoc(ctx: GenerateContext): Promise<void> {
    const hiFd = await loadFontData('hi');
    if (!hiFd) return;
    const params: DocumentParams = {
        title: '\u0939\u093F\u0928\u094D\u0926\u0940 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u095B \u2013 \u092A\u094D\u0930\u0926\u0930\u094D\u0936\u0928',
        blocks: [
            { type: 'heading', text: '\u0905\u0927\u094D\u092F\u093E\u092F \u0967: \u092A\u0930\u093F\u091A\u092F', level: 1 },
            { type: 'paragraph', text: '\u092F\u0939 pdfnative \u092A\u0941\u0938\u094D\u0924\u0915\u093E\u0932\u092F \u0915\u0947 \u0926\u094D\u0935\u093E\u0930\u093E \u0939\u093F\u0928\u094D\u0926\u0940 (\u0926\u0947\u0935\u0928\u093E\u0917\u0930\u0940) \u092E\u0947\u0902 PDF \u0928\u093F\u0930\u094D\u092E\u093E\u0923 \u0915\u093E \u0928\u092E\u0942\u0928\u093E \u0939\u0948\u0964 \u0907\u0938 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u095B \u092E\u0947\u0902 \u0936\u0940\u0930\u094D\u0937\u0915, \u0905\u0928\u0941\u091A\u094D\u091B\u0947\u0926, \u0938\u0942\u091A\u0940 \u0914\u0930 \u0924\u093E\u0932\u093F\u0915\u093E \u0936\u093E\u092E\u093F\u0932 \u0939\u0948\u0902\u0964' },
            { type: 'heading', text: '\u092E\u0941\u0916\u094D\u092F \u0935\u093F\u0936\u0947\u0937\u0924\u093E\u090F\u0901', level: 2 },
            { type: 'list', items: [
                '\u0926\u0947\u0935\u0928\u093E\u0917\u0930\u0940 OpenType \u0936\u0947\u092A\u093F\u0902\u0917 (GSUB + GPOS)',
                '\u0938\u0902\u092F\u0941\u0915\u094D\u0924\u093E\u0915\u094D\u0937\u0930 \u092C\u0928\u093E\u0928\u093E (\u0915\u094D\u0937, \u091C\u094D\u091E, \u0924\u094D\u0930)',
                '\u0930\u0947\u092B \u092A\u0941\u0928\u0930\u094D\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E (\u0930\u094D\u0915)',
                '\u092E\u093E\u0924\u094D\u0930\u093E \u092A\u0941\u0928\u0930\u094D\u0935\u094D\u092F\u0935\u0938\u094D\u0925\u093E (\u093F, \u0947, \u0948)',
                '\u0935\u093F\u092D\u0915\u094D\u0924 \u0938\u094D\u0935\u0930 (\u094B, \u094C)',
                'PDF/A-2b \u0938\u092E\u0930\u094D\u0925\u0928',
            ], style: 'bullet' },
            { type: 'heading', text: '\u092E\u0942\u0932\u094D\u092F \u0924\u093E\u0932\u093F\u0915\u093E', level: 2 },
            { type: 'table', headers: ['\u0915\u094D\u0930\u092E', '\u0938\u0947\u0935\u093E', '\u092E\u0942\u0932\u094D\u092F', '\u0938\u094D\u0925\u093F\u0924\u093F'], rows: [
                { cells: ['\u0967', '\u092C\u0941\u0928\u093F\u092F\u093E\u0926\u0940 PDF', '\u0967,\u0966\u0966\u0966 \u0930\u0941\u092A\u092F\u0947', '\u092A\u0942\u0930\u094D\u0923'], type: 'credit', pointed: false },
                { cells: ['\u0968', '\u0939\u093F\u0928\u094D\u0926\u0940 \u0936\u0947\u092A\u093F\u0902\u0917', '\u0968,\u0966\u0966\u0966 \u0930\u0941\u092A\u092F\u0947', '\u092A\u0942\u0930\u094D\u0923'], type: 'credit', pointed: false },
                { cells: ['\u0969', '\u090F\u0928\u0915\u094D\u0930\u093F\u092A\u0936\u0928', '\u0969,\u0966\u0966\u0966 \u0930\u0941\u092A\u092F\u0947', '\u092A\u0942\u0930\u094D\u0923'], type: 'credit', pointed: true },
            ] },
            { type: 'paragraph', text: '\u0909\u092A\u0930\u094B\u0915\u094D\u0924 \u0924\u093E\u0932\u093F\u0915\u093E pdfnative \u0915\u0940 \u0938\u0947\u0935\u093E\u0913\u0902 \u0915\u093E \u092E\u0942\u0932\u094D\u092F \u0926\u093F\u0916\u093E\u0924\u0940 \u0939\u0948\u0964' },
        ],
        footerText: 'pdfnative \u2013 \u0939\u093F\u0928\u094D\u0926\u0940 \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u095B \u0928\u092E\u0942\u0928\u093E',
        fontEntries: [{ fontData: hiFd, fontRef: '/F3', lang: 'hi' }],
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-devanagari.pdf'), 'document/doc-devanagari.pdf', buildDocumentPDFBytes(params));
}

function generateShowcase(ctx: GenerateContext): void {
    const params: DocumentParams = {
        title: 'Document Builder – Complete Showcase',
        blocks: [
            { type: 'heading', text: 'Complete Block Type Showcase', level: 1 },
            { type: 'paragraph', text: 'This document demonstrates every block type supported by the pdfnative Document Builder API in a single PDF.' },
            { type: 'heading', text: 'Headings', level: 2 },
            { type: 'heading', text: 'Level 1 Heading', level: 1 },
            { type: 'heading', text: 'Level 2 Heading', level: 2 },
            { type: 'heading', text: 'Level 3 Heading', level: 3 },
            { type: 'heading', text: 'Paragraphs', level: 2 },
            { type: 'paragraph', text: 'Standard paragraph with automatic text wrapping.' },
            { type: 'paragraph', text: 'Colored paragraph with custom formatting.', color: '#2563EB' },
            { type: 'heading', text: 'Bullet List', level: 2 },
            { type: 'list', items: ['Zero external dependencies', '16 Unicode scripts', 'PDF/A-1b, PDF/A-2b, PDF/A-2u', 'AES-128/256 encryption', 'FlateDecode compression'], style: 'bullet' },
            { type: 'heading', text: 'Numbered List', level: 2 },
            { type: 'list', items: ['Install: npm install pdfnative', 'Import the builder function', 'Define parameters', 'Generate bytes', 'Write to file'], style: 'numbered' },
            { type: 'heading', text: 'Embedded Table', level: 2 },
            { type: 'table', headers: ['Language', 'Script', 'Font', 'Shaping'], rows: [
                { cells: ['Thai', 'Thai', 'Noto Sans Thai', 'GSUB + GPOS'], type: 'credit', pointed: false },
                { cells: ['Japanese', 'CJK + Kana', 'Noto Sans JP', 'CIDFont'], type: 'credit', pointed: false },
                { cells: ['Arabic', 'Arabic', 'Noto Sans Arabic', 'GSUB + BiDi'], type: 'credit', pointed: true },
                { cells: ['Hebrew', 'Hebrew', 'Noto Sans Hebrew', 'BiDi RTL'], type: 'credit', pointed: false },
            ] },
            { type: 'heading', text: 'Spacer (50pt)', level: 2 },
            { type: 'spacer', height: 50 },
            { type: 'paragraph', text: 'After a 50-point vertical spacer.' },
            { type: 'heading', text: 'Image Embedding', level: 2 },
            { type: 'image', data: makeMinimalJPEG(), width: 60, height: 60, align: 'center' as const, alt: 'Minimal test JPEG' },
            { type: 'heading', text: 'Link Annotations', level: 2 },
            { type: 'link', text: 'pdfnative on GitHub', url: 'https://github.com/Nizoka/pdfnative' },
            { type: 'link', text: 'ISO 32000-1:2008', url: 'https://www.iso.org/standard/51502.html' },
            { type: 'pageBreak' },
            { type: 'heading', text: 'Page Break', level: 1 },
            { type: 'paragraph', text: 'Content on a new page after a forced page break.' },
            { type: 'heading', text: 'Summary', level: 2 },
            { type: 'paragraph', text: 'All 8 block types demonstrated: heading, paragraph, list, table, spacer, image, link, and pageBreak.' },
        ],
        footerText: 'pdfnative – Complete block type showcase',
    };
        ctx.writeSafe(resolve(ctx.outputDir, 'document', 'doc-showcase-all-blocks.pdf'), 'document/doc-showcase-all-blocks.pdf', buildDocumentPDFBytes(params));
}
