import { describe, it, expect } from 'vitest';
import {
    validateURL,
    buildLinkAnnotation,
    buildInternalLinkAnnotation,
    isLinkAnnotation,
} from '../../src/core/pdf-annot.js';
import type { LinkAnnotation, InternalLink, Annotation } from '../../src/core/pdf-annot.js';
import { buildDocumentPDF, buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── validateURL ──────────────────────────────────────────────────────

describe('validateURL', () => {
    it('should accept http URLs', () => {
        expect(validateURL('http://example.com')).toBe(true);
        expect(validateURL('http://example.com/path?q=1')).toBe(true);
    });

    it('should accept https URLs', () => {
        expect(validateURL('https://example.com')).toBe(true);
        expect(validateURL('https://example.com/secure')).toBe(true);
    });

    it('should accept mailto URLs', () => {
        expect(validateURL('mailto:user@example.com')).toBe(true);
    });

    it('should reject javascript: URLs', () => {
        expect(validateURL('javascript:alert(1)')).toBe(false);
    });

    it('should reject file: URLs', () => {
        expect(validateURL('file:///etc/passwd')).toBe(false);
    });

    it('should reject data: URLs', () => {
        expect(validateURL('data:text/html,test')).toBe(false);
    });

    it('should reject empty or null inputs', () => {
        expect(validateURL('')).toBe(false);
        expect(validateURL(null as unknown as string)).toBe(false);
        expect(validateURL(undefined as unknown as string)).toBe(false);
    });

    it('should be case-insensitive for scheme', () => {
        expect(validateURL('HTTP://EXAMPLE.COM')).toBe(true);
        expect(validateURL('HTTPS://secure.example.com')).toBe(true);
        expect(validateURL('JAVASCRIPT:alert(1)')).toBe(false);
    });

    it('should reject URLs without scheme', () => {
        expect(validateURL('example.com')).toBe(false);
        expect(validateURL('//example.com')).toBe(false);
    });
});

// ── buildLinkAnnotation ──────────────────────────────────────────────

describe('buildLinkAnnotation', () => {
    it('should build a valid link annotation object', () => {
        const annot: LinkAnnotation = {
            url: 'https://example.com',
            rect: [72, 700, 200, 714],
        };
        const result = buildLinkAnnotation(annot, 10);
        expect(result).toContain('10 0 obj');
        expect(result).toContain('/Type /Annot');
        expect(result).toContain('/Subtype /Link');
        expect(result).toContain('/Rect [72.00 700.00 200.00 714.00]');
        expect(result).toContain('/S /URI');
        expect(result).toContain('/URI (https://example.com)');
        expect(result).toContain('/Border [0 0 0]');
        expect(result).toContain('endobj');
    });

    it('should escape parentheses in URLs', () => {
        const annot: LinkAnnotation = {
            url: 'https://example.com/path(1)',
            rect: [72, 700, 200, 714],
        };
        const result = buildLinkAnnotation(annot, 10);
        expect(result).toContain('/URI (https://example.com/path\\(1\\))');
    });

    it('should throw for blocked URL schemes', () => {
        const annot: LinkAnnotation = {
            url: 'javascript:alert(1)',
            rect: [72, 700, 200, 714],
        };
        expect(() => buildLinkAnnotation(annot, 10)).toThrow('Blocked URL scheme');
    });

    it('should throw for empty URL', () => {
        const annot: LinkAnnotation = {
            url: '',
            rect: [72, 700, 200, 714],
        };
        expect(() => buildLinkAnnotation(annot, 10)).toThrow('Blocked URL scheme');
    });
});

// ── buildInternalLinkAnnotation ──────────────────────────────────────

describe('buildInternalLinkAnnotation', () => {
    it('should build a GoTo action annotation', () => {
        const annot: InternalLink = {
            pageIndex: 2,
            rect: [72, 700, 200, 714],
        };
        const result = buildInternalLinkAnnotation(annot, 15, 20);
        expect(result).toContain('20 0 obj');
        expect(result).toContain('/Subtype /Link');
        expect(result).toContain('/S /GoTo');
        expect(result).toContain('/D [15 0 R /Fit]');
        expect(result).toContain('endobj');
    });
});

// ── isLinkAnnotation ─────────────────────────────────────────────────

describe('isLinkAnnotation', () => {
    it('should identify external link annotations', () => {
        const annot: Annotation = { url: 'https://example.com', rect: [0, 0, 100, 20] };
        expect(isLinkAnnotation(annot)).toBe(true);
    });

    it('should reject internal link annotations', () => {
        const annot: Annotation = { pageIndex: 0, rect: [0, 0, 100, 20] };
        expect(isLinkAnnotation(annot)).toBe(false);
    });
});

// ── Document Builder Link Integration ────────────────────────────────

describe('LinkBlock in document builder', () => {
    function makeParams(overrides?: Partial<DocumentParams>): DocumentParams {
        return {
            title: 'Link Test',
            blocks: [
                { type: 'link', text: 'Visit Example', url: 'https://example.com' },
            ],
            footerText: 'Test Footer',
            ...overrides,
        };
    }

    it('should produce valid PDF with a link block', () => {
        const pdf = buildDocumentPDF(makeParams());
        expect(pdf).toContain('%PDF-1.4');
        expect(pdf).toContain('%%EOF');
        // Should contain link annotation
        expect(pdf).toContain('/Type /Annot');
        expect(pdf).toContain('/Subtype /Link');
        expect(pdf).toContain('/URI (https://example.com)');
    });

    it('should return Uint8Array from buildDocumentPDFBytes', () => {
        const bytes = buildDocumentPDFBytes(makeParams());
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
    });

    it('should render link text with underline', () => {
        const pdf = buildDocumentPDF(makeParams());
        // Should contain underline stroke
        expect(pdf).toMatch(/0\.0 0\.0 0\.8 RG/); // link color for stroke
        expect(pdf).toContain('l S'); // line stroke
    });

    it('should support custom link color', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'link', text: 'Red Link', url: 'https://example.com', color: '1.0 0.0 0.0' },
            ],
        }));
        expect(pdf).toContain('1.0 0.0 0.0 rg');
    });

    it('should support hex link color', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'link', text: 'Blue Link', url: 'https://example.com', color: '#0000FF' },
            ],
        }));
        expect(pdf).toContain('0 0 1 rg');
    });

    it('should support custom link font size', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'link', text: 'Big Link', url: 'https://example.com', fontSize: 16 },
            ],
        }));
        expect(pdf).toContain('%PDF-1.4');
    });

    it('should include /Annots array on page', () => {
        const pdf = buildDocumentPDF(makeParams());
        expect(pdf).toContain('/Annots [');
    });

    it('should handle multiple links on one page', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'link', text: 'Link 1', url: 'https://example.com' },
                { type: 'link', text: 'Link 2', url: 'https://other.com' },
            ],
        }));
        expect(pdf).toContain('/URI (https://example.com)');
        expect(pdf).toContain('/URI (https://other.com)');
    });

    it('should not emit annotation for blocked URLs', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'link', text: 'Bad Link', url: 'javascript:alert(1)' },
            ],
        }));
        // Should NOT contain annotation objects
        expect(pdf).not.toContain('/Type /Annot');
        // But should still render text
        expect(pdf).toContain('%PDF-1.4');
    });

    it('should handle link blocks with tagged mode', () => {
        const pdf = buildDocumentPDF(makeParams(), { tagged: true });
        expect(pdf).toContain('%PDF-1.7');
        // Tagged mode should have /Link structure element
        expect(pdf).toContain('/S /Link');
    });

    it('should mix links with other block types', () => {
        const pdf = buildDocumentPDF(makeParams({
            blocks: [
                { type: 'heading', text: 'Title', level: 1 },
                { type: 'paragraph', text: 'Some text here.' },
                { type: 'link', text: 'Click here', url: 'https://example.com' },
                { type: 'paragraph', text: 'More text after link.' },
            ],
        }));
        expect(pdf).toContain('/URI (https://example.com)');
        expect(pdf).toContain('%%EOF');
    });
});
