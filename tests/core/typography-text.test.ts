import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes, bindUnits, applyPunctuationSpacing, PUNCTUATION_SPACING_PRESETS, wrapText } from '../../src/index.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { createEncodingContext } from '../../src/core/encoding-context.js';
import { helveticaWidth, helveticaBoldWidth, stripSoftHyphens } from '../../src/fonts/encoding.js';
import { prepareBlocks } from '../../src/core/pdf-typography.js';
import * as notoSans from '../../fonts/noto-sans-data.js';
import type { DocumentParams, DocumentBlock } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry } from '../../src/types/pdf-types.js';

// v1.8.0 — soft hyphens, no-break space metrics and French spacing.

const SHY = '­';
const NBSP = ' ';
const NNBSP = ' ';
const PINNED = new Date('2026-01-01T00:00:00Z');
const enc = createEncodingContext([], false, false);

describe('soft hyphen (U+00AD)', () => {
    it('is invisible and zero-width when no break is taken', () => {
        const plain = 'anticonstitutionnellement';
        const hinted = `anti${SHY}constitution${SHY}nellement`;
        expect(helveticaWidth(hinted, 11)).toBe(helveticaWidth(plain, 11));
        expect(helveticaBoldWidth(hinted, 11)).toBe(helveticaBoldWidth(plain, 11));
        expect(stripSoftHyphens(hinted)).toBe(plain);
    });

    it('disappears from wrapped lines when the word fits', () => {
        const lines = wrapText(`anti${SHY}constitution${SHY}nellement`, 500, 11, enc);
        expect(lines.join('')).not.toContain(SHY);
        expect(lines.join('')).toContain('anticonstitutionnellement');
    });

    it('breaks the word and writes a real hyphen when it does not fit', () => {
        const lines = wrapText(`anti${SHY}constitution${SHY}nellement`, 40, 11, enc);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines[0].endsWith('-')).toBe(true);
        expect(lines.join('')).not.toContain(SHY);
    });

    it('breaks at the last opportunity that fits, not the first', () => {
        const word = `anti${SHY}constitution${SHY}nellement`;
        // Wide enough for "anticonstitution-" but not the whole word.
        const wide = helveticaWidth('anticonstitution-', 11) + 1;
        const lines = wrapText(word, wide, 11, enc);
        expect(lines[0]).toBe('anticonstitution-');
    });

    it('falls back to a hard break when no hint fits', () => {
        const lines = wrapText(`extraordinarily${SHY}long`, 12, 11, enc);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).not.toContain(SHY);
    });

    it('never renders as a visible hyphen in the output', () => {
        const params: DocumentParams = {
            title: 'Soft hyphen',
            blocks: [{ type: 'paragraph', text: `anti${SHY}constitution${SHY}nellement` }],
        };
        const text = extractText(buildDocumentPDFBytes(params, { creationDate: PINNED }))
            .map(p => p.text).join(' ');
        expect(text).toContain('anticonstitutionnellement');
    });

    it('leaves text without soft hyphens byte-identical', () => {
        const params: DocumentParams = {
            title: 'Plain', blocks: [{ type: 'paragraph', text: 'Ordinary prose, nothing hinted.' }],
        };
        const a = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const b = buildDocumentPDFBytes(params, { creationDate: PINNED });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    });

    it('terminates on a word that is only soft hyphens', () => {
        expect(() => wrapText(`${SHY}${SHY}${SHY}`, 20, 11, enc)).not.toThrow();
    });
});

