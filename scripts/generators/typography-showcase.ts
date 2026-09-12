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

    // ── Text-level typography ────────────────────────────────────
    // Soft hyphens in a narrow column, universal unit binding, and a
    // locale convention supplied as a preset.
    const SHY = '­';
    const hyphenated =
        `Les colonnes etroites sont le cas ou la cesure compte vraiment : un mot comme `
        + `anti${SHY}consti${SHY}tution${SHY}nelle${SHY}ment deborde sans point de coupure, `
        + `et se coupe proprement avec. Le tiret conditionnel reste invisible partout ou la `
        + `coupure n'est pas prise.`;

    const textDoc: DocumentParams = {
        title: 'Text Typography',
        blocks: [
            { type: 'heading', text: 'Cesure douce et espaces insecables', level: 1 },
            { type: 'paragraph', text: hyphenated, indent: 300 },
            { type: 'heading', text: 'Liaison nombre-unite (ISO 80000-1)', level: 2 },
            { type: 'paragraph', text: 'Facture de 150 € pour 12 kg de materiel, remise de 30 %, stockage 500 Mo, temperature 21 °C. Aucune de ces paires ne doit se couper en fin de ligne, quelle que soit la langue.' },
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
    // with punctuation hanging past the measure.
    const QUOTED =
        '« La justification remplit la mesure, ce qui distingue une page composee '
        + 'd\'une page simplement generee. » Le debordement optique va plus loin : '
        + 'la ponctuation qui borde une ligne deborde legerement, de sorte que le bord '
        + 'optique de la colonne paraisse droit. "Une guillemet ouvrante", un point '
        + 'final, une virgule : chacun laisse un blanc qui se voit. ';

    const alignDoc = (align: 'left' | 'justify'): DocumentParams => ({
        title: align === 'justify' ? 'Justification' : 'Alignement au fer a gauche',
        blocks: [
            { type: 'heading', text: align === 'justify' ? 'Texte justifie' : 'Texte au fer a gauche', level: 1 },
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
            typography: { opticalMargins: true, punctuationSpacing: 'fr', unitBinding: true },
        }),
    );

    // ── Base-14 metrics ─────────────────────────────────────────
    // The estimate buckets every accented letter and most punctuation at 556
    // units. Right-aligned French therefore misses its margin and lines wrap
    // in the wrong places. The exact AFM tables fix both.
    const metricsDoc: DocumentParams = {
        title: 'Metriques base-14',
        blocks: [
            { type: 'heading', text: 'Estimation contre tables AFM', level: 1 },
            { type: 'paragraph', text: 'Élégance, ÉTÉ, Ünterstützung, œuvre, 100 % — chacun de ces mots contient des caracteres que l\'estimation historique mesure a 556 unites alors qu\'ils valent 667, 722, 944 ou 889. Le texte aligne a droite manque alors sa marge.' },
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'right' },
            { type: 'paragraph', text: 'Élégance ÉTÉ Ünterstützung œuvre 100 % @ & ( )', align: 'center' },
            {
                type: 'table',
                headers: ['Caractere', 'Estimation', 'AFM'],
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
    const amounts = [
        ['Janvier', '1 111,00', '8 888,00'],
        ['Fevrier', '11 111,00', '88 888,00'],
        ['Mars', '111 111,00', '888 888,00'],
    ];

    const featureDoc: DocumentParams = {
        title: 'Fonctionnalites OpenType',
        fontEntries: featureLatin,
        blocks: [
            { type: 'heading', text: 'Substitutions declaratives', level: 1 },
            { type: 'paragraph', text: 'Noto Sans declare tnum, pnum, lnum, onum, zero, smcp, c2sc, case, sups et subs. Chacune remplace un glyphe par un autre, sans moteur de composition, ce qui les rend sures a appliquer sur du texte latin ordinaire.' },
            { type: 'paragraph', text: 'Chiffres 1234567890 — comparez la largeur des colonnes ci-dessous entre les deux fichiers.' },
            {
                type: 'table',
                headers: ['Mois', 'Debit', 'Credit'],
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
