/**
 * Table of Contents showcase — multi-level headings, dot leaders, GoTo links.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // Latin font for PDF/A embedding (rule 6.2.11.4.1)
    const latinEntries = await loadFontEntries('latin', '/F3');
    // ── Full TOC with 3-level headings ───────────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'toc', title: 'Table of Contents', maxLevel: 3 },
            { type: 'heading', text: '1. Introduction', level: 1 },
            { type: 'paragraph', text: 'This document demonstrates the Table of Contents feature with automatic page numbering, dot leaders, and internal GoTo links. Clicking a TOC entry navigates to the corresponding heading.' },
            { type: 'heading', text: '1.1 Purpose', level: 2 },
            { type: 'paragraph', text: 'The TOC block is designed for long-form documents that benefit from structured navigation. It supports up to three levels of headings and uses a multi-pass pagination algorithm to ensure accurate page numbers.' },
            { type: 'heading', text: '1.1.1 Scope', level: 3 },
            { type: 'paragraph', text: 'TOC entries are collected from all heading blocks in the document. Each entry displays the heading text, dot leaders, and the target page number aligned to the right margin.' },
            { type: 'heading', text: '2. Architecture', level: 1 },
            { type: 'paragraph', text: 'The document builder processes blocks sequentially. When a TOC block is encountered, it reserves space for the generated entries. After the first pass determines page numbers, a second pass updates the TOC entries with final page references.' },
            { type: 'heading', text: '2.1 Document Model', level: 2 },
            { type: 'paragraph', text: 'Documents consist of an ordered sequence of typed blocks: headings, paragraphs, lists, tables, images, links, TOC, and barcodes. Each block type has its own rendering logic.' },
            { type: 'heading', text: '2.2 Pagination', level: 2 },
            { type: 'paragraph', text: 'Multi-pass pagination (up to 3 passes) ensures that TOC page numbers are stable even when the TOC itself spans multiple pages. The algorithm converges when page assignments stop changing between passes.' },
            { type: 'heading', text: '2.2.1 Pass Algorithm', level: 3 },
            { type: 'paragraph', text: 'Pass 1: Render all blocks, record heading positions and page numbers. Pass 2: Re-render with updated TOC entries. Pass 3 (if needed): Final stabilization pass.' },
            { type: 'heading', text: '3. Implementation Details', level: 1 },
            { type: 'list', items: ['Dot leaders fill the space between heading text and page number', 'Indentation increases with heading level (configurable)', 'Named destinations enable GoTo navigation', 'Tagged mode wraps TOC in /TOC + /TOCI structure elements'], style: 'bullet' },
            { type: 'heading', text: '3.1 Named Destinations', level: 2 },
            { type: 'paragraph', text: 'Each heading registers a named destination (toc_h_N) in the PDF catalog /Dests dictionary. TOC entries reference these destinations via /Dest annotations, enabling intra-document navigation without URI actions.' },
            { type: 'heading', text: '3.2 Visual Styling', level: 2 },
            { type: 'paragraph', text: 'TOC entries use configurable font size and indentation. The default style uses 10pt text with 15pt indent per level. Dot leaders are rendered as sequences of period characters with consistent spacing.' },
            { type: 'heading', text: '4. Conclusion', level: 1 },
            { type: 'paragraph', text: 'The Table of Contents feature provides professional-grade document navigation with minimal configuration. A single TocBlock at the desired position generates and maintains a complete navigational index.' },
        ];

        const params: DocumentParams = { title: 'TOC Showcase – Full', blocks };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'toc', 'toc-full.pdf'),
            'toc/toc-full.pdf',
            buildDocumentPDFBytes(params),
        );
    }

    // ── TOC limited to level 1 + 2 only ──────────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'toc', title: 'Contents', maxLevel: 2, fontSize: 11, indent: 20 },
            { type: 'heading', text: 'Executive Summary', level: 1 },
            { type: 'paragraph', text: 'This variant limits the TOC to level 1 and 2 headings, with custom font size (11pt) and indent (20pt). Level 3 headings appear in the document but are excluded from the TOC.' },
            { type: 'heading', text: 'Financial Overview', level: 1 },
            { type: 'heading', text: 'Revenue Analysis', level: 2 },
            { type: 'paragraph', text: 'Quarterly revenue figures show consistent growth across all segments.' },
            { type: 'heading', text: 'Regional Breakdown', level: 3 },
            { type: 'paragraph', text: 'This level-3 heading does NOT appear in the TOC (maxLevel: 2).' },
            { type: 'heading', text: 'Cost Structure', level: 2 },
            { type: 'paragraph', text: 'Operating costs remain within budgeted targets.' },
            { type: 'heading', text: 'Strategic Outlook', level: 1 },
            { type: 'heading', text: 'Growth Targets', level: 2 },
            { type: 'paragraph', text: 'Projections indicate 15% YoY growth in the next fiscal year.' },
            { type: 'heading', text: 'Market Positioning', level: 2 },
            { type: 'paragraph', text: 'Competitive analysis confirms strong positioning in key segments.' },
        ];

        const params: DocumentParams = { title: 'TOC Showcase – Level 2', blocks };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'toc', 'toc-level2.pdf'),
            'toc/toc-level2.pdf',
            buildDocumentPDFBytes(params),
        );
    }

    // ── TOC with tagged PDF/A ────────────────────────────────────
    {
        const blocks: DocumentBlock[] = [
            { type: 'toc', title: 'Table of Contents' },
            { type: 'heading', text: 'Accessibility Compliance', level: 1 },
            { type: 'paragraph', text: 'When tagged mode is enabled, the TOC is wrapped in /TOC and /TOCI structure elements for PDF/UA compliance. This enables screen readers to recognize and navigate the table of contents.' },
            { type: 'heading', text: 'Structure Tree', level: 2 },
            { type: 'paragraph', text: 'The structure tree includes: /Document → /TOC → /TOCI entries, each with /Reference to the target heading element. Tagged TOC entries include /ActualText for text extraction fidelity.' },
            { type: 'heading', text: 'Validation', level: 1 },
            { type: 'paragraph', text: 'PDF/A validators (veraPDF, PAC) confirm that tagged TOC output meets ISO 14289-1 requirements for accessible table of contents structures.' },
        ];

        const params: DocumentParams = { title: 'TOC Showcase – Tagged PDF/A', blocks, fontEntries: latinEntries };
        ctx.writeSafe(
            resolve(ctx.outputDir, 'toc', 'toc-tagged.pdf'),
            'toc/toc-tagged.pdf',
            buildDocumentPDFBytes(params, { tagged: true }),
        );
    }
}
