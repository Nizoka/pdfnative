/**
 * SHARED LATIN-SUBSET BUILD CORE (v1.8.0)
 * ========================================
 * Derives the five Latin source fonts — NotoSans-Cyrillic, -Greek, -Polish,
 * -Turkish and -Vietnamese — from the pinned `NotoSans-VF.ttf` with the
 * library's own `subsetTTF()`, so that no font binary is committed and
 * `npm run verify:fonts` proves every bundled module from upstream bytes.
 * Shared by:
 *   - scripts/build-latin-subsets.ts  (the CLI, `npm run fonts:subsets`)
 *   - scripts/download-fonts.ts       (derives the subsets after the VF is verified)
 *   - scripts/verify-fonts.ts         (re-derives them before comparing the modules)
 *
 * The recipe per `derived[]` entry of fonts/SOURCES.json:
 *   1. the code points of `fonts/subsets/<local>.codepoints.txt` → glyph ids
 *      through the variable font's cmap (a code point the font lacks is an error);
 *   2. when `layout` is set, the GSUB closure of that glyph set — every glyph a
 *      single, multiple, ligature or contextual substitution can reach — so
 *      the kept `GSUB` never lands on an emptied outline;
 *   3. `subsetTTF(vf, gids, { keepLayoutTables: layout })`: outlines, metrics,
 *      cmap and names of the default instance; the variation tables go, which
 *      is what instantiates a variable font at its default.
 *
 * Deterministic: identical inputs give identical bytes, and the manifest's
 * `sha256` is that output. Zero external dependency.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subsetTTF } from '../../src/fonts/font-subsetter.js';
import { parseFontData } from '../../src/tools/font-compiler.js';
import type { FontDataObject } from '../../src/tools/font-compiler.js';
import { REPO_ROOT, sha256Of, sfntTables } from './font-sources.js';
import type { DerivedFont, SourcesManifest } from './font-sources.js';

export const SUBSETS_DIR = join(REPO_ROOT, 'fonts', 'subsets');

// ── Code-point lists ────────────────────────────────────────────────

const RANGE_LINE = /^U\+([0-9A-Fa-f]{4,6})(?:-U\+([0-9A-Fa-f]{4,6}))?$/;

/**
 * Parse a code-point list: one `U+XXXX` or `U+XXXX-U+YYYY` (inclusive) per
 * line, `#` comments and blank lines ignored. Throws on a malformed line,
 * naming it, and on a descending range. The result is sorted and unique.
 */
export function parseCodepointList(text: string, name = 'codepoints'): number[] {
    const out = new Set<number>();
    const lines = text.split(/\r?\n/);
    for (let n = 0; n < lines.length; n++) {
        const line = lines[n].replace(/#.*$/, '').trim();
        if (!line) continue;
        const m = RANGE_LINE.exec(line);
        if (!m) throw new Error(`${name}:${n + 1}: expected U+XXXX or U+XXXX-U+YYYY, got "${lines[n].trim()}"`);
        const start = parseInt(m[1], 16);
        const end = m[2] === undefined ? start : parseInt(m[2], 16);
        if (end < start) throw new Error(`${name}:${n + 1}: descending range "${line}"`);
        if (end > 0x10FFFF) throw new Error(`${name}:${n + 1}: beyond U+10FFFF "${line}"`);
        for (let cp = start; cp <= end; cp++) out.add(cp);
    }
    return [...out].sort((a, b) => a - b);
}

const hex = (cp: number): string => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Format code points as the list `parseCodepointList` reads: contiguous runs
 * collapsed to `U+XXXX-U+YYYY`, one per line, after the given comment header.
 */
export function formatCodepointList(cps: Iterable<number>, header: readonly string[]): string {
    const sorted = [...new Set(cps)].sort((a, b) => a - b);
    const lines = header.map(h => (h ? `# ${h}` : '#'));
    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
        lines.push(i === j ? hex(sorted[i]) : `${hex(sorted[i])}-${hex(sorted[j])}`);
        i = j + 1;
    }
    return `${lines.join('\n')}\n`;
}

// ── GSUB closure ────────────────────────────────────────────────────

