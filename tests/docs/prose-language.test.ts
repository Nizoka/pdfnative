import { describe, it, expect } from 'vitest';
import { classifyLine, findNonEnglishProse, DEMO_LANGUAGE_MARKER } from '../../scripts/lib/prose-language.js';

// v1.8.0 — the English-only prose detector shared by verify-docs and the
// regression suite. It is deliberately narrow: French is the language that
// slipped into the samples, and a false positive costs a marker while a
// false negative ships a French PDF.

describe('classifyLine', () => {
    it('flags the French headings the 1.8.0 typography samples shipped with', () => {
        for (const line of [
            "{ type: 'heading', text: 'Césure douce et espaces insécables', level: 1 },",
            "title: 'Crénage',",
            "headers: ['Mois', 'Débit', 'Crédit'],",
            "['Janvier', '1 111,00', '8 888,00'],",
            "balanceText: 'Solde au 31/12/2026 : 12 345,67 EUR',",
            'Le crénage rapproche les paires que le dessin des lettres laisse trop ouvertes.',
        ]) {
            expect(classifyLine(line), line).not.toBeNull();
        }
    });

    it('flags two distinct French function words but not one', () => {
        expect(classifyLine('la ponctuation qui borde une ligne')).not.toBeNull();
        expect(classifyLine('Sans dictionnaire, le fournisseur reçoit chaque mot')).not.toBeNull();
        expect(classifyLine('set the par value of the bond')).toBeNull();
        expect(classifyLine('EST is five hours behind UTC')).toBeNull();
        expect(classifyLine('a sur-name is not a surname')).toBeNull();
    });

    it('flags UTF-8 text decoded as Latin-1', () => {
        expect(classifyLine("balanceText: 'â‚¬ 1,000.00',")).toMatch(/mojibake/);
        expect(classifyLine('pdfnative â€” PDF Compression Tests')).toMatch(/mojibake/);
    });

    it('leaves English typographic vocabulary and isolated accents alone', () => {
        for (const line of [
            'Brackets and Guillemets',
            'it should mirror guillemets around Arabic content',
            'A café résumé with naïve façade — €42',
            "expect(slugify('Café <2026>')).toBe('Café-2026');",
            'files that parse the parser output',
            '« » are the French quotation marks',
        ]) {
            expect(classifyLine(line), line).toBeNull();
        }
    });
});

describe('findNonEnglishProse', () => {
    it('reports line numbers and skips marked lines', () => {
        const text = [
            'English line',
            "title: 'Crénage',",
            `// ${DEMO_LANGUAGE_MARKER} fr (kerning demo)`,
            "title: 'Crénage',",
            `text: 'Vraiment ? Oui ! Total : 42.', // ${DEMO_LANGUAGE_MARKER} fr (punctuation)`,
            'an English line, so the marker above does not reach the next one',
            'la ponctuation qui borde une ligne',
        ].join('\n');
        const found = findNonEnglishProse(text, 'sample.ts');
        expect(found.map(f => f.line)).toEqual([2, 7]);
        expect(found[0].snippet).toContain('Crénage');
    });

    it('skips comment lines in TypeScript but not in other files', () => {
        const ts = "// Lexique des règles typographiques de l'Imprimerie nationale\nconst x = 1;";
        expect(findNonEnglishProse(ts, 'a.ts')).toEqual([]);
        expect(findNonEnglishProse("// la ponctuation qui borde une ligne", 'a.md')).toHaveLength(1);
    });

    it('exempts a fenced block that follows a marker in Markdown', () => {
        const md = [
            `<!-- ${DEMO_LANGUAGE_MARKER} fr (example) -->`,
            '```ts',
            "const s = 'Vraiment ? Oui ! Total : 42. Et une « citation » pour finir.';",
            "const t = 'la ponctuation qui borde une ligne';",
            '```',
            "la ponctuation qui borde une ligne",
        ].join('\n');
        expect(findNonEnglishProse(md, 'guide.md').map(f => f.line)).toEqual([6]);
    });

    it('honours a caller-supplied suppression marker', () => {
        const md = '<!-- verify-docs:allow prose-language (history) -->\nla ponctuation qui borde une ligne';
        expect(findNonEnglishProse(md, 'x.md', { suppress: 'verify-docs:allow prose-language' })).toEqual([]);
        expect(findNonEnglishProse(md, 'x.md')).toHaveLength(1);
    });
});
