/**
 * FlateDecode compression samples — size comparisons + compressed non-Latin.
 */

import { resolve } from 'path';
import { buildPDFBytes, buildDocumentPDFBytes, loadFontData } from '../../src/index.js';
import type { PdfParams, FontEntry, DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // Latin font for PDF/A embedding (rule 6.2.11.4.1 — fonts must be embedded)
    const latinEntries = await loadFontEntries('latin', '/F3');
    // ── Compressed Latin table (100 rows) ────────────────────────
    {
        const compressRows = Array.from({ length: 100 }, (_, i) => ({
            cells: [
                `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
                `Transaction #${i + 1} – Monthly recurring payment`,
                i % 3 === 0 ? `${(50 + i * 2.5).toFixed(2)}` : '',
                i % 3 !== 0 ? `${(100 + i * 5).toFixed(2)}` : '',
                `${(10000 + (i % 2 === 0 ? 1 : -1) * i * 10).toFixed(2)}`,
            ],
            type: i % 3 === 0 ? 'debit' : 'credit',
            pointed: i === 0,
        }));
        const params: PdfParams = {
            title: 'Compressed Financial Statement (FlateDecode)',
            infoItems: [
                { label: 'Account', value: 'FR76 3000 6000 0112 3456 7890 189' },
                { label: 'Period', value: '01/01/2026 – 31/03/2026' },
                { label: 'Compression', value: 'FlateDecode (zlib)' },
            ],
            balanceText: '€ 10,000.00',
            countText: '100 operations',
            headers: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
            rows: compressRows,
            footerText: 'pdfnative – FlateDecode compressed output · ISO 32000-1 §7.3.8.1',
        };
        const uncompressedBytes = buildPDFBytes(params, { compress: false });
        const compressedBytes = buildPDFBytes(params, { compress: true });
        ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-latin-100rows.pdf'), 'compression/compressed-latin-100rows.pdf', compressedBytes);
        const ratio = ((1 - compressedBytes.length / uncompressedBytes.length) * 100).toFixed(1);
        console.log(`  ℹ compressed-latin-100rows.pdf: ${uncompressedBytes.length} → ${compressedBytes.length} bytes (${ratio}% reduction)`);
    }

    // ── Compressed + Tagged (PDF/A-2b + FlateDecode) ─────────────
    {
        const params: PdfParams = {
            title: 'Compressed + Tagged PDF/A-2b',
            infoItems: [
                { label: 'Standard', value: 'PDF/A-2b (ISO 19005-2)' },
                { label: 'Compression', value: 'FlateDecode (all streams except XMP)' },
            ],
            balanceText: 'Accessible & Compressed',
            countText: '5 sample rows',
            headers: ['Feature', 'Status', 'Standard', 'Details', 'Notes'],
            rows: [
                { cells: ['FlateDecode', 'Active', 'ISO 32000-1 §7.3.8.1', 'zlib / RFC 1950', 'Content + Font + ICC'], type: 'credit', pointed: false },
                { cells: ['Tagged PDF', 'Active', 'ISO 14289-1', 'StructTreeRoot', '/Document > /Table > /TR > /TD'], type: 'credit', pointed: false },
                { cells: ['XMP Metadata', 'Uncompressed', 'ISO 19005-2', 'pdfaid:part=2', 'PDF/A validator safety'], type: 'credit', pointed: true },
                { cells: ['ICC Profile', 'Compressed', 'ISO 15076-1', 'sRGB D50', 'OutputIntent'], type: 'credit', pointed: false },
                { cells: ['Encryption', 'N/A', 'ISO 19005-1 §6.3.2', 'Mutually exclusive', 'PDF/A forbids encryption'], type: 'debit', pointed: false },
            ],
            footerText: 'pdfnative – Compressed + Tagged (PDF/A-2b)',
            fontEntries: latinEntries,
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-tagged-pdfa2b.pdf'), 'compression/compressed-tagged-pdfa2b.pdf', buildPDFBytes(params, { compress: true, tagged: true }));
    }

    // ── Compressed + Encrypted (AES-128 + FlateDecode) ───────────
    {
        const params: PdfParams = {
            title: 'Compressed + Encrypted (AES-128)',
            infoItems: [
                { label: 'Algorithm', value: 'AES-128 (V4/R4/AESV2)' },
                { label: 'Compression', value: 'FlateDecode → AES-CBC' },
                { label: 'Owner Password', value: 'compress-owner' },
            ],
            balanceText: 'Doubly Protected',
            countText: '3 sample rows',
            headers: ['Step', 'Operation', 'Input', 'Output', 'Notes'],
            rows: [
                { cells: ['1', 'Compress', 'Raw stream', 'zlib data', 'RFC 1950 format'], type: 'credit', pointed: false },
                { cells: ['2', 'Encrypt', 'zlib data', 'AES-CBC ciphertext', 'Per-object key + random IV'], type: 'credit', pointed: false },
                { cells: ['3', 'Embed', 'Ciphertext', 'PDF stream', '/Filter /FlateDecode in dict'], type: 'credit', pointed: true },
            ],
            footerText: 'pdfnative – Compressed + Encrypted',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-encrypted-aes128.pdf'), 'compression/compressed-encrypted-aes128.pdf', buildPDFBytes(params, {
            compress: true,
            encryption: { ownerPassword: 'compress-owner', algorithm: 'aes128' },
        }));
    }

    // ── Compressed Document Builder ──────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Compressed Document (FlateDecode)',
            blocks: [
                { type: 'heading', text: 'Stream Compression Analysis', level: 1 },
                { type: 'paragraph', text: 'This document demonstrates FlateDecode stream compression using platform-native zlib. All content streams, font streams, and ToUnicode CMaps are compressed, reducing file size by 50–70%.' },
                { type: 'heading', text: 'Stream Types', level: 2 },
                { type: 'table', headers: ['Stream', 'Compressed?', 'Benefit', 'Notes'], rows: [
                    { cells: ['Page Content', 'Yes', 'Very High', 'Repetitive operators'], type: 'credit', pointed: false },
                    { cells: ['FontFile2 (TTF)', 'Yes', 'High', 'Binary subset'], type: 'credit', pointed: false },
                    { cells: ['ToUnicode CMap', 'Yes', 'Very High', 'PostScript text'], type: 'credit', pointed: false },
                    { cells: ['ICC Profile', 'Yes', 'Medium', '390 bytes'], type: 'credit', pointed: false },
                    { cells: ['XMP Metadata', 'No (tagged)', 'N/A', 'PDF/A safety'], type: 'debit', pointed: false },
                    { cells: ['JPEG Image', 'No', 'N/A', 'Already DCTDecode'], type: 'debit', pointed: false },
                    { cells: ['PNG Image', 'No', 'N/A', 'Already FlateDecode'], type: 'debit', pointed: true },
                ] },
                { type: 'link', text: 'View source on GitHub', url: 'https://github.com/Nizoka/pdfnative' },
            ],
            footerText: 'pdfnative – Document Builder with FlateDecode',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'doc-compressed.pdf'), 'compression/doc-compressed.pdf', buildDocumentPDFBytes(params, { compress: true }));
    }

    // ── Uncompressed baseline ────────────────────────────────────
    {
        const params: PdfParams = {
            title: 'Uncompressed Baseline (No FlateDecode)',
            infoItems: [
                { label: 'Account', value: 'FR76 3000 6000 0112 3456 7890 189' },
                { label: 'Period', value: '01/01/2026 – 31/03/2026' },
                { label: 'Compression', value: 'None – raw streams' },
            ],
            balanceText: '€ 10,000.00',
            countText: '100 operations',
            headers: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
            rows: Array.from({ length: 100 }, (_, i) => ({
                cells: [
                    `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
                    `Transaction #${i + 1} – Monthly recurring payment`,
                    i % 3 === 0 ? `${(50 + i * 2.5).toFixed(2)}` : '',
                    i % 3 !== 0 ? `${(100 + i * 5).toFixed(2)}` : '',
                    `${(10000 + (i % 2 === 0 ? 1 : -1) * i * 10).toFixed(2)}`,
                ],
                type: i % 3 === 0 ? 'debit' : 'credit',
                pointed: i === 0,
            })),
            footerText: 'pdfnative – Uncompressed baseline for size comparison',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'uncompressed-latin-100rows.pdf'), 'compression/uncompressed-latin-100rows.pdf', buildPDFBytes(params));
    }

    // ── Compressed non-Latin: Japanese ────────────────────────────
    {
        const jaFd = await loadFontData('ja');
        if (jaFd) {
            const entries: FontEntry[] = [{ fontData: jaFd, fontRef: '/F3', lang: 'ja' }];
            const params: PdfParams = {
                title: '月次口座明細書（圧縮版）',
                infoItems: [{ label: '口座番号', value: 'JP-0001-2345-6789' }, { label: '圧縮', value: 'FlateDecode (zlib)' }],
                balanceText: '残高: ¥ 1,234,567',
                countText: '20 件の取引',
                headers: ['日付', '摘要', '区分', '金額', '状態'],
                rows: Array.from({ length: 20 }, (_, i) => ({
                    cells: [`${String((i % 28) + 1).padStart(2, '0')}/01`, `取引番号 ${i + 1} – 月次定期支払い`, i % 2 === 0 ? '収入' : '支出', `${i % 2 === 0 ? '+' : '-'}${((i + 1) * 5000).toLocaleString()}`, i % 3 === 0 ? '済' : ''],
                    type: i % 2 === 0 ? 'credit' : 'debit',
                    pointed: i === 0,
                })),
                footerText: 'pdfnative – 日本語圧縮出力 (FlateDecode)',
                fontEntries: entries,
            };
            const uncompBytes = buildPDFBytes(params);
            const compBytes = buildPDFBytes(params, { compress: true });
            ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-japanese.pdf'), 'compression/compressed-japanese.pdf', compBytes);
            const r = ((1 - compBytes.length / uncompBytes.length) * 100).toFixed(1);
            console.log(`  ℹ compressed-japanese.pdf: ${uncompBytes.length} → ${compBytes.length} bytes (${r}% reduction)`);
        }
    }

    // ── Compressed non-Latin: Arabic ─────────────────────────────
    {
        const arFd = await loadFontData('ar');
        if (arFd) {
            const params: PdfParams = {
                title: 'كشف حساب مضغوط',
                infoItems: [{ label: 'الحساب', value: 'SA03 8000 0000 6080 1016 7519' }, { label: 'الضغط', value: 'FlateDecode (zlib)' }],
                balanceText: 'الرصيد: ﷼ 45,230.00',
                countText: '10 معاملات',
                headers: ['التاريخ', 'الوصف', 'الفئة', 'المبلغ', 'الحالة'],
                rows: Array.from({ length: 10 }, (_, i) => ({
                    cells: [`${String((i % 28) + 1).padStart(2, '0')}/01`, `معاملة رقم ${i + 1}`, i % 2 === 0 ? 'دخل' : 'مصروف', `${i % 2 === 0 ? '+' : '-'}${((i + 1) * 500).toLocaleString()}`, i % 3 === 0 ? 'مراجع' : ''],
                    type: i % 2 === 0 ? 'credit' : 'debit',
                    pointed: i === 0,
                })),
                footerText: 'pdfnative – مخرجات مضغوطة (FlateDecode)',
                fontEntries: [{ fontData: arFd, fontRef: '/F3', lang: 'ar' }],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-arabic.pdf'), 'compression/compressed-arabic.pdf', buildPDFBytes(params, { compress: true }));
        }
    }

    // ── Compressed non-Latin: Thai ───────────────────────────────
    {
        const thFd = await loadFontData('th');
        if (thFd) {
            const params: PdfParams = {
                title: 'รายงานบัญชี (บีบอัด)',
                infoItems: [{ label: 'บัญชี', value: 'TH-1234-5678-9012' }, { label: 'การบีบอัด', value: 'FlateDecode (zlib)' }],
                balanceText: 'ยอดคงเหลือ: ฿ 345,678.90',
                countText: '10 รายการ',
                headers: ['วันที่', 'รายละเอียด', 'หมวดหมู่', 'จำนวน', 'สถานะ'],
                rows: Array.from({ length: 10 }, (_, i) => ({
                    cells: [`${String((i % 28) + 1).padStart(2, '0')}/01`, `รายการที่ ${i + 1} – ชำระรายเดือน`, i % 2 === 0 ? 'รายได้' : 'รายจ่าย', `${i % 2 === 0 ? '+' : '-'}${((i + 1) * 1000).toLocaleString()}`, i % 3 === 0 ? 'ตรวจ' : ''],
                    type: i % 2 === 0 ? 'credit' : 'debit',
                    pointed: i === 0,
                })),
                footerText: 'pdfnative – ผลลัพธ์บีบอัด (FlateDecode)',
                fontEntries: [{ fontData: thFd, fontRef: '/F3', lang: 'th' }],
            };
            ctx.writeSafe(resolve(ctx.outputDir, 'compression', 'compressed-thai.pdf'), 'compression/compressed-thai.pdf', buildPDFBytes(params, { compress: true }));
        }
    }
}
