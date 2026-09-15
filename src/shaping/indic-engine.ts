/**
 * pdfnative — Indic OpenType Shaping Engine
 * ==========================================
 * One syllable engine for the Indic scripts with a dedicated shaper —
 * Devanagari, Bengali, Tamil, Telugu and Sinhala — driven by the font's own
 * OpenType Layout tables (`FontData.otl`, baked per script and feature since
 * v1.8.0) and by the Unicode Character Database for the character classes.
 *
 * What it does, per syllable, in the order the Indic OpenType specification
 * prescribes and HarfBuzz implements:
 *
 *   1. Segment the text into syllables from the USE categories of the UCD
 *      (consonant, virama, nukta, pre/above/below/post vowel signs, syllable
 *      modifiers, joiners).
 *   2. Decompose two-part vowel signs into the parts the font positions.
 *   3. Find the base consonant (the last one without a below- or post-base
 *      form, which the font itself declares through `blwf` / `pstf` / `pref`),
 *      detect a reph (Ra + virama at the head of a syllable that the font's
 *      `rphf` would substitute), assign each glyph a position and the feature
 *      masks that position allows — `rphf` on the reph pair only, `half` on
 *      the consonants before the base, `blwf` / `pstf` / `vatu` on those after
 *      it — and move pre-base vowel signs to the front.
 *   4. Apply the basic features one stage at a time: `locl ccmp nukt akhn
 *      rphf rkrf pref blwf abvf half pstf vatu cjct`.
 *   5. Final reordering: a pre-base vowel sign lands after the last virama
 *      that survived (the one no half form absorbed) or at the syllable start;
 *      the reph glyph moves to its script's position (before the post-base
 *      vowel signs in Devanagari, after the subjoined consonants in Bengali,
 *      after everything in Tamil, Telugu and Sinhala); leftover joiners go.
 *   6. Apply the presentation features in one pass, in lookup order:
 *      `pres abvs blws psts haln calt`.
 *   7. Attach marks through the font's MarkToBase and MarkToMark anchors.
 *
 * Fonts without `otl` — modules built before v1.8.0, or font-data objects a
 * caller assembled by hand — take the same path over their flat `ligatures`
 * and `gsub` tables, so the reordering fixes reach them too.
 *
 * Lookup types applied: single (1), multiple (2), ligature (4) and the
 * contextual 5 and 6 (backtrack, input and lookahead over the font's glyph
 * sets, nested lookups fired at their input positions). Not applied,
 * documented: alternate (3) and reverse-chaining (8) lookups, and the
 * mark-filtering-set flag, which is treated as "skip no mark".
 *
 * The font's tables are compiled once per font and script — glyph sets as
 * sorted range arrays searched by bisection, contextual rules indexed by
 * their first input glyph, GDEF marks as a bitmap, the lookup plan of each
 * feature stage as a flat list — and memoised in a WeakMap keyed by the
 * FontData object, so the per-syllable work is a handful of object reads and
 * integer compares (see performance.instructions.md).
 *
 * References:
 *   - Microsoft, "Developing OpenType Fonts for Indic Scripts"
 *     https://learn.microsoft.com/typography/script-development/devanagari
 *   - HarfBuzz, hb-ot-shaper-indic.cc (base finding, reph and matra placement)
 *   - Unicode Standard, chapter 12 (South and Central Asia)
 *
 * @module shaping/indic-engine
 * @since 1.8.0
 */

import type { FontData, OtlChainRule, OtlLookup, OtlTables, ShapedGlyph } from '../types/pdf-types.js';
import { useCategory } from './use-engine.js';
import { attachMarks, type AttachItem } from './gpos-positioner.js';

// ── Configuration ────────────────────────────────────────────────────

/** How a script forms its reph (the above-base form of an initial Ra + virama). */
export type IndicRephMode =
    /** Ra + virama + consonant becomes a reph without any joiner. */
    | 'implicit'
    /** Only Ra + virama + ZWJ becomes a reph (Telugu, Sinhala). */
    | 'explicit'
    /** The script has no reph. */
    | 'none';

/** Where the reph glyph lands once the syllable is shaped. */
export type IndicRephPosition =
    /** After the base and its above-base signs, before post-base signs (Devanagari). */
    | 'beforePost'
    /** After the subjoined consonants, before every vowel sign (Bengali). */
    | 'afterSub'
    /** After every vowel sign, before the syllable modifiers. */
    | 'afterPost';

/**
 * The per-script facts the engine needs. Everything else — which glyphs
 * exist, which sequences form conjuncts, where marks attach — comes from the
 * font.
 *
 * @since 1.8.0
 */
export interface IndicScriptConfig {
    /** Script identifier, for diagnostics. */
    readonly id: string;
    /** OpenType script tags in order of preference (`dev2` before `deva`). */
    readonly scriptTags: readonly string[];
    /** Inclusive code-point ranges of the consonants. */
    readonly consonants: readonly (readonly [number, number])[];
    /** The virama (halant, pulli, al-lakuna). */
    readonly virama: number;
    /** The letter Ra, which forms the reph and the rakar. */
    readonly ra: number;
    readonly rephMode: IndicRephMode;
    readonly rephPosition: IndicRephPosition;
    /** Whether `blwf` may reach consonants before the base as well as after it. */
    readonly blwfMode: 'preAndPost' | 'postOnly';
    /**
     * Two-part vowel signs and their parts, in the order the font positions
     * them: the pre-base part first. Canonical decompositions only.
     */
    readonly splitMatras: Readonly<Record<number, readonly number[]>>;
    /** Consonants join into a conjunct only across virama + ZWJ (Sinhala). */
    readonly conjunctsNeedZwj?: boolean;
}

