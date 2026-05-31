/**
 * pdfnative — Universal Shaping Engine (USE) lite
 * =================================================
 * Cluster classification utility for Indic and related complex scripts
 * (Devanagari, Bengali, Tamil, Gujarati, Gurmukhi, Telugu, Kannada,
 * Malayalam, Sinhala, Khmer, Myanmar, Tibetan).
 *
 * Based on the Universal Shaping Engine specification:
 *   https://learn.microsoft.com/en-us/typography/script-development/use
 *
 * Scope (v1.3.0):
 *   - Public API for cluster classification: callers can run their own
 *     reordering / GSUB pipelines on top of the cluster categories.
 *   - 11 cluster categories sufficient for the four scripts pdfnative
 *     ships shaping for (Devanagari, Bengali, Tamil) plus a generic
 *     fallback that classifies any USE-eligible code point.
 *   - Marathi eyelash-ra (Ra + virama + ZWJ) is recognised as a distinct
 *     reph variant (`UseCluster.eyelash`).
 *   - The bundled Devanagari/Bengali/Tamil shapers consume
 *     `classifyUseCategory` as the single source of truth for joiner
 *     (ZWJ/ZWNJ) and half-form/eyelash decisions; their hand-tuned
 *     happy-path reordering (pinned by the vitest suite) is preserved.
 *
 * Not in scope (deferred):
 *   - State-table classification for Khmer/Myanmar/Tibetan/Sinhala/
 *     other USE-required scripts not currently bundled.
 */

// ── Cluster Categories (USE spec subset) ─────────────────────────────

/**
 * USE-lite cluster categories. A subset of the full USE category set
 * sufficient for the four scripts pdfnative ships shaping for.
 *
 * - `B` — Base consonant
 * - `V` — Independent vowel
 * - `N` — Number
 * - `H` — Halant / Virama
 * - `M` — Vowel sign / Matra (combining mark)
 * - `Mpre` — Pre-base matra (reorders before base in visual order)
 * - `Mabv` — Above-base matra
 * - `Mblw` — Below-base matra
 * - `Mpst` — Post-base matra
 * - `R` — Reph (the special "ra + virama" cluster head)
 * - `ZWJ` — Zero-width joiner (forms half / conjunct)
 * - `ZWNJ` — Zero-width non-joiner (breaks conjunct)
 * - `O` — Other (default)
 */
export type UseCategory =
    | 'B' | 'V' | 'N' | 'H'
    | 'M' | 'Mpre' | 'Mabv' | 'Mblw' | 'Mpst'
    | 'R' | 'ZWJ' | 'ZWNJ' | 'O';

/** Classified code point with its USE-lite category. */
export interface UseClassifiedCp {
    readonly cp: number;
    readonly category: UseCategory;
}

/** A USE-lite cluster: a base plus its prefixed/suffixed marks and signs. */
export interface UseCluster {
    /** Pre-base reordering elements (e.g. Devanagari ि matra). */
    readonly prebase: UseClassifiedCp[];
    /** The cluster base (consonant or vowel). */
    readonly base: UseClassifiedCp | null;
    /** Above-base marks. */
    readonly above: UseClassifiedCp[];
    /** Below-base marks. */
    readonly below: UseClassifiedCp[];
    /** Post-base marks. */
    readonly post: UseClassifiedCp[];
    /** Halant + consonant chains attached after the base (conjunct tail). */
    readonly tail: UseClassifiedCp[];
    /**
     * True when the cluster head is a Marathi eyelash-ra — `Ra + virama + ZWJ`
     * — which renders as the eyelash (rakar) form rather than a reph. The
     * leading `Ra` is still recorded in {@link prebase} with category `'R'`.
     */
    readonly eyelash?: boolean;
}

// ── Per-script Code Point Tables ─────────────────────────────────────

/* eslint-disable no-fallthrough */

function devanagariCategory(cp: number): UseCategory {
    // U+0900–U+097F (Devanagari)
    if (cp === 0x0901 || cp === 0x0902) return 'Mabv';        // candrabindu, anusvara
    if (cp === 0x0903) return 'Mpst';                          // visarga
    if (cp >= 0x0904 && cp <= 0x0914) return 'V';              // independent vowels
    if (cp >= 0x0915 && cp <= 0x0939) return 'B';              // consonants
    if (cp === 0x093A) return 'Mabv';                          // vowel sign OE
    if (cp === 0x093B) return 'Mpst';                          // vowel sign OOE
    if (cp === 0x093C) return 'Mblw';                          // nukta
    if (cp === 0x093D) return 'O';                             // avagraha
    if (cp === 0x093E) return 'Mpst';                          // matra aa
    if (cp >= 0x093F && cp <= 0x0940) return cp === 0x093F ? 'Mpre' : 'Mpst'; // i / ii
    if (cp >= 0x0941 && cp <= 0x0948) return 'Mblw';           // u/uu/ru/rru/lr/lrr/e/ai
    if (cp >= 0x0949 && cp <= 0x094C) return 'Mpst';           // candra-o/o/au
    if (cp === 0x094D) return 'H';                             // virama
    if (cp >= 0x094E && cp <= 0x094F) return 'Mpre';           // prishthamatra
    if (cp === 0x0950) return 'O';                             // OM
    if (cp >= 0x0951 && cp <= 0x0957) return 'Mabv';           // stress + vedic marks
    if (cp >= 0x0958 && cp <= 0x0961) return 'B';              // additional consonants & vowels
    if (cp >= 0x0962 && cp <= 0x0963) return 'Mblw';           // vocalic L marks
    if (cp >= 0x0966 && cp <= 0x096F) return 'N';              // digits
    return 'O';
}

