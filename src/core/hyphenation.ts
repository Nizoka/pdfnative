/**
 * pdfnative — Hyphenation provider (v1.8.0)
 * ===========================================
 * An injection point for automatic hyphenation, deliberately without any
 * bundled dictionary.
 *
 * Real hyphenation needs Liang patterns, and a useful pattern set is hundreds
 * of kilobytes *per language*. Shipping one would either bloat every install
 * or pick a language for everyone, so pdfnative ships neither: the algorithm
 * stays in user land and the library provides the seam, exactly as it does
 * for signing ({@link setCryptoProvider}) and compression
 * ({@link setDeflateRawImpl}).
 *
 * Without a provider, the only break opportunities inside a word are the soft
 * hyphens (U+00AD) the author wrote, which need no data at all.
 *
 * @module core/hyphenation
 */

/**
 * Returns the positions inside `word` where a hyphen may be inserted.
 *
 * `word` is the bare word — no surrounding whitespace or punctuation-free
 * trimming is required of the provider. Positions are indices into `word`:
 * `3` means a break between `word[2]` and `word[3]`. Positions outside the
 * word, or at its very start or end, are ignored. Order does not matter.
 *
 * `lang` is the document's {@link TypographyOptions.hyphenationLanguage}
 * when one was set, so a single provider can pick a pattern set per
 * document; it is `undefined` otherwise.
 *
 * The function must be **synchronous** and **pure** — it is called during
 * layout, possibly many times for the same word, and its result must not
 * change between calls or the output stops being reproducible.
 *
 * @since 1.8.0
 */
export type HyphenationProvider = (word: string, lang?: string) => readonly number[];

let _provider: HyphenationProvider | null = null;

/**
 * Install a hyphenation provider, or `null` to remove it.
 *
 * @example Driving a Liang-pattern library
 * ```typescript
 * import Hypher from 'hypher';
 * import english from 'hyphenation.en-us';
 * import { setHyphenationProvider } from 'pdfnative';
 *
 * const h = new Hypher(english);
 * setHyphenationProvider((word, lang) => {
 *     if (lang !== undefined && !lang.startsWith('en')) return [];
 *     const parts = h.hyphenate(word);
 *     const positions: number[] = [];
 *     let at = 0;
 *     for (let i = 0; i < parts.length - 1; i++) {
 *         at += parts[i].length;
 *         positions.push(at);
 *     }
 *     return positions;
 * });
 * ```
 *
 * Narrow columns and justified text benefit most: without break
 * opportunities a long word either overflows or forces a ragged gap.
 *
 * @since 1.8.0
 */
export function setHyphenationProvider(fn: HyphenationProvider | null): void {
    _provider = fn;
}

/** The installed provider, or `null`. @since 1.8.0 */
export function getHyphenationProvider(): HyphenationProvider | null {
    return _provider;
}

/** SOFT HYPHEN — the internal representation of a break opportunity. */
const SHY = '­';

/**
 * Rewrite a word with soft hyphens at the provider's break positions, so the
 * line breaker can treat author-written and computed opportunities
 * identically.
 *
 * Returns the word unchanged when no provider is installed, when the word
 * already carries explicit hints (the author's choice wins), or when the
 * provider finds nothing usable.
 *
 * @internal
 */
export function hyphenateWord(word: string, lang?: string): string {
    if (_provider === null || word.includes(SHY)) return word;

    // The line breaker hands over tokens with their trailing separator; the
    // provider is given the bare word and its positions index into that.
    const m = /^(\s*)([^]*?)(\s*)$/.exec(word);
    const lead = m?.[1] ?? '';
    const core = m?.[2] ?? word;
    const trail = m?.[3] ?? '';
    if (core.length < 4) return word;

    let positions: readonly number[];
    try {
        positions = _provider(core, lang);
    } catch {
        // A provider that throws must not take the document down with it.
        return word;
    }
    if (!positions || positions.length === 0) return word;

    // Keep only interior positions, de-duplicated, descending so each splice
    // leaves the earlier indices valid.
    const valid = [...new Set(positions)]
        .filter(p => Number.isInteger(p) && p > 0 && p < core.length)
        .sort((a, b) => b - a);
    if (valid.length === 0) return word;

    let out = core;
    for (const p of valid) out = `${out.slice(0, p)}${SHY}${out.slice(p)}`;
    return lead + out + trail;
}
