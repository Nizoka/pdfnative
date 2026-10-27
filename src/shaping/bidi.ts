/**
 * pdfnative — Unicode Bidirectional Algorithm (UAX #9)
 * =====================================================
 * Pure JS implementation of the Unicode Bidirectional Algorithm, complete
 * since v1.9.0 and checked line by line against the Unicode Character
 * Database's BidiCharacterTest (`tests/shaping/bidi-conformance.test.ts`).
 *
 * The rules, in the order the algorithm applies them:
 *   - P2–P3  paragraph level from the first strong character outside isolates
 *            (or forced through `direction`)
 *   - X1–X8  explicit embeddings, overrides and isolates: the directional
 *            status stack (depth 125), overflow counters, LRE/RLE/LRO/RLO/PDF,
 *            LRI/RLI/FSI/PDI with BD9 matching
 *   - X9–X10 removal of the explicit formatting characters and BN, level
 *            runs chained into isolating run sequences with sos/eos
 *   - W1–W7  weak types (NSM, EN/AN, AL, separators, terminators)
 *   - N0     paired brackets (BD14–BD16 over BidiBrackets.txt, the two
 *            canonical equivalences, 63-deep pairing stack)
 *   - N1–N2  the remaining neutrals and isolate formatting characters
 *   - I1–I2  implicit levels (numbers always land on an even level, so a
 *            digit run keeps its logical order in RTL text)
 *   - L1     segment separators and trailing whitespace back to the paragraph
 *            level, per line
 *   - L2     reordering from the highest level down to the lowest odd level
 *   - L4     glyph mirroring of every odd-level character (BidiMirroring.txt)
 *
 * Classification comes from the generated `bidi-class-data.ts` (the UCD's
 * DerivedBidiClass.txt, @missing defaults included); brackets from
 * `bidi-brackets-data.ts`; mirrors from `bidi-mirroring-data.ts`. The three
 * are regenerated from `scripts/data/` and drift-checked by
 * `npm run verify:unicode`.
 *
 * Paragraphs and lines: `resolveBidiLevels()` resolves a paragraph once
 * (P1–I2) and `bidiRunsForLine()` reorders each wrapped line from those
 * levels (L1–L4), as UAX #9 prescribes — a continuation line that starts
 * with a Latin word stays part of its RTL paragraph. `resolveBidiRuns()`
 * does both for a single-line text.
 *
 * History: 1.1.0 isolates, 1.2.0 embeddings mapped to isolates, 1.3.0
 * overrides, 1.7.0 I1/I2 and the full L4 table, 1.9.0 the full algorithm
 * (#92: the pre-1.9.0 resolver re-typed sentence punctuation after a Latin
 * word as L in RTL paragraphs and gave bracket pairs around Latin content
 * level L; both deviated from N1/N2 and N0).
 *
 * Deliberate simplification: a paragraph separator (type B) inside the text
 * resets the explicit state (X8) and takes the paragraph level, but the
 * paragraph level itself is not re-detected after it — callers split
 * paragraphs on line breaks before resolving (P1).
 *
 * References:
 *   - Unicode Standard Annex #9: https://unicode.org/reports/tr9/
 *   - ISO 32000-1 §14.8.2.3 (logical structure and reading order)
 */

import { BIDI_MIRRORING_PAIRS } from './bidi-mirroring-data.js';
import { BIDI_BRACKET_PAIRS } from './bidi-brackets-data.js';
import { BIDI_CLASS_RANGES, BIDI_CLASS_NAMES } from './bidi-class-data.js';
import type { TextDirection } from '../types/pdf-types.js';

// ── Bidi Character Types ─────────────────────────────────────────────

/** Bidirectional character type (the UCD Bidi_Class property, short names). */
export type BidiType = (typeof BIDI_CLASS_NAMES)[number];

/** A run of text with a resolved embedding level. */
export interface BidiRun {
    /** The run's characters in visual order (an odd-level run is reversed and mirrored). */
    readonly text: string;
    /** Resolved embedding level: even = left-to-right, odd = right-to-left. */
    readonly level: number;
    /** Offset of the run's first logical character in the source text. */
    readonly start: number;
}

// ── Character Type Classification ────────────────────────────────────

/** Code points below this bound are classified through a flat table built once. */
const FAST_TABLE_LIMIT = 0x0800;
let fastTable: Uint8Array | null = null;

function buildFastTable(): Uint8Array {
    const table = new Uint8Array(FAST_TABLE_LIMIT); // 0 = L
    for (let i = 0; i + 2 < BIDI_CLASS_RANGES.length; i += 3) {
        const start = BIDI_CLASS_RANGES[i];
        if (start >= FAST_TABLE_LIMIT) break;
        const end = Math.min(BIDI_CLASS_RANGES[i + 1], FAST_TABLE_LIMIT - 1);
        table.fill(BIDI_CLASS_RANGES[i + 2], start, end + 1);
    }
    return table;
}

/**
 * Classify a Unicode code point into its bidi character type
 * (Bidi_Class, from the generated UCD table; L for unlisted code points).
 *
 * @param cp - Unicode code point
 * @returns Bidi character type
 */
