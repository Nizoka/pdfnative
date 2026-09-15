/**
 * pdfnative — Typographic text preparation (v1.8.0)
 * ===================================================
 * Pure text transforms applied once, before pagination, so the planner, the
 * renderer and `inspectDocumentLayout()` all see the same strings.
 *
 * Two deliberately separate concerns:
 *
 * - **Unit binding** is universal. ISO 80000-1 §7.1 asks for a non-breaking
 *   space between a numerical value and its unit symbol in every language, so
 *   this needs no locale and carries no cultural assumption.
 * - **Punctuation spacing** is not universal at all, and is expressed as an
 *   explicit list of rules rather than a language flag. French sets a narrow
 *   space before `;` `!` `?`; Canadian French sets none; English, German,
 *   Italian and Spanish set none anywhere; Polish and Czech have an unrelated
 *   rule about one-letter prepositions. The library ships only the presets it
 *   can state precisely and lets any other convention be described by hand,
 *   instead of pretending to know them all.
 * - **Short-word binding** sits in between. Keeping a one-letter word off the
 *   end of a line is orthography in Polish, Czech, Slovak, Russian, Ukrainian
 *   and Hungarian, and a house-style preference elsewhere — Chicago and
 *   Bringhurst do not forbid an English line ending on "a". It is therefore
 *   a separate switch with an explicit word list, never a side effect of a
 *   language flag.
 *
 * Everything here is opt-in through `layout.typography`. With it omitted
 * nothing runs and output is byte-identical.
 *
 * @module core/pdf-typography
 */

import type { DocumentBlock, ListItem } from '../types/pdf-document-types.js';
import type {
    TypographyOptions, PunctuationSpacingRule, PunctuationSpacingPreset,
} from '../types/pdf-types.js';

/** NO-BREAK SPACE (U+00A0). */
const NBSP = ' ';
/** NARROW NO-BREAK SPACE (U+202F). */
const NNBSP = ' ';

const SPACE_CHAR: Record<'nbsp' | 'narrow', string> = { nbsp: NBSP, narrow: NNBSP };

/**
 * Built-in punctuation-spacing conventions.
 *
 * - `fr` — France, Belgium: a narrow no-break space before `;` `!` `?`, a full
 *   no-break space before `:`, and no-break spaces inside guillemets
 *   (Imprimerie nationale, *Lexique des règles typographiques*).
 * - `fr-CA` — Canada: no space before `;` `!` `?`; the colon keeps its space
 *   (Bureau de la traduction, *Le guide du rédacteur*). This is why the
 *   convention cannot be a single "French" flag.
 *
 * Anything else is supplied as an explicit rule list.
 */
export const PUNCTUATION_SPACING_PRESETS: Readonly<Record<PunctuationSpacingPreset, readonly PunctuationSpacingRule[]>> = {
    fr: [
        { char: ';', side: 'before', space: 'narrow' },
        { char: '!', side: 'before', space: 'narrow' },
        { char: '?', side: 'before', space: 'narrow' },
        { char: ':', side: 'before', space: 'nbsp' },
        { char: '«', side: 'after', space: 'nbsp' },
        { char: '»', side: 'before', space: 'nbsp' },
    ],
    'fr-CA': [
        { char: ':', side: 'before', space: 'nbsp' },
        { char: '«', side: 'after', space: 'nbsp' },
        { char: '»', side: 'before', space: 'nbsp' },
    ],
};

/**
 * Unit symbols bound to the number in front of them by default.
 *
 * A closed list on purpose: a non-breaking space belongs between a value and
 * its *unit*, not between a number and any following word — "150 personnes"
 * is two words and must stay breakable. Extend it through
 * {@link UnitBindingOptions.units} rather than loosening the rule.
 */