// ── Character classes ────────────────────────────────────────────────

type Cat = 'C' | 'V' | 'H' | 'N' | 'ZWJ' | 'ZWNJ' | 'MPre' | 'MAbv' | 'MBlw' | 'MPst' | 'SM' | 'O';

function isConsonant(cp: number, cfg: IndicScriptConfig): boolean {
    for (const [a, b] of cfg.consonants) if (cp >= a && cp <= b) return true;
    return false;
}

/** The engine's class of a code point, from the UCD's USE category. */
function classify(cp: number, cfg: IndicScriptConfig): Cat {
    if (cp === 0x200D) return 'ZWJ';
    if (cp === 0x200C) return 'ZWNJ';
    switch (useCategory(cp)) {
        case 'B': return isConsonant(cp, cfg) ? 'C' : 'V';
        case 'GB': return 'V';
        case 'H': case 'HVM': return 'H';
        case 'CMBlw': case 'CMAbv': return 'N';
        case 'VPre': return 'MPre';
        case 'VAbv': return 'MAbv';
        case 'VBlw': return 'MBlw';
        case 'VPst': return 'MPst';
        case 'VMAbv': case 'VMBlw': case 'VMPst':
        case 'FMAbv': case 'FMBlw': case 'FMPst': case 'SM':
            return 'SM';
        default: return 'O';
    }
}

const isMatra = (c: Cat): boolean => c === 'MPre' || c === 'MAbv' || c === 'MBlw' || c === 'MPst';
const isMarkLike = (c: Cat): boolean => isMatra(c) || c === 'SM' || c === 'N' || c === 'H';

// ── Syllables ────────────────────────────────────────────────────────

/**
 * One syllable as a half-open range over the input code points. `cluster`
 * is false for a run the grammar does not own (spaces, digits, Latin), which
 * the engine passes through the cmap unchanged.
 *
 * @since 1.8.0
 */
export interface IndicSyllable {
    readonly start: number;
    readonly end: number;
    readonly cluster: boolean;
}

/**
 * Split code points into Indic syllables:
 *
 *   consonant_syllable := (C N? (H ZWJ? | ZWJ? H))* C N? H? ZWNJ? matras* modifiers*
 *   vowel_syllable     := V N? (H C N?)* H? matras* modifiers*
 *
 * A virama followed by ZWNJ, or a virama not followed by a consonant, closes
 * the syllable. With `conjunctsNeedZwj` a virama continues the syllable only
 * through a ZWJ.
 *
 * @since 1.8.0
 */
export function splitIndicSyllables(cps: readonly number[], cfg: IndicScriptConfig): IndicSyllable[] {
    const cats = cps.map(cp => classify(cp, cfg));
    const out: IndicSyllable[] = [];
    let i = 0;
    while (i < cps.length) {
        const start = i;
        const c = cats[i];
        if (c !== 'C' && c !== 'V') {
            // A stray sign is its own syllable, shaped over a dotted circle
            // by a full engine; here it rides on the previous glyph.
            i++;
            out.push({ start, end: i, cluster: isMarkLike(c) });
            continue;
        }
        i++;
        if (cats[i] === 'N') i++;
        // Consonant chain.
        for (;;) {
            let j = i;
            if (cats[j] === 'ZWJ' && cats[j + 1] === 'H') j++;
            if (cats[j] !== 'H') break;
            j++;
            if (cats[j] === 'ZWNJ') { i = j + 1; break; }          // explicit halant, no conjunct
            const viaZwj = cats[j] === 'ZWJ';
            if (viaZwj) j++;
            if (cats[j] !== 'C' || (cfg.conjunctsNeedZwj && !viaZwj)) { i = j - (viaZwj ? 1 : 0); break; } // dead consonant closes the syllable
            i = j + 1;
            if (cats[i] === 'N') i++;
        }
        // Vowel signs, with a nukta or virama that may follow one.
        while (isMatra(cats[i])) {
            i++;
            if (cats[i] === 'N') i++;
            if (cats[i] === 'H' && !isMatra(cats[i + 1]) && cats[i + 1] !== 'C') i++;
        }
        while (cats[i] === 'SM') i++;
        out.push({ start, end: i, cluster: true });
    }
    return out;
}

// ── Feature masks and positions ──────────────────────────────────────

const F: Readonly<Record<string, number>> = {
    locl: 1 << 0, ccmp: 1 << 1, nukt: 1 << 2, akhn: 1 << 3, rphf: 1 << 4, rkrf: 1 << 5,
    pref: 1 << 6, blwf: 1 << 7, abvf: 1 << 8, half: 1 << 9, pstf: 1 << 10, vatu: 1 << 11,
    cjct: 1 << 12, pres: 1 << 13, abvs: 1 << 14, blws: 1 << 15, psts: 1 << 16, haln: 1 << 17,
    calt: 1 << 18,
};
const ALL_FEATURES = 0x7FFFF;
/** Masks a glyph never loses whatever its position. */
const GENERAL = F.locl | F.ccmp | F.nukt | F.akhn | F.rkrf | F.abvf | F.cjct
    | F.pres | F.abvs | F.blws | F.psts | F.haln | F.calt;