describe('no-break space metrics', () => {
    it('measures NBSP and narrow NBSP as the space they render as', () => {
        const space = helveticaWidth('a a', 11);
        expect(helveticaWidth(`a${NBSP}a`, 11)).toBe(space);
        expect(helveticaWidth(`a${NNBSP}a`, 11)).toBe(space);
        expect(helveticaBoldWidth(`a${NBSP}a`, 11)).toBe(helveticaBoldWidth('a a', 11));
    });

    it('no longer measures them at the fallback width', () => {
        // They used to fall through to the 556-unit default, roughly double.
        const one = helveticaWidth(NBSP, 1000);
        expect(one).toBe(278);
        expect(one).not.toBe(556);
    });

    it('keeps a number and its unit on one line', () => {
        const lines = wrapText(`facture de 150${NBSP}€ payee`, helveticaWidth('facture de 150', 11) + 2, 11, enc);
        const withUnit = lines.find(l => l.includes('150'));
        expect(withUnit).toContain('€');
    });
});

/**
 * A no-break space used to be folded to U+0020 before it reached any CID
 * font, so the narrow no-break space the French preset inserts was neither
 * narrow nor no-break in the output and `'fr'` produced the same bytes as
 * `'fr-CA'`. A font that carries the glyph now gets it.
 */
describe('no-break spaces reach the font', () => {
    const latin = notoSans as unknown as FontData;
    const entries: FontEntry[] = [{ fontData: latin, fontRef: '/F3', lang: 'latin' }];
    const gidOf = (cp: number): string => latin.cmap[cp].toString(16).toUpperCase().padStart(4, '0');
    const advOf = (cp: number): number => latin.widths[latin.cmap[cp]] ?? latin.defaultWidth;

    it('Noto Sans carries both no-break spaces, the narrow one narrower', () => {
        expect(latin.cmap[0xA0]).toBeGreaterThan(0);
        expect(latin.cmap[0x202F]).toBeGreaterThan(0);
        expect(advOf(0x202F)).toBeLessThan(advOf(0x20));
    });

    it('encodes U+202F and U+00A0 as their own glyphs in a CID font', () => {
        const uni = createEncodingContext(entries, false, false);
        const hex = uni.textRuns(`a${NNBSP}b${NBSP}c`, 11).map(r => r.hexStr).join('');
        expect(hex).toContain(gidOf(0x202F));
        expect(hex).toContain(gidOf(0xA0));
        expect(uni.ps(`a${NNBSP}b`)).toContain(gidOf(0x202F));
    });

    it('measures the narrow no-break space at its real advance', () => {
        const uni = createEncodingContext(entries, false, false);
        expect(uni.tw(`a${NNBSP}b`, 11)).toBeLessThan(uni.tw('a b', 11));
        expect(uni.tw(`a${NBSP}b`, 11)).toBeCloseTo(uni.tw('a b', 11), 6);
    });

    it('falls back to the ordinary space in a font that lacks the glyph', () => {
        const cmap = { ...latin.cmap };
        delete cmap[0x202F];
        delete cmap[0xA0];
        const bare: FontData = { ...latin, cmap };
        const uni = createEncodingContext([{ fontData: bare, fontRef: '/F3', lang: 'latin' }], true, false);
        const hex = uni.textRuns(`a${NNBSP}b${NBSP}c`, 11).map(r => r.hexStr).join('');
        expect(hex).not.toContain(gidOf(0x202F));
        expect(hex).not.toContain(gidOf(0xA0));
        expect(hex.match(new RegExp(gidOf(0x20), 'g'))?.length).toBe(2);
    });

    const spaced: DocumentParams = {
        title: 'Ponctuation',
        fontEntries: entries,
        blocks: [{ type: 'paragraph', text: 'Vraiment ? Oui ! Ainsi ; Total : 42. Et une « citation » pour finir.' }],
    };

    it('makes the fr and fr-CA presets distinguishable in the output', () => {
        const fr = buildDocumentPDFBytes(spaced, { creationDate: PINNED, typography: { punctuationSpacing: 'fr' } });
        const ca = buildDocumentPDFBytes(spaced, { creationDate: PINNED, typography: { punctuationSpacing: 'fr-CA' } });
        const none = buildDocumentPDFBytes(spaced, { creationDate: PINNED });
        expect(Buffer.from(fr).equals(Buffer.from(ca))).toBe(false);
        expect(Buffer.from(ca).equals(Buffer.from(none))).toBe(false);
    });

    it('extracts the spaces the preset inserted', () => {
        const fr = buildDocumentPDFBytes(spaced, { creationDate: PINNED, typography: { punctuationSpacing: 'fr' } });
        const text = extractText(fr).map(p => p.text).join('\n');
        expect(text).toContain(`Vraiment${NNBSP}?`);
        expect(text).toContain(`Total${NBSP}:`);
        expect(text).toContain(`«${NBSP}citation${NBSP}»`);
    });

    it('degrades to the ordinary space on the base-14 path, where WinAnsi has no U+202F', () => {
        const base14: DocumentParams = { ...spaced, fontEntries: undefined };
        const fr = buildDocumentPDFBytes(base14, { creationDate: PINNED, typography: { punctuationSpacing: 'fr' } });
        const s = new TextDecoder('latin1').decode(fr);
        expect(s).toContain('Vraiment ?');
        expect(s).toContain('Total :');
    });
});

