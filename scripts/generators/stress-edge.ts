/**
 * Stress tests and edge-case samples — extreme pagination, BiDi, layout, images, annotations.
 */

import { resolve } from 'path';
import { buildPDFBytes, buildDocumentPDFBytes, loadFontData } from '../../src/index.js';
import type { PdfParams, PdfLayoutOptions, DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { makeMinimalJPEG, makeLargeJPEG, makeSyntheticPNG } from '../helpers/images.js';
import { loadFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // Latin font for PDF/A embedding (rule 6.2.11.4.1)
    const latinEntries = await loadFontEntries('latin', '/F3');
    // ── 1. 10,000 rows (~300 pages) ──────────────────────────────
    {
        const rows = Array.from({ length: 10000 }, (_, i) => ({
            cells: [
                `${String((i % 28) + 1).padStart(2, '0')}/${String((i % 12) + 1).padStart(2, '0')}/2026`,
                `TXN-${String(i + 1).padStart(5, '0')} – ${['Wire transfer international', 'Card payment POS terminal', 'Direct debit utility bill', 'Standing order monthly rent', 'Cash deposit ATM'][i % 5]}`,
                ['Income', 'Expense', 'Transfer', 'Fee'][i % 4],
                `${i % 2 === 0 ? '+' : '-'}${((i * 17.31 + 42.5) % 9999).toFixed(2)}`,
                i % 3 === 0 ? 'OK' : '',
            ],
            type: i % 2 === 0 ? 'credit' as const : 'debit' as const,
            pointed: i % 11 === 0,
        }));
        const params: PdfParams = {
            title: 'Stress Test – 10,000 Rows',
            infoItems: [{ label: 'Account', value: 'STRESS-TEST-10K-001' }, { label: 'Period', value: 'Full Year 2026' }, { label: 'Type', value: 'Pagination & memory stress test' }],
            balanceText: 'Balance: € 1,234,567.89',
            countText: '10,000 transactions',
            headers: ['Date', 'Description', 'Category', 'Amount', 'Status'],
            rows,
            footerText: 'pdfnative – 10K row stress test',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'stress-test-10k-rows.pdf'), 'stress/stress-test-10k-rows.pdf', buildPDFBytes(params));
    }

    // ── 2. Extreme BiDi + multi-script wrapping ──────────────────
    {
        const arFd = await loadFontData('ar');
        const heFd = await loadFontData('he');
        const jaFd = await loadFontData('ja');
        if (arFd && heFd && jaFd) {
            const params: DocumentParams = {
                title: 'Extreme BiDi – Multi-Script Wrapping',
                blocks: [
                    { type: 'heading', text: 'Chapter 1: Mixed Script Paragraphs', level: 1 },
                    { type: 'paragraph', text: 'This paragraph mixes English with Arabic \u0645\u0631\u062d\u0628\u0627 and Hebrew \u05e9\u05dc\u05d5\u05dd and Japanese \u3053\u3093\u306b\u3061\u306f in a single flowing sentence. The BiDi algorithm must correctly resolve directional runs while the text wrapping engine breaks lines at appropriate boundaries.' },
                    { type: 'paragraph', text: 'The word for "peace" varies: Arabic \u0633\u0644\u0627\u0645, Hebrew \u05e9\u05dc\u05d5\u05dd, Japanese \u5e73\u548c. All three scripts coexist with automatic font switching via Unicode block detection.' },
                    { type: 'heading', text: 'Chapter 2: RTL-Dominant Mixed Content', level: 1 },
                    { type: 'paragraph', text: '\u0647\u0630\u0627 \u0627\u0644\u0646\u0635 \u064a\u0628\u062f\u0623 \u0628\u0627\u0644\u0639\u0631\u0628\u064a\u0629 then switches to English and back to \u0627\u0644\u0639\u0631\u0628\u064a\u0629 again. We also include \u05e2\u05d1\u05e8\u05d9\u05ea for Hebrew testing, and \u65e5\u672c\u8a9e for Japanese.' },
                    { type: 'heading', text: 'Chapter 3: Dense Multilingual List', level: 2 },
                    { type: 'list', items: [
                        'English: Hello – the universal baseline',
                        'Arabic: \u0645\u0631\u062d\u0628\u0627 \u0628\u0643\u0645 \u0641\u064a pdfnative – GSUB shaping',
                        'Hebrew: \u05d1\u05e8\u05d5\u05db\u05d9\u05dd \u05d4\u05d1\u05d0\u05d9\u05dd \u05dc-pdfnative – BiDi RTL',
                        'Japanese: pdfnative\u3078\u3088\u3046\u3053\u305d – CJK line breaking',
                        'Mixed: Hello \u0645\u0631\u062d\u0628\u0627 \u05e9\u05dc\u05d5\u05dd \u3053\u3093\u306b\u3061\u306f – all four scripts',
                    ], style: 'bullet' },
                    { type: 'heading', text: 'Chapter 4: Technical Verification', level: 2 },
                    { type: 'paragraph', text: 'This sample validates: 1) BiDi paragraph level detection, 2) font fallback, 3) multi-font width measurement, 4) CJK character-level breaking, 5) Arabic GSUB shaping coexisting with Hebrew and Japanese.' },
                ],
                footerText: 'pdfnative – Extreme BiDi multi-script wrapping stress test',
                fontEntries: [
                    { fontData: arFd, fontRef: '/F3', lang: 'ar' },
                    { fontData: heFd, fontRef: '/F4', lang: 'he' },
                    { fontData: jaFd, fontRef: '/F5', lang: 'ja' },
                ],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'doc-extreme-bidi-wrapping.pdf'), 'stress/doc-extreme-bidi-wrapping.pdf', buildDocumentPDFBytes(params));
        }
    }

    // ── 3. Asymmetric table with heavy text ──────────────────────
    {
        const longDesc1 = 'This cell contains an extremely long description that is designed to test truncation with the mx parameter. When longer than mx characters the table engine appends .. to signal overflow.';
        const longDesc2 = 'Another heavy cell: the system must handle heterogeneous content where some rows are compact single-line entries and others hit the mx truncation boundary.';
        const longDesc3 = 'Edge case: an extremely detailed technical specification that might appear in an enterprise report. Features include: high-throughput data processing, distributed caching, real-time analytics, multi-tenant isolation, and audit logging.';
        const rows = Array.from({ length: 30 }, (_, i) => ({
            cells: [`${String(i + 1).padStart(3, '0')}`, `Item-${String.fromCharCode(65 + (i % 26))}-${i + 1}`, i % 3 === 0 ? longDesc1 : i % 3 === 1 ? longDesc2 : (i % 5 === 0 ? longDesc3 : `Standard row ${i + 1} with brief content.`)],
            type: i % 2 === 0 ? 'credit' as const : 'debit' as const,
            pointed: i % 7 === 0,
        }));
        const layout: Partial<PdfLayoutOptions> = {
            columns: [
                { f: 0.08, a: 'c' as const, mx: 5, mxH: 5 },
                { f: 0.15, a: 'l' as const, mx: 15, mxH: 10 },
                { f: 0.77, a: 'l' as const, mx: 80, mxH: 20 },
            ],
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'table-heavy-text-overflow.pdf'), 'stress/table-heavy-text-overflow.pdf', buildPDFBytes({
            title: 'Asymmetric Table – Heavy Text Truncation',
            infoItems: [{ label: 'Report', value: 'LAYOUT-OVERFLOW-001' }, { label: 'Type', value: 'mx truncation stress test' }],
            balanceText: '',
            countText: '30 items with variable-length descriptions',
            headers: ['ID', 'Code', 'Description'],
            rows,
            footerText: 'pdfnative – Asymmetric column layout stress test',
        }, layout));
    }

    // ── 4. Media-rich document (JPEG + PNG) ──────────────────────
    {
        const jpeg = makeMinimalJPEG();
        const png = makeSyntheticPNG();
        const params: DocumentParams = {
            title: 'Media-Rich Document – Images & Layout',
            blocks: [
                { type: 'heading', text: 'Image Embedding Showcase', level: 1 },
                { type: 'paragraph', text: 'JPEG with DCTDecode and PNG with FlateDecode. Images embedded as XObject resources.' },
                { type: 'heading', text: 'JPEG Image (Left-Aligned)', level: 2 },
                { type: 'image', data: jpeg, width: 120, height: 120, align: 'left' as const, alt: 'JPEG test image' },
                { type: 'paragraph', text: 'JPEG above uses DCTDecode. Scaled from 2x2 native pixels to 120pt.' },
                { type: 'heading', text: 'PNG Image (Center-Aligned)', level: 2 },
                { type: 'image', data: png, width: 100, height: 100, align: 'center' as const, alt: 'PNG test image' },
                { type: 'paragraph', text: 'PNG above uses FlateDecode with /Predictor 15.' },
                { type: 'heading', text: 'JPEG Image (Right-Aligned)', level: 2 },
                { type: 'image', data: jpeg, width: 80, height: 80, align: 'right' as const, alt: 'JPEG right-aligned' },
                { type: 'heading', text: 'Multiple Images with Text Flow', level: 2 },
                { type: 'image', data: png, width: 200, height: 50, align: 'center' as const, alt: 'Wide PNG banner' },
                { type: 'image', data: jpeg, width: 40, height: 40, align: 'left' as const, alt: 'Small JPEG icon' },
                { type: 'image', data: png, width: 150, height: 75, align: 'right' as const, alt: 'Medium PNG' },
                { type: 'paragraph', text: 'All images rendered with proper spacing and no overlap.' },
            ],
            footerText: 'pdfnative – Media-rich document stress test',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'media-rich-document.pdf'), 'stress/media-rich-document.pdf', buildDocumentPDFBytes(params));
    }

    // ── 5. Tagged accessibility complex ──────────────────────────
    {
        const params: DocumentParams = {
            title: 'Tagged PDF – Accessibility Complex',
            blocks: [
                { type: 'heading', text: 'Annual Accessibility Report 2026', level: 1 },
                { type: 'paragraph', text: 'This document validates the complete StructTreeRoot hierarchy for PDF/UA compliance. Every block type is tagged with proper structure elements.' },
                { type: 'heading', text: 'Section 1: Executive Summary', level: 2 },
                { type: 'paragraph', text: 'The organization achieved 98.7% WCAG 2.1 AA compliance.' },
                { type: 'heading', text: 'Section 2: Compliance Metrics', level: 2 },
                { type: 'heading', text: '2.1 Web Properties', level: 3 },
                { type: 'table', headers: ['Property', 'Score', 'Level', 'Issues'], rows: [
                    { cells: ['Main Website', '99.2%', 'AAA', '3 minor'], type: 'credit', pointed: false },
                    { cells: ['Customer Portal', '97.8%', 'AA', '12 medium'], type: 'credit', pointed: true },
                    { cells: ['Developer Docs', '98.5%', 'AA', '7 minor'], type: 'credit', pointed: false },
                    { cells: ['Mobile App (iOS)', '96.1%', 'AA', '18 medium'], type: 'debit', pointed: true },
                    { cells: ['Mobile App (Android)', '95.4%', 'AA', '22 medium'], type: 'debit', pointed: true },
                ] },
                { type: 'heading', text: '2.2 Document Standards', level: 3 },
                { type: 'list', items: ['All PDF outputs conform to PDF/UA', 'Tagged structure tree validated to 6 levels', 'ActualText provided on all shaped glyph sequences', 'Reading order matches visual layout', 'Language tags specified for multi-lingual content'], style: 'numbered' },
                { type: 'heading', text: 'Section 3: Remediation Plan', level: 2 },
                { type: 'list', items: ['Improve color contrast ratios', 'Add ARIA live regions', 'Enhance focus indicators', 'Provide text alternatives for SVG icons', 'Implement skip navigation links'], style: 'bullet' },
                { type: 'heading', text: 'Section 4: Image Accessibility', level: 2 },
                { type: 'image', data: makeMinimalJPEG(), width: 80, height: 80, align: 'center' as const, alt: 'Accessibility certification badge – WCAG 2.1 AA' },
                { type: 'heading', text: 'Section 5: External Resources', level: 2 },
                { type: 'link', text: 'WCAG 2.1 Guidelines (W3C)', url: 'https://www.w3.org/TR/WCAG21/' },
                { type: 'link', text: 'PDF/UA Reference (AIIM)', url: 'https://www.pdfa.org/resource/pdfua-in-a-nutshell/' },
                { type: 'link', text: 'ISO 14289-1:2014', url: 'https://www.iso.org/standard/64599.html' },
            ],
            footerText: 'pdfnative – Tagged PDF/UA accessibility stress test',
            layout: { tagged: true },
            fontEntries: latinEntries,
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'tagged-accessibility-complex.pdf'), 'stress/tagged-accessibility-complex.pdf', buildDocumentPDFBytes(params));
    }

    // ── 6. Layout extreme customization ──────────────────────────
    {
        const params: DocumentParams = {
            title: 'Layout Extreme – Custom Margins & Sizes',
            blocks: [
                { type: 'heading', text: 'Testing Extreme Layout Parameters', level: 1 },
                { type: 'paragraph', text: 'Wide left margin, narrow right margin, asymmetric top/bottom margins, large indentation, expanded line heights, varied font sizes.', fontSize: 12, lineHeight: 2.0, indent: 50 },
                { type: 'heading', text: 'Large Font Paragraph', level: 2 },
                { type: 'paragraph', text: 'This paragraph uses fontSize: 16 with lineHeight: 1.8.', fontSize: 16, lineHeight: 1.8 },
                { type: 'heading', text: 'Small Dense Text', level: 2 },
                { type: 'paragraph', text: 'fontSize: 7 with tight lineHeight: 1.1. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.', fontSize: 7, lineHeight: 1.1 },
                { type: 'heading', text: 'Deep Indentation', level: 2 },
                { type: 'paragraph', text: 'Level 0: No indentation.', fontSize: 10 },
                { type: 'paragraph', text: 'Level 1: 30pt indent.', fontSize: 10, indent: 30 },
                { type: 'paragraph', text: 'Level 2: 60pt indent.', fontSize: 10, indent: 60 },
                { type: 'paragraph', text: 'Level 3: 90pt indent.', fontSize: 10, indent: 90 },
                { type: 'heading', text: 'Center-Aligned', level: 2 },
                { type: 'paragraph', text: 'Center-aligned paragraph accounting for asymmetric margins.', align: 'center', fontSize: 10 },
                { type: 'heading', text: 'Table in Constrained Space', level: 2 },
                { type: 'table', headers: ['Parameter', 'Value', 'Unit', 'Notes'], rows: [
                    { cells: ['Page Width', '595.28', 'pt', 'A4 standard'], type: 'credit', pointed: false },
                    { cells: ['Left Margin', '100', 'pt', 'Wide (binding)'], type: 'credit', pointed: true },
                    { cells: ['Right Margin', '30', 'pt', 'Narrow'], type: 'credit', pointed: false },
                    { cells: ['Content Width', '465.28', 'pt', 'Calculated'], type: 'debit', pointed: true },
                ] },
            ],
            footerText: 'pdfnative – Extreme layout customization stress test',
            layout: { margins: { t: 60, r: 30, b: 50, l: 100 } },
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'layout-extreme-customization.pdf'), 'stress/layout-extreme-customization.pdf', buildDocumentPDFBytes(params));
    }

    // ── 7. Custom fontSizes ──────────────────────────────────────
    {
        const params: PdfParams = {
            title: 'Custom Font Sizes Demo',
            infoItems: [{ label: 'Report', value: 'FONTSIZES-001' }, { label: 'Purpose', value: 'Validate fontSizes layout option' }],
            balanceText: '€ 12,345.67',
            countText: '5 transactions',
            headers: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
            rows: [
                { cells: ['2026-01-15', 'Opening balance', '', '€ 10,000.00', '€ 10,000.00'], type: 'credit', pointed: false },
                { cells: ['2026-01-20', 'Office supplies', '€ 234.56', '', '€ 9,765.44'], type: 'debit', pointed: true },
                { cells: ['2026-02-01', 'Client payment', '', '€ 3,500.00', '€ 13,265.44'], type: 'credit', pointed: false },
                { cells: ['2026-02-10', 'Software license', '€ 899.77', '', '€ 12,365.67'], type: 'debit', pointed: true },
                { cells: ['2026-02-15', 'Expense refund', '', '€ 20.00', '€ 12,345.67'], type: 'credit', pointed: false },
            ],
            footerText: 'pdfnative – Custom fontSizes layout option demo',
        };
        const layout: Partial<PdfLayoutOptions> = { fontSizes: { title: 18, info: 9, th: 11, td: 10, ft: 7 } };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'custom-font-sizes.pdf'), 'stress/custom-font-sizes.pdf', buildPDFBytes(params, layout));
    }

    // ══════════════════════════════════════════════════════════════
    // EDGE-CASE STRESS TESTS
    // ══════════════════════════════════════════════════════════════

    // ── 8. Unbreakable text (1000-char word, no spaces) ──────────
    {
        const dnaChars = 'ACGT';
        const longWord = Array.from({ length: 1000 }, (_, i) => dnaChars[i % 4]).join('');
        const longUrl = 'https://example.com/' + Array.from({ length: 500 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');
        const base64Chunk = Array.from({ length: 800 }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[i % 64]).join('');

        const params: DocumentParams = {
            title: 'Unbreakable Text – Stress Test',
            blocks: [
                { type: 'heading', text: 'Line Wrapping Edge Cases', level: 1 },
                { type: 'paragraph', text: 'Paragraphs below contain extremely long words with no whitespace break points.' },
                { type: 'heading', text: '1. DNA Sequence (1000 chars)', level: 2 },
                { type: 'paragraph', text: `Sequence: ${longWord}` },
                { type: 'heading', text: '2. Long URL (520 chars)', level: 2 },
                { type: 'paragraph', text: longUrl },
                { type: 'heading', text: '3. Base64 Blob (800 chars)', level: 2 },
                { type: 'paragraph', text: `data:application/octet-stream;base64,${base64Chunk}` },
                { type: 'heading', text: '4. Mixed: normal + unbreakable', level: 2 },
                { type: 'paragraph', text: `Normal text before ${longWord.slice(0, 500)} and normal text after.` },
            ],
            footerText: 'pdfnative – Unbreakable text stress test',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'doc-unbreakable-text.pdf'), 'stress/doc-unbreakable-text.pdf', buildDocumentPDFBytes(params));
    }

    // ── 9. Micro-column table ────────────────────────────────────
    {
        const rows = Array.from({ length: 20 }, (_, i) => ({
            cells: [`Row ${i + 1}: Very long description for truncation test`, String.fromCharCode(65 + (i % 26)), `${i + 1}`],
            type: i % 2 === 0 ? 'credit' as const : 'debit' as const,
            pointed: i % 5 === 0,
        }));
        const layout: Partial<PdfLayoutOptions> = {
            columns: [
                { f: 0.95, a: 'l' as const, mx: 80, mxH: 20 },
                { f: 0.025, a: 'c' as const, mx: 1, mxH: 1 },
                { f: 0.025, a: 'c' as const, mx: 1, mxH: 1 },
            ],
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'table-micro-columns.pdf'), 'stress/table-micro-columns.pdf', buildPDFBytes({
            title: 'Micro-Column Table – Extreme Fractions',
            infoItems: [{ label: 'Test', value: 'MICRO-COL-001' }],
            balanceText: '',
            countText: '20 rows – columns at 95% / 2.5% / 2.5%',
            headers: ['Description (95%)', 'X', 'N'],
            rows,
            footerText: 'pdfnative – Micro-column table stress test',
        }, layout));
    }

    // ── 10. Link annotation bomb (500 links) ─────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'heading', text: 'Link Annotation Density Test', level: 1 },
            { type: 'paragraph', text: 'This document contains 500 clickable link annotations.' },
        ];
        for (let i = 1; i <= 500; i++) {
            blocks.push({ type: 'link', text: `Link #${String(i).padStart(3, '0')} – https://example.com/page/${i}`, url: `https://example.com/page/${i}`, fontSize: 7 } as DocumentBlock);
        }
        blocks.push({ type: 'paragraph', text: 'All 500 links rendered successfully.' } as DocumentBlock);
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'doc-link-annotation-bomb.pdf'), 'stress/doc-link-annotation-bomb.pdf', buildDocumentPDFBytes({
            title: 'Link Annotation Bomb – 500 Links',
            blocks,
            footerText: 'pdfnative – Annotation density stress test',
        }));
    }

    // ── 11. Zero-content edge cases ──────────────────────────────
    {
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'zero-content-empty-table.pdf'), 'stress/zero-content-empty-table.pdf', buildPDFBytes({
            title: 'Zero Content – Empty Table',
            infoItems: [{ label: 'Test', value: 'EMPTY-TABLE-001' }],
            balanceText: '',
            countText: '0 transactions',
            headers: ['Date', 'Description', 'Amount', 'Status'],
            rows: [],
            footerText: 'pdfnative – Empty table edge case',
        }));

        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'zero-content-empty-doc.pdf'), 'stress/zero-content-empty-doc.pdf', buildDocumentPDFBytes({
            title: 'Zero Content – Empty Document',
            blocks: [],
            footerText: 'pdfnative – Empty document edge case',
        }));

        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'zero-content-empty-strings.pdf'), 'stress/zero-content-empty-strings.pdf', buildDocumentPDFBytes({
            title: 'Zero Content – Empty Strings',
            blocks: [
                { type: 'heading', text: '', level: 1 },
                { type: 'paragraph', text: '' },
                { type: 'paragraph', text: '' },
                { type: 'list', items: ['', '', ''], style: 'bullet' },
                { type: 'table', headers: ['A', 'B', 'C'], rows: [] },
                { type: 'heading', text: '', level: 2 },
                { type: 'paragraph', text: 'This paragraph follows empty blocks above.' },
            ],
            footerText: 'pdfnative – Empty strings edge case',
        }));
    }

    // ── 12. Heavy buffer memory test (5 MB JPEG) ─────────────────
    {
        const heavyJpeg = makeLargeJPEG(5 * 1024 * 1024);
        ctx.writeSafe(resolve(ctx.outputDir, 'stress', 'doc-heavy-buffer-5mb.pdf'), 'stress/doc-heavy-buffer-5mb.pdf', buildDocumentPDFBytes({
            title: 'Heavy Buffer – 5 MB Image Memory Test',
            blocks: [
                { type: 'heading', text: 'Large Image Embedding', level: 1 },
                { type: 'paragraph', text: `Embeds a synthetic ${(heavyJpeg.length / (1024 * 1024)).toFixed(1)} MB JPEG to stress-test buffer handling.` },
                { type: 'image', data: heavyJpeg, width: 200, height: 200, align: 'center' as const, alt: 'Synthetic 5MB JPEG stress test' },
                { type: 'paragraph', text: 'If rendered without OOM errors, the buffer pipeline handles multi-megabyte images correctly.' },
            ],
            footerText: 'pdfnative – Heavy buffer memory stress test',
        }));
    }
}
