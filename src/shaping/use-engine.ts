/**
 * pdfnative — Universal Shaping Engine
 * ======================================
 * Cluster segmentation and reordering for every complex script that does
 * not have a dedicated shaper, driven by a table generated from the Unicode
 * Character Database rather than written by hand.
 *
 * What this replaces. Until v1.8.0 each complex script carried its own
 * classification: a cascade of code-point ranges, thirteen categories, one
 * copy per shaper. Khmer, Myanmar, Sinhala and Tibetan each had their own,
 * each slightly different, and each with the same blind spots — the Khmer
 * robat, the Myanmar kinzi, deep coeng stacks — because a hand-written range
 * list is exactly as complete as the day it was written. The engine here
 * classifies against {@link USE_RANGES}, derived from the UCD, and segments
 * with the cluster grammar the specification publishes.
 *
 * What it does NOT do. This is segmentation, classification and reordering:
 * the parts that depend only on the text. Glyph substitution still runs
 * through the font's own tables, so a conjunct only forms when the font
 * carries a ligature for it. That boundary is deliberate — a shaping engine
 * that invents glyphs is worse than one that does not.
 *
 * References:
 *   - Universal Shaping Engine specification
 *     https://learn.microsoft.com/typography/script-development/use
 *   - The cluster grammar, transcribed from the reference state machine
 *
 * @module shaping/use-engine
 * @since 1.8.0
 */

import { USE_CATEGORIES, USE_RANGES, USE_UNICODE_VERSION } from './use-data.js';

export { USE_UNICODE_VERSION };

/**
 * A USE cluster category: one of the base categories (`B`, `H`, `R`, …) or
 * a positional variant (`VPre`, `MAbv`, `FBlw`, …). `O` is the default for
 * anything the table does not name.
 *
 * @since 1.8.0
 */
export type UseClusterCategory = string;

/** The kind of cluster the grammar matched. */
export type UseSyllableType =
    | 'virama_terminated'
    | 'sakot_terminated'
    | 'standard'
    | 'number_joiner_terminated'
    | 'numeral'
    | 'symbol'
    | 'hieroglyph'
    | 'broken'
    | 'non_cluster';

/**
 * One cluster, as a half-open range over the input code points.
 *
 * @since 1.8.0
 */
export interface UseSyllable {
    readonly type: UseSyllableType;
    /** Index of the first code point, inclusive. */
    readonly start: number;
    /** Index one past the last code point. */
    readonly end: number;
}

// ── Classification ───────────────────────────────────────────────────

/**
 * The USE cluster category of a code point.
 *
 * Binary search over the generated range table. Code points the table does
 * not carry are `'O'`, which is both the specification's default and the
 * reason the table is 22 KB rather than 300.
 *
 * @since 1.8.0
 */
export function useCategory(cp: number): UseClusterCategory {
    let lo = 0;
    let hi = USE_RANGES.length / 3 - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const start = USE_RANGES[mid * 3];
        const end = USE_RANGES[mid * 3 + 1];
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return USE_CATEGORIES[USE_RANGES[mid * 3 + 2]];
    }
    return 'O';
}

/** Classify a whole code-point sequence in one pass. */
export function useCategories(cps: readonly number[]): UseClusterCategory[] {
    return cps.map(useCategory);
}

// ── Grammar ──────────────────────────────────────────────────────────
//
// Each matcher takes the category array and a position, and returns the
// position after the longest match, which equals the input position when the
// production matched nothing. Productions that can fail outright return -1,
// so a caller can tell "matched empty" from "did not match".

type Matcher = (c: readonly UseClusterCategory[], i: number) => number;

/** `x?` — zero or one. */
const opt = (m: Matcher): Matcher => (c, i) => {
    const n = m(c, i);
    return n < 0 ? i : n;
};

/** `x*` — zero or more, greedily. */
const star = (m: Matcher): Matcher => (c, i) => {
    let pos = i;
    for (;;) {
        const n = m(c, pos);
        if (n < 0 || n === pos) return pos;
        pos = n;
    }
};

/** `x+` — one or more. */
const plus = (m: Matcher): Matcher => (c, i) => {
    const first = m(c, i);
    if (first < 0 || first === i) return -1;
    return star(m)(c, first);
};

/** `a b c` — every part in order; the whole fails if any part does. */
const seq = (...ms: Matcher[]): Matcher => (c, i) => {
    let pos = i;
    for (const m of ms) {
        const n = m(c, pos);
        if (n < 0) return -1;
        pos = n;
    }
    return pos;
};

