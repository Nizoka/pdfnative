/**
 * Typographic page-breaking showcase (v1.8.0) — paragraph splitting,
 * widows/orphans and keep-with-next.
 *
 * Each PDF pairs the historical atomic behaviour with the opt-in typographic
 * one on identical content, so the difference is visible side by side when
 * the files are opened next to each other.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadFontEntries } from '../helpers/fonts.js';

const BODY =
    'Long-form reports are where page breaking stops being cosmetic. A paragraph that '
    + 'cannot fit in the space left at the foot of a page used to move over whole, leaving '
    + 'a band of white space behind it, and a paragraph taller than a full page simply ran '
    + 'off the bottom with its remaining lines lost. Breaking at line boundaries fixes both, '
    + 'and the widow and orphan rules keep the breaks from falling somewhere embarrassing. ';

function body(repeats: number): DocumentBlock {
    return { type: 'paragraph', text: BODY.repeat(repeats) };
}

function sections(count: number): DocumentBlock[] {
    const out: DocumentBlock[] = [];
    for (let i = 1; i <= count; i++) {
        out.push({ type: 'heading', text: `${i}. Section ${i}`, level: 2 });
        out.push(body(2));
    }
    return out;
}

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── Atomic vs split, same content ────────────────────────────
    const flowing: DocumentParams = {
        title: 'Paragraph Breaking',
        blocks: [
            { type: 'heading', text: 'Breaking paragraphs across pages', level: 1 },
            body(6),
            body(6),
            body(6),
            body(6),
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'breaks-atomic.pdf'),
        'typography/breaks-atomic.pdf',
        buildDocumentPDFBytes(flowing),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'breaks-split.pdf'),
        'typography/breaks-split.pdf',
        buildDocumentPDFBytes(flowing, {
            typography: { splitParagraphs: true, orphans: 2, widows: 2 },
        }),
    );

    // ── A paragraph taller than a whole page ─────────────────────
    // Atomically its tail is drawn past the bottom margin and lost: the file
    // comes out at two pages where the text needs three. Split, it simply
    // continues onto the next page and nothing disappears.
    const oversized: DocumentParams = {
        title: 'Oversized Paragraph',
        blocks: [
            { type: 'heading', text: 'One paragraph, longer than a page', level: 1 },
            body(40),
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'oversized-atomic.pdf'),
        'typography/oversized-atomic.pdf',
        buildDocumentPDFBytes(oversized),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'oversized-split.pdf'),
        'typography/oversized-split.pdf',
        buildDocumentPDFBytes(oversized, { typography: { splitParagraphs: true } }),
    );

    // ── Keep headings with the text they introduce ───────────────
    const keep: DocumentParams = {
        title: 'Keep With Next',
        blocks: [
            { type: 'heading', text: 'Headings that never end up stranded', level: 1 },
            ...sections(12),
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'keep-with-next-off.pdf'),
        'typography/keep-with-next-off.pdf',
        buildDocumentPDFBytes(keep),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'keep-with-next-on.pdf'),
        'typography/keep-with-next-on.pdf',
        buildDocumentPDFBytes(keep, {
            typography: { splitParagraphs: true, keepHeadingsWithNext: true },
        }),
    );

    // ── Tagged: a split paragraph stays one /P element ───────────
    // PDF/A-2b, so veraPDF checks that splitting a paragraph across pages
    // leaves the structure tree conformant. Needs an embedded Latin font like
    // every other PDF/A-claiming sample (ISO 19005 §6.2.11.4.1).
    const latinEntries = await loadFontEntries('latin', '/F3');
    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'breaks-split-tagged.pdf'),
        'typography/breaks-split-tagged.pdf',
        buildDocumentPDFBytes(
            { ...flowing, title: 'Paragraph Breaking – Tagged', fontEntries: latinEntries },
            { tagged: 'pdfa2b', typography: { splitParagraphs: true } },
        ),
    );
}
