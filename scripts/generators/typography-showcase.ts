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
    const hyphenated =
        `Les colonnes étroites sont le cas où la césure compte vraiment : un mot comme `
        + `anti${SHY}consti${SHY}tution${SHY}nelle${SHY}ment déborde sans point de coupure, `
        + `et se coupe proprement avec. Le tiret conditionnel reste invisible partout où la `
        + `coupure n’est pas prise.`;

    const textDoc: DocumentParams = {
        title: 'Text Typography',
        fontEntries: textLatin,
        blocks: [
            { type: 'heading', text: 'Césure douce et espaces insécables', level: 1 },
            { type: 'paragraph', text: hyphenated, indent: 300 },
            { type: 'heading', text: 'Liaison nombre-unité (ISO 80000-1)', level: 2 },
            { type: 'paragraph', text: 'Facture de 150 € pour 12 kg de matériel, remise de 30 %, stockage 500 Mo, température 21 °C. Aucune de ces paires ne doit se couper en fin de ligne, quelle que soit la langue.' },
            { type: 'heading', text: 'Convention de ponctuation', level: 2 },
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
        '« La justification remplit la mesure, ce qui distingue une page composée '
        + 'd’une page simplement générée. » Le débordement optique va plus loin : '
        + 'la ponctuation qui borde une ligne déborde légèrement, de sorte que le bord '
        + 'optique de la colonne paraisse droit. « Un guillemet ouvrant », un point '
        + 'final, une virgule : chacun laisse un blanc qui se voit. ';

    const alignDoc = (align: 'left' | 'justify'): DocumentParams => ({
        title: align === 'justify' ? 'Justification' : 'Alignement au fer à gauche',
        blocks: [
            { type: 'heading', text: align === 'justify' ? 'Texte justifié' : 'Texte au fer à gauche', level: 1 },
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
    // small French rule — break before a consonant that starts a new
    // syllable — installed for this sample only and removed after it.
    const FR_VOWELS = 'aeiouyàâäéèêëîïôöùûüœ';
    const FR_CONSONANTS = 'bcdfghjklmnpqrstvwxz';
    const frSyllables = (word: string, lang?: string): number[] => {
        if (lang !== 'fr') return [];
        const out: number[] = [];
        const w = word.toLowerCase();
        for (let i = 2; i < w.length - 2; i++) {
            if (FR_VOWELS.includes(w[i - 1]) && FR_CONSONANTS.includes(w[i]) && FR_VOWELS.includes(w[i + 1])) out.push(i);
        }
        return out;
    };
    const hyphenDoc: DocumentParams = {
        title: 'Hyphenation Provider',
        fontEntries: textLatin,
        blocks: [
            { type: 'heading', text: 'Césure automatique par fournisseur', level: 1 },
            { type: 'paragraph', text: 'Sans dictionnaire embarqué, la bibliothèque délègue la césure : le fournisseur reçoit chaque mot et la langue du document, et renvoie les positions de coupure. Dans cette colonne étroite, les mots anticonstitutionnellement, internationalisation et incompréhensiblement se coupent à la syllabe au lieu de déborder ou de laisser un trou.', indent: 320, align: 'justify' },
        ],
        footerText: 'pdfnative – typography showcase',
    };
    setHyphenationProvider(frSyllables);
    try {
        ctx.writeSafe(
            resolve(ctx.outputDir, 'typography', 'hyphenation-provider.pdf'),
            'typography/hyphenation-provider.pdf',
            buildDocumentPDFBytes(hyphenDoc, { typography: { hyphenationLanguage: 'fr' } }),
        );
    } finally {
        setHyphenationProvider(null);
    }

    // ── Base-14 metrics ─────────────────────────────────────────
    // The estimate buckets every accented letter and most punctuation at 556
    // units. Right-aligned French therefore misses its margin and lines wrap
    // in the wrong places. The exact AFM tables fix both.
    const metricsDoc: DocumentParams = {
        title: 'Métriques base-14',
        blocks: [
            { type: 'heading', text: 'Estimation contre tables AFM', level: 1 },
            { type: 'paragraph', text: 'Élégance, ÉTÉ, Ünterstützung, œuvre, 100 % — chacun de ces mots contient des caractères que l’estimation historique mesure à 556 unités alors qu’ils valent 667, 722, 944 ou 889. Le texte aligné à droite manque alors sa marge.' },
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'right' },
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'center' },
            {
                type: 'table',
                headers: ['Caractère', 'Estimation', 'AFM'],
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
        ['Janvier', `1${NNBSP}111,00`, `8${NNBSP}888,00`],
        ['Février', `11${NNBSP}111,00`, `88${NNBSP}888,00`],
        ['Mars', `111${NNBSP}111,00`, `888${NNBSP}888,00`],
    ];

    const featureDoc: DocumentParams = {
        title: 'Fonctionnalités OpenType',
        fontEntries: featureLatin,
        blocks: [
            { type: 'heading', text: 'Substitutions déclaratives', level: 1 },
            { type: 'paragraph', text: 'Noto Sans déclare tnum, pnum, lnum, onum, zero, smcp, c2sc, case, sups et subs. Chacune remplace un glyphe par un autre, sans moteur de composition, ce qui les rend sûres à appliquer sur du texte latin ordinaire. Ses chiffres sont tabulaires et alignés par défaut : tnum et lnum n’y changent rien, pnum et onum si.' },
            { type: 'paragraph', text: 'Chiffres 1234567890 — comparez la largeur des colonnes ci-dessous entre les deux fichiers.' },
            {
                type: 'table',
                headers: ['Mois', 'Débit', 'Crédit'],
                rows: amounts.map(cells => ({ cells, type: '', pointed: false })),
                columns: [{ f: 0.34, a: 'l', mx: 20, mxH: 20 }, { f: 0.33, a: 'r', mx: 20, mxH: 20 }, { f: 0.33, a: 'r', mx: 20, mxH: 20 }],
            },
            { type: 'paragraph', text: 'Petites capitales : abcdefghijklmnop' },
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
        title: 'Crénage',
        fontEntries: featureLatin,
        blocks: [
            { type: 'heading', text: 'AVATAR Yo To Wave', level: 1 },
            { type: 'heading', text: 'AWAY Toyota Vyborg Wavy', level: 2 },
            { type: 'paragraph', text: 'AVATAR To Yo Wave AWAY Toyota Vyborg Wavy LTAVA. ' .repeat(12) },
            { type: 'paragraph', text: 'Le crénage rapproche les paires que le dessin des lettres laisse trop ouvertes. Les titres ci-dessus sont le cas le plus visible ; en texte courant l’effet est cumulatif sur la longueur de ligne.' },
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