export function classifyBidiType(cp: number): BidiType {
    if (cp < FAST_TABLE_LIMIT) {
        if (fastTable === null) fastTable = buildFastTable();
        return BIDI_CLASS_NAMES[fastTable[cp]];
    }
    let lo = 0;
    let hi = BIDI_CLASS_RANGES.length / 3 - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const start = BIDI_CLASS_RANGES[mid * 3];
        if (cp < start) hi = mid - 1;
        else if (cp > BIDI_CLASS_RANGES[mid * 3 + 1]) lo = mid + 1;
        else return BIDI_CLASS_NAMES[BIDI_CLASS_RANGES[mid * 3 + 2]];
    }
    return 'L';
}

const isIsolateInitiator = (t: BidiType): boolean => t === 'LRI' || t === 'RLI' || t === 'FSI';
/** Types X9 removes from the algorithm's view. */
const isRemovedByX9 = (t: BidiType): boolean =>
    t === 'BN' || t === 'LRE' || t === 'RLE' || t === 'LRO' || t === 'RLO' || t === 'PDF';
/** Neutral and isolate formatting types (NI) for N1/N2. */
const isNeutralOrIsolate = (t: BidiType): boolean =>
    t === 'B' || t === 'S' || t === 'WS' || t === 'ON' || t === 'LRI' || t === 'RLI' || t === 'FSI' || t === 'PDI';

// ── Paragraph Level Detection (P2-P3) ────────────────────────────────

/**
 * Determine the paragraph embedding level.
 * P2: find the first strong character (L, R, AL), skipping the characters
 * between an isolate initiator and its matching PDI (or the end of the
 * text when it has none). P3: R or AL → 1, otherwise 0.
 *
 * @param types - Bidi character types of the paragraph
 * @returns 0 for LTR, 1 for RTL
 */
export function detectParagraphLevel(types: readonly BidiType[]): number {
    let depth = 0;
    for (const t of types) {
        if (isIsolateInitiator(t)) depth++;
        else if (t === 'PDI') { if (depth > 0) depth--; }
        else if (depth === 0) {
            if (t === 'L') return 0;
            if (t === 'R' || t === 'AL') return 1;
        }
    }
    return 0; // default LTR
}

// ── Explicit levels (X1–X8) and isolating run sequences (X9–X10) ─────

/** Maximum explicit embedding level (BD2). */
const MAX_DEPTH = 125;

interface StatusEntry {
    readonly level: number;
    /** Directional override status: 'N' neutral, else the forced type. */
    readonly override: 'N' | 'L' | 'R';
    readonly isolate: boolean;
}

/** The outcome of P2–I2 for one paragraph, per code point. */
interface ParagraphResolution {
    readonly paraLevel: number;
    readonly levels: number[];
    /** Original Bidi_Class per code point (L1 and the run assembly read it). */
    readonly original: BidiType[];
}

/**
 * BD9: the matching PDI of every isolate initiator (-1 when unmatched) and
 * whether each PDI closes an initiator.
 */
function matchIsolates(types: readonly BidiType[]): { matchingPdi: Int32Array; pdiMatched: Uint8Array } {
    const len = types.length;
    const matchingPdi = new Int32Array(len).fill(-1);
    const pdiMatched = new Uint8Array(len);
    const open: number[] = [];
    for (let i = 0; i < len; i++) {
        const t = types[i];
        if (isIsolateInitiator(t)) open.push(i);
        else if (t === 'PDI' && open.length > 0) {
            const opener = open.pop() as number;
            matchingPdi[opener] = i;
            pdiMatched[i] = 1;
        } else if (t === 'B') open.length = 0;
    }
    return { matchingPdi, pdiMatched };
}

/**
 * Resolve one paragraph (code points) through P2–I2.
 *
 * @param codePoints - The paragraph in logical order
 * @param forcedLevel - Paragraph level to use instead of P2–P3
 */
