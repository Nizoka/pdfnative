/**
 * Typographic page-breaking showcase (v1.8.0) — paragraph splitting,
 * widows/orphans and keep-with-next.
 *
 * Each PDF pairs the historical atomic behaviour with the opt-in typographic
 * one on identical content, so the difference is visible side by side when
 * the files are opened next to each other.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes, setHyphenationProvider } from '../../src/index.js';
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
    // Each paragraph is a little over half a page, so the second one cannot
    // fit under the first: atomically it moves over whole and leaves the
    // foot of the page blank, split it continues where the page ends. (Two
    // shorter paragraphs per page would give the splitter nothing to do and
    // the pair would come out byte-identical.)
    const flowing: DocumentParams = {
        title: 'Paragraph Breaking',
        blocks: [
            { type: 'heading', text: 'Breaking paragraphs across pages', level: 1 },
            body(9),
            body(9),
            body(9),
            body(9),
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

    // ── Text-level typography ────────────────────────────────────
    // Soft hyphens in a narrow column, universal unit binding, and a
    // locale convention supplied as a preset. Set in Noto Sans: the French
    // preset inserts a narrow no-break space (U+202F), which WinAnsi cannot
    // encode — on the base-14 path it degrades to an ordinary space and
    // the pair would differ by a handful of bytes only.
    const SHY = '­';
    const textLatin = await loadFontEntries('latin', '/F3');
    // A 28-letter English word with author-written soft hyphens at its
    // syllables: the classic narrow-column case.
    const hyphenated =
        `Narrow columns are where hyphenation matters: a long word such as `
        + `anti${SHY}dis${SHY}establish${SHY}ment${SHY}arian${SHY}ism overflows without a break opportunity `
        + `and breaks cleanly with one. A soft hyphen stays invisible wherever the break is not taken.`;

    const textDoc: DocumentParams = {
        title: 'Text Typography',
        fontEntries: textLatin,
        blocks: [
            { type: 'heading', text: 'Soft hyphens and no-break spaces', level: 1 },
            { type: 'paragraph', text: hyphenated, indent: 300 },
            { type: 'heading', text: 'Number–unit binding (ISO 80000-1)', level: 2 },
            { type: 'paragraph', text: 'An invoice of 150 € for 12 kg of material, a 30 % discount, 500 MB of storage, 21 °C. None of these pairs may break at the end of a line, whatever the language.' },
            { type: 'heading', text: 'Punctuation spacing: the French convention', level: 2 },
            { type: 'paragraph', text: 'French sets a narrow no-break space before ; ! ? and a no-break space before : and inside guillemets. The sample sentence below is French for that reason:' },
            // demo-language: fr (punctuationSpacing 'fr' is a French convention)
            { type: 'paragraph', text: 'Vraiment ? Oui ! Total : 42. Et une « citation » pour finir.' },
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'text-plain.pdf'),
        'typography/text-plain.pdf',
        buildDocumentPDFBytes(textDoc),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'text-refined.pdf'),
        'typography/text-refined.pdf',
        buildDocumentPDFBytes(textDoc, {
            typography: { unitBinding: true, punctuationSpacing: 'fr' },
        }),
    );

    // ── Justification and optical margins ───────────────────────
    // Three variants of one page: ragged right, justified, and justified
    // with punctuation hanging past the measure. The third differs from the
    // second by opticalMargins alone, so the pair isolates that option.
    const QUOTED =
        '“Justification fills the measure, which is what separates a typeset page '
        + 'from a merely generated one.” Optical alignment goes one step further: '
        + 'the punctuation that borders a line hangs slightly past it, so that the '
        + 'optical edge of the column reads straight. “An opening quote,” a full stop, '
        + 'a comma; each leaves a gap that shows. ';

    const alignDoc = (align: 'left' | 'justify'): DocumentParams => ({
        title: align === 'justify' ? 'Justification' : 'Ragged-right alignment',
        blocks: [
            { type: 'heading', text: align === 'justify' ? 'Justified text' : 'Ragged-right text', level: 1 },
            { type: 'paragraph', text: QUOTED.repeat(4), align },
            { type: 'paragraph', text: QUOTED.repeat(4), align },
        ],
        footerText: 'pdfnative – typography showcase',
    });

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'align-ragged.pdf'),
        'typography/align-ragged.pdf',
        buildDocumentPDFBytes(alignDoc('left')),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'align-justified.pdf'),
        'typography/align-justified.pdf',
        buildDocumentPDFBytes(alignDoc('justify')),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'align-optical.pdf'),
        'typography/align-optical.pdf',
        buildDocumentPDFBytes(alignDoc('justify'), {
            typography: { opticalMargins: true },
        }),
    );

    // ── Hyphenation provider ─────────────────────────────────────
    // The library ships no dictionary; a provider supplies break positions
    // and receives the document's language. This one is a deliberately
    // small English rule — break before a consonant that starts a new
    // syllable — installed for this sample only and removed after it. A
    // real provider would use Liang patterns for the language it is given.
    const EN_VOWELS = 'aeiouy';
    const EN_CONSONANTS = 'bcdfghjklmnpqrstvwxz';
    const enSyllables = (word: string, lang?: string): number[] => {
        if (lang !== 'en') return [];
        const out: number[] = [];
        const w = word.toLowerCase();
        for (let i = 2; i < w.length - 2; i++) {
            if (EN_VOWELS.includes(w[i - 1]) && EN_CONSONANTS.includes(w[i]) && EN_VOWELS.includes(w[i + 1])) out.push(i);
        }
        return out;
    };
    const hyphenDoc: DocumentParams = {
        title: 'Hyphenation Provider',
        fontEntries: textLatin,
        blocks: [
            { type: 'heading', text: 'Automatic hyphenation through a provider', level: 1 },
            { type: 'paragraph', text: 'The library ships no dictionary: a provider receives every word and the document language, and returns the break positions. This sample installs a small English syllable rule and sets hyphenationLanguage to en, so the narrow paragraph below breaks at syllables instead of overflowing or leaving gaps.' },
            { type: 'paragraph', text: 'In this narrow column the words antidisestablishmentarianism, internationalization, incomprehensibilities and counterrevolutionaries break at a syllable instead of overflowing or leaving a gap, because the provider knows the language of the document.', indent: 320, align: 'justify' },
        ],
        footerText: 'pdfnative – typography showcase',
    };
    setHyphenationProvider(enSyllables);
    try {
        ctx.writeSafe(
            resolve(ctx.outputDir, 'typography', 'hyphenation-provider.pdf'),
            'typography/hyphenation-provider.pdf',
            buildDocumentPDFBytes(hyphenDoc, { typography: { hyphenationLanguage: 'en' } }),
        );
    } finally {
        setHyphenationProvider(null);
    }

    // ── Base-14 metrics ─────────────────────────────────────────
    // The estimate buckets every accented letter and most punctuation at 556
    // units. Right-aligned French therefore misses its margin and lines wrap
    // in the wrong places. The exact AFM tables fix both.
    const metricsDoc: DocumentParams = {
        title: 'Base-14 metrics',
        blocks: [
            { type: 'heading', text: 'Estimate versus AFM tables', level: 1 },
            { type: 'paragraph', text: 'Élégance, ÉTÉ, Ünterstützung, œuvre, 100 % — each of these words contains characters the historical estimate measures at 556 units when they are 667, 722, 944 or 889 wide. Right-aligned text then misses its margin.' },
            // demo-language: fr (accented words whose advances the estimate gets wrong)
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'right' },
            // demo-language: fr (same line, centred)
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'center' },
            {
                type: 'table',
                headers: ['Character', 'Estimate', 'AFM'],
                rows: [
                    { cells: ['@', '556', '1015'], type: '', pointed: false },
                    { cells: ['%', '556', '889'], type: '', pointed: false },
                    { cells: ['É', '556', '667'], type: '', pointed: false },
                    { cells: ['œ', '556', '944'], type: '', pointed: false },
                    { cells: ['(', '556', '333'], type: '', pointed: false },
                ],
            },
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'metrics-approximate.pdf'),
        'typography/metrics-approximate.pdf',
        buildDocumentPDFBytes(metricsDoc),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'metrics-exact.pdf'),
        'typography/metrics-exact.pdf',
        buildDocumentPDFBytes(metricsDoc, { typography: { metrics: 'exact' } }),
    );

    // ── OpenType features ────────────────────────────────────────
    // Single substitutions the font itself declares. Needs a registered
    // font: the base-14 faces carry no OpenType tables at all.
    const featureLatin = await loadFontEntries('latin', '/F3');
    // Thousands are grouped with a narrow no-break space, as ISO 80000-1
    // §7.3.1 asks, so an amount can never break across a line.
    const NNBSP = ' ';
    const amounts = [
        ['January', `1${NNBSP}111.00`, `8${NNBSP}888.00`],
        ['February', `11${NNBSP}111.00`, `88${NNBSP}888.00`],
        ['March', `111${NNBSP}111.00`, `888${NNBSP}888.00`],
    ];

    const featureDoc: DocumentParams = {
        title: 'OpenType features',
        fontEntries: featureLatin,
        blocks: [
            { type: 'heading', text: 'Declarative substitutions', level: 1 },
            { type: 'paragraph', text: 'Noto Sans declares tnum, pnum, lnum, onum, zero, smcp, c2sc, case, sups and subs. Each replaces one glyph with another, without a shaping engine, which makes them safe to apply to ordinary Latin text. Its figures are tabular and lining by default: tnum and lnum change nothing, pnum and onum do.' },
            { type: 'paragraph', text: 'Figures 1234567890 — compare the column widths below between the two files.' },
            {
                type: 'table',
                headers: ['Month', 'Debit', 'Credit'],
                rows: amounts.map(cells => ({ cells, type: '', pointed: false })),
                columns: [{ f: 0.34, a: 'l', mx: 20, mxH: 20 }, { f: 0.33, a: 'r', mx: 20, mxH: 20 }, { f: 0.33, a: 'r', mx: 20, mxH: 20 }],
            },
            { type: 'paragraph', text: 'Small capitals: abcdefghijklmnop' },
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'features-default.pdf'),
        'typography/features-default.pdf',
        buildDocumentPDFBytes(featureDoc),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'features-proportional.pdf'),
        'typography/features-proportional.pdf',
        buildDocumentPDFBytes(featureDoc, { typography: { fontFeatures: ['pnum'] } }),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'features-oldstyle-smallcaps.pdf'),
        'typography/features-oldstyle-smallcaps.pdf',
        buildDocumentPDFBytes(featureDoc, { typography: { fontFeatures: ['onum', 'smcp'] } }),
    );

    // ── Pair kerning ─────────────────────────────────────────────
    // The pairs everyone checks: AV, To, Yo, Wa. Without kerning they are
    // set with their nominal advances, which reads loose at any size and
    // obvious at display sizes.
    const kernDoc: DocumentParams = {
        title: 'Kerning',
        fontEntries: featureLatin,
        blocks: [
            { type: 'heading', text: 'AVATAR Yo To Wave', level: 1 },
            { type: 'heading', text: 'AWAY Toyota Vyborg Wavy', level: 2 },
            { type: 'paragraph', text: 'AVATAR To Yo Wave AWAY Toyota Vyborg Wavy LTAVA. ' .repeat(12) },
            { type: 'paragraph', text: 'Kerning closes the pairs that the letter shapes leave too open. The headings above are the most visible case; in running text the effect accumulates along the line.' },
        ],
        footerText: 'pdfnative – typography showcase',
    };

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'kerning-off.pdf'),
        'typography/kerning-off.pdf',
        buildDocumentPDFBytes(kernDoc),
    );

    ctx.writeSafe(
        resolve(ctx.outputDir, 'typography', 'kerning-on.pdf'),
        'typography/kerning-on.pdf',
        buildDocumentPDFBytes(kernDoc, { typography: { kerning: true } }),
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