describe('bindUnits (universal, ISO 80000-1)', () => {
    it('binds a number to its unit regardless of language', () => {
        expect(bindUnits('150 €')).toBe(`150${NBSP}€`);
        expect(bindUnits('12 kg')).toBe(`12${NBSP}kg`);
        expect(bindUnits('30 %')).toBe(`30${NBSP}%`);
        expect(bindUnits('500 Mo')).toBe(`500${NBSP}Mo`);
        expect(bindUnits('21 °C')).toBe(`21${NBSP}°C`);
        // Same rule, English sentence — nothing locale-specific about it.
        expect(bindUnits('a 5 kg parcel')).toBe(`a 5${NBSP}kg parcel`);
    });

    it('prefers the longest matching unit', () => {
        expect(bindUnits('5 cm')).toBe(`5${NBSP}cm`);
        expect(bindUnits('5 m')).toBe(`5${NBSP}m`);
        expect(bindUnits('21 °C')).toBe(`21${NBSP}°C`);
    });

    it('does not glue a number to an ordinary word', () => {
        expect(bindUnits('150 personnes')).toBe('150 personnes');
        expect(bindUnits('12 mois')).toBe('12 mois');
        expect(bindUnits('3 metres of rope')).toBe('3 metres of rope');
    });

    it('inserts nothing where the author wrote no space', () => {
        expect(bindUnits('150€')).toBe('150€');
    });

    it('accepts a caller-supplied unit list', () => {
        expect(bindUnits('7 sprockets', ['sprockets'])).toBe(`7${NBSP}sprockets`);
        expect(bindUnits('7 kg', ['sprockets'])).toBe('7 kg');
    });

    it('is a no-op on empty input or an empty unit list', () => {
        expect(bindUnits('')).toBe('');
        expect(bindUnits('12 kg', [])).toBe('12 kg');
    });
});

describe('applyPunctuationSpacing (locale-specific, rule-driven)', () => {
    const fr = PUNCTUATION_SPACING_PRESETS.fr;
    const frCA = PUNCTUATION_SPACING_PRESETS['fr-CA'];

    it('applies the French convention', () => {
        expect(applyPunctuationSpacing('Vraiment ?', fr)).toBe(`Vraiment${NNBSP}?`);
        expect(applyPunctuationSpacing('Attention !', fr)).toBe(`Attention${NNBSP}!`);
        expect(applyPunctuationSpacing('Total : 42', fr)).toBe(`Total${NBSP}: 42`);
        expect(applyPunctuationSpacing('« citation »', fr)).toBe(`«${NBSP}citation${NBSP}»`);
    });

    it('differs from the Canadian convention, which is why it is not one flag', () => {
        expect(applyPunctuationSpacing('Vraiment ?', frCA)).toBe('Vraiment ?');
        expect(applyPunctuationSpacing('Total : 42', frCA)).toBe(`Total${NBSP}: 42`);
    });

    it('leaves text untouched with no rules, as for English or German', () => {
        expect(applyPunctuationSpacing('Really? Yes!', [])).toBe('Really? Yes!');
    });

    it('accepts an arbitrary convention as an explicit rule list', () => {
        const custom = [{ char: '§', side: 'after' as const, space: 'nbsp' as const }];
        expect(applyPunctuationSpacing('§ 12', custom)).toBe(`§${NBSP}12`);
    });

    it('inserts nothing where the author wrote no space', () => {
        expect(applyPunctuationSpacing('Vraiment?', fr)).toBe('Vraiment?');
    });

    it('is a no-op on empty input', () => {
        expect(applyPunctuationSpacing('', fr)).toBe('');
    });
});