function resolveParagraph(codePoints: readonly number[], forcedLevel?: number): ParagraphResolution {
    const len = codePoints.length;
    const original: BidiType[] = new Array(len);
    for (let i = 0; i < len; i++) original[i] = classifyBidiType(codePoints[i]);
    const types: BidiType[] = original.slice();
    const levels: number[] = new Array(len).fill(0);
    const paraLevel = forcedLevel !== undefined ? forcedLevel : detectParagraphLevel(original);
    if (len === 0) return { paraLevel, levels, original };

    // Fast path — no explicit formatting character and no paragraph separator
    // (the common case): X1–X8 leave every character at the paragraph level,
    // so the retained characters form one isolating run sequence.
    let hasExplicit = false;
    for (let i = 0; i < len; i++) {
        const t = original[i];
        if (t === 'B' || t === 'PDI' || isIsolateInitiator(t) || (isRemovedByX9(t) && t !== 'BN')) { hasExplicit = true; break; }
    }
    if (!hasExplicit) {
        levels.fill(paraLevel);
        const explicit = levels.slice();
        const removed = new Uint8Array(len);
        const seq: number[] = [];
        for (let i = 0; i < len; i++) {
            if (original[i] === 'BN') removed[i] = 1;
            else seq.push(i);
        }
        if (seq.length > 0) resolveSequence(seq, types, original, codePoints, explicit, levels, paraLevel, removed, len);
        settleRemovedLevels(levels, removed, paraLevel, len);
        return { paraLevel, levels, original };
    }

    const { matchingPdi, pdiMatched } = matchIsolates(original);

    // X1: the directional status stack.
    const stack: StatusEntry[] = [{ level: paraLevel, override: 'N', isolate: false }];
    let overflowIsolate = 0;
    let overflowEmbedding = 0;
    let validIsolate = 0;
    const nextOdd = (l: number): number => (l + 1) | 1;
    const nextEven = (l: number): number => (l + 2) & ~1;

    for (let i = 0; i < len; i++) {
        const t = original[i];
        const top = stack[stack.length - 1];
        switch (t) {
            case 'RLE': case 'LRE': case 'RLO': case 'LRO': {
                // X2–X5
                levels[i] = top.level;
                const rtl = t === 'RLE' || t === 'RLO';
                const newLevel = rtl ? nextOdd(top.level) : nextEven(top.level);
                if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
                    const override = t === 'RLO' ? 'R' : t === 'LRO' ? 'L' : 'N';
                    stack.push({ level: newLevel, override, isolate: false });
                } else if (overflowIsolate === 0) {
                    overflowEmbedding++;
                }
                break;
            }
            case 'RLI': case 'LRI': case 'FSI': {
                // X5a–X5c
                levels[i] = top.level;
                if (top.override !== 'N') types[i] = top.override;
                let rtl = t === 'RLI';
                if (t === 'FSI') {
                    const end = matchingPdi[i] === -1 ? len : matchingPdi[i];
                    rtl = detectParagraphLevel(original.slice(i + 1, end)) === 1;
                }
                const newLevel = rtl ? nextOdd(top.level) : nextEven(top.level);
                if (newLevel <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
                    validIsolate++;
                    stack.push({ level: newLevel, override: 'N', isolate: true });
                } else {
                    overflowIsolate++;
                }
                break;
            }
            case 'PDI': {
                // X6a
                if (overflowIsolate > 0) overflowIsolate--;
                else if (validIsolate > 0) {
                    overflowEmbedding = 0;
                    while (!stack[stack.length - 1].isolate) stack.pop();
                    stack.pop();
                    validIsolate--;
                }
                const now = stack[stack.length - 1];
                levels[i] = now.level;
                if (now.override !== 'N') types[i] = now.override;
                break;
            }
            case 'PDF': {
                // X7
                levels[i] = top.level;
                if (overflowIsolate > 0) { /* nothing */ }
                else if (overflowEmbedding > 0) overflowEmbedding--;
                else if (!top.isolate && stack.length >= 2) stack.pop();
                break;
            }
            case 'B': {
                // X8: everything is terminated at a paragraph separator.
                levels[i] = paraLevel;
                stack.length = 1;
                overflowIsolate = 0;
                overflowEmbedding = 0;
                validIsolate = 0;
                break;
            }
            case 'BN':
                levels[i] = top.level; // X9 removes it; the level is refined below
                break;
            default:
                // X6
                levels[i] = top.level;
                if (top.override !== 'N') types[i] = top.override;
        }
    }

    // The explicit levels X1–X8 produced: X10 reads them for sos/eos while
    // `levels` receives the implicit levels of I1/I2 sequence by sequence.
    const explicit = levels.slice();

    // X9: the characters the rest of the algorithm ignores.
    const removed = new Uint8Array(len);
    for (let i = 0; i < len; i++) if (isRemovedByX9(original[i])) removed[i] = 1;

    // X10: level runs over the retained characters.
    const runs: number[][] = [];
    const runOfPdi = new Map<number, number>();
    let current: number[] | null = null;
    let currentLevel = -1;
    for (let i = 0; i < len; i++) {
        if (removed[i]) continue;
        if (current === null || levels[i] !== currentLevel) {
            current = [i];
            currentLevel = levels[i];
            runs.push(current);
            if (original[i] === 'PDI' && pdiMatched[i]) runOfPdi.set(i, runs.length - 1);
        } else {
            current.push(i);
        }
    }

    // Chain level runs into isolating run sequences (BD13).
    const consumed = new Uint8Array(runs.length);
    for (let r = 0; r < runs.length; r++) {
        if (consumed[r]) continue;
        const first = runs[r][0];
        if (original[first] === 'PDI' && pdiMatched[first] && runs[r].length > 0 && r > 0) {
            // Appended to its initiator's sequence when that initiator ends a run;
            // otherwise (the initiator shares its run with the isolate's content,
            // an overflow isolate) this run starts a sequence of its own.
            const initiator = findInitiator(matchingPdi, first);
            if (initiator !== -1 && isLastOfItsRun(runs, initiator, removed, len)) continue;
        }
        const seq: number[] = [];
        let r2 = r;
        for (;;) {
            consumed[r2] = 1;
            const run = runs[r2];
            for (const i of run) seq.push(i);
            const last = run[run.length - 1];
            if (!isIsolateInitiator(original[last]) || matchingPdi[last] === -1) break;
            const next = runOfPdi.get(matchingPdi[last]);
            if (next === undefined || consumed[next]) break;
            r2 = next;
        }
        resolveSequence(seq, types, original, codePoints, explicit, levels, paraLevel, removed, len);
    }

    settleRemovedLevels(levels, removed, paraLevel, len);
    return { paraLevel, levels, original };
}

/**
 * Retained X9 characters take the level of the preceding retained character
 * (else the following, else the paragraph level) so they stay inside the run
 * they belong to (UAX #9 §5.2).
 */
