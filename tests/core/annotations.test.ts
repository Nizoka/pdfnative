import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { createModifier } from '../../src/parser/pdf-modifier.js';
import { buildAnnotation, buildAnnotationBody } from '../../src/core/pdf-annot-markup.js';
import type { MarkupAnnotation } from '../../src/core/pdf-annot-markup.js';

// Roadmap v1.5.0 — markup/drawing annotation builders + PdfReader.getAnnotations.

describe('annotation builders', () => {
    it('builds a sticky-note (Text) annotation', () => {
        const a = buildAnnotation(
            { type: 'text', rect: [10, 20, 30, 40], contents: 'note', title: 'Alice', icon: 'Note', open: true },
            5,
        );
        expect(a).toContain('5 0 obj');
        expect(a).toContain('/Subtype /Text');
        expect(a).toContain('/Rect [10.00 20.00 30.00 40.00]');
        expect(a).toContain('/Name /Note');
        expect(a).toContain('/Open true');
        expect(a).toContain('endobj');
    });

    it('auto-derives QuadPoints for a highlight when omitted', () => {
        const body = buildAnnotationBody({ type: 'highlight', rect: [0, 0, 100, 12] });
        expect(body).toContain('/Subtype /Highlight');
        expect(body).toContain('/QuadPoints [');
    });

    it('encodes non-ASCII /Contents as UTF-16BE hex', () => {
        const body = buildAnnotationBody({ type: 'text', rect: [0, 0, 1, 1], contents: 'café ≠ thé' });
        expect(body).toMatch(/\/Contents <FEFF[0-9A-F]+>/);
    });

    it('emits /L and /BS for a line annotation', () => {
        const body = buildAnnotationBody({ type: 'line', rect: [0, 0, 100, 100], start: [0, 0], end: [100, 100], borderWidth: 2 });
        expect(body).toContain('/Subtype /Line');
        expect(body).toContain('/L [0.00 0.00 100.00 100.00]');
        expect(body).toContain('/BS << /W 2.00 >>');
    });

    it('emits /DA for free-text', () => {
        const body = buildAnnotationBody({ type: 'freetext', rect: [0, 0, 100, 20], fontSize: 14, contents: 'hi' });
        expect(body).toContain('/Subtype /FreeText');
        expect(body).toContain('/DA (/Helv 14.00 Tf');
    });
});

describe('getAnnotations round-trip', () => {
    it('reads back annotations attached via the modifier', () => {
        const base = buildDocumentPDFBytes({ title: 'A', blocks: [{ type: 'paragraph', text: 'Hello' }] });
        const mod = createModifier(openPdf(base));

        const note: MarkupAnnotation = { type: 'text', rect: [100, 700, 120, 720], contents: 'Révisé — voir §2', title: 'Bob' };
        const hl: MarkupAnnotation = { type: 'highlight', rect: [72, 690, 200, 702], contents: 'important' };
        mod.addAnnotation(0, buildAnnotationBody(note));
        mod.addAnnotation(0, buildAnnotationBody(hl));

        const annots = openPdf(mod.save()).getAnnotations(0);
        expect(annots.length).toBe(2);

        const text = annots.find(a => a.subtype === 'Text');
        expect(text?.contents).toBe('Révisé — voir §2');
        expect(text?.title).toBe('Bob');
        expect(text?.rect).toEqual([100, 700, 120, 720]);

        const highlight = annots.find(a => a.subtype === 'Highlight');
        expect(highlight?.contents).toBe('important');
        expect(highlight?.quadPoints?.length).toBe(8);
    });

    it('returns [] for a page with no annotations', () => {
        const bytes = buildDocumentPDFBytes({ title: 'A', blocks: [{ type: 'paragraph', text: 'x' }] });
        expect(openPdf(bytes).getAnnotations(0)).toEqual([]);
    });
});