describe('prepareBlocks', () => {
    const blocks: DocumentBlock[] = [
        { type: 'heading', level: 1, text: 'Facture : resume' },
        { type: 'paragraph', text: 'Montant du : 150 €' },
        { type: 'list', style: 'bullet', items: ['Poids : 12 kg', { text: 'Remise : 30 %' }] },
        { type: 'table', headers: ['Article', 'Prix'], rows: [{ cells: ['Cable 2 m', '15 €'], type: '', pointed: false }], caption: 'Detail : lignes' },
        { type: 'link', text: 'En savoir plus : ici', url: 'https://example.com' },
    ];

    it('returns the input array untouched when not configured', () => {
        expect(prepareBlocks(blocks, undefined)).toBe(blocks);
        expect(prepareBlocks(blocks, {})).toBe(blocks);
        expect(prepareBlocks(blocks, { unitBinding: false })).toBe(blocks);
    });

    it('applies unit binding alone, without any locale convention', () => {
        const json = JSON.stringify(prepareBlocks(blocks, { unitBinding: true }));
        expect(json).toContain(`150${NBSP}€`);
        expect(json).toContain(`12${NBSP}kg`);
        expect(json).toContain(`30${NBSP}%`);
        // No punctuation rules configured, so colons keep their plain space.
        expect(json).toContain('Facture : resume');
    });

    it('transforms every kind of running text when both are on', () => {
        const out = prepareBlocks(blocks, { unitBinding: true, punctuationSpacing: 'fr' });
        const json = JSON.stringify(out);
        expect(json).not.toMatch(/ :/);
        expect(json).toContain(`Facture${NBSP}:`);
        expect(json).toContain(`150${NBSP}€`);
        expect(json).toContain(`Detail${NBSP}:`);
        expect(json).toContain(`plus${NBSP}:`);
    });

    it('accepts an explicit rule list in place of a preset', () => {
        const json = JSON.stringify(prepareBlocks(blocks, {
            punctuationSpacing: [{ char: ':', side: 'before', space: 'narrow' }],
        }));
        expect(json).toContain(`Facture${NNBSP}:`);
    });

    it('rejects an unknown preset with an actionable message', () => {
        expect(() => prepareBlocks(blocks, { punctuationSpacing: 'de' as never }))
            .toThrow(/unknown preset "de".*fr, fr-CA/s);
    });

    it('leaves the originals untouched', () => {
        prepareBlocks(blocks, { unitBinding: true, punctuationSpacing: 'fr' });
        expect((blocks[1] as { text: string }).text).toBe('Montant du : 150 €');
    });

    it('changes the built document only when enabled', () => {
        const params: DocumentParams = { title: 'Facture', blocks };
        const plain = buildDocumentPDFBytes(params, { creationDate: PINNED });
        const off = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { unitBinding: false } });
        const on = buildDocumentPDFBytes(params, { creationDate: PINNED, typography: { unitBinding: true } });
        expect(Buffer.from(off).equals(Buffer.from(plain))).toBe(true);
        expect(Buffer.from(on).equals(Buffer.from(plain))).toBe(false);
    });
});