function settleRemovedLevels(levels: number[], removed: Uint8Array, paraLevel: number, len: number): void {
    for (let i = 0; i < len; i++) {
        if (!removed[i]) continue;
        let j = i - 1;
        while (j >= 0 && removed[j]) j--;
        if (j >= 0) { levels[i] = levels[j]; continue; }
        let k = i + 1;
        while (k < len && removed[k]) k++;
        levels[i] = k < len ? levels[k] : paraLevel;
    }
}

/** The isolate initiator a matched PDI closes. */
function findInitiator(matchingPdi: Int32Array, pdi: number): number {
    for (let i = pdi - 1; i >= 0; i--) if (matchingPdi[i] === pdi) return i;
    return -1;
}

/** Whether the retained character after `index` starts a new level run (or there is none). */
function isLastOfItsRun(runs: readonly number[][], index: number, removed: Uint8Array, len: number): boolean {
    let next = index + 1;
    while (next < len && removed[next]) next++;
    if (next >= len) return true;
    for (const run of runs) if (run[0] === next) return true;
    return false;
}

// ── One isolating run sequence: W1–W7, N0, N1–N2, I1–I2 ─────────────

/** Strong direction a resolved type counts as under N0–N2 (EN and AN count as R). */
function strongDirection(type: BidiType): 'L' | 'R' | null {
    if (type === 'L') return 'L';
    if (type === 'R' || type === 'AL' || type === 'EN' || type === 'AN') return 'R';
    return null;
}

function resolveSequence(
    seq: readonly number[],
    types: BidiType[],
    original: readonly BidiType[],
    codePoints: readonly number[],
    explicit: readonly number[],
    levels: number[],
    paraLevel: number,
    removed: Uint8Array,
    len: number,
): void {
    const n = seq.length;
    const level = explicit[seq[0]];
    const t: BidiType[] = new Array(n);
    for (let k = 0; k < n; k++) t[k] = types[seq[k]];

    // sos / eos (X10).
    let prev = seq[0] - 1;
    while (prev >= 0 && removed[prev]) prev--;
    const sos: 'L' | 'R' = Math.max(level, prev >= 0 ? explicit[prev] : paraLevel) % 2 === 1 ? 'R' : 'L';
    const lastIdx = seq[n - 1];
    let eosLevel = paraLevel;
    if (!isIsolateInitiator(original[lastIdx])) {
        let next = lastIdx + 1;
        while (next < len && removed[next]) next++;
        if (next < len) eosLevel = explicit[next];
    }
    const eos: 'L' | 'R' = Math.max(level, eosLevel) % 2 === 1 ? 'R' : 'L';

    // W1: NSM takes the type of the previous character (ON after an isolate control).
    for (let k = 0; k < n; k++) {
        if (t[k] !== 'NSM') continue;
        if (k === 0) t[k] = sos;
        else {
            const p = t[k - 1];
            t[k] = isIsolateInitiator(p) || p === 'PDI' ? 'ON' : p;
        }
    }
    // W2: EN after AL → AN.
    let lastStrong: BidiType = sos;
    for (let k = 0; k < n; k++) {
        const v = t[k];
        if (v === 'L' || v === 'R' || v === 'AL') lastStrong = v;
        else if (v === 'EN' && lastStrong === 'AL') t[k] = 'AN';
    }
    // W3: AL → R.
    for (let k = 0; k < n; k++) if (t[k] === 'AL') t[k] = 'R';
    // W4: a single separator between two numbers of the same kind.
    for (let k = 1; k + 1 < n; k++) {
        const v = t[k];
        if (v === 'ES' && t[k - 1] === 'EN' && t[k + 1] === 'EN') t[k] = 'EN';
        else if (v === 'CS') {
            if (t[k - 1] === 'EN' && t[k + 1] === 'EN') t[k] = 'EN';
            else if (t[k - 1] === 'AN' && t[k + 1] === 'AN') t[k] = 'AN';
        }
    }
    // W5: a sequence of ET adjacent to EN → EN.
    for (let k = 0; k < n; k++) {
        if (t[k] !== 'ET') continue;
        let end = k;
        while (end < n && t[end] === 'ET') end++;
        if ((k > 0 && t[k - 1] === 'EN') || (end < n && t[end] === 'EN')) {
            for (let j = k; j < end; j++) t[j] = 'EN';
        }
        k = end - 1;
    }
    // W6: remaining separators and terminators → ON.
    for (let k = 0; k < n; k++) if (t[k] === 'ES' || t[k] === 'ET' || t[k] === 'CS') t[k] = 'ON';
    // W7: EN with L as the last strong type → L.
    lastStrong = sos;
    for (let k = 0; k < n; k++) {
        const v = t[k];
        if (v === 'L' || v === 'R') lastStrong = v;
        else if (v === 'EN' && lastStrong === 'L') t[k] = 'L';
    }

    // N0: paired brackets.
    resolveBracketPairs(t, seq, original, codePoints, level, sos);

    // N1–N2: neutrals and isolate formatting characters.
    const embedding: 'L' | 'R' = level % 2 === 1 ? 'R' : 'L';
    for (let k = 0; k < n; k++) {
        if (!isNeutralOrIsolate(t[k])) continue;
        let end = k;
        while (end < n && isNeutralOrIsolate(t[end])) end++;
        const before: 'L' | 'R' = k === 0 ? sos : (strongDirection(t[k - 1]) ?? sos);
        const after: 'L' | 'R' = end === n ? eos : (strongDirection(t[end]) ?? eos);
        const resolved: BidiType = before === after ? before : embedding;
        for (let j = k; j < end; j++) t[j] = resolved;
        k = end - 1;
    }

    // I1–I2.
    for (let k = 0; k < n; k++) {
        const v = t[k];
        const i = seq[k];
        let resolvedLevel = level;
        if (level % 2 === 0) {
            if (v === 'R') resolvedLevel = level + 1;
            else if (v === 'AN' || v === 'EN') resolvedLevel = level + 2;
        } else if (v === 'L' || v === 'EN' || v === 'AN') {
            resolvedLevel = level + 1;
        }
        levels[i] = resolvedLevel;
        types[i] = v;
    }
}