/** Whether any glyph of `set` falls in the flat inclusive-range list `ranges`. */
function rangesMeet(ranges: readonly number[], set: ReadonlySet<number>): boolean {
    for (let k = 0; k + 1 < ranges.length; k += 2) {
        const s = ranges[k]; const e = ranges[k + 1];
        if (e - s < set.size) {
            for (let g = s; g <= e; g++) if (set.has(g)) return true;
        } else {
            for (const g of set) if (g >= s && g <= e) return true;
        }
    }
    return false;
}

const inRanges = (ranges: readonly number[], g: number): boolean => {
    for (let k = 0; k + 1 < ranges.length; k += 2) if (g >= ranges[k] && g <= ranges[k + 1]) return true;
    return false;
};

/**
 * The glyphs the font's GSUB can produce from `seed`, to a fixpoint — what
 * `pyftsubset --layout-features='*'` calls the layout closure. Every default
 * and discretionary single substitution (`gsub`, `features`), every ligature
 * whose components are all kept (`ligatures`), and every `otl` lookup a
 * script's feature lists, of type 1, 2, 4 and 6 (a chain rule fires when each
 * of its backtrack, input and lookahead sets has a kept glyph; the lookups it
 * names then apply to the kept glyphs of their input set — the only way a
 * lookup no feature lists is reached, as in the shapers). Lookup flags are
 * ignored: a superset is what a subsetter wants. GID 0 is always kept.
 */
export function gsubClosure(seed: ReadonlySet<number>, fd: FontDataObject): Set<number> {
    const kept = new Set<number>(seed);
    kept.add(0);
    const lookups = fd.otl?.gsub.lookups ?? {};
    const sets = fd.otl?.gsub.sets ?? [];
    const featureLookups = new Set<number>();
    for (const features of Object.values(fd.otl?.gsub.scripts ?? {})) {
        for (const indices of Object.values(features)) for (const index of indices) featureLookups.add(index);
    }

    const addLigatures = (rules: Readonly<Record<number, readonly (readonly number[])[]>>, only?: readonly number[]): void => {
        for (const [firstKey, list] of Object.entries(rules)) {
            const first = Number(firstKey);
            if (!kept.has(first) || (only && !inRanges(only, first))) continue;
            for (const rule of list) {
                let all = true;
                for (let c = 1; c < rule.length; c++) if (!kept.has(rule[c])) { all = false; break; }
                if (all) kept.add(rule[0]);
            }
        }
    };

    const applyLookup = (index: number, only?: readonly number[], depth = 0): void => {
        const lk = lookups[index];
        if (!lk || depth > 8) return;
        if (lk.t === 1) {
            for (const [from, to] of Object.entries(lk.m)) {
                const g = Number(from);
                if (kept.has(g) && (!only || inRanges(only, g))) kept.add(to);
            }
        } else if (lk.t === 2) {
            for (const [from, tos] of Object.entries(lk.m)) {
                const g = Number(from);
                if (kept.has(g) && (!only || inRanges(only, g))) for (const to of tos) kept.add(to);
            }
        } else if (lk.t === 4) {
            addLigatures(lk.m, only);
        } else {
            for (const rule of lk.m) {
                const fires = [...rule.b, ...rule.i, ...rule.l].every(si => sets[si] !== undefined && rangesMeet(sets[si], kept));
                if (!fires) continue;
                for (const [pos, nested] of rule.a) {
                    const inputSet = sets[rule.i[pos]];
                    applyLookup(nested, inputSet, depth + 1);
                }
            }
        }
    };

    for (;;) {
        const before = kept.size;
        for (const [from, to] of Object.entries(fd.gsub)) if (kept.has(Number(from))) kept.add(to);
        for (const table of Object.values(fd.features ?? {})) {
            for (const [from, to] of Object.entries(table)) if (kept.has(Number(from))) kept.add(to);
        }
        addLigatures(fd.ligatures);
        for (const index of featureLookups) applyLookup(index);
        if (kept.size === before) return kept;
    }
}

// ── Deriving one subset ─────────────────────────────────────────────

export interface DerivedBuild {
    readonly entry: DerivedFont;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    /** Glyph ids kept, closure included. */
    readonly glyphs: number;
}

