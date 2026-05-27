/**
 * UAX #9 explicit-embedding showcase (v1.2.0).
 *
 * Demonstrates LRE/RLE/LRO/RLO/PDF normalization producing the same
 * visual results as their isolate equivalents.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

const LRE = '\u202A', RLE = '\u202B', PDF = '\u202C', LRO = '\u202D', RLO = '\u202E';

async function buildDoc(): Promise<DocumentParams> {
    const fontEntries = await loadSelectedFontEntries(['he']);
    return {
        title: 'UAX #9 Embeddings Showcase',
        fontEntries,
        blocks: [
            { type: 'heading', text: 'pdfnative v1.2 — UAX #9 Embeddings', level: 1 },
            {
                type: 'paragraph',
                text:
                    'The legacy explicit bidirectional formatting characters '
                    + '(LRE U+202A, RLE U+202B, LRO U+202D, RLO U+202E, PDF U+202C) are now '
                    + 'supported via sealed-isolate normalization. normalizeBidiEmbeddings() '
                    + 'rewrites them as their isolate equivalents (LRI/RLI/PDI) before the '
                    + 'BiDi resolver runs, so downstream rendering sees the same visual order '
                    + 'as documents authored with modern Unicode controls.',
            },

            { type: 'heading', text: 'LRE — Left-to-Right Embedding', level: 2 },
            { type: 'paragraph', text: `English text ${LRE}שלום עולם${PDF} continues in English.` },

            { type: 'heading', text: 'RLE — Right-to-Left Embedding', level: 2 },
            { type: 'paragraph', text: `שלום ${RLE}English text${PDF} עולם` },

            { type: 'heading', text: 'LRO — Left-to-Right Override (normalized to LRI)', level: 2 },
            { type: 'paragraph', text: `English ${LRO}שלום${PDF} continues.` },

            { type: 'heading', text: 'RLO — Right-to-Left Override (normalized to RLI)', level: 2 },
            { type: 'paragraph', text: `שלום ${RLO}עולם${PDF} continues.` },

            { type: 'heading', text: 'Nested embeddings', level: 2 },
            { type: 'paragraph', text: `outer ${LRE}inner ${RLE}שלום${PDF} back to L${PDF} done` },

            { type: 'heading', text: 'Orphan PDF (silently dropped)', level: 2 },
            { type: 'paragraph', text: `text ${PDF}with orphan PDF marker` },
        ],
    };
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const doc = await buildDoc();
    const bytes = buildDocumentPDFBytes(doc);
    ctx.writeSafe(
        resolve(ctx.outputDir, 'bidi', 'bidi-embeddings-showcase.pdf'),
        'bidi/bidi-embeddings-showcase.pdf',
        bytes,
    );
}