// ── Paired Brackets (UAX #9 BD14–BD16, N0) ───────────────────────────

/** BD16 canonical equivalents: the angle brackets U+2329/U+232A decompose to U+3008/U+3009. */
function canonicalBracket(cp: number): number {
    if (cp === 0x2329) return 0x3008;
    if (cp === 0x232A) return 0x3009;
    return cp;
}

let bracketMap: Map<number, number> | null = null;
/** Opening bracket → its paired closer (BidiBrackets.txt), built on first use. */
function getBracketMap(): Map<number, number> {
    if (bracketMap === null) {
        bracketMap = new Map();
        for (let i = 0; i + 1 < BIDI_BRACKET_PAIRS.length; i += 2) bracketMap.set(BIDI_BRACKET_PAIRS[i], BIDI_BRACKET_PAIRS[i + 1]);
    }
    return bracketMap;
}

/** BD16 stack depth: at the 64th unmatched opener, pairing stops for the sequence. */
const MAX_BRACKET_DEPTH = 63;

/**
 * BD16: the bracket pairs of one isolating run sequence, as (open, close)
 * positions within the sequence sorted by the opener. Only characters whose
 * current type is ON take part (an opener overridden to L or R is no bracket).
 */
function identifyBracketPairs(t: readonly BidiType[], seq: readonly number[], codePoints: readonly number[]): [number, number][] {
    const openers = getBracketMap();
    const stack: { closer: number; pos: number }[] = [];
    const pairs: [number, number][] = [];
    for (let k = 0; k < seq.length; k++) {
        if (t[k] !== 'ON') continue;
        const cp = codePoints[seq[k]];
        const closer = openers.get(cp);
        if (closer !== undefined) {
            if (stack.length >= MAX_BRACKET_DEPTH) break;
            stack.push({ closer: canonicalBracket(closer), pos: k });
            continue;
        }
        const canon = canonicalBracket(cp);
        for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].closer === canon) {
                pairs.push([stack[s].pos, k]);
                stack.length = s;
                break;
            }
        }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    return pairs;
}

/**
 * N0: a bracket pair takes the embedding direction when a strong type of
 * that direction sits inside it; otherwise the opposite direction when one
 * sits inside and the context before the opener (or sos) is that direction
 * too; otherwise the embedding direction; a pair with no strong type inside
 * keeps its neutrals. Marks (NSM at classification) following a resolved
 * bracket take the bracket's type.
 */
function resolveBracketPairs(
    t: BidiType[],
    seq: readonly number[],
    original: readonly BidiType[],
    codePoints: readonly number[],
    level: number,
    sos: 'L' | 'R',
): void {
    const pairs = identifyBracketPairs(t, seq, codePoints);
    if (pairs.length === 0) return;
    const embedding: 'L' | 'R' = level % 2 === 1 ? 'R' : 'L';
    const opposite: 'L' | 'R' = embedding === 'R' ? 'L' : 'R';
    for (const [open, close] of pairs) {
        let foundEmbedding = false;
        let foundOpposite = false;
        for (let k = open + 1; k < close; k++) {
            const d = strongDirection(t[k]);
            if (d === embedding) { foundEmbedding = true; break; }
            if (d === opposite) foundOpposite = true;
        }
        let resolved: 'L' | 'R' | null = null;
        if (foundEmbedding) resolved = embedding;
        else if (foundOpposite) {
            let context: 'L' | 'R' = sos;
            for (let k = open - 1; k >= 0; k--) {
                const d = strongDirection(t[k]);
                if (d !== null) { context = d; break; }
            }
            resolved = context === opposite ? opposite : embedding;
        }
        if (resolved === null) continue;
        t[open] = resolved;
        t[close] = resolved;
        for (const at of [open, close]) {
            for (let k = at + 1; k < seq.length && original[seq[k]] === 'NSM'; k++) t[k] = resolved;
        }
    }
}

// ── Lines: L1, L2, L4 ────────────────────────────────────────────────

/**
 * L1: segment and paragraph separators, and the whitespace, isolate
 * formatting characters and retained X9 characters before one or at the end
 * of the line, take the paragraph level.
 */
function applyL1(levels: number[], original: readonly BidiType[], paraLevel: number, len: number): void {
    const resettable = (t: BidiType): boolean =>
        t === 'WS' || t === 'LRI' || t === 'RLI' || t === 'FSI' || t === 'PDI' || isRemovedByX9(t);
    let i = len - 1;
    while (i >= 0 && resettable(original[i])) { levels[i] = paraLevel; i--; }
    for (let k = 0; k < len; k++) {
        const t = original[k];
        if (t !== 'S' && t !== 'B') continue;
        levels[k] = paraLevel;
        for (let j = k - 1; j >= 0 && resettable(original[j]); j--) levels[j] = paraLevel;
    }
}