/** `a | b` — the first alternative that matches. */
const alt = (...ms: Matcher[]): Matcher => (c, i) => {
    for (const m of ms) {
        const n = m(c, i);
        if (n >= 0) return n;
    }
    return -1;
};

/** One code point of the given category. */
const one = (...cats: UseClusterCategory[]): Matcher => (c, i) =>
    (i < c.length && cats.includes(c[i]) ? i + 1 : -1);

/** Any single code point. */
const any: Matcher = (c, i) => (i < c.length ? i + 1 : -1);

// tail = complex_syllable_tail | sakot_terminated_cluster_tail
//      | symbol_cluster_tail | virama_terminated_cluster_tail
//
// Declaration order matters less than length here, so every alternative is
// tried and the longest wins — the reference scanner is a longest-match
// machine, not a first-match one.
const longest = (...ms: Matcher[]): Matcher => (c, i) => {
    let best = -1;
    for (const m of ms) {
        const n = m(c, i);
        if (n > best) best = n;
    }
    return best;
};

type ClusterGrammar = ReadonlyArray<readonly [UseSyllableType, Matcher]>;

/**
 * Build the cluster grammar.
 *
 * Assembled on first use rather than at module load: the combinators above
 * are calls, and a bundler cannot know a top-level call is pure, so every
 * consumer of the library — even one importing a single colour helper —
 * would otherwise carry the whole grammar. Inside a function there is
 * nothing to evaluate until a shaper actually needs it.
 */
function buildGrammar(): ClusterGrammar {
// h = H | HVM | IS | Sk
const h = one('H', 'HVM', 'IS', 'Sk');

// consonant_modifiers = CMAbv* CMBlw* ((h B | SUB) CMAbv* CMBlw*)*
const consonantModifiers: Matcher = seq(
    star(one('CMAbv')),
    star(one('CMBlw')),
    star(seq(
        alt(seq(h, one('B')), one('SUB')),
        star(one('CMAbv')),
        star(one('CMBlw')),
    )),
);

// medial_consonants = MPre? MAbv? MBlw? MPst?
const medialConsonants: Matcher = seq(
    opt(one('MPre')), opt(one('MAbv')), opt(one('MBlw')), opt(one('MPst')),
);

// dependent_vowels = VPre* VAbv* VBlw* VPst* | H
const dependentVowels: Matcher = alt(
    seq(star(one('VPre')), star(one('VAbv')), star(one('VBlw')), star(one('VPst'))),
    one('H'),
);

// vowel_modifiers = HVM? VMPre* VMAbv* VMBlw* VMPst*
const vowelModifiers: Matcher = seq(
    opt(one('HVM')),
    star(one('VMPre')), star(one('VMAbv')), star(one('VMBlw')), star(one('VMPst')),
);

// final_consonants = FAbv* FBlw* FPst*
const finalConsonants: Matcher = seq(star(one('FAbv')), star(one('FBlw')), star(one('FPst')));

// final_modifiers = FMAbv* FMBlw* | FMPst?
const finalModifiers: Matcher = alt(
    seq(star(one('FMAbv')), star(one('FMBlw'))),
    opt(one('FMPst')),
);

// complex_syllable_start = (R | CS)? (B | GB)
const complexSyllableStart: Matcher = seq(opt(one('R', 'CS')), one('B', 'GB'));

// complex_syllable_middle = consonant_modifiers medial_consonants
//                           dependent_vowels vowel_modifiers (Sk B)*
const complexSyllableMiddle: Matcher = seq(
    consonantModifiers, medialConsonants, dependentVowels, vowelModifiers,
    star(seq(one('Sk'), one('B'))),
);

// complex_syllable_tail = complex_syllable_middle final_consonants final_modifiers
const complexSyllableTail: Matcher = seq(complexSyllableMiddle, finalConsonants, finalModifiers);

// virama_terminated_cluster_tail = consonant_modifiers (IS | RK)
const viramaTerminatedTail: Matcher = seq(consonantModifiers, one('IS', 'RK'));

// sakot_terminated_cluster_tail = complex_syllable_middle Sk
const sakotTerminatedTail: Matcher = seq(complexSyllableMiddle, one('Sk'));

// number_joiner_terminated_cluster_tail = (HN N)* HN
const numberJoinerTail: Matcher = seq(star(seq(one('HN'), one('N'))), one('HN'));

// numeral_cluster_tail = (HN N)+
const numeralTail: Matcher = plus(seq(one('HN'), one('N')));

// symbol_cluster_tail = SMAbv+ SMBlw* | SMBlw+
const symbolTail: Matcher = alt(
    seq(plus(one('SMAbv')), star(one('SMBlw'))),
    plus(one('SMBlw')),
);

const tail: Matcher = longest(
    complexSyllableTail, sakotTerminatedTail, symbolTail, viramaTerminatedTail,
);

/** Every top-level cluster alternative, in the order the grammar declares. */
return [
    // virama_terminated_cluster ZWNJ?
    ['virama_terminated', seq(complexSyllableStart, viramaTerminatedTail, opt(one('ZWNJ')))],
    // sakot_terminated_cluster ZWNJ?
    ['sakot_terminated', seq(complexSyllableStart, sakotTerminatedTail, opt(one('ZWNJ')))],
    // standard_cluster ZWNJ?
    ['standard', seq(complexSyllableStart, complexSyllableTail, opt(one('ZWNJ')))],
    // number_joiner_terminated_cluster ZWNJ?
    ['number_joiner_terminated', seq(one('N'), numberJoinerTail, opt(one('ZWNJ')))],
    // numeral_cluster ZWNJ?
    ['numeral', seq(one('N'), opt(numeralTail), opt(one('ZWNJ')))],
    // symbol_cluster ZWNJ?
    ['symbol', seq(one('O', 'GB', 'SB'), opt(tail), opt(one('ZWNJ')))],
    // hieroglyph_cluster ZWNJ?
    ['hieroglyph', seq(
        star(one('SB')), one('G'), opt(one('HR')), opt(one('HM')), star(one('SE')),
        star(seq(one('J'), star(one('SB')), opt(seq(one('G'), opt(one('HR')), opt(one('HM')), star(one('SE')))))),
        opt(one('ZWNJ')),
    )],
    // FMPst
    ['non_cluster', one('FMPst')],
    // broken_cluster ZWNJ?
    ['broken', seq(
        opt(one('R')),
        longest(tail, numberJoinerTail, numeralTail),
        opt(one('ZWNJ')),
    )],
    // other
    ['non_cluster', any],
];
}

