/**
 * Phase 8 — PDF/A-2b Configuration Tests
 * ========================================
 * Tests for resolvePdfAConfig(), updated XMP metadata, and PDF version headers.
 */

import { describe, it, expect } from 'vitest';
import {
    resolvePdfAConfig,
    buildXMPMetadata,
    buildOutputIntentDict,
} from '../../src/core/pdf-tags.js';
import { buildPDF, buildPDFBytes } from '../../src/core/pdf-builder.js';
import { buildDocumentPDF, buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTableParams(overrides?: Partial<PdfParams>): PdfParams {
    return {
        title: 'PDF/A Test',
        infoItems: [{ label: 'Account', value: '1234' }],
        balanceText: '1000.00',
        countText: '2 operations',
        headers: ['Date', 'Desc', 'Cat', 'Amount', 'Balance'],
        rows: [
            { cells: ['01/01', 'Test', 'Cat', '100', '900'], type: 'credit', pointed: false },
        ],
        footerText: 'Test Footer',
        ...overrides,
    };
}

function makeDocParams(overrides?: Partial<DocumentParams>): DocumentParams {
    return {
        title: 'PDF/A Doc Test',
        blocks: [
            { type: 'heading', level: 1 as const, text: 'Section 1' },
            { type: 'paragraph', text: 'Content paragraph.' },
        ],
        footerText: 'Footer',
        ...overrides,
    };
}

// ── resolvePdfAConfig ────────────────────────────────────────────────

describe('resolvePdfAConfig', () => {
    it('should return disabled config for false', () => {
        const cfg = resolvePdfAConfig(false);
        expect(cfg.enabled).toBe(false);
        expect(cfg.pdfVersion).toBe('1.4');
    });

    it('should return disabled config for undefined', () => {
        const cfg = resolvePdfAConfig(undefined);
        expect(cfg.enabled).toBe(false);
        expect(cfg.pdfVersion).toBe('1.4');
    });

    it('should return PDF/A-2b for true (default tagged)', () => {
        const cfg = resolvePdfAConfig(true);
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfVersion).toBe('1.7');
        expect(cfg.pdfaPart).toBe(2);
        expect(cfg.pdfaConformance).toBe('B');
    });

    it('should return PDF/A-2b for "pdfa2b"', () => {
        const cfg = resolvePdfAConfig('pdfa2b');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfVersion).toBe('1.7');
        expect(cfg.pdfaPart).toBe(2);
        expect(cfg.pdfaConformance).toBe('B');
    });

    it('should return PDF/A-1b for "pdfa1b"', () => {
        const cfg = resolvePdfAConfig('pdfa1b');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfVersion).toBe('1.4');
        expect(cfg.pdfaPart).toBe(1);
        expect(cfg.pdfaConformance).toBe('B');
    });

    it('should return PDF/A-2u for "pdfa2u"', () => {
        const cfg = resolvePdfAConfig('pdfa2u');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfVersion).toBe('1.7');
        expect(cfg.pdfaPart).toBe(2);
        expect(cfg.pdfaConformance).toBe('U');
    });

    it('should have correct outputIntentSubtype for all levels', () => {
        expect(resolvePdfAConfig(true).outputIntentSubtype).toBe('GTS_PDFA1');
        expect(resolvePdfAConfig('pdfa1b').outputIntentSubtype).toBe('GTS_PDFA1');
        expect(resolvePdfAConfig('pdfa2b').outputIntentSubtype).toBe('GTS_PDFA1');
        expect(resolvePdfAConfig('pdfa2u').outputIntentSubtype).toBe('GTS_PDFA1');
    });
});

// ── buildXMPMetadata with part/conformance ───────────────────────────

describe('buildXMPMetadata PDF/A levels', () => {
    it('should produce PDF/A-2b by default', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-01T00:00:00');
        expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    });

    it('should produce PDF/A-1b when part=1', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-01T00:00:00', 1, 'B');
        expect(xmp).toContain('<pdfaid:part>1</pdfaid:part>');
        expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    });

    it('should produce PDF/A-2u when conformance=U', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-01T00:00:00', 2, 'U');
        expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(xmp).toContain('<pdfaid:conformance>U</pdfaid:conformance>');
    });
});

// ── buildOutputIntentDict ────────────────────────────────────────────