/** The features whose forms take a consonant out of the running for base. */
const SUBJOINING_FEATURES = ['blwf', 'pstf', 'pref', 'vatu'] as const;
const BASIC_STAGES = ['locl', 'ccmp', 'nukt', 'akhn', 'rphf', 'rkrf', 'pref', 'blwf', 'abvf', 'half', 'pstf', 'vatu', 'cjct'] as const;
const PRESENTATION = ['pres', 'abvs', 'blws', 'psts', 'haln', 'calt'] as const;

/** Visual positions, in the order glyphs end up. */
const POS_REPH = 1, POS_PRE_M = 2, POS_PRE_C = 3, POS_BASE = 4, POS_AFTER_BASE = 5,
    POS_ABV_M = 6, POS_BLW_M = 7, POS_PST_M = 8, POS_SM = 9;

interface Item {
    gid: number;
    cat: Cat;
    pos: number;
    mask: number;
    cps: number[];
    /** The Ra of a reph pair, and the reph glyph once it is substituted. */
    reph: boolean;
    /** The pre-base-reordering Ra once `pref` has substituted it. */
    pref: boolean;
}

// ── Lookups ──────────────────────────────────────────────────────────

/** A glyph set as parallel sorted range bounds, searched by bisection. */
interface RangeSet {
    readonly starts: Int32Array;
    readonly ends: Int32Array;
}

/**
 * A contextual lookup's rules, indexed by the glyph their first input set
 * covers. A rule whose first set is wider than {@link WILDCARD_SPAN} glyphs
 * goes to `wide` and is tried at every position instead.
 */
interface RuleIndex {
    readonly byFirst: ReadonlyMap<number, readonly OtlChainRule[]>;
    readonly wide: readonly OtlChainRule[];
}
const WILDCARD_SPAN = 512;

/** One lookup application: its index, the mask of the features that reach it in this stage, and the stage's tag for traces. */
interface PlanStep { readonly li: number; readonly mask: number; readonly tag: string; }

/** The compiled form of one font's layout for one script (see the module header). */
interface Layout {
    readonly lookups: Readonly<Record<number, OtlLookup>>;
    readonly features: Readonly<Record<string, readonly number[]>>;
    readonly sets: readonly RangeSet[];
    /** GDEF mark bitmap indexed by glyph id, or null when the font has no GDEF. */
    readonly marks: Uint8Array | null;
    readonly rules: ReadonlyMap<number, RuleIndex>;
    /**
     * Per lookup, the glyphs it can start a match on, as a bitmap indexed by
     * glyph id — `null` when a contextual rule's first set is too wide to
     * enumerate, so every position must be tried.
     */
    readonly coverage: ReadonlyMap<number, Uint8Array | null>;
    /** The basic features, one stage after another, flattened. */
    readonly basicPlan: readonly PlanStep[];
    /** The presentation features in one pass, lookup order. */
    readonly presentationPlan: readonly PlanStep[];
    /** Memo of `wouldSubstitute` answers per feature tag and glyph sequence. */
    readonly would: Map<string, boolean>;
    /** Memo of the base-finding probe per consonant glyph (`subjoinable`), and of the reph probe per Ra glyph. */
    readonly subjoinable: Map<number, boolean>;
    readonly rephForms: Map<number, boolean>;
    /** Receives one line per applied lookup when a caller asks for a trace. */
    trace?: (line: string) => void;
}

/**
 * Compiled layouts, memoised per FontData object and script tag list. A
 * WeakMap holds no font alive and allocates nothing at import time, so the
 * module stays side-effect free for bundlers.
 */
const LAYOUTS = /*#__PURE__*/ new WeakMap<FontData, Map<string, Layout>>();