let grammar: ClusterGrammar | undefined;
const clusters = (): ClusterGrammar => grammar ?? (grammar = buildGrammar());

/**
 * Split a code-point sequence into USE clusters.
 *
 * Longest match wins, and ties go to the earliest alternative in the
 * grammar — the behaviour of the reference scanner. Every cluster advances
 * by at least one code point, so the segmentation always terminates even on
 * input the grammar cannot explain.
 *
 * @param cps Logical-order code points.
 * @since 1.8.0
 */
export function splitUseSyllables(cps: readonly number[]): UseSyllable[] {
    const cats = useCategories(cps);
    const out: UseSyllable[] = [];
    let i = 0;
    while (i < cats.length) {
        let bestType: UseSyllableType = 'non_cluster';
        let bestEnd = -1;
        for (const [type, matcher] of clusters()) {
            const end = matcher(cats, i);
            if (end > bestEnd) { bestEnd = end; bestType = type; }
        }
        // `other = any` guarantees at least one code point; the guard is here
        // so a future grammar edit cannot silently produce an endless loop.
        const end = bestEnd > i ? bestEnd : i + 1;
        out.push({ type: bestType, start: i, end });
        i = end;
    }
    return out;
}

// ── Reordering ───────────────────────────────────────────────────────

/**
 * Categories that render to the left of their base and must therefore be
 * emitted before it, whatever their logical position.
 */
const PRE_BASE = /*#__PURE__*/ new Set<UseClusterCategory>(['VPre', 'VMPre', 'MPre']);

/**
 * Reorder one cluster into visual order.
 *
 * Two movements, both of them text-only — neither consults the font:
 *
 *   - **Pre-base vowels and medials** (`VPre`, `VMPre`, `MPre`) move to the
 *     front of the cluster. This is the reordering every Indic and
 *     South-East Asian script needs and the reason "ເກ" is stored as
 *     consonant-then-vowel but drawn vowel-then-consonant.
 *   - **Repha** (`R`) moves to the end. A repha is logically the first
 *     consonant of the cluster but renders as a mark over the last one.
 *
 * Anything else keeps its logical order, including the base, so a cluster
 * the grammar could not explain passes through untouched rather than being
 * scrambled by guesswork.
 *
 * @param cps Code points of one cluster, in logical order.
 * @returns Indices into `cps`, in visual order.
 * @since 1.8.0
 */
export function reorderUseCluster(cps: readonly number[]): number[] {
    const cats = useCategories(cps);
    const pre: number[] = [];
    const mid: number[] = [];
    const repha: number[] = [];
    for (let i = 0; i < cps.length; i++) {
        if (PRE_BASE.has(cats[i])) pre.push(i);
        else if (cats[i] === 'R') repha.push(i);
        else mid.push(i);
    }
    return [...pre, ...mid, ...repha];
}