/**
 * L2: the visual order of the line's code points — from the highest level
 * down to the lowest odd level, reverse every maximal sequence at that level
 * or higher.
 */
function visualOrder(levels: readonly number[], len: number): number[] {
    const order: number[] = new Array(len);
    const lv: number[] = new Array(len);
    let max = 0;
    let minOdd = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < len; i++) {
        order[i] = i;
        lv[i] = levels[i];
        if (levels[i] > max) max = levels[i];
        if (levels[i] % 2 === 1 && levels[i] < minOdd) minOdd = levels[i];
    }
    if (minOdd === Number.MAX_SAFE_INTEGER) {
        // Only even levels: the lowest odd level is the one below the maximum
        // (a level-2 number in a level-0 paragraph is reversed twice: ≥2, ≥1).
        if (max === 0) return order;
        minOdd = max - 1;
    }
    for (let target = max; target >= minOdd; target--) {
        for (let i = 0; i < len; i++) {
            if (lv[i] < target) continue;
            let end = i;
            while (end < len && lv[end] >= target) end++;
            for (let a = i, b = end - 1; a < b; a++, b--) {
                const o = order[a]; order[a] = order[b]; order[b] = o;
                const l = lv[a]; lv[a] = lv[b]; lv[b] = l;
            }
            i = end - 1;
        }
    }
    return order;
}

/** The invisible directional formatting characters `stripBidiControls()` removes (never drawn). */
function isBidiControl(cp: number): boolean {
    return cp === 0x200E || cp === 0x200F || cp === 0x061C
        || (cp >= 0x202A && cp <= 0x202E)
        || (cp >= 0x2066 && cp <= 0x2069);
}

/**
 * Build the visual-order runs of one line from its resolved levels: L2 over
 * the levels, then maximal stretches of logically contiguous characters at
 * one level, odd-level stretches reversed and mirrored (L4). The directional
 * formatting characters (marks, embeddings, overrides, isolates) have done
 * their work by now and are left out of the runs — they have no glyph; ZWJ,
 * ZWNJ and the other BN characters stay, the shapers read them.
 *
 * @param text - The line
 * @param codePoints - The line's code points
 * @param cpToStr - Code-point index → code-unit offset map (length = cp + 1)
 * @param levels - One resolved level per code point
 * @param len - Number of code points
 */
function assembleRuns(text: string, codePoints: readonly number[], cpToStr: readonly number[], levels: readonly number[], len: number): BidiRun[] {
    if (len === 0) return [];
    const order = visualOrder(levels, len);
    const runs: BidiRun[] = [];
    let k = 0;
    while (k < len) {
        const first = order[k];
        const level = levels[first];
        const odd = level % 2 === 1;
        let last = first;
        let k2 = k + 1;
        while (k2 < len && levels[order[k2]] === level && order[k2] === last + (odd ? -1 : 1)) {
            last = order[k2];
            k2++;
        }
        const lo = odd ? last : first;
        const hi = odd ? first : last;
        let from = lo;
        while (from <= hi && isBidiControl(codePoints[from])) from++;
        if (from <= hi) {
            const logical = stripBidiControls(text.substring(cpToStr[from], cpToStr[hi + 1]));
            runs.push({ text: odd ? reverseAndMirror(logical) : logical, level, start: cpToStr[from] });
        }
        k = k2;
    }
    return runs;
}

// ── Glyph Mirroring (UAX #9 L4) ──────────────────────────────────────

/**
 * Lazily-built Bidi_Mirroring_Glyph lookup, populated from the full
 * generated UCD table on first use (v1.7.0 — replaces the former ~40-pair
 * curated map with all BidiMirroring.txt mappings).
 */
let mirrorMap: Map<number, number> | null = null;

function getMirrorMap(): Map<number, number> {
    if (mirrorMap === null) {
        mirrorMap = new Map<number, number>();
        for (let i = 0; i < BIDI_MIRRORING_PAIRS.length; i += 2) {
            mirrorMap.set(BIDI_MIRRORING_PAIRS[i], BIDI_MIRRORING_PAIRS[i + 1]);
        }
    }
    return mirrorMap;
}

/**
 * Apply glyph mirroring for a code point in RTL context.
 * Returns the mirrored code point, or the original if no mirror exists.
 *
 * @param cp - Unicode code point to mirror
 * @returns Mirrored code point (e.g. '(' → ')') or the original
 */
export function mirrorCodePoint(cp: number): number {
    return getMirrorMap().get(cp) ?? cp;
}

// ── Main API ─────────────────────────────────────────────────────────

/** Split a string into code points with a parallel code-point → code-unit offset map (length cp + 1). */
function splitCodePoints(text: string): { codePoints: number[]; cpToStr: number[] } {
    const codePoints: number[] = [];
    const cpToStr: number[] = [];
    for (let i = 0; i < text.length;) {
        cpToStr.push(i);
        const cp = text.codePointAt(i) ?? 0;
        codePoints.push(cp);
        i += cp > 0xFFFF ? 2 : 1;
    }
    cpToStr.push(text.length);
    return { codePoints, cpToStr };
}

