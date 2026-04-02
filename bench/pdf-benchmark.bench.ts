/**
 * pdfnative — Performance Benchmarks
 * ====================================
 * Measures PDF generation time for realistic workloads.
 * Run: npx vitest bench
 */

import { bench, describe } from 'vitest';
import { buildPDF, buildPDFBytes } from '../src/core/pdf-builder.js';
import type { PdfParams, FontData, FontEntry } from '../src/types/pdf-types.js';

// ── Fixtures ─────────────────────────────────────────────────────────

function makeLatinParams(rowCount: number): PdfParams {
    return {
        title: 'Performance Benchmark Report',
        infoItems: [
            { label: 'Account', value: 'FR76 3000 6000 0112 3456 7890 189' },
            { label: 'Period', value: '01/01/2026 – 31/12/2026' },
            { label: 'Currency', value: 'EUR' },
        ],
        balanceText: 'Solde au 31/12/2026 : 12 345,67 EUR',
        countText: `${rowCount} opérations`,
        headers: ['Date', 'Référence', 'Libellé', 'Montant', 'Solde'],
        rows: Array.from({ length: rowCount }, (_, i) => ({
            cells: [
                `${String((i % 28) + 1).padStart(2, '0')}/01/2026`,
                `REF-${String(i + 1).padStart(6, '0')}`,
                `Opération bancaire numéro ${i + 1}`,
                `${(i % 2 === 0 ? '' : '-')}${(Math.random() * 1000).toFixed(2)} EUR`,
                `${(12345.67 + i * 10).toFixed(2)} EUR`,
            ],
            type: i % 2 === 0 ? 'credit' : 'debit',
            pointed: i % 5 === 0,
        })),
        footerText: 'Document généré par pdfnative — Benchmark',
    };
}

function makeMockFontData(): FontData {
    const cmap: Record<number, number> = {};
    const widths: Record<number, number> = {};
    // Map printable ASCII + French chars
    for (let i = 32; i < 127; i++) { cmap[i] = i - 31; widths[i - 31] = 500; }
    // French accented
    for (const cp of [0xE0, 0xE2, 0xE7, 0xE8, 0xE9, 0xEA, 0xEE, 0xF4, 0xFB, 0xFC]) {
        const gid = Object.keys(cmap).length + 1;
        cmap[cp] = gid;
        widths[gid] = 500;
    }
    return {
        metrics: { unitsPerEm: 1000, numGlyphs: 200, defaultWidth: 500, ascent: 800, descent: -200, bbox: [0, -200, 1000, 800], capHeight: 700, stemV: 50 },
        fontName: 'BenchFont',
        cmap,
        defaultWidth: 500,
        widths,
        pdfWidthArray: Object.entries(widths).map(([g, w]) => `${g} [${w}]`).join(' '),
        ttfBase64: 'AAAAAAAAAA==',
        gsub: {},
        markAnchors: null,
        mark2mark: null,
    };
}

function makeUnicodeParams(rowCount: number): PdfParams {
    const fontData = makeMockFontData();
    const fontEntries: FontEntry[] = [{ fontData, fontRef: '/F3', lang: 'fr' }];
    return { ...makeLatinParams(rowCount), fontEntries };
}

// ── Benchmarks ───────────────────────────────────────────────────────

describe('buildPDF Latin mode', () => {
    bench('100 rows', () => {
        buildPDF(makeLatinParams(100));
    });

    bench('500 rows', () => {
        buildPDF(makeLatinParams(500));
    });

    bench('1000 rows', () => {
        buildPDF(makeLatinParams(1000));
    });

    bench('5000 rows', () => {
        buildPDF(makeLatinParams(5000));
    });
});

describe('buildPDF Unicode mode', () => {
    bench('100 rows', () => {
        buildPDF(makeUnicodeParams(100));
    });

    bench('500 rows', () => {
        buildPDF(makeUnicodeParams(500));
    });

    bench('1000 rows', () => {
        buildPDF(makeUnicodeParams(1000));
    });
});

describe('buildPDFBytes (full pipeline)', () => {
    bench('500 rows Latin → Uint8Array', () => {
        buildPDFBytes(makeLatinParams(500));
    });

    bench('500 rows Unicode → Uint8Array', () => {
        buildPDFBytes(makeUnicodeParams(500));
    });
});
