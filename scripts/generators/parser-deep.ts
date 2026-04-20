/**
 * Parser deep-dive — tokenizer, xref table/stream, /Prev chain, stream decode.
 */

import { resolve } from 'path';
import {
    buildPDFBytes, buildDocumentPDFBytes,
    openPdf, createModifier,
} from '../../src/index.js';
import type { DocumentParams, PdfValue } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── 1. Tokenizer & object parser internals ──────────────────
    {
        const params: DocumentParams = {
            title: 'PDF Parser Internals – Tokenizer & Objects',
            blocks: [
                { type: 'heading', text: 'PDF Tokenizer & Object Parser', level: 1 },
                { type: 'paragraph', text: 'The pdfnative parser reads existing PDF files following ISO 32000-1 §7. It scans tokens lazily one at a time and builds a typed AST.' },

                { type: 'heading', text: 'Token Types (ISO 32000-1 §7.2)', level: 2 },
                { type: 'list', style: 'bullet', items: [
                    'Boolean: true, false',
                    'Integer: 42, -7, 0',
                    'Real: 3.14, -0.5, .25',
                    'String literal: (Hello World), (escaped \\( parens)',
                    'Hex string: <48656C6C6F>',
                    'Name: /Type, /Page, /Font',
                    'Array: [1 2 3 /Name (string)]',
                    'Dictionary: << /Key value /Key2 value2 >>',
                    'Indirect reference: 5 0 R',
                    'Stream: << /Length N >> stream...endstream',
                    'null keyword',
                ] },

                { type: 'heading', text: 'PdfValue Discriminated Union', level: 2 },
                { type: 'paragraph', text: 'Parser output uses TypeScript discriminated unions for type-safe handling: PdfRef (indirect references), PdfName (PDF names), PdfStream (dict + data), plus primitives (null, boolean, number, string) and containers (PdfDict as Map, PdfArray).' },

                { type: 'heading', text: 'PdfName vs String', level: 2 },
                { type: 'paragraph', text: 'PDF names (/Type, /Page) are distinct from string values ("Hello"). The parser returns PdfName objects ({ type: "name", value: "Type" }) for names, enabling type-safe comparisons with isName() and dictGetName().' },
            ],
            footerText: 'pdfnative – Parser Internals',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'parser-tokenizer.pdf'), 'parser/parser-tokenizer.pdf', buildDocumentPDFBytes(params));
    }

    // ── 2. Xref table/stream + /Prev chain ──────────────────────
    {
        // Generate a PDF, modify it twice to create /Prev chain
        const original = buildPDFBytes({
            title: 'Xref Chain Demo – Original',
            infoItems: [{ label: 'Version', value: '1' }],
            balanceText: 'Balance: $100.00',
            countText: '1 item',
            headers: ['Key', 'Value'],
            rows: [{ cells: ['Version', '1'], type: 'credit', pointed: false }],
            footerText: 'Original',
        }, { compress: false });

        const reader1 = openPdf(original);
        const mod1 = createModifier(reader1);
        const meta1 = new Map<string, PdfValue>();
        meta1.set('Revision', 2);
        mod1.addObject(meta1);
        const rev2 = mod1.save();

        const reader2 = openPdf(rev2);
        const mod2 = createModifier(reader2);
        const meta2 = new Map<string, PdfValue>();
        meta2.set('Revision', 3);
        mod2.addObject(meta2);
        const rev3 = mod2.save();

        const params: DocumentParams = {
            title: 'Xref Table, Streams & /Prev Chain',
            blocks: [
                { type: 'heading', text: 'Cross-Reference Tables & Streams', level: 1 },
                { type: 'paragraph', text: 'Every PDF contains a cross-reference structure mapping object numbers to byte offsets. The parser supports both traditional xref tables (§7.5.4) and compressed xref streams (§7.5.8).' },

                { type: 'heading', text: 'Traditional Xref Table', level: 2 },
                { type: 'paragraph', text: 'Format: 20 bytes per entry (10-digit offset + 5-digit generation + "n" or "f" + CRLF). The startxref pointer at file end gives the byte offset of the xref keyword.' },

                { type: 'heading', text: 'Xref Streams', level: 2 },
                { type: 'paragraph', text: 'Compressed xref streams store the same data as a FlateDecode stream object. The /W array specifies field widths: [type, offset, generation]. Type 0 = free, 1 = uncompressed, 2 = compressed in object stream.' },

                { type: 'heading', text: '/Prev Chain (Incremental Updates)', level: 2 },
                { type: 'paragraph', text: `This showcase created a PDF, then modified it twice. The final file contains 3 xref sections linked by /Prev pointers. The parser follows the chain to reconstruct the complete object table.` },
                { type: 'paragraph', text: `Original: ${original.length} bytes → Rev 2: ${rev2.length} bytes → Rev 3: ${rev3.length} bytes. Each revision appends objects + a new xref section — the original data is never modified (non-destructive save).` },

                { type: 'heading', text: 'FlateDecode Decompression', level: 2 },
                { type: 'paragraph', text: 'Streams with /Filter /FlateDecode are decompressed using a pure-JS inflate implementation (zlib/DEFLATE). On Node.js, native zlib is used for performance if initNodeCompression() was called.' },
            ],
            footerText: 'pdfnative – Xref & /Prev Chain',
        };
        ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'parser-xref-chain.pdf'), 'parser/parser-xref-chain.pdf', buildDocumentPDFBytes(params));

        // Also save the multi-revision PDF for inspection
        ctx.writeSafe(resolve(ctx.outputDir, 'parser', 'parser-3-revisions.pdf'), 'parser/parser-3-revisions.pdf', rev3);
    }
}