/** Repository path of an entry's code-point list, resolved for this platform. */
export function codepointsPath(entry: DerivedFont): string {
    return join(REPO_ROOT, ...entry.codepoints.split('/'));
}

/**
 * Derive one subset from the parsed variable font. `vfData` is
 * `parseFontData(vf)` — computed once by the caller, it parses a 244 KB GPOS.
 * Throws when a listed code point is not in the font, or when the subsetter
 * fell back to returning its input (it does so on any internal error).
 */
export function buildLatinSubset(vf: Uint8Array, vfData: FontDataObject, entry: DerivedFont, codepointText: string): DerivedBuild {
    const cps = parseCodepointList(codepointText, entry.codepoints);
    const gids = new Set<number>([0]);
    const missing: number[] = [];
    for (const cp of cps) {
        const gid = vfData.cmap[cp];
        if (gid === undefined) missing.push(cp); else gids.add(gid);
    }
    if (missing.length > 0) {
        throw new Error(`${entry.local}: ${missing.length} listed code point(s) are not in ${entry.from}: ${missing.slice(0, 8).map(hex).join(' ')}${missing.length > 8 ? ' …' : ''}`);
    }
    const kept = entry.layout ? gsubClosure(gids, vfData) : gids;
    const binary = subsetTTF(vf, kept, { keepLayoutTables: entry.layout });
    const bytes = new Uint8Array(Buffer.from(binary, 'latin1'));

    // subsetTTF returns its input unchanged on any internal error — a 2 MB
    // "subset" must never be recorded as derived.
    const tables = sfntTables(bytes);
    if (bytes.length >= vf.length || !tables.has('glyf') || tables.has('fvar') || tables.has('gvar')) {
        throw new Error(`${entry.local}: subsetTTF did not produce a static subset of ${entry.from}`);
    }
    if (entry.layout !== (tables.has('GSUB') && tables.has('GPOS'))) {
        throw new Error(`${entry.local}: layout tables ${entry.layout ? 'missing from' : 'unexpected in'} the subset`);
    }
    return { entry, bytes, sha256: sha256Of(bytes), glyphs: kept.size };
}

/**
 * Derive every `derived[]` entry from the fonts in `ttfDir`. The upstream font
 * must be present and match the manifest's hash — a subset of an unverified
 * font proves nothing — or an error is thrown before anything is built.
 */
export function buildAllLatinSubsets(manifest: SourcesManifest, ttfDir: string): DerivedBuild[] {
    const parsed = new Map<string, { vf: Uint8Array; data: FontDataObject }>();
    const results: DerivedBuild[] = [];
    for (const entry of manifest.derived) {
        let source = parsed.get(entry.from);
        if (!source) {
            const upstream = manifest.fonts.find(f => f.local === entry.from);
            if (!upstream) throw new Error(`${entry.local}: ${entry.from} is not a fonts[] entry of fonts/SOURCES.json`);
            const path = join(ttfDir, entry.from);
            if (!existsSync(path)) throw new Error(`${entry.local}: ${entry.from} is missing — npm run fonts:download`);
            const vf = new Uint8Array(readFileSync(path));
            const actual = sha256Of(vf);
            if (actual !== upstream.sha256) {
                throw new Error(`${entry.local}: ${entry.from} differs from fonts/SOURCES.json (expected ${upstream.sha256.slice(0, 16)}…, got ${actual.slice(0, 16)}…)`);
            }
            source = { vf, data: parseFontData(vf) };
            parsed.set(entry.from, source);
        }
        const listPath = codepointsPath(entry);
        if (!existsSync(listPath)) throw new Error(`${entry.local}: ${entry.codepoints} is missing`);
        results.push(buildLatinSubset(source.vf, source.data, entry, readFileSync(listPath, 'utf8')));
    }
    return results;
}

/** The manifest with each `derived[]` hash and size replaced by what was built. */
export function withDerivedHashes(manifest: SourcesManifest, results: readonly DerivedBuild[]): SourcesManifest {
    const byName = new Map(results.map(r => [r.entry.local, r]));
    return {
        ...manifest,
        derived: manifest.derived.map(d => {
            const r = byName.get(d.local);
            return r ? { ...d, sha256: r.sha256, bytes: r.bytes.length } : d;
        }),
    };
}
