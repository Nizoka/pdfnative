/**
 * USE-lite cluster classification showcase (v1.2.0 public API).
 *
 * `classifyUseCategory(cp)` and `classifyClusters(cps)` expose pdfnative's
 * Universal Shaping Engine (lite) clustering authority — the same logic the
 * Devanagari / Bengali / Tamil shapers consult to drop orphan joiners, build
 * conjuncts, and reorder matras. This generator renders a human-readable
 * breakdown of a few Indic clusters so the classifier output is visible in a
 * PDF without needing to read the shaping internals.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, classifyClusters, classifyUseCategory } from '../../src/index.js';
import type { DocumentParams, DocumentBlock, UseCluster } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

/** Render a single cluster as `cat:U+XXXX` tokens grouped by slot. */
function describeCluster(c: UseCluster): string {
    const fmt = (cp: number) => `${classifyUseCategory(cp)}:U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    const slots: string[] = [];
    if (c.prebase.length) slots.push(`pre[${c.prebase.map((x) => fmt(x.cp)).join(' ')}]`);
    if (c.base) slots.push(`base[${fmt(c.base.cp)}]`);
    if (c.above.length) slots.push(`abv[${c.above.map((x) => fmt(x.cp)).join(' ')}]`);
    if (c.below.length) slots.push(`blw[${c.below.map((x) => fmt(x.cp)).join(' ')}]`);
    if (c.post.length) slots.push(`pst[${c.post.map((x) => fmt(x.cp)).join(' ')}]`);
    if (c.tail.length) slots.push(`tail[${c.tail.map((x) => fmt(x.cp)).join(' ')}]`);
    if (c.eyelash) slots.push('(eyelash-ra)');
    return slots.join('  ');
}

function row(label: string, sample: string): { label: string; sample: string; breakdown: string } {
    const cps = Array.from(sample).map((ch) => ch.codePointAt(0) as number);
    const clusters = classifyClusters(cps);
    return { label, sample, breakdown: clusters.map(describeCluster).join('   ·   ') };
}

async function buildDoc(): Promise<DocumentParams> {
    const fontEntries = await loadSelectedFontEntries(['hi', 'bn', 'ta']);

    const samples = [
        // Devanagari: क + ् + ष  → conjunct kṣa (halant tail)
        row('Devanagari conjunct क्ष', '\u0915\u094D\u0937'),
        // Devanagari: reph — र + ् + क  (ra+virama heads a reph over the next base)
        row('Devanagari reph र्क', '\u0930\u094D\u0915'),
        // Devanagari: pre-base matra ि on क  → कि (matra reorders before base)
        row('Devanagari pre-base ि कि', '\u0915\u093F'),
        // Devanagari: eyelash-ra — र + ् + ZWJ + क
        row('Marathi eyelash-ra', '\u0930\u094D\u200D\u0915'),
        // Bengali: conjunct ক + ্ + ষ → kṣa
        row('Bengali conjunct ক্ষ', '\u0995\u09CD\u09B7'),
        // Tamil: க + ெ split vowel (pre-base) + consonant
        row('Tamil pre-base ெ கெ', '\u0B95\u0BC6'),
    ];

    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'USE-lite Cluster Classification', level: 1 },
        {
            type: 'paragraph',
            text:
                'classifyUseCategory(cp) labels each code point (B base, V vowel, H halant, '
                + 'R reph, Mpre/Mabv/Mblw/Mpst matras, ZWJ/ZWNJ joiners, O other). '
                + 'classifyClusters(cps) groups a code-point run into ordered slots '
                + '(prebase · base · above · below · post · tail). The shapers consult this '
                + 'same authority to form conjuncts and reorder matras.',
        },
    ];

    for (const s of samples) {
        blocks.push({ type: 'heading', text: s.label, level: 2 });
        blocks.push({ type: 'paragraph', text: `Sample: ${s.sample}` });
        blocks.push({ type: 'paragraph', text: s.breakdown });
    }

    return { title: 'USE-lite Cluster Classification', fontEntries, blocks };
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const doc = await buildDoc();
    const bytes = buildDocumentPDFBytes(doc);
    ctx.writeSafe(
        resolve(ctx.outputDir, 'shaping', 'use-lite-clusters.pdf'),
        'shaping/use-lite-clusters.pdf',
        bytes,
    );
}