function bengaliCategory(cp: number): UseCategory {
    // U+0980–U+09FF (Bengali)
    if (cp === 0x0981) return 'Mabv';                          // candrabindu
    if (cp === 0x0982) return 'Mpst';                          // anusvara
    if (cp === 0x0983) return 'Mpst';                          // visarga
    if (cp >= 0x0985 && cp <= 0x0994) return 'V';              // independent vowels
    if (cp >= 0x0995 && cp <= 0x09B9) return 'B';              // consonants
    if (cp === 0x09BC) return 'Mblw';                          // nukta
    if (cp === 0x09BD) return 'O';                             // avagraha
    if (cp === 0x09BE) return 'Mpst';                          // matra aa
    if (cp >= 0x09BF && cp <= 0x09C0) return cp === 0x09BF ? 'Mpre' : 'Mpst';
    if (cp >= 0x09C1 && cp <= 0x09C4) return 'Mblw';
    if (cp >= 0x09C7 && cp <= 0x09C8) return 'Mpre';           // e / ai (split vowels)
    if (cp >= 0x09CB && cp <= 0x09CC) return 'Mpre';           // o / au (split vowels)
    if (cp === 0x09CD) return 'H';                             // virama / hasanta
    if (cp === 0x09CE) return 'B';                             // khanda ta
    if (cp === 0x09D7) return 'Mpst';                          // au length mark
    if (cp >= 0x09DC && cp <= 0x09DF) return 'B';              // additional consonants
    if (cp >= 0x09E0 && cp <= 0x09E3) return 'O';
    if (cp >= 0x09E6 && cp <= 0x09EF) return 'N';              // digits
    return 'O';
}

function tamilCategory(cp: number): UseCategory {
    // U+0B80–U+0BFF (Tamil)
    if (cp === 0x0B82) return 'Mabv';                          // anusvara
    if (cp >= 0x0B85 && cp <= 0x0B94) return 'V';              // independent vowels
    if (cp >= 0x0B95 && cp <= 0x0BB9) return 'B';              // consonants
    if (cp === 0x0BBE) return 'Mpst';                          // matra aa
    if (cp === 0x0BBF) return 'Mpst';                          // matra i
    if (cp >= 0x0BC0 && cp <= 0x0BC2) return 'Mpst';
    if (cp >= 0x0BC6 && cp <= 0x0BC8) return 'Mpre';           // e / ee / ai
    if (cp >= 0x0BCA && cp <= 0x0BCC) return 'Mpre';           // o / oo / au (split vowels)
    if (cp === 0x0BCD) return 'H';                             // virama / pulli
    if (cp === 0x0BD7) return 'Mpst';                          // au length mark
    if (cp >= 0x0BE6 && cp <= 0x0BEF) return 'N';              // digits
    return 'O';
}

/* eslint-enable no-fallthrough */

// ── Top-level Classifier ─────────────────────────────────────────────

/**
 * Classify a single Unicode code point into a USE-lite category.
 * Dispatches to per-script tables; falls back to `'O'` for code points
 * outside the supported ranges.
 *
 * Special cases:
 *   - U+200C ZWNJ → 'ZWNJ'
 *   - U+200D ZWJ  → 'ZWJ'
 *
 * @param cp - Unicode code point
 * @returns USE-lite category
 */
export function classifyUseCategory(cp: number): UseCategory {
    if (cp === 0x200C) return 'ZWNJ';
    if (cp === 0x200D) return 'ZWJ';
    if (cp >= 0x0900 && cp <= 0x097F) return devanagariCategory(cp);
    if (cp >= 0x0980 && cp <= 0x09FF) return bengaliCategory(cp);
    if (cp >= 0x0B80 && cp <= 0x0BFF) return tamilCategory(cp);
    return 'O';
}

// ── Cluster Builder ──────────────────────────────────────────────────

