/**
 * Document builder sample data — multi-block PDF documents.
 */

import { makeMinimalJPEG } from '../helpers/images.js';
import type { DocSample } from '../helpers/types.js';
export const DOC_SAMPLES: DocSample[] = [
    {
        filename: 'doc-headings-paragraphs',
        description: 'Document: headings + paragraphs',
        params: {
            title: 'Document Builder \u2013 Headings & Paragraphs',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Chapter 1: Introduction' },
                { type: 'paragraph', text: 'This document demonstrates the free-form document builder API of pdfnative. It supports headings at three levels, paragraphs with automatic text wrapping, and various other block types.' },
                { type: 'heading', level: 2 as const, text: '1.1 Purpose' },
                { type: 'paragraph', text: 'The purpose of this sample is to verify that the document builder correctly renders multi-level headings and properly wraps long paragraphs across page boundaries. Each paragraph is rendered with appropriate line spacing and font sizing.' },
                { type: 'heading', level: 2 as const, text: '1.2 Features' },
                { type: 'paragraph', text: 'Features include: automatic pagination, configurable margins, font embedding for non-Latin scripts, tagged PDF/A output, and AES encryption. The builder follows ISO 32000-1 standards for all generated output.' },
                { type: 'heading', level: 3 as const, text: '1.2.1 Text Rendering' },
                { type: 'paragraph', text: 'Text rendering uses precise glyph positioning with WinAnsi encoding for Latin text and CIDFont Type2 with Identity-H encoding for CJK and other complex scripts. Font subsetting ensures minimal file sizes.' },
                { type: 'heading', level: 1 as const, text: 'Chapter 2: Conclusion' },
                { type: 'paragraph', text: 'This concludes the headings and paragraphs demonstration. All heading levels (H1, H2, H3) and paragraph blocks have been rendered correctly with proper spacing and text wrapping.' },
            ],
            footerText: 'pdfnative \u2013 Document builder headings & paragraphs sample',
        },
    },
    {
        filename: 'doc-lists',
        description: 'Document: bullet and numbered lists',
        params: {
            title: 'Document Builder \u2013 Lists',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'List Examples' },
                { type: 'paragraph', text: 'Below are examples of bullet and numbered lists.' },
                { type: 'heading', level: 2 as const, text: 'Bullet List \u2013 Supported Features' },
                { type: 'list', style: 'bullet' as const, items: [
                    'Multi-language support (10+ scripts)',
                    'PDF/A-1b, PDF/A-2b, and PDF/A-2u conformance',
                    'AES-128 and AES-256 encryption',
                    'Tagged PDF with structure tree and marked content',
                    'JPEG and PNG image embedding',
                    'Internal and external link annotations',
                ] },
                { type: 'heading', level: 2 as const, text: 'Numbered List \u2013 Build Steps' },
                { type: 'list', style: 'numbered' as const, items: [
                    'Install pdfnative from npm',
                    'Import buildPDF or buildDocumentPDF',
                    'Prepare your data (params object)',
                    'Call the build function to get PDF string or bytes',
                    'Write to file or serve via HTTP',
                ] },
                { type: 'heading', level: 2 as const, text: 'Nested Context' },
                { type: 'paragraph', text: 'Lists can be combined with paragraphs and headings to create structured documents such as reports, manuals, and specifications.' },
            ],
            footerText: 'pdfnative \u2013 Document builder lists sample',
        },
    },
    {
        filename: 'doc-links',
        description: 'Document: external links',
        params: {
            title: 'Document Builder \u2013 Links',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Link Annotations' },
                { type: 'paragraph', text: 'The document builder supports clickable link annotations that open in the default browser.' },
                { type: 'link', url: 'https://github.com/Nizoka/pdfnative', text: 'pdfnative on GitHub' },
                { type: 'link', url: 'https://www.iso.org/standard/51502.html', text: 'ISO 32000-1:2008 (PDF 1.7)' },
                { type: 'link', url: 'mailto:test@example.com', text: 'Email: test@example.com' },
                { type: 'paragraph', text: 'Link annotations use /URI actions with scheme validation (http, https, mailto only). JavaScript and file URIs are blocked for security.' },
            ],
            footerText: 'pdfnative \u2013 Document builder links sample',
        },
    },
    {
        filename: 'doc-table',
        description: 'Document: embedded table',
        params: {
            title: 'Document Builder \u2013 Tables',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Embedded Table Example' },
                { type: 'paragraph', text: 'Tables can be embedded within document blocks, combining with headings and paragraphs.' },
                { type: 'table', headers: ['Feature', 'Phase', 'Status', 'Version'], rows: [
                    { cells: ['Core PDF generation', '1', 'Complete', 'v0.1.0'], type: 'credit', pointed: false },
                    { cells: ['Font embedding', '2', 'Complete', 'v0.2.0'], type: 'credit', pointed: false },
                    { cells: ['Tagged PDF/A', '3', 'Complete', 'v0.3.0'], type: 'credit', pointed: false },
                    { cells: ['Document builder', '4', 'Complete', 'v0.4.0'], type: 'credit', pointed: true },
                    { cells: ['Images (JPEG/PNG)', '5', 'Complete', 'v0.5.0'], type: 'credit', pointed: true },
                    { cells: ['Link annotations', '6', 'Complete', 'v0.6.0'], type: 'credit', pointed: true },
                    { cells: ['BiDi + Arabic shaping', '7', 'Complete', 'v0.7.0'], type: 'credit', pointed: true },
                    { cells: ['PDF/A-2b upgrade', '8', 'Complete', 'v0.8.0'], type: 'credit', pointed: true },
                    { cells: ['PDF Encryption', '9', 'Complete', 'v0.8.0'], type: 'credit', pointed: true },
                ] },
                { type: 'paragraph', text: 'Table above shows the complete pdfnative feature roadmap.' },
            ],
            footerText: 'pdfnative \u2013 Document builder table sample',
        },
    },
    {
        filename: 'doc-spacer-pagebreak',
        description: 'Document: spacers and page breaks',
        params: {
            title: 'Document Builder \u2013 Spacers & Page Breaks',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Page 1 Content' },
                { type: 'paragraph', text: 'This paragraph appears on page 1. After this, a spacer adds vertical space.' },
                { type: 'spacer', height: 50 },
                { type: 'paragraph', text: 'This paragraph appears after a 50pt spacer on page 1.' },
                { type: 'pageBreak' },
                { type: 'heading', level: 1 as const, text: 'Page 2 Content' },
                { type: 'paragraph', text: 'This paragraph appears on page 2 after a forced page break.' },
                { type: 'spacer', height: 100 },
                { type: 'paragraph', text: 'After another 100pt spacer.' },
                { type: 'pageBreak' },
                { type: 'heading', level: 1 as const, text: 'Page 3 Content' },
                { type: 'paragraph', text: 'Final page content after a second page break.' },
            ],
            footerText: 'pdfnative \u2013 Document builder spacer & page break sample',
        },
    },
    {
        filename: 'doc-encrypted-aes128',
        description: 'Document: encrypted with AES-128',
        params: {
            title: 'Encrypted Document \u2013 AES-128',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Encrypted Document' },
                { type: 'paragraph', text: 'This document is encrypted with AES-128 (V4/R4). It requires the owner password "docowner" to modify and the user password "docuser" to open.' },
                { type: 'list', style: 'bullet' as const, items: [
                    'Algorithm: AES-128 (AESV2)',
                    'PDF version: 1.4',
                    'Revision: 4',
                    'Permissions: print + extract text',
                ] },
            ],
            footerText: 'pdfnative \u2013 Encrypted document sample',
        },
        options: {
            encryption: {
                ownerPassword: 'docowner',
                userPassword: 'docuser',
                algorithm: 'aes128',
                permissions: { print: true, extractText: true },
            },
        },
    },
    {
        filename: 'doc-encrypted-aes256',
        description: 'Document: encrypted with AES-256',
        params: {
            title: 'Encrypted Document \u2013 AES-256',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'AES-256 Encrypted Document' },
                { type: 'paragraph', text: 'This document uses AES-256 encryption (V5/R6) with the latest PDF encryption standard. Owner password: "strongowner256".' },
                { type: 'list', style: 'numbered' as const, items: [
                    'Algorithm: AES-256 (AESV3)',
                    'PDF encryption revision: 6',
                    'Encryption key length: 256 bits',
                    'Fully compliant with ISO 32000-2',
                ] },
            ],
            footerText: 'pdfnative \u2013 AES-256 encrypted document sample',
        },
        options: {
            encryption: {
                ownerPassword: 'strongowner256',
                algorithm: 'aes256',
            },
        },
    },
    {
        filename: 'doc-image',
        description: 'Document: image embedding (JPEG)',
        params: {
            title: 'Document Builder \u2013 Image Embedding',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Image Embedding Test' },
                { type: 'paragraph', text: 'This document demonstrates JPEG image embedding via the DocumentBuilder ImageBlock. The image below is a minimal 2x2 pixel JPEG used for structural validation.' },
                { type: 'image', data: makeMinimalJPEG(), width: 100, height: 100, align: 'center' as const, alt: 'Minimal 2x2 test JPEG' },
                { type: 'paragraph', text: 'The image above was embedded using /DCTDecode filter with /Type /XObject /Subtype /Image. It is scaled from native 2x2 pixels to 100x100 points for visibility.' },
                { type: 'heading', level: 2 as const, text: 'Supported Formats' },
                { type: 'list', style: 'bullet' as const, items: [
                    'JPEG \u2013 /DCTDecode (lossy, RGB/Grayscale)',
                    'PNG \u2013 /FlateDecode with /Predictor 15 (lossless, RGB/RGBA/Gray/GrayA)',
                ] },
                { type: 'heading', level: 2 as const, text: 'Alignment Options' },
                { type: 'paragraph', text: 'Images support left, center, and right alignment via the align property. The image above is center-aligned.' },
            ],
            footerText: 'pdfnative \u2013 Document builder image embedding sample',
        },
    },
    {
        filename: 'doc-custom-colors',
        description: 'Document: color formats (hex, tuple, PDF operator)',
        params: {
            title: 'Document Builder \u2013 Color Formats',
            blocks: [
                { type: 'heading', level: 1 as const, text: 'Color Format Showcase', color: '#1E40AF' },
                { type: 'paragraph', text: 'pdfnative accepts three color formats: hex strings (#RRGGBB / #RGB), RGB tuples ([r, g, b] with 0–255), and PDF operator strings ("R G B" with 0.0–1.0). All formats are validated and normalized at the API boundary.', color: '#374151' },

                { type: 'heading', level: 2 as const, text: 'Hex Colors', color: '#059669' },
                { type: 'paragraph', text: 'This paragraph uses hex color #7C3AED (violet).', color: '#7C3AED' },
                { type: 'paragraph', text: 'This paragraph uses hex shorthand #E44 (coral red).', color: '#E44' },

                { type: 'heading', level: 2 as const, text: 'RGB Tuple Colors', color: [220, 38, 38] },
                { type: 'paragraph', text: 'This paragraph uses tuple [14, 116, 144] (teal).', color: [14, 116, 144] },
                { type: 'paragraph', text: 'This paragraph uses tuple [161, 98, 7] (amber).', color: [161, 98, 7] },

                { type: 'heading', level: 2 as const, text: 'PDF Operator Strings', color: '0.494 0.204 0.780' },
                { type: 'paragraph', text: 'This paragraph uses raw PDF RGB "0.082 0.396 0.753" (ocean blue).', color: '0.082 0.396 0.753' },

                { type: 'heading', level: 2 as const, text: 'Links with Custom Colors' },
                { type: 'link', text: 'pdfnative on GitHub (forest green)', url: 'https://github.com/Nizoka/pdfnative', color: '#166534' },

                { type: 'heading', level: 3 as const, text: 'Security' },
                { type: 'paragraph', text: 'All color inputs are parsed, validated, and normalized before interpolation into PDF content streams. Injection attempts (operators, newlines, special characters) are rejected with descriptive errors.' },
            ],
            footerText: 'pdfnative \u2013 Color format showcase sample',
        },
    },
];