describe('buildOutputIntentDict with subtype', () => {
    it('should use GTS_PDFA1 by default', () => {
        const dict = buildOutputIntentDict(42);
        expect(dict).toContain('/S /GTS_PDFA1');
    });

    it('should accept custom subtype', () => {
        const dict = buildOutputIntentDict(42, 'GTS_PDFA1');
        expect(dict).toContain('/S /GTS_PDFA1');
    });
});

// ── buildPDF with different tagged values ────────────────────────────

describe('buildPDF PDF/A-2b (table builder)', () => {
    it('should produce %PDF-1.7 header when tagged=true', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    });

    it('should produce %PDF-1.4 header when tagged=false', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: false });
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    });

    it('should produce %PDF-1.4 header when tagged="pdfa1b"', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: 'pdfa1b' });
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
        expect(pdf).toContain('<pdfaid:part>1</pdfaid:part>');
    });

    it('should produce %PDF-1.7 header when tagged="pdfa2b"', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: 'pdfa2b' });
        expect(pdf.startsWith('%PDF-1.7')).toBe(true);
        expect(pdf).toContain('<pdfaid:part>2</pdfaid:part>');
    });

    it('should produce %PDF-1.7 header when tagged="pdfa2u"', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: 'pdfa2u' });
        expect(pdf.startsWith('%PDF-1.7')).toBe(true);
        expect(pdf).toContain('<pdfaid:conformance>U</pdfaid:conformance>');
    });

    it('should include MarkInfo and StructTreeRoot for all PDF/A variants', () => {
        for (const tagged of [true, 'pdfa1b', 'pdfa2b', 'pdfa2u'] as const) {
            const pdf = buildPDF(makeTableParams(), { tagged });
            expect(pdf).toContain('/MarkInfo << /Marked true >>');
            expect(pdf).toContain('/StructTreeRoot');
        }
    });

    it('should produce valid bytes for PDF/A-2b', () => {
        const bytes = buildPDFBytes(makeTableParams(), { tagged: true });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
    });
});

// ── buildDocumentPDF with different tagged values ────────────────────

describe('buildDocumentPDF PDF/A-2b (document builder)', () => {
    it('should produce %PDF-1.7 header when tagged=true', () => {
        const pdf = buildDocumentPDF(makeDocParams(), { tagged: true });
        expect(pdf.startsWith('%PDF-1.7')).toBe(true);
    });

    it('should produce %PDF-1.4 header when tagged=false', () => {
        const pdf = buildDocumentPDF(makeDocParams());
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    });

    it('should produce %PDF-1.4 header when tagged="pdfa1b"', () => {
        const pdf = buildDocumentPDF(makeDocParams(), { tagged: 'pdfa1b' });
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
        expect(pdf).toContain('<pdfaid:part>1</pdfaid:part>');
    });

    it('should produce %PDF-1.7 header when tagged="pdfa2u"', () => {
        const pdf = buildDocumentPDF(makeDocParams(), { tagged: 'pdfa2u' });
        expect(pdf.startsWith('%PDF-1.7')).toBe(true);
        expect(pdf).toContain('<pdfaid:conformance>U</pdfaid:conformance>');
    });

    it('should produce valid bytes for PDF/A-2b', () => {
        const bytes = buildDocumentPDFBytes(makeDocParams(), { tagged: true });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
    });
});

// ── Backward Compatibility ───────────────────────────────────────────

describe('PDF/A backward compatibility', () => {
    it('tagged=true should still produce tagged structures', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: true });
        expect(pdf).toContain('/MarkInfo << /Marked true >>');
        expect(pdf).toContain('/StructTreeRoot');
        expect(pdf).toContain('BDC');
        expect(pdf).toContain('EMC');
        expect(pdf).toContain('/OutputIntents');
        expect(pdf).toContain('/Type /Metadata');
    });

    it('tagged=false should not produce tagged structures', () => {
        const pdf = buildPDF(makeTableParams(), { tagged: false });
        expect(pdf).not.toContain('/MarkInfo');
        expect(pdf).not.toContain('/StructTreeRoot');
    });

    it('unset tagged should not produce tagged structures', () => {
        const pdf = buildPDF(makeTableParams());
        expect(pdf).not.toContain('/MarkInfo');
        expect(pdf).not.toContain('/StructTreeRoot');
    });
});