/**
 * Resolve bidirectional text into ordered runs with embedding levels: the
 * whole UAX #9 pipeline (P2–I2, then L1–L4) on a single-line paragraph with
 * its base direction detected. For wrapped paragraphs use
 * {@link resolveBidiLevels} once and {@link bidiRunsForLine} per line.
 *
 * @param text - Input text in logical order
 * @returns Runs in visual order (left to right); the invisible directional
 *   formatting characters are not part of any run
 */
export function resolveBidiRuns(text: string): BidiRun[] {
    if (!text) return [];
    const { codePoints, cpToStr } = splitCodePoints(text);
    const res = resolveParagraph(codePoints);
    applyL1(res.levels, res.original, res.paraLevel, codePoints.length);
    return assembleRuns(text, codePoints, cpToStr, res.levels, codePoints.length);
}

/**
 * Map the legacy explicit embedding characters LRE (U+202A) / RLE (U+202B)
 * and the PDF (U+202C) closing them to their isolate equivalents LRI / RLI /
 * PDI; overrides (LRO/RLO and their PDF) are preserved and orphan PDFs
 * dropped.
 *
 * Until 1.8.0 the resolver ran this before resolving. Since 1.9.0 it
 * implements X1–X8 natively and no longer needs it; the function remains for
 * callers that want isolate-only text (an embedding and an isolate differ in
 * how neutrals at their boundary resolve — N1/N2 see across an embedding,
 * never across an isolate).
 *
 * @param text - Raw input text in logical order
 * @returns Text with embeddings mapped to isolates; overrides preserved
 * @deprecated since 1.9.0 — `resolveBidiRuns` handles embeddings directly
 */
export function normalizeBidiEmbeddings(text: string): string {
    const LRE = 0x202A, RLE = 0x202B, PDF_CP = 0x202C, LRO = 0x202D, RLO = 0x202E;
    const LRI = 0x2066, RLI = 0x2067, PDI = 0x2069;

    let hasEmbed = false;
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === LRE || c === RLE || c === PDF_CP || c === LRO || c === RLO) {
            hasEmbed = true;
            break;
        }
    }
    if (!hasEmbed) return text;

    const stack: Array<'E' | 'O'> = [];
    const out: number[] = [];
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        const cpLen = cp > 0xFFFF ? 2 : 1;
        if (cp === LRE || cp === RLE) {
            if (stack.length >= MAX_DEPTH) { i += cpLen; continue; }
            stack.push('E');
            out.push(cp === LRE ? LRI : RLI);
        } else if (cp === LRO || cp === RLO) {
            if (stack.length >= MAX_DEPTH) { i += cpLen; continue; }
            stack.push('O');
            out.push(cp);
        } else if (cp === PDF_CP) {
            const frame = stack.pop();
            if (frame === 'E') out.push(PDI);
            else if (frame === 'O') out.push(PDF_CP);
        } else {
            out.push(cp);
        }
        i += cpLen;
    }
    let result = '';
    for (let i = 0; i < out.length; i++) result += String.fromCodePoint(out[i]);
    return result;
}

// ── Per-paragraph resolution (v1.9.0) ────────────────────────────────

/** Base direction of a paragraph: detected (P2–P3), or forced — the layout option's type. @since 1.9.0 */
export type BidiDirection = TextDirection;

/** A paragraph's resolved embedding levels, one per UTF-16 code unit. @since 1.9.0 */
export interface BidiLevels {
    /** The paragraph embedding level: 0 (LTR) or 1 (RTL). */
    readonly paraLevel: number;
    /** Resolved level per code unit of the paragraph text (both units of a surrogate pair carry the level). */
    readonly levels: readonly number[];
}

/**
 * Resolve the embedding levels of a whole paragraph (UAX #9 P2–I2), once.
 * Lines wrapped from the paragraph then reorder from these levels through
 * {@link bidiRunsForLine}: a continuation line starting with a Latin word
 * stays part of its RTL paragraph instead of being resolved as a paragraph
 * of its own. `direction` forces the base direction (`'rtl'`, `'ltr'`) or
 * detects it (`'auto'`, the default).
 *
 * @param text - Paragraph text in logical order
 * @param direction - Base direction; `'auto'` applies P2–P3
 * @returns Paragraph level and per-code-unit levels
 * @since 1.9.0
 */
export function resolveBidiLevels(text: string, direction: BidiDirection = 'auto'): BidiLevels {
    const forced = direction === 'rtl' ? 1 : direction === 'ltr' ? 0 : undefined;
    const levels = new Array<number>(text.length).fill(forced ?? 0);
    if (!text) return { paraLevel: forced ?? 0, levels };
    const { codePoints, cpToStr } = splitCodePoints(text);
    const res = resolveParagraph(codePoints, forced);
    for (let k = 0; k < codePoints.length; k++) {
        for (let u = cpToStr[k]; u < cpToStr[k + 1]; u++) levels[u] = res.levels[k];
    }
    return { paraLevel: res.paraLevel, levels };
}

