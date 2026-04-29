/**
 * PDF/A Latin embedding showcase (v1.1.0 — issue #28).
 *
 * Demonstrates that PDF/A documents containing non-WinAnsi Latin
 * characters (curly quotes, em-dash, ellipsis, accented letters,
 * Polish/Vietnamese/Turkish extended Latin, the Euro sign, …) embed
 * Noto Sans VF instead of relying on the standard 14 non-embedded fonts.
 * This produces a fully PDF/A-conforming output that veraPDF accepts
 * without "non-embedded font" violations.
 *
 * Output: test-output/pdfa-latin/*.pdf
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import { loadSelectedFontEntries } from '../helpers/fonts.js';

type PdfAMode = 'pdfa1b' | 'pdfa2b' | 'pdfa2u' | 'pdfa3b';

const VARIANTS: { mode: PdfAMode; label: string; filename: string }[] = [
    { mode: 'pdfa1b', label: 'PDF/A-1b', filename: 'pdfa-latin-pdfa1b.pdf' },
    { mode: 'pdfa2b', label: 'PDF/A-2b', filename: 'pdfa-latin-pdfa2b.pdf' },
    { mode: 'pdfa2u', label: 'PDF/A-2u', filename: 'pdfa-latin-pdfa2u.pdf' },
    { mode: 'pdfa3b', label: 'PDF/A-3b', filename: 'pdfa-latin-pdfa3b.pdf' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    const fontEntries = await loadSelectedFontEntries(['latin']);
    if (fontEntries.length !== 1) return;

    for (const v of VARIANTS) {
        const params: DocumentParams = {
            title: `PDF/A Latin embedding — ${v.label}`,
            metadata: {
                author: 'pdfnative',
                subject: 'Demonstrates Noto Sans VF embedding for non-WinAnsi Latin under PDF/A',
                keywords: 'pdfa, latin, noto-sans, embedding, iso-19005',
            },
            blocks: [
                { type: 'heading', level: 1, text: `${v.label} with embedded Latin font` },
                { type: 'paragraph', text: 'pdfnative v1.1.0 bundles Noto Sans VF (OFL-1.1) as an opt-in Latin fallback. When PDF/A is requested and the document contains characters outside WinAnsi, the encoding context routes those runs to the embedded font.' },

                { type: 'heading', level: 2, text: 'Typographic punctuation' },
                { type: 'paragraph', text: 'Curly quotes: "double" and \u2018single\u2019. Em-dash: word\u2014word. En-dash: 2024\u20132026. Ellipsis: wait\u2026 done. Bullet: \u2022 item.' },

                { type: 'heading', level: 2, text: 'Accented Latin (Western European)' },
                { type: 'paragraph', text: 'Caf\u00e9, r\u00e9sum\u00e9, na\u00efve, fa\u00e7ade, jal\u00fc, \u00fcber, M\u00e4dchen, fianc\u00e9e, \u00f1ame, p\u00f1ata, \u00e7a va.' },

                { type: 'heading', level: 2, text: 'Currency and symbols' },
                { type: 'paragraph', text: 'Euro \u20ac1\u202f000.00 \u2014 Pound \u00a312.50 \u2014 Yen \u00a51\u202f200 \u2014 Copyright \u00a9 2026 \u2014 Trade mark \u2122 \u2014 Registered \u00ae \u2014 Section \u00a7 \u2014 Paragraph \u00b6 \u2014 Degrees 25\u00b0C \u2014 Plus-or-minus \u00b13.5.' },

                { type: 'heading', level: 2, text: 'Polish, Vietnamese, Turkish (extended Latin)' },
                { type: 'paragraph', text: 'Polish: za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144 \u2014 Vietnamese: ti\u1ebfng Vi\u1ec7t r\u1ea5t \u0111\u1eb9p \u2014 Turkish: \u0130stanbul, \u00d6\u011fretmen, kalp\u0131m\u0131z\u0131.' },

                { type: 'heading', level: 2, text: 'Mathematical letters and basic operators' },
                { type: 'paragraph', text: 'Number sets: \u2102 \u2115 \u2124 \u211d. Basic operators: \u00d7 \u00f7 \u00b1. Greek (math context): \u03b1 \u03b2 \u03b3 \u03c0 \u03c3 \u03a9.' },
                { type: 'paragraph', text: 'Note: Noto Sans VF does not cover the U+2200\u2013U+22FF math operator block (intersection, union, element-of, less-or-equal, infinity, square-root, sigma, pi, etc.). For mathematical typesetting under PDF/A, register Noto Sans Math as an additional font \u2014 deferred to a future release.' },
            ],
            footerText: `pdfnative v1.1.0 \u2014 ${v.label} with embedded Noto Sans VF`,
            fontEntries,
        };

        ctx.writeSafe(
            resolve(ctx.outputDir, 'pdfa-latin', v.filename),
            `pdfa-latin/${v.filename}`,
            buildDocumentPDFBytes(params, { tagged: v.mode }),
        );
    }
}
