/**
 * Math / technical symbols showcase (v1.5.0 — issue #57).
 *
 * Demonstrates automatic routing of mathematical operators, arrows, and
 * technical symbols to the bundled Noto Sans Math font (lang `'math'`) via
 * script detection. Register the font once with
 * `registerFont('math', () => import('pdfnative/fonts/noto-sans-math-data.js'))`
 * and math codepoints embed + render without any manual run splitting.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, containsMath } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const lines = [
        'Set theory: A ∪ B, A ∩ B, x ∈ S, ∅ ⊆ A, A ⊂ B',
        'Logic: ∀x ∃y (P → Q), ¬P ∨ Q, P ∧ Q, ⊤ ⊢ ⊥',
        'Relations: a ≤ b ≠ c ≥ d, x ≈ y, p ≡ q, m ∝ n',
        'Operators: ∑ ∏ ∫ ∮ √ ∂ ∇ ∞ ± ∓ ⊕ ⊗',
        'Arrows: → ← ↔ ⇒ ⇐ ⇔ ↦ ↑ ↓ ⇄',
    ];

    const params: DocumentParams = {
        title: 'Math & technical symbols (v1.5.0)',
        blocks: [
            { type: 'heading', text: 'Mathematical & technical symbols', level: 1 },
            {
                type: 'paragraph',
                text: 'Math codepoints route automatically to the bundled Noto Sans Math font via script detection — no manual font handling.',
            },
            ...lines.map((text) => ({ type: 'paragraph' as const, text })),
            { type: 'heading', text: 'Detection', level: 2 },
            {
                type: 'paragraph',
                text: `containsMath('x ≠ y') → ${containsMath('x ≠ y')}; containsMath('hello') → ${containsMath('hello')}.`,
            },
        ],
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'math', 'math-symbols.pdf'),
        'math/math-symbols.pdf',
        buildDocumentPDFBytes(params),
    );
}