function compileRangeSet(ranges: readonly number[]): RangeSet {
    const n = ranges.length >> 1;
    const pairs: [number, number][] = [];
    for (let k = 0; k < n; k++) pairs.push([ranges[2 * k], ranges[2 * k + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    const starts = new Int32Array(n);
    const ends = new Int32Array(n);
    for (let k = 0; k < n; k++) { starts[k] = pairs[k][0]; ends[k] = pairs[k][1]; }
    return { starts, ends };
}

/** Whether `gid` falls in the range set. */
function inRangeSet(set: RangeSet, gid: number): boolean {
    let lo = 0;
    let hi = set.starts.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (gid < set.starts[mid]) hi = mid - 1;
        else if (gid > set.ends[mid]) lo = mid + 1;
        else return true;
    }
    return false;
}

function compileRules(rules: readonly OtlChainRule[], sets: readonly RangeSet[]): RuleIndex {
    const byFirst = new Map<number, OtlChainRule[]>();
    const wide: OtlChainRule[] = [];
    for (const rule of rules) {
        const first = sets[rule.i[0]];
        if (!first) continue;
        let span = 0;
        for (let k = 0; k < first.starts.length; k++) span += first.ends[k] - first.starts[k] + 1;
        if (span > WILDCARD_SPAN) { wide.push(rule); continue; }
        for (let k = 0; k < first.starts.length; k++) {
            for (let gid = first.starts[k]; gid <= first.ends[k]; gid++) {
                const list = byFirst.get(gid);
                if (list) list.push(rule); else byFirst.set(gid, [rule]);
            }
        }
    }
    return { byFirst, wide };
}

/** A bitmap over glyph ids with the listed ids set. */
function bitmapOf(gids: readonly number[]): Uint8Array {
    let max = -1;
    for (const g of gids) if (g > max) max = g;
    const bits = new Uint8Array(max + 1);
    for (const g of gids) bits[g] = 1;
    return bits;
}

function compileLayout(
    lookups: Readonly<Record<number, OtlLookup>>,
    features: Readonly<Record<string, readonly number[]>>,
    rawSets: readonly (readonly number[])[],
    markRanges: readonly (readonly [number, number])[] | null,
): Layout {
    const sets = rawSets.map(compileRangeSet);
    const rules = new Map<number, RuleIndex>();
    const coverage = new Map<number, Uint8Array | null>();
    for (const key of Object.keys(lookups)) {
        const li = Number(key);
        const lk = lookups[li];
        if (!lk) continue;
        if (lk.t === 6) {
            const index = compileRules(lk.m, sets);
            rules.set(li, index);
            coverage.set(li, index.wide.length > 0 ? null : bitmapOf([...index.byFirst.keys()]));
        } else {
            coverage.set(li, bitmapOf(Object.keys(lk.m).map(Number)));
        }
    }
    let marks: Uint8Array | null = null;
    if (markRanges) {
        let max = -1;
        for (const [, b] of markRanges) if (b > max) max = b;
        marks = new Uint8Array(max + 1);
        for (const [a, b] of markRanges) marks.fill(1, a, b + 1);
    }
    const basicPlan: PlanStep[] = [];
    for (const tag of BASIC_STAGES) basicPlan.push(...planFor(lookups, features, [tag]));
    return {
        lookups, features, sets, marks, rules, coverage, basicPlan,
        presentationPlan: planFor(lookups, features, PRESENTATION),
        would: new Map(), subjoinable: new Map(), rephForms: new Map(),
    };
}

/** The script's compiled layout from `otl`, or one synthesised from the flat tables. */
function resolveLayout(fd: FontData, cfg: IndicScriptConfig): Layout {
    return layoutFor(fd, cfg.scriptTags, () => {
        // Pre-1.8.0 module or hand-made font data: the flat ligature table
        // plays every basic role at once and the merged singles are
        // presentation forms.
        const lookups: Record<number, OtlLookup> = {};
        const features: Record<string, number[]> = {};
        if (fd.ligatures && Object.keys(fd.ligatures).length > 0) {
            lookups[0] = { t: 4, f: 0, m: fd.ligatures };
            features.akhn = [0];
        }
        if (fd.gsub && Object.keys(fd.gsub).length > 0) {
            lookups[1] = { t: 1, f: 0, m: fd.gsub };
            features.pres = [1];
        }
        return compileLayout(lookups, features, [], null);
    });
}

/**
 * The compiled layout of `fd` under the first of `scriptTags` its `otl`
 * declares, memoised; `fallback` builds one when the font has no such tables.
 */
function layoutFor(fd: FontData, scriptTags: readonly string[], fallback: () => Layout): Layout {
    const key = scriptTags.join(',');
    let perScript = LAYOUTS.get(fd);
    if (!perScript) { perScript = new Map(); LAYOUTS.set(fd, perScript); }
    const cached = perScript.get(key);
    if (cached) return cached;
    let layout: Layout | undefined;
    const otl: OtlTables | null | undefined = fd.otl;
    if (otl) {
        for (const tag of scriptTags) {
            const features = otl.gsub.scripts[tag];
            if (features) {
                layout = compileLayout(otl.gsub.lookups, features, otl.gsub.sets ?? [], otl.gdef?.marks ?? null);
                break;
            }
        }
    }
    layout ??= fallback();
    perScript.set(key, layout);
    return layout;
}

/** Whether the font's GDEF classes `gid` as a mark (false without a GDEF). */
function isGdefMark(layout: Layout, gid: number): boolean {
    const marks = layout.marks;
    return marks !== null && gid < marks.length && marks[gid] === 1;
}

/**
 * Whether a feature of the layout would substitute exactly `gids`, with no
 * surrounding context — a contextual rule counts only when it has no
 * backtrack and no lookahead, as HarfBuzz's `would_substitute` decides.
 */
function wouldSubstitute(layout: Layout, tag: string, gids: readonly number[]): boolean {
    const indices = layout.features[tag];
    if (!indices) return false;
    const key = `${tag}:${gids.join(',')}`;
    const memo = layout.would.get(key);
    if (memo !== undefined) return memo;
    const answer = wouldSubstituteUncached(layout, indices, gids);
    layout.would.set(key, answer);
    return answer;
}

function wouldSubstituteUncached(layout: Layout, indices: readonly number[], gids: readonly number[]): boolean {
    for (const li of indices) {
        const lk = layout.lookups[li];
        if (!lk) continue;
        if (lk.t === 1 && gids.length === 1 && lk.m[gids[0]] !== undefined) return true;
        if (lk.t === 4 && gids.length >= 2) {
            const ligs = lk.m[gids[0]];
            if (!ligs) continue;
            for (const lig of ligs) {
                if (lig.length !== gids.length) continue;
                let ok = true;
                for (let k = 1; k < gids.length; k++) if (lig[k] !== gids[k]) { ok = false; break; }
                if (ok) return true;
            }
        }
        if (lk.t === 6) {
            const index = layout.rules.get(li);
            if (!index) continue;
            if (matchesZeroContext(layout, index.byFirst.get(gids[0]), gids)
                || matchesZeroContext(layout, index.wide, gids)) return true;
        }
    }
    return false;
}

function matchesZeroContext(layout: Layout, rules: readonly OtlChainRule[] | undefined, gids: readonly number[]): boolean {
    if (!rules) return false;
    for (const rule of rules) {
        if (rule.b.length > 0 || rule.l.length > 0 || rule.i.length !== gids.length) continue;
        let ok = true;
        for (let k = 0; k < gids.length; k++) if (!inSet(layout, rule.i[k], gids[k])) { ok = false; break; }
        if (ok) return true;
    }
    return false;
}

/** Whether `gid` falls in the shared glyph set `idx`. */
function inSet(layout: Layout, idx: number, gid: number): boolean {
    const set = layout.sets[idx];
    return set !== undefined && inRangeSet(set, gid);
}

/** Apply one lookup across the syllable with `mask`, honouring IgnoreMarks. */
function applyLookup(items: Item[], li: number, mask: number, layout: Layout): void {
    const cov = layout.coverage.get(li);
    if (cov === null) {
        for (let i = 0; i < items.length; i++) i = applyAt(items, li, i, mask, layout);
        return;
    }
    if (cov === undefined) return;
    for (let i = 0; i < items.length; i++) {
        const gid = items[i].gid;
        if (gid < cov.length && cov[gid] === 1) i = applyAt(items, li, i, mask, layout);
    }
}

/**
 * Apply one lookup at position `i` when it matches there. Returns the index
 * of the last item the application consumed, so a caller stepping through
 * the syllable continues after it.
 */
function applyAt(items: Item[], li: number, i: number, mask: number, layout: Layout): number {
    const lk = layout.lookups[li];
    if (lk === undefined) return i;
    const ignoreMarks = (lk.f & 0x0008) !== 0 && layout.marks !== null;

    const it = items[i];
    if (it === undefined || (ignoreMarks && isGdefMark(layout, it.gid))) return i;
    // The mask gates the glyphs a feature may change. A contextual rule's
    // input is matched regardless (a Bengali `blwf` rule names the base
    // consonant before the virama and the Ra it forms); the nested lookups
    // it fires check the mask at the positions they change.
    if (lk.t !== 6 && (it.mask & mask) === 0) return i;

    if (lk.t === 1) {
        const to = lk.m[it.gid];
        if (to !== undefined) it.gid = to;
        return i;
    }
    if (lk.t === 2) {
        const seq = lk.m[it.gid];
        if (seq === undefined) return i;
        const parts: Item[] = seq.map((g, k) => ({
            gid: g, cat: it.cat, pos: it.pos, mask: it.mask,
            cps: k === 0 ? it.cps : [], reph: k === 0 && it.reph, pref: k === 0 && it.pref,
        }));
        items.splice(i, 1, ...parts);
        return i + parts.length - 1;
    }
    if (lk.t === 4) {
        const ligs = lk.m[it.gid];
        if (!ligs) return i;
        for (const lig of ligs) {
            // Match the components, skipping ignorable marks.
            const matched: number[] = [];
            let j = i + 1;
            let ok = true;
            for (let k = 1; k < lig.length; k++) {
                while (j < items.length && ignoreMarks && isGdefMark(layout, items[j].gid)) j++;
                if (j >= items.length || items[j].gid !== lig[k] || (items[j].mask & mask) === 0) { ok = false; break; }
                matched.push(j);
                j++;
            }
            if (!ok) continue;
            const cps = [...it.cps];
            for (const m of matched) cps.push(...items[m].cps);
            it.gid = lig[0];
            it.cps = cps;
            for (let k = matched.length - 1; k >= 0; k--) items.splice(matched[k], 1);
            return i;
        }
        return i;
    }

    // Contextual: the first rule whose backtrack, input and lookahead match
    // here fires its nested lookups at the matched input positions. Rules
    // are tried in font order: the indexed ones for this glyph, then the
    // wide ones, each list already in that order.
    const index = layout.rules.get(li);
    if (!index) return i;
    const own = index.byFirst.get(it.gid);
    if (own) {
        const r = applyContextRules(items, own, i, it, mask, layout, ignoreMarks);
        if (r >= 0) return r;
    }
    if (index.wide.length > 0) {
        const r = applyContextRules(items, index.wide, i, it, mask, layout, ignoreMarks);
        if (r >= 0) return r;
    }
    return i;
}

/** Try `rules` at position `i`; returns the last consumed index, or −1 when none matched. */
function applyContextRules(
    items: Item[], rules: readonly OtlChainRule[], i: number, it: Item, mask: number, layout: Layout, ignoreMarks: boolean,
): number {
    for (const rule of rules) {
        if (!inSet(layout, rule.i[0], it.gid)) continue;
        const input: Item[] = [it];
        let j = i + 1;
        let ok = true;
        for (let k = 1; k < rule.i.length; k++) {
            while (j < items.length && ignoreMarks && isGdefMark(layout, items[j].gid)) j++;
            if (j >= items.length || !inSet(layout, rule.i[k], items[j].gid)) { ok = false; break; }
            input.push(items[j]);
            j++;
        }
        if (!ok) continue;
        let p = i - 1;
        for (const set of rule.b) {
            while (p >= 0 && ignoreMarks && isGdefMark(layout, items[p].gid)) p--;
            if (p < 0 || !inSet(layout, set, items[p].gid)) { ok = false; break; }
            p--;
        }
        if (!ok) continue;
        for (const set of rule.l) {
            while (j < items.length && ignoreMarks && isGdefMark(layout, items[j].gid)) j++;
            if (j >= items.length || !inSet(layout, set, items[j].gid)) { ok = false; break; }
            j++;
        }
        if (!ok) continue;

        for (const [seqIdx, nestedIdx] of rule.a) {
            const target = input[seqIdx];
            if (target === undefined || layout.lookups[nestedIdx] === undefined) continue;
            const at = items.indexOf(target);
            if (at < 0) continue; // absorbed into an earlier ligature
            applyAt(items, nestedIdx, at, mask, layout);
        }
        const last = items.indexOf(input[input.length - 1]);
        return last >= 0 ? last : Math.max(i, items.indexOf(it));
    }
    return -1;
}

/** The lookups the listed features reach, once each, in lookup order, with their masks — computed once per layout. */
function planFor(
    lookups: Readonly<Record<number, OtlLookup>>, features: Readonly<Record<string, readonly number[]>>, tags: readonly string[],
): PlanStep[] {
    const masks = new Map<number, number>();
    for (const tag of tags) {
        const indices = features[tag];
        if (!indices) continue;
        for (const li of indices) masks.set(li, (masks.get(li) ?? 0) | F[tag]);
    }
    const tag = tags.join('+');
    return [...masks.keys()].sort((a, b) => a - b)
        .filter(li => lookups[li] !== undefined)
        .map(li => ({ li, mask: masks.get(li) ?? 0, tag }));
}

/** Apply a plan's lookups in order. */
function applyPlan(items: Item[], layout: Layout, plan: readonly PlanStep[]): void {
    const trace = layout.trace;
    for (let k = 0; k < plan.length; k++) {
        const step = plan[k];
        const before = trace ? items.map(it => it.gid).join(' ') : '';
        applyLookup(items, step.li, step.mask, layout);
        if (trace) {
            const after = items.map(it => it.gid).join(' ');
            if (after !== before) trace(`${step.tag} lookup ${step.li} (t${layout.lookups[step.li]?.t ?? 0}): ${before} -> ${after}`);
        }
    }
}

// ── The engine ───────────────────────────────────────────────────────

/** A glyph with the code points it stands for, as {@link applyGsubFeatures} takes and returns them. */
export interface GlyphWithSource {
    readonly gid: number;
    readonly cps: readonly number[];
}

/**
 * Apply the GSUB lookups of `tags` (under the first of `scriptTags` the font
 * declares) to a plain glyph sequence, every glyph eligible, in lookup
 * order — what a script without syllable structure needs from the font's
 * layout tables: `ccmp` composition for Latin combining marks, for example.
 * Returns the input untouched when the font has no such tables.
 *
 * @since 1.8.0
 */
export function applyGsubFeatures(
    glyphs: readonly GlyphWithSource[], fontData: FontData, scriptTags: readonly string[], tags: readonly string[],
): GlyphWithSource[] {
    if (!fontData.otl) return [...glyphs];
    const layout = layoutFor(fontData, scriptTags, () => compileLayout({}, {}, [], null));
    if (Object.keys(layout.features).length === 0) return [...glyphs];
    const items: Item[] = glyphs.map(g => ({ gid: g.gid, cat: 'O', pos: 0, mask: ALL_FEATURES, cps: [...g.cps], reph: false, pref: false }));
    applyPlan(items, layout, planFor(layout.lookups, layout.features, tags));
    return items.map(it => ({ gid: it.gid, cps: it.cps }));
}

/**
 * Shape `str` for a font with the script described by `cfg`.
 *
 * @param str - Text in logical order
 * @param fontData - A registered font's data; `otl` drives the substitutions
 * @param cfg - The script's configuration
 * @returns Positioned glyphs in visual order, each naming its source code points
 * @since 1.8.0
 */
export function shapeIndicText(str: string, fontData: FontData, cfg: IndicScriptConfig): ShapedGlyph[] {
    return shapeIndicTextTraced(str, fontData, cfg, undefined);
}

/**
 * {@link shapeIndicText} with a trace of every lookup that changed the
 * syllable — a debugging aid for tests and tooling, not a rendering path.
 *
 * @since 1.8.0
 */
export function shapeIndicTextTraced(
    str: string, fontData: FontData, cfg: IndicScriptConfig, trace: ((line: string) => void) | undefined,
): ShapedGlyph[] {
    const layout = resolveLayout(fontData, cfg);
    layout.trace = trace;
    try {
        return shapeWithLayout(str, fontData, cfg, layout);
    } finally {
        layout.trace = undefined;
    }
}

function shapeWithLayout(str: string, fontData: FontData, cfg: IndicScriptConfig, layout: Layout): ShapedGlyph[] {
    const { cmap } = fontData;
    const gidOf = (cp: number): number => cmap[(cp === 0x202F || cp === 0xA0) ? 0x20 : cp] || 0;
    const viramaGid = gidOf(cfg.virama);
    const zwjGid = gidOf(0x200D);

    const cps: number[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        cps.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }

    // With a GDEF table the font says which glyphs are marks; without one, a
    // glyph the font anchors is a mark, and so is a combining character
    // class — a spacing vowel sign (pre- or post-base) is not.
    const hasGdef = layout.marks !== null;
    const anchored = fontData.markAnchors?.marks;
    const isMark = (it: Item): boolean =>
        hasGdef ? isGdefMark(layout, it.gid)
            : (it.reph
                || (anchored !== undefined && anchored[it.gid] !== undefined)
                || (isMarkLike(it.cat) && it.cat !== 'MPre' && it.cat !== 'MPst'));

    const out: AttachItem[] = [];
    for (const syl of splitIndicSyllables(cps, cfg)) {
        if (!syl.cluster) {
            for (let k = syl.start; k < syl.end; k++) {
                const cp = cps[k];
                if (cp === 0x200D || cp === 0x200C) continue; // an orphan joiner draws nothing
                out.push({ gid: gidOf(cp), isMark: false, cps: [cp] });
            }
            continue;
        }
        const items = buildItems(cps.slice(syl.start, syl.end), cfg, gidOf);
        shapeSyllable(items, cfg, layout, viramaGid, zwjGid);
        for (const it of items) {
            if (it.cat === 'ZWJ' || it.cat === 'ZWNJ') continue;
            out.push({ gid: it.gid, isMark: isMark(it), cps: it.cps, keepAdvance: hasGdef });
        }
    }
    return attachMarks(out, fontData);
}

/** Items of one syllable, two-part vowel signs decomposed. */
function buildItems(cps: readonly number[], cfg: IndicScriptConfig, gidOf: (cp: number) => number): Item[] {
    const items: Item[] = [];
    for (const cp of cps) {
        const parts = cfg.splitMatras[cp];
        if (parts && parts.every(p => gidOf(p) > 0)) {
            parts.forEach((p, k) => items.push({
                gid: gidOf(p), cat: k === 0 ? 'MPre' : 'MPst', pos: 0, mask: ALL_FEATURES,
                cps: k === 0 ? [cp] : [], reph: false, pref: false,
            }));
            continue;
        }
        items.push({ gid: gidOf(cp), cat: classify(cp, cfg), pos: 0, mask: ALL_FEATURES, cps: [cp], reph: false, pref: false });
    }
    return items;
}

function shapeSyllable(items: Item[], cfg: IndicScriptConfig, layout: Layout, viramaGid: number, zwjGid: number): void {
    // ── Reph ─────────────────────────────────────────────────────────
    let firstC = 0;
    let hasReph = false;
    if (cfg.rephMode !== 'none' && items.length >= 3 && items[0].cat === 'C' && items[0].cps[0] === cfg.ra && items[1].cat === 'H') {
        const ra = items[0].gid;
        let forms = layout.rephForms.get(ra);
        if (forms === undefined) {
            forms = cfg.rephMode === 'implicit'
                ? wouldSubstitute(layout, 'rphf', [ra, viramaGid])
                : wouldSubstitute(layout, 'rphf', [ra, viramaGid, zwjGid]) || wouldSubstitute(layout, 'rphf', [ra, viramaGid]);
            layout.rephForms.set(ra, forms);
        }
        if (cfg.rephMode === 'implicit' && items[2].cat === 'C' && forms) {
            hasReph = true; firstC = 2;
        } else if (cfg.rephMode === 'explicit' && items[2].cat === 'ZWJ' && items.length >= 4 && items[3].cat === 'C' && forms) {
            hasReph = true; firstC = 3;
        }
    }

    // ── Base: the last consonant without a below- or post-base form ──
    const consonants: number[] = [];
    for (let i = firstC; i < items.length; i++) if (items[i].cat === 'C' || items[i].cat === 'V') consonants.push(i);
    let base = consonants.length > 0 ? consonants[0] : -1;
    const subjoinable = (i: number): boolean => {
        const gid = items[i].gid;
        const memo = layout.subjoinable.get(gid);
        if (memo !== undefined) return memo;
        const seqs: number[][] = [[viramaGid, gid], [gid, viramaGid]];
        if (cfg.conjunctsNeedZwj) seqs.push([viramaGid, zwjGid, gid]);
        let answer = false;
        for (const tag of SUBJOINING_FEATURES) {
            for (const s of seqs) if (wouldSubstitute(layout, tag, s)) { answer = true; break; }
            if (answer) break;
        }
        layout.subjoinable.set(gid, answer);
        return answer;
    };
    for (let k = consonants.length - 1; k >= 0; k--) {
        const i = consonants[k];
        if (k === 0 || items[i].cat === 'V') { base = i; break; }
        const prev = items[i - 1].cat === 'ZWJ' ? i - 2 : i - 1;
        if (prev >= 0 && items[prev].cat === 'H' && subjoinable(i)) continue;
        base = i;
        break;
    }
    if (base < 0) return;

    // ── Positions and masks ──────────────────────────────────────────
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (hasReph && i < firstC) { it.pos = POS_REPH; it.mask = GENERAL | F.rphf; it.reph = i === 0; continue; }
        if (i < base) {
            it.pos = it.cat === 'MPre' ? POS_PRE_M : POS_PRE_C;
            it.mask = GENERAL | F.half | (cfg.blwfMode === 'preAndPost' ? F.blwf : 0);
            continue;
        }
        if (i === base) { it.pos = POS_BASE; it.mask = GENERAL; continue; }
        switch (it.cat) {
            case 'MPre': it.pos = POS_PRE_M; it.mask = GENERAL; break;
            case 'MAbv': it.pos = POS_ABV_M; it.mask = GENERAL; break;
            case 'MBlw': it.pos = POS_BLW_M; it.mask = GENERAL; break;
            case 'MPst': it.pos = POS_PST_M; it.mask = GENERAL; break;
            case 'SM': it.pos = POS_SM; it.mask = GENERAL; break;
            default:
                // Consonants after the base, their viramas, nuktas and joiners.
                it.pos = POS_AFTER_BASE;
                it.mask = GENERAL | F.blwf | F.pstf | F.vatu | F.pref;
        }
    }
    // A nukta or virama belongs to the consonant it follows: before the base
    // it shares that consonant's half-form mask, after it the post-base one.
    const POST_MASK = GENERAL | F.blwf | F.pstf | F.vatu | F.pref;
    for (let i = 1; i < items.length; i++) {
        if (items[i].cat !== 'N' && items[i].cat !== 'H') continue;
        const prev = items[i - 1];
        if (prev.pos === POS_PRE_C || prev.pos === POS_REPH) {
            items[i].pos = prev.pos;
            items[i].mask = prev.mask;
        } else if (prev.pos === POS_BASE) {
            items[i].pos = POS_AFTER_BASE;
            items[i].mask = POST_MASK;
        }
    }
    // Initial reordering: pre-base vowel signs move to the front, after the reph pair.
    stableSortByPos(items, [POS_PRE_M]);
    if (layout.trace) layout.trace(`syllable base=${base} reph=${hasReph}: ${items.map(it => `${it.gid}@${it.pos}/${it.mask.toString(16)}`).join(' ')}`);

    // ── Basic features, one stage each ───────────────────────────────
    applyPlan(items, layout, layout.basicPlan);

    // ── Final reordering ─────────────────────────────────────────────
    finalReorder(items, cfg, hasReph);
    if (layout.trace) layout.trace(`reordered: ${items.map(it => it.gid).join(' ')}`);

    // ── Presentation features, one pass ──────────────────────────────
    applyPlan(items, layout, layout.presentationPlan);
}

/** Move every item whose position is in `front` before the others, keeping relative order. */
function stableSortByPos(items: Item[], front: readonly number[]): void {
    const head: Item[] = [];
    const rest: Item[] = [];
    let rephPair = 0;
    while (rephPair < items.length && items[rephPair].pos === POS_REPH) rephPair++;
    for (let i = rephPair; i < items.length; i++) (front.includes(items[i].pos) ? head : rest).push(items[i]);
    items.splice(rephPair, items.length - rephPair, ...head, ...rest);
}

function finalReorder(items: Item[], cfg: IndicScriptConfig, hasReph: boolean): void {
    const baseIdx = (): number => items.findIndex(it => it.pos === POS_BASE);

    // Pre-base vowel signs: after the last virama before the base that no
    // half form absorbed, else at the syllable start (before the reph pair,
    // which moves away below).
    let b = baseIdx();
    if (b > 0) {
        const pre = items.filter((it, i) => i < b && it.pos === POS_PRE_M);
        if (pre.length > 0) {
            for (const it of pre) items.splice(items.indexOf(it), 1);
            b = baseIdx();
            let at = 0;
            for (let i = b - 1; i >= 0; i--) {
                if (items[i].cat === 'H' && items[i].pos !== POS_REPH) { at = i + 1; if (items[at] && (items[at].cat === 'ZWJ' || items[at].cat === 'ZWNJ')) at++; break; }
            }
            items.splice(at, 0, ...pre);
        }
    }

    // Reph: from the front of the syllable to its script's position.
    if (hasReph) {
        const rephIdx = items.findIndex(it => it.reph);
        if (rephIdx >= 0 && items[rephIdx].pos === POS_REPH) {
            const [reph] = items.splice(rephIdx, 1);
            // Any leftover of the pair (a virama the font did not absorb) rides along.
            const b2 = baseIdx();
            let at = items.length;
            if (b2 >= 0) {
                at = b2 + 1;
                if (cfg.rephPosition === 'afterSub') {
                    while (at < items.length && items[at].pos === POS_AFTER_BASE) at++;
                } else if (cfg.rephPosition === 'beforePost') {
                    while (at < items.length && items[at].pos !== POS_PST_M && items[at].pos !== POS_SM) at++;
                } else {
                    while (at < items.length && items[at].pos !== POS_SM) at++;
                }
            }
            reph.pos = POS_AFTER_BASE;
            items.splice(at, 0, reph);
        }
    }

    // Pre-base-reordering Ra: a `pref` form goes just before the base.
    const prefIdx = items.findIndex(it => it.pref);
    if (prefIdx >= 0) {
        const [ra] = items.splice(prefIdx, 1);
        const b3 = baseIdx();
        items.splice(b3 < 0 ? 0 : b3, 0, ra);
    }
}
