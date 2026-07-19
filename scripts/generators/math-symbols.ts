/**
 * Math / technical symbols showcase (v1.5.0 — issue #57).
 *
 * Demonstrates the bundled Noto Sans Math font (lang `'math'`): load it with
 * `loadFontData('math')`, add it to `fontEntries`, and coverage-based
 * run splitting routes every math codepoint to it — no manual run splitting.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, containsMath } from '../../src/index.js';
import type { DocumentParams, FontEntry } from '../../src/index.js';
import { loadFontData } from '../helpers/fonts.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    const lines = [
        'Set theory: A ∪ B, A ∩ B, x ∈ S, ∅ ⊆ A, A ⊂ B',
        'Logic: ∀x ∃y (P → Q), ¬P ∨ Q, P ∧ Q, ⊤ ⊢ ⊥',
        'Relations: a ≤ b ≠ c ≥ d, x ≈ y, p ≡ q, m ∝ n',
        'Operators: ∑ ∏ ∫ ∮ √ ∂ ∇ ∞ ± ∓ ⊕ ⊗',
        'Arrows: → ← ↔ ⇒ ⇐ ⇔ ↦ ↑ ↓ ⇄',
    ];

    const latinFont = await loadFontData('latin');
    const mathFont = await loadFontData('math');
    if (!latinFont || !mathFont) return;
    const fontEntries: FontEntry[] = [
        { fontData: latinFont, fontRef: '/F3', lang: 'latin' },
        { fontData: mathFont, fontRef: '/F4', lang: 'math' },
    ];

    const params: DocumentParams = {
        title: 'Math & technical symbols (v1.5.0)',
        blocks: [
            { type: 'heading', text: 'Mathematical & technical symbols', level: 1 },
            {
                type: 'paragraph',
                text: 'Math codepoints route to the bundled Noto Sans Math font (loaded via loadFontData(\'math\')) through coverage-based run splitting — no manual run splitting.',
            },
            ...lines.map((text) => ({ type: 'paragraph' as const, text })),
            { type: 'heading', text: 'Detection', level: 2 },
            {
                type: 'paragraph',
                text: `containsMath('x ≠ y') → ${containsMath('x ≠ y')}; containsMath('hello') → ${containsMath('hello')}.`,
            },
        ],
        fontEntries,
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'math', 'math-symbols.pdf'),
        'math/math-symbols.pdf',
        buildDocumentPDFBytes(params),
    );
}