export const DEFAULT_UNITS: readonly string[] = [
    // Currency and proportion
    '€', '$', '£', '¥', '₽', '₹', '₩', 'CHF', '%', '‰', '°C', '°F', '°',
    // Length, mass, volume
    'nm', 'µm', 'mm', 'cm', 'dm', 'km', 'm',
    'mg', 'kg', 'g', 't',
    'ml', 'cl', 'dl', 'L', 'l',
    // Time and frequency
    'ms', 'min', 'h', 's', 'Hz', 'kHz', 'MHz', 'GHz',
    // Data
    'KiB', 'MiB', 'GiB', 'TiB', 'KB', 'MB', 'GB', 'TB', 'Ko', 'Mo', 'Go', 'To', 'o', 'B',
    // Typography and screens
    'px', 'pt', 'em', 'dpi', 'ppi',
];

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bind numbers to the units that follow them with a no-break space
 * (ISO 80000-1 §7.1). Language-independent.
 *
 * Only an existing plain space is converted, and only when the token that
 * follows is a known unit standing on its own.
 *
 * @param text  Text to transform.
 * @param units Unit symbols to recognise. Defaults to {@link DEFAULT_UNITS}.
 *
 * @since 1.8.0
 */
export function bindUnits(text: string, units: readonly string[] = DEFAULT_UNITS): string {
    if (!text || units.length === 0) return text;
    // Longest first, so "cm" wins over "m" and "°C" over "°".
    const alternation = [...units].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const re = new RegExp(`(\\d) (${alternation})(?![\\p{L}\\p{N}])`, 'gu');
    return text.replace(re, `$1${NBSP}$2`);
}

/** Object form of {@link TypographyOptions.bindShortWords}. */
type ShortWordBinding = Exclude<NonNullable<TypographyOptions['bindShortWords']>, boolean>;

/** Longest word `maxLength` may ask for; beyond three letters the rule stops being about short words. */
const SHORT_WORD_MAX = 3;

/**
 * Bind short words to the word that follows them with a no-break space, so
 * a line never ends on "a", "w" or "I".
 *
 * A house style, not a typographic law. It is orthography in Polish, Czech,
 * Slovak, Russian, Ukrainian and Hungarian, whose one-letter prepositions and
 * conjunctions (`w z i a o u k s v`) must not close a line, and a preference
 * elsewhere — Chicago and Bringhurst do not forbid an English line ending on
 * an article. Hence opt-in, and hence the explicit `words` list for a
 * language whose short words are a closed set.
 *
 * Only the single U+0020 after a qualifying word is converted, and only when
 * the word starts the text or follows breakable white space or an opening
 * bracket or quote, and the next token starts with a letter or digit — a
 * short word at the end of the text or before punctuation keeps its space.
 * Words are letters only (`\p{L}`), matched case-insensitively; a digit is
 * never a word, so `2 m` is left to {@link bindUnits}. A word already glued
 * to what precedes it by a no-break space — a unit symbol bound to its
 * number — is not a lone short word and is left alone. Existing no-break
 * spaces are never touched, which makes the transform idempotent.
 *
 * The no-break space is visible to text extraction, and it removes a break
 * opportunity: in a narrow column, binding widens the pool of lines the
 * wrapper cannot fill.
 *
 * @param text Text to transform.
 * @param opts `maxLength` widens the rule to words of up to that many letters
 *   (1 to 3, default 1); `words` restricts it to an explicit list instead.
 *
 * @since 1.8.0
 */
export function bindShortWords(text: string, opts?: ShortWordBinding): string {
    if (!text) return text;
    let word: string;
    if (opts?.words !== undefined) {
        const list = opts.words.filter(w => w.length > 0);
        if (list.length === 0) return text;
        // Longest first, so a longer entry is not shadowed by its own prefix.
        word = [...list].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    } else {
        const max = Math.min(SHORT_WORD_MAX, Math.max(1, Math.floor(opts?.maxLength ?? 1)));
        word = `\\p{L}{1,${max}}`;
    }
    // Lookbehind: start of text, breakable white space, or an opening
    // bracket or quote (Ps, Pi and the straight double quote). A straight
    // apostrophe is deliberately absent: "l'a" is one word, not an "a".
    const re = new RegExp(`(?<=^|[ \\t\\r\\n\\p{Ps}\\p{Pi}"])(${word}) (?=[\\p{L}\\p{N}])`, 'giu');
    return text.replace(re, `$1${NBSP}`);
}

