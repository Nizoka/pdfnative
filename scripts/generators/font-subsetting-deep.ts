/**
 * Font subsetting deep-dive — TTF pipeline, GID mapping, CMap, .notdef.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {

    // ── 1. Subsetting pipeline overview (Latin-only — no font embedding needed) ──
    {
        const params: DocumentParams = {
            title: 'Font Subsetting Internals',
            blocks: [
                { type: 'heading', text: 'TTF Font Subsetting Pipeline', level: 1 },
                { type: 'paragraph', text: 'pdfnative embeds only the glyphs actually used in each PDF. This dramatically reduces file size — a full CJK font (15+ MB) subsets to just the needed glyphs (often < 50 KB).' },

                { type: 'heading', text: 'Pipeline Stages', level: 2 },
                { type: 'list', style: 'numbered', items: [
                    'Collect unique codepoints from all text content',
                    'Map codepoints → glyph IDs (GIDs) via the cmap table',
                    'Always preserve GID 0 (.notdef) per PDF/A spec',
                    'Extract required TTF tables: head, hhea, maxp, OS/2, name, cmap, loca, glyf, hmtx, post',
                    'Remap GIDs to sequential order (0, 1, 2, ...)',
                    'Build new cmap subtable for the subset',
                    'Recalculate loca offsets and table checksums',
                    'Emit minimal TTF binary with proper table directory',
                ] },

                { type: 'heading', text: 'GID 0: .notdef', level: 2 },
                { type: 'paragraph', text: 'PDF/A requires GID 0 (.notdef) to be present in every embedded font. The subsetter always includes it, even if no missing glyphs are referenced. This glyph typically renders as an empty rectangle or blank space.' },

                { type: 'heading', text: 'CIDFont Type2 + Identity-H', level: 2 },
                { type: 'paragraph', text: 'Unicode fonts use CIDFont Type2 embedding with Identity-H CMap encoding. Glyph IDs are hex-encoded directly in the content stream: <0041> for GID 65.' },
                { type: 'paragraph', text: 'The /ToUnicode CMap maps GIDs back to Unicode codepoints for text extraction (copy-paste) support.' },
            ],
            footerText: 'pdfnative – Font Subsetting Deep Dive',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'font', 'font-subsetting-overview.pdf'), 'font/font-subsetting-overview.pdf', buildDocumentPDFBytes(params));
    }

    // ── 2. Multi-script subsetting comparison ────────────────────
    {
        const fontEntries = await loadSelectedFontEntries(['th', 'ja', 'ar', 'bn', 'ta', 'te', 'si', 'bo', 'km', 'my', 'am']);
        const params: DocumentParams = {
            title: 'Multi-Script Font Subsetting',
            blocks: [
                { type: 'heading', text: 'Multi-Script Subsetting', level: 1 },
                { type: 'paragraph', text: 'Each script uses a different Noto Sans variant. The subsetter processes each font independently, embedding only the glyphs used by that script.' },

                { type: 'heading', text: 'Latin (Helvetica — WinAnsi)', level: 2 },
                { type: 'paragraph', text: 'The quick brown fox jumps over the lazy dog. ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789' },
                { type: 'paragraph', text: 'Latin text uses the built-in Helvetica with WinAnsi encoding — no font embedding needed. Characters are single-byte encoded: (Hello).' },

                { type: 'heading', text: 'Thai (Noto Sans Thai)', level: 2 },
                { type: 'paragraph', text: 'สวัสดีครับ กรุงเทพมหานคร ประเทศไทย' },

                { type: 'heading', text: 'Japanese (Noto Sans JP)', level: 2 },
                { type: 'paragraph', text: '東京都 日本語テスト こんにちは世界' },

                { type: 'heading', text: 'Arabic (Noto Sans Arabic)', level: 2 },
                { type: 'paragraph', text: 'مرحباً بالعالم — اختبار الخطوط العربية' },

                { type: 'heading', text: 'Bengali (Noto Sans Bengali)', level: 2 },
                { type: 'paragraph', text: 'বাংলা ফন্ট সাবসেটিং পরীক্ষা' },

                { type: 'heading', text: 'Tamil (Noto Sans Tamil)', level: 2 },
                { type: 'paragraph', text: 'தமிழ் எழுத்துரு சோதனை' },

                { type: 'heading', text: 'Telugu (Noto Sans Telugu)', level: 2 },
                { type: 'paragraph', text: 'తెలుగు అక్షరాల సబ్‌సెట్టింగ్ పరీక్ష' },

                { type: 'heading', text: 'Sinhala (Noto Sans Sinhala)', level: 2 },
                { type: 'paragraph', text: '\u0DC3\u0DD2\u0D82\u0DC4\u0DBD \u0DB7\u0DCF\u0DC2\u0DCF\u0DC0\u0DD9\u0DB1\u0DCA PDF \u0DBD\u0DDA\u0D9B\u0DB1 \u0DC3\u0DEF\u0DBA\u0DD2' },

                { type: 'heading', text: 'Tibetan (Noto Serif Tibetan)', level: 2 },
                { type: 'paragraph', text: '\u0F56\u0F7C\u0F51\u0F0B\u0F61\u0F72\u0F42\u0F0B\u0F61\u0F72\u0F0B\u0F42\u0F7C\u0F0B\u0F46' },

                { type: 'heading', text: 'Khmer (Noto Sans Khmer)', level: 2 },
                { type: 'paragraph', text: '\u1794\u1784\u17D2\u1780\u17BE\u178F\u17AF\u1780\u179F\u17B6\u179A\u1787\u17B6\u1797\u17B6\u179F\u17B6\u1781\u17D2\u1798\u17C2\u179A' },

                { type: 'heading', text: 'Myanmar (Noto Sans Myanmar)', level: 2 },
                { type: 'paragraph', text: '\u1019\u103C\u1014\u103A\u1019\u102C\u1018\u102C\u101E\u102C\u1005\u102C\u101B\u103D\u1000\u103A\u1005\u102C' },

                { type: 'heading', text: 'Amharic (Noto Sans Ethiopic)', level: 2 },
                { type: 'paragraph', text: '\u12A0\u121B\u122D\u129B \u1241\u12CB\u1295\u124B \u12E8 PDF \u1230\u1290\u12F6\u127D' },

                { type: 'heading', text: 'CMap Structure', level: 2 },
                { type: 'paragraph', text: 'Each CIDFont includes a /ToUnicode CMap stream that maps GIDs → Unicode. Format: beginbfchar / endbfchar entries for direct mappings, beginbfrange / endbfrange for contiguous ranges.' },
            ],
            fontEntries,
            footerText: 'pdfnative – Multi-Script Subsetting',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'font', 'font-subsetting-multiscript.pdf'), 'font/font-subsetting-multiscript.pdf', buildDocumentPDFBytes(params));
    }
}