/**
 * Split a code-point sequence into USE-lite clusters. Each cluster
 * carries a single base (consonant or independent vowel) plus all its
 * attached marks classified by their position relative to the base.
 *
 * Reph detection: when the sequence starts with consonant + virama
 * (or contains a "Ra + virama + consonant" prefix where Ra is U+0930
 * for Devanagari or U+09B0 for Bengali), the leading Ra-virama is
 * collected as a special pre-base reph element (category 'R').
 *
 * @param codePoints - Logical-order code points
 * @returns Array of UseCluster objects
 *
 * @example
 * ```ts
 * import { classifyClusters } from 'pdfnative';
 * const cps = Array.from('प्रकार').map(c => c.codePointAt(0)!);
 * const clusters = classifyClusters(cps);
 * // → one cluster per visible aksara, with reph/conjunct info
 * ```
 */
export function classifyClusters(codePoints: readonly number[]): UseCluster[] {
    const out: UseCluster[] = [];
    let i = 0;
    while (i < codePoints.length) {
        const cluster = nextCluster(codePoints, i);
        out.push(cluster.cluster);
        i = cluster.next;
    }
    return out;
}

const DEVA_RA = 0x0930;
const BENG_RA = 0x09B0;

function nextCluster(cps: readonly number[], start: number): { cluster: UseCluster; next: number } {
    const prebase: UseClassifiedCp[] = [];
    const above: UseClassifiedCp[] = [];
    const below: UseClassifiedCp[] = [];
    const post: UseClassifiedCp[] = [];
    const tail: UseClassifiedCp[] = [];

    let i = start;
    let eyelash = false;

    // Reph detection: leading Ra + virama + (consonant) — promote the
    // Ra-virama pair to a single category-R prebase entry. Cluster base
    // is then the following consonant.
    //
    // Eyelash-ra (Marathi): Ra + virama + ZWJ requests the eyelash (rakar)
    // form instead of a reph. The Ra is still recorded as category 'R' but
    // the cluster is flagged `eyelash` so callers can pick the right glyph.
    const cp0 = cps[i];
    const cat0 = classifyUseCategory(cp0);
    const isRa = (cp0 === DEVA_RA || cp0 === BENG_RA);
    if (isRa && i + 1 < cps.length && classifyUseCategory(cps[i + 1]) === 'H' && i + 2 < cps.length) {
        const cat2 = classifyUseCategory(cps[i + 2]);
        if (cat2 === 'B') {
            prebase.push({ cp: cp0, category: 'R' });
            // Skip the virama (it gets consumed by the reph form)
            i += 2;
        } else if (cat2 === 'ZWJ') {
            prebase.push({ cp: cp0, category: 'R' });
            eyelash = true;
            // Skip the virama + ZWJ; the following consonant (if any)
            // becomes the cluster base.
            i += 3;
        }
    }

    // Walk pre-base matras (independent of the base, they may appear in
    // logical order before the base for some scripts like Tamil/Bengali).
    while (i < cps.length && classifyUseCategory(cps[i]) === 'Mpre') {
        prebase.push({ cp: cps[i], category: 'Mpre' });
        i++;
    }

    // Base consonant or independent vowel.
    let base: UseClassifiedCp | null = null;
    if (i < cps.length) {
        const cat = classifyUseCategory(cps[i]);
        if (cat === 'B' || cat === 'V') {
            base = { cp: cps[i], category: cat };
            i++;
        }
    }

    // Marks and conjunct tail attached to the base.
    while (i < cps.length) {
        const cp = cps[i];
        const cat = classifyUseCategory(cp);
        if (cat === 'B' || cat === 'V') break;        // start of next cluster
        if (cat === 'H') {
            // Consume the virama plus the next consonant as conjunct tail.
            tail.push({ cp, category: 'H' });
            i++;
            if (i < cps.length) {
                const nextCat = classifyUseCategory(cps[i]);
                if (nextCat === 'B') {
                    tail.push({ cp: cps[i], category: 'B' });
                    i++;
                }
            }
            continue;
        }
        if (cat === 'Mabv') { above.push({ cp, category: 'Mabv' }); i++; continue; }
        if (cat === 'Mblw') { below.push({ cp, category: 'Mblw' }); i++; continue; }
        if (cat === 'Mpst') { post.push({ cp, category: 'Mpst' }); i++; continue; }
        if (cat === 'Mpre') { prebase.push({ cp, category: 'Mpre' }); i++; continue; }
        if (cat === 'M')    { post.push({ cp, category: 'M' });    i++; continue; }
        if (cat === 'ZWJ' || cat === 'ZWNJ') { tail.push({ cp, category: cat }); i++; continue; }
        if (cat === 'N' || cat === 'O') {
            if (!base) {
                base = { cp, category: cat === 'N' ? 'N' : 'O' };
                i++;
                continue;
            }
            break;
        }
        // Reph (R) was handled at the prebase pass; any other case: treat as opaque
        break;
    }

    // Guard against zero-progress (e.g. orphaned mark at start)
    if (i === start) {
        base = { cp: cps[i], category: cat0 };
        i++;
    }

    return {
        cluster: eyelash
            ? { prebase, base, above, below, post, tail, eyelash: true }
            : { prebase, base, above, below, post, tail },
        next: i,
    };
}