/**
 * Replace the plain spaces adjacent to punctuation with no-break ones,
 * following an explicit set of rules.
 *
 * Only existing spaces are converted; nothing is inserted where the author
 * wrote none. That keeps the transform predictable and reversible, and means
 * it can never move a word.
 *
 * @since 1.8.0
 */
export function applyPunctuationSpacing(text: string, rules: readonly PunctuationSpacingRule[]): string {
    if (!text || rules.length === 0) return text;
    let out = text;
    for (const rule of rules) {
        const ch = escapeRe(rule.char);
        const space = SPACE_CHAR[rule.space];
        out = rule.side === 'before'
            ? out.replace(new RegExp(` (?=${ch})`, 'g'), space)
            : out.replace(new RegExp(`(?<=${ch}) `, 'g'), space);
    }
    return out;
}

/** Resolve the configured punctuation rules, preset name or explicit list. */
export function resolvePunctuationRules(
    spec: TypographyOptions['punctuationSpacing'],
): readonly PunctuationSpacingRule[] {
    if (!spec) return [];
    if (typeof spec === 'string') {
        const preset = PUNCTUATION_SPACING_PRESETS[spec];
        if (!preset) {
            throw new Error(
                `typography.punctuationSpacing: unknown preset "${spec}". `
                + `Known presets: ${Object.keys(PUNCTUATION_SPACING_PRESETS).join(', ')}. `
                + 'Any other convention can be passed as an explicit rule list.',
            );
        }
        return preset;
    }
    return spec;
}

/** Compose the transforms a given configuration asks for, or `null` for none. */
function buildTransform(opts: TypographyOptions | undefined): ((s: string) => string) | null {
    const rules = resolvePunctuationRules(opts?.punctuationSpacing);
    const binding = opts?.unitBinding;
    const bindOn = binding === true || (typeof binding === 'object' && binding !== null);
    const short = opts?.bindShortWords;
    const shortOn = short === true || (typeof short === 'object' && short !== null);
    if (rules.length === 0 && !bindOn && !shortOn) return null;

    const units = typeof binding === 'object' && binding !== null
        ? (binding.units ?? DEFAULT_UNITS)
        : DEFAULT_UNITS;
    const shortOpts = typeof short === 'object' && short !== null ? short : undefined;

    return (s: string): string => {
        let out = s;
        if (rules.length > 0) out = applyPunctuationSpacing(out, rules);
        if (bindOn) out = bindUnits(out, units);
        // After unit binding on purpose: a unit already glued to its number
        // must not be taken for a lone short word.
        if (shortOn) out = bindShortWords(out, shortOpts);
        return out;
    };
}

/** Apply `fn` to a list's entries, preserving nesting. */
function mapItems(items: readonly (string | ListItem)[], fn: (s: string) => string): (string | ListItem)[] {
    return items.map(entry => (typeof entry === 'string'
        ? fn(entry)
        : { ...entry, text: fn(entry.text), items: entry.items ? mapItems(entry.items, fn) : undefined }));
}

/**
 * Return the blocks with every piece of running text transformed.
 *
 * Returns the input array untouched when no transform is configured, so the
 * default path allocates nothing and stays byte-identical.
 *
 * Covers headings, paragraphs, list entries, link labels and table content
 * (headers, cells and caption) — everywhere a reader sees prose.
 *
 * @since 1.8.0
 */
export function prepareBlocks(
    blocks: readonly DocumentBlock[],
    opts: TypographyOptions | undefined,
): readonly DocumentBlock[] {
    const fn = buildTransform(opts);
    if (!fn) return blocks;

    return blocks.map((block): DocumentBlock => {
        switch (block.type) {
            case 'heading':
            case 'paragraph':
            case 'link':
                return { ...block, text: fn(block.text) };
            case 'list':
                return { ...block, items: mapItems(block.items, fn) };
            case 'table':
                return {
                    ...block,
                    headers: block.headers.map(fn),
                    caption: block.caption === undefined ? undefined : fn(block.caption),
                    rows: block.rows.map(row => ({ ...row, cells: row.cells.map(fn) })),
                };
            default:
                return block;
        }
    });
}
