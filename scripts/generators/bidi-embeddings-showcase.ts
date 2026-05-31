/**
 * UAX #9 explicit-embedding & override showcase (v1.2.0 + v1.3.0).
 *
 * v1.2.0: LRE/RLE/PDF normalization to sealed-isolate equivalents.
 * v1.3.0: X4–X5 character-level overrides — LRO forces every code point in its
 * scope to strong L, RLO to strong R, before the W/N/L rules run.
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
            { type: 'heading', text: 'UAX #9 — Embeddings & X4–X5 Overrides', level: 1 },
            {
                type: 'paragraph',
                text:
                    'The legacy explicit bidirectional formatting characters '
                    + '(LRE U+202A, RLE U+202B, LRO U+202D, RLO U+202E, PDF U+202C) are now '
                    + 'supported. LRE/RLE are normalized to sealed isolates (v1.2.0); LRO/RLO '
                    + 'additionally apply UAX #9 rules X4–X5 (v1.3.0), forcing every code point '
                    + 'in their scope to a strong direction (L for LRO, R for RLO) before the '
                    + 'weak/neutral resolution runs.',
            },

            { type: 'heading', text: 'LRE — Left-to-Right Embedding', level: 2 },
            { type: 'paragraph', text: `English text ${LRE}שלום עולם${PDF} continues in English.` },

            { type: 'heading', text: 'RLE — Right-to-Left Embedding', level: 2 },
            { type: 'paragraph', text: `שלום ${RLE}English text${PDF} עולם` },

            { type: 'heading', text: 'LRO — Left-to-Right Override (X4: forces strong L)', level: 2 },
            { type: 'paragraph', text: `English ${LRO}שלום${PDF} continues.` },

            { type: 'heading', text: 'RLO — Right-to-Left Override (X5: forces strong R)', level: 2 },
            { type: 'paragraph', text: `שלום ${RLO}עולם${PDF} continues.` },

            { type: 'heading', text: 'RLO forces digits to lay out right-to-left', level: 2 },
            { type: 'paragraph', text: `value ${RLO}12345${PDF} end` },

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