/**
 * Reorder one line of a paragraph from the paragraph's resolved levels
 * (UAX #9 L1, L2 and L4): the line's slice of the levels, trailing
 * whitespace reset to the paragraph level, runs reversed and mirrored.
 *
 * @param line - The line text, a substring of the paragraph
 * @param lineLevels - The paragraph levels of exactly that substring (one per code unit)
 * @param paraLevel - The paragraph embedding level
 * @returns Runs in visual order, offsets relative to the line
 * @since 1.9.0
 */
export function bidiRunsForLine(line: string, lineLevels: readonly number[], paraLevel: number): BidiRun[] {
    if (!line) return [];
    const { codePoints, cpToStr } = splitCodePoints(line);
    const len = codePoints.length;
    const levels = lineLevelsOf(codePoints, cpToStr, lineLevels, paraLevel);
    return assembleRuns(line, codePoints, cpToStr, levels, len);
}

/** The line's levels per code point after L1. */
function lineLevelsOf(codePoints: readonly number[], cpToStr: readonly number[], lineLevels: readonly number[], paraLevel: number): number[] {
    const len = codePoints.length;
    const levels: number[] = new Array(len);
    const original: BidiType[] = new Array(len);
    for (let k = 0; k < len; k++) {
        levels[k] = lineLevels[cpToStr[k]] ?? paraLevel;
        original[k] = classifyBidiType(codePoints[k]);
    }
    applyL1(levels, original, paraLevel, len);
    return levels;
}

/**
 * The final levels of one line (UAX #9 L1 applied to the paragraph levels of
 * that line): segment separators and the whitespace or formatting characters
 * before one or at the end of the line take the paragraph level. One level
 * per code unit, like {@link resolveBidiLevels}. This is what the UCD's
 * BidiCharacterTest reports; {@link bidiRunsForLine} reorders from it.
 *
 * @param line - The line text, a substring of the paragraph
 * @param lineLevels - The paragraph levels of exactly that substring (one per code unit)
 * @param paraLevel - The paragraph embedding level
 * @since 1.9.0
 */
export function bidiLineLevels(line: string, lineLevels: readonly number[], paraLevel: number): number[] {
    const out = new Array<number>(line.length).fill(paraLevel);
    if (!line) return out;
    const { codePoints, cpToStr } = splitCodePoints(line);
    const levels = lineLevelsOf(codePoints, cpToStr, lineLevels, paraLevel);
    for (let k = 0; k < codePoints.length; k++) {
        for (let u = cpToStr[k]; u < cpToStr[k + 1]; u++) out[u] = levels[k];
    }
    return out;
}

/**
 * Check whether text needs bidirectional resolution: it holds a
 * right-to-left character (R or AL, which includes the RLM and ALM marks) or
 * a right-to-left explicit control (RLE, RLO, RLI). Pure left-to-right text
 * with left-to-right controls or Arabic digits only resolves to its logical
 * order and skips the resolver.
 *
 * @param text - Input text string
 * @returns True when an odd embedding level can result
 */
export function containsRTL(text: string): boolean {
    for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i) ?? 0;
        const t = classifyBidiType(cp);
        if (t === 'R' || t === 'AL' || t === 'RLE' || t === 'RLO' || t === 'RLI') return true;
        i += cp > 0xFFFF ? 2 : 1;
    }
    return false;
}

/**
 * Strip invisible Unicode bidirectional formatting characters.
 *
 * The resolver consumes these characters when it runs; text that reaches a
 * font encoder with them would render them as `.notdef` (tofu), since no
 * font ships a glyph for them.
 *
 * Stripped codepoints:
 * - LRM / RLM (U+200E, U+200F) and ALM (U+061C)
 * - LRE / RLE / PDF / LRO / RLO (U+202A–U+202E)
 * - LRI / RLI / FSI / PDI (U+2066–U+2069)
 *
 * Safe to call unconditionally — these characters carry no visible
 * width per UAX #9, so removing them never changes layout.
 *
 * @since 1.2.0
 */
export function stripBidiControls(text: string): string {
    if (!text) return text;
    let needs = false;
    for (let i = 0; i < text.length; i++) {
        if (isBidiControl(text.charCodeAt(i))) { needs = true; break; }
    }
    if (!needs) return text;
    let out = '';
    for (let i = 0; i < text.length; i++) {
        if (isBidiControl(text.charCodeAt(i))) continue;
        out += text[i];
    }
    return out;
}

/**
 * Reverse a string, keeping surrogate pairs intact.
 * Used to convert a visual-order RTL run back to logical order before
 * Arabic shaping.
 *
 * @param str - String to reverse
 * @returns Reversed string
 */
export function reverseString(str: string): string {
    const cps: string[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const len = cp > 0xFFFF ? 2 : 1;
        cps.push(str.substring(i, i + len));
        i += len;
    }
    return cps.reverse().join('');
}

/**
 * Reverse a run and apply L4 glyph mirroring to every code point —
 * the visual form of an odd-level run. An involution (the mirroring table
 * is symmetric): applied to a {@link BidiRun}'s visual text it gives the
 * logical text back, which is what an untagged `/ActualText` carries
 * (1.9.0, C27).
 */
export function reverseAndMirror(str: string): string {
    const parts: string[] = [];
    for (let i = 0; i < str.length;) {
        const cp = str.codePointAt(i) ?? 0;
        const len = cp > 0xFFFF ? 2 : 1;
        parts.push(String.fromCodePoint(mirrorCodePoint(cp)));
        i += len;
    }
    return parts.reverse().join('');
}
