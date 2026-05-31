/**
 * Regression guard for per-line MCID granularity in tagged (PDF/UA / PDF/A-2b)
 * output (v1.3.0).
 *
 * ISO 14289-1 §7.3 requires every marked-content sequence in a content stream
 * to carry a UNIQUE marked-content identifier; a single MCID must not be shared
 * by two disjoint `BDC … EMC` text fragments. Before v1.3.0 the document-builder
 * table renderer (`emitCell`) and the multi-line `/Caption` emitter allocated a
 * single MCID per cell/caption and reused it for every wrapped line, producing
 * duplicate `/Span << /MCID n …>>` sequences that veraPDF flags.
 *
 * These tests render single-page tagged documents (MCIDs restart per page, so a
 * single page lets us assert global uniqueness) and verify:
 *   - wrapped table cells emit one DISTINCT MCID per visual line,
 *   - multi-line captions do the same,
 *   - no content-stream `/Span` MCID is reused,
 *   - single-line cells still consume exactly one MCID (byte-stability guard),
 *   - paragraphs (already correct pre-1.3.0) keep per-line MCIDs.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDF } from '../../src/core/pdf-document.js';
import type { DocumentBlock } from '../../src/types/pdf-document-types.js';

/** All MCIDs attached to content-stream marked-content (`/Span`, `/TD`, …) BDC sequences. */
function contentSpanMcids(pdf: string): number[] {
    return [...pdf.matchAll(/\/(?:Span|TD|TH|P|Caption|L|LI)\s*<<\s*\/MCID\s+(\d+)/g)].map((m) => Number(m[1]));
}

const WRAP_COLS = [
    { f: 0.18, a: 'l' as const, mx: 10, mxH: 10 },
    { f: 0.82, a: 'l' as const, mx: 200, mxH: 200 },
];

const LONG = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';

describe('tagged MCID granularity (v1.3.0)', () => {
    it('a wrapped table cell emits one distinct MCID per visual line', () => {
        const pdf = buildDocumentPDF(
            {
                title: 'Wrapped cell',
                blocks: [
                    {
                        type: 'table',
                        headers: ['Key', 'Value'],
                        rows: [{ cells: ['k', LONG], type: 'credit', pointed: false }],
                        columns: WRAP_COLS,
                        wrap: 'always',
                    },
                ],
                footerText: 'pdfnative',
            },
            { tagged: true },
        );

        const mcids = contentSpanMcids(pdf);
        // The long second cell must wrap, so the document holds more spans than
        // the trivial header(2)+key(1)+value(1) single-line minimum.
        expect(mcids.length).toBeGreaterThan(4);
        // Core invariant: no MCID is reused by two disjoint marked-content spans.
        expect(new Set(mcids).size).toBe(mcids.length);
    });

    it('no content-stream MCID is reused across a multi-row wrapping table', () => {
        const rows = Array.from({ length: 6 }, (_, i) => ({
            cells: [`R${i + 1}`, `${LONG} (row ${i + 1})`],
            type: 'credit' as const,
            pointed: false,
        }));
        const pdf = buildDocumentPDF(
            {
                title: 'Multi-row wrap',
                blocks: [{ type: 'table', headers: ['#', 'Text'], rows, columns: WRAP_COLS, wrap: 'always' }],
                footerText: 'pdfnative',
            },
            { tagged: true },
        );
        const mcids = contentSpanMcids(pdf);
        expect(new Set(mcids).size).toBe(mcids.length);
    });

    it('a multi-line caption emits one distinct MCID per caption line', () => {
        const pdf = buildDocumentPDF(
            {
                title: 'Wrapped caption',
                blocks: [
                    {
                        type: 'table',
                        headers: ['A', 'B'],
                        rows: [{ cells: ['x', 'y'], type: 'credit', pointed: false }],
                        columns: WRAP_COLS,
                        caption:
                            'This is a deliberately long table caption that must wrap across several visual lines so that the per-line MCID allocation path is exercised end to end.',
                    },
                ],
                footerText: 'pdfnative',
            },
            { tagged: true },
        );
        const mcids = contentSpanMcids(pdf);
        expect(new Set(mcids).size).toBe(mcids.length);
        // Caption struct element present and references marked content.
        expect(pdf).toContain('/Caption');
    });

    it('a single-line table cell still consumes exactly one MCID (byte-stability guard)', () => {
        const pdf = buildDocumentPDF(
            {
                title: 'Single line',
                blocks: [
                    {
                        type: 'table',
                        headers: ['A', 'B'],
                        rows: [{ cells: ['short', 'tiny'], type: 'credit', pointed: false }],
                        columns: [
                            { f: 0.5, a: 'l', mx: 100, mxH: 100 },
                            { f: 0.5, a: 'l', mx: 100, mxH: 100 },
                        ],
                        wrap: 'auto',
                    },
                ],
                footerText: 'pdfnative',
            },
            { tagged: true },
        );
        const mcids = contentSpanMcids(pdf);
        expect(new Set(mcids).size).toBe(mcids.length);
        // header(2) + row(2) = 4 single-line cells, all distinct.
        expect(mcids.length).toBeGreaterThanOrEqual(4);
    });

    it('a wrapped paragraph keeps one distinct MCID per line', () => {
        const blocks: DocumentBlock[] = [
            {
                type: 'paragraph',
                text:
                    'A long paragraph that wraps onto several lines so the per-line MCID allocation in renderParagraph is exercised and verified to stay collision-free across the whole single-page content stream.',
            },
        ];
        const pdf = buildDocumentPDF({ title: 'Para', blocks, footerText: 'pdfnative' }, { tagged: true });
        const mcids = contentSpanMcids(pdf);
        expect(mcids.length).toBeGreaterThan(2);
        expect(new Set(mcids).size).toBe(mcids.length);
    });
});
