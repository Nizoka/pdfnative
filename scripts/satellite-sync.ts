#!/usr/bin/env tsx
/**
 * pdfnative — Satellite synchronisation
 * ======================================
 * Reads the three satellite checkouts (pdfnative-cli, pdfnative-mcp,
 * pdfnative-react) through scripts/lib/satellite-surface.ts and turns what it
 * finds into three artefacts under test-output/.satellites/ (never committed):
 *
 *   facts.json + facts.md   the compact fact sheet — versions, pins, counts,
 *                           lists, deltas, constraints — the only source the
 *                           alignment agents read; no agent opens a satellite
 *   worklist.json + .md     (--worklist) verify-docs findings grouped by file
 *                           and rule, assigned to the writer batches B1…B8,
 *                           plus the blind-spot tokens verify-docs does not
 *                           see and the per-satellite surface delta
 *   <name>.capture.json     (--capture) the JSON printed by each satellite's
 *                           capture commands, cached and reused when present
 *
 * `--apply` performs the mechanical edits of a satellite bump in this repo,
 * each a targeted regex on the one field it owns (never a reserialisation):
 *   docs/assets/ecosystem.json   packages.<name> version, pin, counts + verifiedOn
 *   the six Verified-on stamps   llms.txt, docs/llms.txt, docs/agent-brief.md,
 *                                docs/data/{surfaces,errors,playgrounds}.json
 *   docs/assets/versions.js      the FALLBACK rows
 *   docs/index.html              JSON-LD softwareVersion (#cli/#mcp/#react) + badges
 *   docs/** /*.html              importmap pins pdfnative-<name>@X.Y.Z
 *   package.json                 the satellite devDependency (prints `npm install`,
 *                                never runs it)
 *   README.md                    the ecosystem table's version cells
 *   llms.txt + docs/llms.txt     the ecosystem lines (version, requires, pins)
 *
 * Usage:
 *   npx tsx scripts/satellite-sync.ts
 *   npx tsx scripts/satellite-sync.ts --expect cli=1.6.0 mcp=1.8.0 react=1.4.0 --capture --apply --worklist
 *   npx tsx scripts/satellite-sync.ts --react ../pdfnative-react --apply --dry-run
 *
 * Flags: --cli/--mcp/--react <dir> (default ../pdfnative-<name> next to this
 * repo), --expect <name>=<semver> (repeatable or comma-separated; the
 * satellite's package.json must agree), --capture, --apply, --worklist,
 * --json, --out <dir> (default test-output/.satellites), --date YYYY-MM-DD
 * (default today UTC), --dry-run (the repo edits are reported, not written;
 * the reports under --out are always written).
 *
 * Exit codes:
 *   0 — clean (an aligned tree reports only `=` lines)
 *   1 — an --apply edit found no pattern to rewrite
 *   2 — bad usage, a satellite checkout not at the --expect version, or a
 *       satellite directory missing under --expect
 *   3 — verify-docs could not be spawned or did not print JSON
 *
 * The pure helpers are exported and covered by tests/tools/satellite-sync.test.ts;
 * only `main()` touches disk and child processes. The surface library is loaded
 * when `main()` runs, so the helpers stay importable without it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bumpJsonLdVersion, isIsoDate, isSemver, restampVerifiedOn, todayUtc } from './release-prepare.js';
import type { Rewrite } from './release-prepare.js';
import type {
    BlindSpot,
    Captures,
    SatelliteFacts,
    SatelliteName,
    SatelliteSurface,
    SurfaceDelta,
} from './lib/satellite-surface.js';

// ── Types ───────────────────────────────────────────────────────────

/** The short satellite keys; the npm package is `pdfnative-<key>`. */
export type SatelliteKey = 'cli' | 'mcp' | 'react';

export const SATELLITE_KEYS: readonly SatelliteKey[] = ['cli', 'mcp', 'react'];

export function packageOf(key: SatelliteKey): SatelliteName {
    return `pdfnative-${key}`;
}

/** Which `Captures` slot each `CAPTURE_COMMANDS[name][i]` fills, in command order. */
export const CAPTURE_KEYS: Readonly<Record<SatelliteKey, readonly (keyof Captures)[]>> = {
    cli: ['cliManifest', 'cliStatus', 'cliSubjects'],
    mcp: [],
    react: ['reactManifest'],
};

/** `<out>/<key>.capture.json`: the parsed captures plus the commands that failed and why. */
export interface CaptureCache {
    readonly captures: Captures;
    readonly failed: Readonly<Record<string, string>>;
}

export interface Options {
    /** Explicit checkout directories; null means the default `../pdfnative-<key>`. */
    readonly roots: Readonly<Record<SatelliteKey, string | null>>;
    /** Versions the checkouts must be at (`--expect`). */
    readonly expect: Readonly<Partial<Record<SatelliteKey, string>>>;
    readonly capture: boolean;
    readonly apply: boolean;
    readonly worklist: boolean;
    readonly json: boolean;
    readonly out: string;
    readonly date: string;
    readonly dryRun: boolean;
}

/** What `bumpPackageRow` writes into one `packages.<name>` block. */
export interface PackageRow {
    readonly version: string;
    readonly pin: string | null;
    readonly counts?: Readonly<Record<string, number>>;
}

/** One verify-docs finding, as `scripts/verify-docs.ts --json` prints it. */
export interface Finding {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: 'error' | 'warn';
}

/** The structural half of the library's `BlindSpot` row that the evaluator needs. */
export interface BlindSpotRow {
    readonly id: string;
    readonly file: string | '*';
    readonly pattern: RegExp;
    readonly package: string | null;
    readonly nameGroup?: number | string;
    readonly versionGroup: number | string;
    /** When set, the same match also carries the engine pin (compared bare). */
    readonly pinGroup?: number | string;
    readonly kind: 'version' | 'pin';
    readonly description: string;
}

/** A blind-spot token whose live value differs from the manifest. */
export interface BlindSpotFinding {
    readonly id: string;
    readonly file: string;
    readonly line: number;
    readonly package: SatelliteKey;
    readonly kind: 'version' | 'pin';
    readonly current: string;
    readonly expected: string;
}

/** What the manifest says about one satellite: version and the bare pin. */
export interface Expected {
    readonly version: string;
    readonly pin: string | null;
}

/** A per-list delta in the shape `diffSurface` produces. */
export type DeltaLike = Readonly<Record<string, { readonly added: readonly string[]; readonly removed: readonly string[] }>>;

export interface Batch {
    readonly files: string[];
    readonly findings: Finding[];
    readonly blindSpots: BlindSpotFinding[];
    readonly deltas: string[];
}

export interface Worklist {
    readonly generatedOn: string;
    readonly verifyDocs: { readonly exitCode: number | null; readonly errors: number; readonly warnings: number };
    readonly batches: Readonly<Record<string, Batch>>;
}

// ── Small helpers ───────────────────────────────────────────────────

function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace with a counter, so the caller learns whether the pattern existed at all. */
function replaceCounting(text: string, re: RegExp, replacement: (...groups: string[]) => string): Rewrite {
    let matched = 0;
    const out = text.replace(re, (...args: unknown[]) => {
        matched++;
        return replacement(...(args as string[]));
    });
    return { text: out, matched };
}

/** The file's text, or null when it cannot be read — one call, no exists-then-read race. */
function readTextOr(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}

/** `^1.9.0` / `~1.9.0` → `1.9.0`; null stays null. */
export function barePin(pin: string | null | undefined): string | null {
    return pin === null || pin === undefined ? null : pin.replace(/^[\^~]/, '');
}

/** `pdfnative-cli` → `cli`; `cli` → `cli`; anything else → null. */
export function satelliteKey(name: string): SatelliteKey | null {
    const key = name.replace(/^pdfnative-/, '');
    return (SATELLITE_KEYS as readonly string[]).includes(key) ? (key as SatelliteKey) : null;
}

/**
 * Splits a command line into argv, honouring double and single quotes — the
 * capture commands are plain strings and spawnSync without a shell wants an
 * array (on Windows the shell does the splitting).
 */
export function splitCommand(cmd: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quote: '"' | "'" | null = null;
    let has = false;
    for (const ch of cmd) {
        if (quote) {
            if (ch === quote) quote = null;
            else cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            has = true;
        } else if (/\s/.test(ch)) {
            if (has) out.push(cur);
            cur = '';
            has = false;
        } else {
            cur += ch;
            has = true;
        }
    }
    if (has) out.push(cur);
    return out;
}

/** The line number (1-based) of a character offset. */
function lineAt(text: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
}

// ── 1. docs/assets/ecosystem.json ───────────────────────────────────

/**
 * The counters to write into `packages.<name>.counts`: only the keys the manifest
 * already polices, and only when the surface verified them — a count the surface
 * took from a previous release's capture (named under `unverified` as `<key>: …`,
 * possibly several keys before the colon) keeps the manifest's value.
 */
export function syncCounts(
    existing: Readonly<Record<string, number>>,
    surfaceCounts: Readonly<Record<string, number>>,
    unverified: readonly string[],
): Record<string, number> {
    const unverifiedKeys = new Set(unverified.flatMap((u) => (u.split(':')[0] ?? '').split(/[\s,]+/).filter((k) => k.length > 0)));
    const synced: Record<string, number> = {};
    for (const [k, cur] of Object.entries(existing)) {
        const v = surfaceCounts[k];
        synced[k] = v !== undefined && !unverifiedKeys.has(k) ? v : cur;
    }
    return synced;
}

/**
 * `packages.<name>`: `version`, `pin`, and the `counts` object (replaced when
 * present, inserted before the block's closing brace otherwise, at the file's
 * own indent). The block is located inside `"packages": {` by its indent, so
 * a `"<name>"` key anywhere else in the manifest is never touched, and
 * `packages.pdfnative` — the engine, owned by release-prepare — is refused.
 */
export function bumpPackageRow(text: string, name: string, row: PackageRow): Rewrite {
    if (name === 'pdfnative') return { text, matched: 0 };
    const pkgs = /^([ \t]*)"packages":[ \t]*\{[ \t]*\r?\n/m.exec(text);
    if (!pkgs) return { text, matched: 0 };
    const outer = pkgs[1];
    const sectionStart = pkgs.index + pkgs[0].length;
    const outerClose = new RegExp(`^${outer}\\}`, 'mg');
    outerClose.lastIndex = sectionStart;
    const outerEnd = outerClose.exec(text)?.index ?? text.length;
    const section = text.slice(sectionStart, outerEnd);

    const head = new RegExp(`^([ \\t]+)"${escapeRe(name)}":[ \\t]*\\{[ \\t]*\\r?\\n`, 'm').exec(section);
    if (!head) return { text, matched: 0 };
    const indent = head[1];
    const bodyStart = head.index + head[0].length;
    const close = new RegExp(`^${indent}\\}`, 'mg');
    close.lastIndex = bodyStart;
    const closeAt = close.exec(section)?.index;
    if (closeAt === undefined) return { text, matched: 0 };
    let body = section.slice(bodyStart, closeAt);
    const inner = /^([ \t]+)"/.exec(body)?.[1] ?? `${indent}  `;
    const unit = inner.slice(indent.length) || '  ';
    let matched = 0;

    const v = replaceCounting(body, new RegExp(`^(${inner}"version":[ \\t]*")([^"]*)(")`, 'm'), (_m, a, _old, c) => `${a}${row.version}${c}`);
    body = v.text;
    matched += v.matched;
    const pinValue = row.pin === null ? 'null' : `"${row.pin}"`;
    const p = replaceCounting(body, new RegExp(`^(${inner}"pin":[ \\t]*)(null|"[^"]*")`, 'm'), (_m, a) => `${a}${pinValue}`);
    body = p.text;
    matched += p.matched;

    if (row.counts !== undefined) {
        const entries = Object.entries(row.counts);
        const block = entries.length === 0
            ? `${inner}"counts": {}`
            : `${inner}"counts": {\n${entries.map(([k, n]) => `${inner}${unit}"${k}": ${n}`).join(',\n')}\n${inner}}`;
        const existing = new RegExp(`^${inner}"counts":[ \\t]*\\{[^]*?^${inner}\\}|^${inner}"counts":[ \\t]*\\{[ \\t]*\\}`, 'm');
        const c = replaceCounting(body, existing, () => block);
        if (c.matched > 0) {
            body = c.text;
        } else {
            const trimmed = body.replace(/\s+$/, '');
            body = trimmed.length === 0 ? `${block}\n` : `${trimmed},\n${block}\n`;
        }
        matched++;
    }

    const absStart = sectionStart + bodyStart;
    const absEnd = sectionStart + closeAt;
    return { text: text.slice(0, absStart) + body + text.slice(absEnd), matched };
}

// ── 2. docs/assets/versions.js ──────────────────────────────────────

/** The FALLBACK row `'<name>': { version: 'X', pin: '^Y', pinField: '…' }`. */
export function bumpVersionsFallback(js: string, name: string, version: string, pin: string | null): Rewrite {
    const pinValue = pin === null ? 'null' : `'${pin}'`;
    return replaceCounting(
        js,
        new RegExp(`('${escapeRe(name)}':\\s*\\{\\s*version:\\s*')([^']*)(',\\s*pin:\\s*)('[^']*'|null)`),
        (_m, a, _old, c) => `${a}${version}${c}${pinValue}`,
    );
}

// ── 3. docs/index.html badges and importmaps ────────────────────────

/** `<span … data-pn-badge="<name>">vX.Y.Z</span>` — every badge of that package. */
export function bumpBadge(html: string, name: string, version: string): Rewrite {
    return replaceCounting(
        html,
        new RegExp(`(data-pn-badge="${escapeRe(name)}"[^>]*>)v?[^<]*(<)`, 'g'),
        (_m, a, b) => `${a}v${version}${b}`,
    );
}

/** Every `<name>@X.Y.Z` pin (esm.sh importmaps, CDN links) in one HTML page. */
export function bumpImportmapPin(html: string, name: string, version: string): Rewrite {
    return replaceCounting(
        html,
        new RegExp(`(?<![\\w-])(${escapeRe(name)}@)\\d+\\.\\d+\\.\\d+`, 'g'),
        (_m, a) => `${a}${version}`,
    );
}

// ── 4. package.json devDependency ───────────────────────────────────

/** The top-level `devDependencies.<name>` range; nested manifests are left alone. */
export function bumpDevDependency(text: string, name: string, range: string): Rewrite {
    const head = /^( {0,2}|\t)"devDependencies":[ \t]*\{[ \t]*\r?\n/m.exec(text);
    if (!head) return { text, matched: 0 };
    const indent = head[1];
    const start = head.index + head[0].length;
    const close = new RegExp(`^${indent}\\}`, 'mg');
    close.lastIndex = start;
    const end = close.exec(text)?.index ?? text.length;
    const r = replaceCounting(
        text.slice(start, end),
        new RegExp(`^([ \\t]+"${escapeRe(name)}":[ \\t]*")([^"]*)(")`, 'm'),
        (_m, a, _old, c) => `${a}${range}${c}`,
    );
    return { text: text.slice(0, start) + r.text + text.slice(end), matched: r.matched };
}

// ── 5. README.md ecosystem table ────────────────────────────────────

/** The row `| [`<name>`](url) | **vX.Y.Z** | …` of the ecosystem table. */
export function bumpReadmeEcosystemRow(md: string, name: string, version: string): Rewrite {
    return replaceCounting(
        md,
        new RegExp(`^(\\|\\s*\\[\`${escapeRe(name)}\`\\]\\([^)]*\\)\\s*\\|\\s*\\*\\*v)[^*\\n]*(\\*\\*)`, 'm'),
        (_m, a, b) => `${a}${version}${b}`,
    );
}

// ── 6. llms.txt ecosystem lines ─────────────────────────────────────

/**
 * The line `- [<name>](…): … (vX, requires pdfnative ≥ Y — pins `^Y` …)` of
 * llms.txt and docs/llms.txt. `matched` counts the fields found on that line
 * (version, `requires … ≥`, `pins`, `pdfnative ^Y peers`); other packages'
 * lines are never touched because every field is rewritten within the line.
 */
export function bumpLlmsEcosystemLine(text: string, name: string, version: string, pin: string | null): Rewrite {
    const lineRe = new RegExp(`^- \\[${escapeRe(name)}\\]\\([^)]*\\):.*$`, 'm');
    const at = lineRe.exec(text);
    if (!at) return { text, matched: 0 };
    let line = at[0];
    let matched = 0;
    const v = replaceCounting(line, /\(v\d+\.\d+\.\d+/, () => `(v${version}`);
    line = v.text;
    matched += v.matched;
    if (pin !== null) {
        const bare = barePin(pin) ?? pin;
        const req = replaceCounting(line, /(requires pdfnative ≥ )\d+\.\d+\.\d+/, (_m, a) => `${a}${bare}`);
        line = req.text;
        matched += req.matched;
        const pins = replaceCounting(line, /(pins `)[\^~]?\d+\.\d+\.\d+(`)/, (_m, a, b) => `${a}${pin}${b}`);
        line = pins.text;
        matched += pins.matched;
        const peers = replaceCounting(line, /(pdfnative )[\^~]?\d+\.\d+\.\d+( peers)/, (_m, a, b) => `${a}${pin}${b}`);
        line = peers.text;
        matched += peers.matched;
    }
    return { text: text.slice(0, at.index) + line + text.slice(at.index + at[0].length), matched };
}

// ── 7. Worklist: batches, blind spots, deltas ───────────────────────

/** Writer batches: the first pattern that matches a repo-relative path wins; B0 is the rest. */
export const BATCH_OF: readonly (readonly [RegExp, string])[] = [
    [/^docs\/guides\/cli\.(md|html)$/, 'B1'],
    [/^docs\/guides\/mcp\.(md|html)$/, 'B2'],
    [/^docs\/guides\/react\.(md|html)$/, 'B3'],
    [/^(docs\/data\/surfaces\.json|docs\/guides\/choose\.(md|html))$/, 'B4'],
    [/^(docs\/guides\/use-cases(-[\w-]+)?\.(md|html)|docs\/assets\/use-case-[\w-]+\.svg)$/, 'B5'],
    [/^(README\.md|llms\.txt|docs\/index\.html|docs\/agent-brief\.md|docs\/llms\.txt)$/, 'B6'],
    [/^docs\/playgrounds\/(cli|mcp)\.html$/, 'B7'],
    [/^docs\/playgrounds\/(react|docspec-lint)\.html$/, 'B8'],
];

export const BATCH_IDS: readonly string[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B0'];

/** Which satellites' deltas each batch receives. */
export const DELTA_BATCHES: Readonly<Record<SatelliteKey, readonly string[]>> = {
    cli: ['B1'],
    mcp: ['B2'],
    react: ['B3', 'B8'],
};

export function batchOf(file: string): string {
    const path = file.replace(/\\/g, '/');
    for (const [re, batch] of BATCH_OF) if (re.test(path)) return batch;
    return 'B0';
}

/**
 * `verify-docs --json` prints one JSON array on stdout; anything else on the
 * stream (a stray warning) is skipped by locating the array. Returns null
 * when no array of findings can be read.
 */
export function parseVerifyDocsJson(stdout: string): Finding[] | null {
    const candidates = [stdout.trim()];
    const first = stdout.indexOf('[');
    const last = stdout.lastIndexOf(']');
    if (first !== -1 && last > first) candidates.push(stdout.slice(first, last + 1));
    for (const c of candidates) {
        try {
            const parsed: unknown = JSON.parse(c);
            if (Array.isArray(parsed) && parsed.every(isFinding)) return parsed;
        } catch {
            // try the next candidate
        }
    }
    return null;
}

function isFinding(x: unknown): x is Finding {
    if (typeof x !== 'object' || x === null) return false;
    const f = x as Record<string, unknown>;
    return typeof f.file === 'string' && typeof f.line === 'number' && typeof f.rule === 'string'
        && typeof f.message === 'string' && (f.severity === 'error' || f.severity === 'warn');
}

/**
 * Runs every blind-spot row over the live files and keeps the tokens whose
 * version (or bare pin) differs from the manifest. A row with `file: '*'`
 * sweeps every file given; a row naming a file reads that file only. The
 * package comes from the row, or from its `nameGroup` when the pattern
 * matches several packages.
 */
export function evaluateBlindSpots(
    rows: readonly BlindSpotRow[],
    files: ReadonlyMap<string, string>,
    expected: Readonly<Partial<Record<SatelliteKey, Expected>>>,
): BlindSpotFinding[] {
    const out: BlindSpotFinding[] = [];
    const group = (m: RegExpExecArray, g: number | string | undefined): string | undefined =>
        g === undefined ? undefined : typeof g === 'number' ? m[g] : m.groups?.[g];
    for (const row of rows) {
        const targets = row.file === '*' ? [...files.keys()] : [row.file.replace(/\\/g, '/')];
        const re = new RegExp(row.pattern.source, row.pattern.flags.includes('g') ? row.pattern.flags : `${row.pattern.flags}g`);
        for (const file of targets) {
            const text = files.get(file);
            if (text === undefined) continue;
            re.lastIndex = 0;
            for (let m = re.exec(text); m !== null; m = re.exec(text)) {
                if (m[0].length === 0) re.lastIndex++;
                const pkgName = row.package ?? group(m, row.nameGroup);
                const key = pkgName === undefined ? null : satelliteKey(pkgName);
                if (key === null) continue;
                const want = expected[key];
                if (!want) continue;
                const line = lineAt(text, m.index);
                const check = (kind: 'version' | 'pin', current: string | undefined): void => {
                    const target = kind === 'version' ? want.version : barePin(want.pin);
                    if (current === undefined || target === null) return;
                    const live = barePin(current) ?? current;
                    if (live !== target) out.push({ id: row.id, file, line, package: key, kind, current, expected: target });
                };
                check(row.kind, group(m, row.versionGroup));
                if (row.pinGroup !== undefined) check('pin', group(m, row.pinGroup));
            }
        }
    }
    return out;
}

/** `commands: +foo, +bar / -baz` — one line per list that changed. */
export function deltaLines(name: string, delta: DeltaLike | null | undefined): string[] {
    if (!delta) return [];
    const lines: string[] = [];
    for (const [list, d] of Object.entries(delta)) {
        if (d.added.length === 0 && d.removed.length === 0) continue;
        const parts: string[] = [];
        if (d.added.length > 0) parts.push(d.added.map((x) => `+${x}`).join(', '));
        if (d.removed.length > 0) parts.push(d.removed.map((x) => `-${x}`).join(', '));
        lines.push(`${name} ${list}: ${parts.join(' / ')}`);
    }
    return lines;
}

function emptyBatches(): Record<string, Batch> {
    const out: Record<string, Batch> = {};
    for (const id of BATCH_IDS) out[id] = { files: [], findings: [], blindSpots: [], deltas: [] };
    return out;
}

/** Groups findings, blind spots and deltas into the writer batches. */
export function buildWorklist(
    generatedOn: string,
    exitCode: number | null,
    findings: readonly Finding[],
    blindSpots: readonly BlindSpotFinding[],
    deltas: Readonly<Partial<Record<SatelliteKey, readonly string[]>>>,
): Worklist {
    const batches = emptyBatches();
    const touch = (batch: Batch, file: string): void => {
        if (!batch.files.includes(file)) batch.files.push(file);
    };
    const sorted = [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.line - b.line);
    for (const f of sorted) {
        const b = batches[batchOf(f.file)];
        touch(b, f.file);
        b.findings.push(f);
    }
    for (const s of blindSpots) {
        const b = batches[batchOf(s.file)];
        touch(b, s.file);
        b.blindSpots.push(s);
    }
    for (const key of SATELLITE_KEYS) {
        const lines = deltas[key];
        if (!lines || lines.length === 0) continue;
        for (const id of DELTA_BATCHES[key]) batches[id].deltas.push(...lines);
    }
    for (const b of Object.values(batches)) b.files.sort();
    return {
        generatedOn,
        verifyDocs: {
            exitCode,
            errors: findings.filter((f) => f.severity === 'error').length,
            warnings: findings.filter((f) => f.severity === 'warn').length,
        },
        batches,
    };
}

/** The Markdown the coordinator reads: one section per non-empty batch. */
export function renderWorklist(w: Worklist): string {
    const lines: string[] = [
        `# Satellite worklist — ${w.generatedOn}`,
        '',
        `verify-docs: ${w.verifyDocs.errors} error${w.verifyDocs.errors === 1 ? '' : 's'}, ${w.verifyDocs.warnings} warning${w.verifyDocs.warnings === 1 ? '' : 's'} (exit ${w.verifyDocs.exitCode ?? 'n/a'})`,
        '',
    ];
    for (const id of BATCH_IDS) {
        const b = w.batches[id];
        if (b.findings.length === 0 && b.blindSpots.length === 0 && b.deltas.length === 0) continue;
        lines.push(`## ${id}${b.files.length > 0 ? ` — ${b.files.join(', ')}` : ''}`, '');
        if (b.findings.length > 0) {
            lines.push('### verify-docs', '');
            let file = '';
            let rule = '';
            for (const f of b.findings) {
                if (f.file !== file) {
                    file = f.file;
                    rule = '';
                    lines.push(`- ${file}`);
                }
                if (f.rule !== rule) {
                    rule = f.rule;
                    lines.push(`  - [${rule}]`);
                }
                lines.push(`    - ${f.severity === 'warn' ? 'warn ' : ''}l.${f.line}: ${f.message}`);
            }
            lines.push('');
        }
        if (b.blindSpots.length > 0) {
            lines.push('### Blind spots (not seen by verify-docs)', '');
            for (const s of b.blindSpots) {
                lines.push(`- ${s.file}:${s.line} [${s.id}] pdfnative-${s.package} ${s.kind} ${s.current} → ${s.expected}`);
            }
            lines.push('');
        }
        if (b.deltas.length > 0) {
            lines.push('### Surface delta', '');
            for (const d of b.deltas) lines.push(`- ${d}`);
            lines.push('');
        }
    }
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────

export const USAGE =
    'usage: npx tsx scripts/satellite-sync.ts [--cli <dir>] [--mcp <dir>] [--react <dir>] [--expect cli=X.Y.Z mcp=X.Y.Z react=X.Y.Z]\n'
    + '         [--capture] [--apply] [--worklist] [--json] [--out <dir>] [--date YYYY-MM-DD] [--dry-run]';

const DEFAULT_OUT = 'test-output/.satellites';

/** Returns the options, or a usage error message. */
export function parseArgs(argv: readonly string[]): Options | string {
    const roots: Record<SatelliteKey, string | null> = { cli: null, mcp: null, react: null };
    const expect: Partial<Record<SatelliteKey, string>> = {};
    let capture = false;
    let apply = false;
    let worklist = false;
    let json = false;
    let dryRun = false;
    let out: string | null = null;
    let date: string | null = null;
    const expectError = (entry: string): string => `--expect "${entry}" is not <cli|mcp|react>=<X.Y.Z>\n${USAGE}`;
    const addExpect = (raw: string): string | null => {
        for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
            const eq = entry.indexOf('=');
            if (eq === -1) return expectError(entry);
            const key = satelliteKey(entry.slice(0, eq));
            const version = entry.slice(eq + 1);
            if (key === null || !isSemver(version)) return expectError(entry);
            expect[key] = version;
        }
        return null;
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = (): string | null => (i + 1 < argv.length ? argv[++i] : null);
        const flag = arg.startsWith('--') ? arg.slice(2) : null;
        if (arg === '--capture') capture = true;
        else if (arg === '--apply') apply = true;
        else if (arg === '--worklist') worklist = true;
        else if (arg === '--json') json = true;
        else if (arg === '--dry-run') dryRun = true;
        else if (arg === '--out') out = value() ?? '';
        else if (arg === '--date') date = value() ?? '';
        else if (arg.startsWith('--out=')) out = arg.slice('--out='.length);
        else if (arg.startsWith('--date=')) date = arg.slice('--date='.length);
        else if (flag !== null && (SATELLITE_KEYS as readonly string[]).includes(flag)) roots[flag as SatelliteKey] = value() ?? '';
        else if (flag !== null && /^(cli|mcp|react)=/.test(flag)) roots[flag.slice(0, flag.indexOf('=')) as SatelliteKey] = flag.slice(flag.indexOf('=') + 1);
        else if (arg === '--expect' || arg.startsWith('--expect=')) {
            const entries: string[] = arg === '--expect' ? [] : [arg.slice('--expect='.length)];
            // Bare `--expect` takes every following `<key>=<version>` word; the validator names a bad key.
            while (arg === '--expect' && i + 1 < argv.length && /^[^-][^=]*=/.test(argv[i + 1])) entries.push(argv[++i]);
            if (entries.length === 0) return `--expect needs at least one <cli|mcp|react>=<X.Y.Z>\n${USAGE}`;
            for (const e of entries) {
                const err = addExpect(e);
                if (err !== null) return err;
            }
        } else return `unknown argument "${arg}"\n${USAGE}`;
    }
    for (const key of SATELLITE_KEYS) if (roots[key] === '') return `--${key} needs a directory\n${USAGE}`;
    if (out === '') return `--out needs a directory\n${USAGE}`;
    if (date !== null && !isIsoDate(date)) return `--date "${date}" is not an ISO date (YYYY-MM-DD)`;
    return { roots, expect, capture, apply, worklist, json, out: out ?? DEFAULT_OUT, date: date ?? todayUtc(), dryRun };
}

// ── main ────────────────────────────────────────────────────────────

interface Spawned {
    readonly ok: boolean;
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error: string | null;
}

/** Runs one command line in `cwd`: through the shell on Windows, as argv elsewhere. */
function run(cmd: string, cwd: string): Spawned {
    const shell = process.platform === 'win32';
    const argv = shell ? [] : splitCommand(cmd);
    const r = spawnSync(shell ? cmd : argv[0], shell ? [] : argv.slice(1), {
        cwd,
        shell,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
    });
    return {
        ok: r.error === undefined && r.status === 0,
        status: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        error: r.error ? r.error.message : null,
    };
}

function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, filter, out);
        else if (filter(full)) out.push(full);
    }
    return out;
}

interface ManifestPackage {
    readonly version?: string;
    readonly pin?: string | null;
    readonly counts?: Record<string, number>;
}

interface Manifest {
    readonly verifiedOn?: string;
    readonly packages?: Record<string, ManifestPackage | undefined>;
}

/** The doc files the blind-spot sweep reads (the generated llms bulk files excluded). */
function blindSpotFiles(root: string): Map<string, string> {
    const rel = (p: string): string => relative(root, p).replace(/\\/g, '/');
    const files = [
        ...['README.md', 'llms.txt', 'package.json'].map((f) => join(root, f)),
        ...walk(join(root, 'docs'), (p) => /\.(html|md|txt|js|json)$/.test(p) && !/llms-(full|recipes|index)\./.test(p) && !/[\\/]assets[\\/]api\.json$/.test(p)),
    ];
    const out = new Map<string, string>();
    for (const f of files) {
        const text = readTextOr(f);
        if (text !== null) out.set(rel(f), text);
    }
    return out;
}

async function main(): Promise<number> {
    const parsed = parseArgs(process.argv.slice(2));
    if (typeof parsed === 'string') {
        console.error(`satellite-sync: ${parsed}`);
        return 2;
    }
    const opts = parsed;
    const root = resolve(import.meta.dirname, '..');
    const outDir = resolve(root, opts.out);
    const rel = (p: string): string => relative(root, p).replace(/\\/g, '/');
    const summary: string[] = [];
    const say = (line: string): void => {
        summary.push(line);
        if (!opts.json) console.log(line);
    };

    // The surface library is loaded here, not at module level: the pure helpers
    // above (and their tests) do not depend on it.
    const lib = await import('./lib/satellite-surface.js');

    // 1. Checkouts and --expect
    const satRoots = new Map<SatelliteKey, string>();
    const versions: Partial<Record<SatelliteKey, string>> = {};
    const skipped: string[] = [];
    const mismatches: string[] = [];
    for (const key of SATELLITE_KEYS) {
        const dir = resolve(root, opts.roots[key] ?? join('..', `pdfnative-${key}`));
        const pkgText = readTextOr(join(dir, 'package.json'));
        const expected = opts.expect[key];
        if (pkgText === null) {
            if (expected !== undefined) mismatches.push(`pdfnative-${key}: ${rel(dir)} has no package.json (expected ${expected})`);
            else skipped.push(`pdfnative-${key} (${rel(dir)} not found)`);
            continue;
        }
        let version = '';
        try {
            version = String((JSON.parse(pkgText) as { version?: unknown }).version ?? '');
        } catch {
            mismatches.push(`pdfnative-${key}: ${rel(join(dir, 'package.json'))} is not JSON`);
            continue;
        }
        if (expected !== undefined && version !== expected) {
            mismatches.push(`pdfnative-${key}: checkout at ${version}, --expect ${expected}`);
            continue;
        }
        satRoots.set(key, dir);
        versions[key] = version;
    }
    if (mismatches.length > 0) {
        for (const m of mismatches) console.error(`satellite-sync: ${m}`);
        return 2;
    }
    say(`satellite-sync: ${SATELLITE_KEYS.filter((k) => satRoots.has(k)).map((k) => `${k} ${versions[k]}`).join(', ') || 'no satellite checkout'}`
        + `${skipped.length > 0 ? ` — skipped ${skipped.join(', ')}` : ''}${opts.dryRun ? ' — dry run, repo edits are not written' : ''}`);

    mkdirSync(outDir, { recursive: true });
    const outputs: string[] = [];
    const write = (name: string, text: string): void => {
        writeFileSync(join(outDir, name), text);
        outputs.push(rel(join(outDir, name)));
    };

    // 2. --capture: the satellites' own JSON, cached per satellite
    const captures = new Map<SatelliteKey, Captures>();
    for (const [key, dir] of satRoots) {
        {
            const commands = lib.CAPTURE_COMMANDS[packageOf(key)];
            if (commands.length === 0) continue;
            const cachePath = join(outDir, `${key}.capture.json`);
            const cached = readTextOr(cachePath);
            // A cached capture is reused whether or not --capture is given: a run without
            // the captures would otherwise fall back to the previous release's lists.
            if (cached !== null) {
                try {
                    captures.set(key, (JSON.parse(cached) as CaptureCache).captures);
                    say(`  =  ${rel(cachePath)} — reused`);
                    continue;
                } catch {
                    // fall through and recapture
                }
            }
            if (!opts.capture) {
                say(`  ~  ${rel(cachePath)} — no capture (pass --capture); the counts that need one stay unverified`);
                continue;
            }
            const result: Record<string, unknown> = {};
            const failed: Record<string, string> = {};
            commands.forEach((cmd, i) => {
                const slot = CAPTURE_KEYS[key][i];
                if (slot === undefined) return;
                const r = run(cmd, dir);
                let parsedOut: unknown = null;
                if (r.ok) {
                    try {
                        parsedOut = JSON.parse(r.stdout);
                    } catch {
                        parsedOut = null;
                    }
                }
                if (parsedOut === null) failed[cmd] = `${r.error ?? `exit ${r.status ?? 'signal'}`}: ${r.stderr.slice(-500).trim()}`;
                else result[slot] = parsedOut;
            });
            const cache: CaptureCache = { captures: result as Captures, failed };
            writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
            captures.set(key, cache.captures);
            const n = Object.keys(failed).length;
            say(`  +  ${rel(cachePath)} — ${commands.length - n}/${commands.length} capture${commands.length === 1 ? '' : 's'}${n > 0 ? ` (failed: ${Object.keys(failed).join('; ')})` : ''}`);
        }
    }

    // 3. Facts
    const manifestPath = join(root, 'docs', 'assets', 'ecosystem.json');
    const manifestText = readTextOr(manifestPath);
    let manifest: Manifest = {};
    try {
        manifest = manifestText === null ? {} : (JSON.parse(manifestText) as Manifest);
    } catch {
        console.error(`satellite-sync: ${rel(manifestPath)} is not JSON`);
        return 1;
    }
    const manifestRow = (key: SatelliteKey): { version: string; pin: string | null; counts: Record<string, number> } => {
        const p = manifest.packages?.[`pdfnative-${key}`];
        return { version: p?.version ?? '', pin: p?.pin ?? null, counts: p?.counts ?? {} };
    };
    const surfaces = new Map<SatelliteKey, SatelliteSurface>();
    const deltas = new Map<SatelliteKey, SurfaceDelta>();
    const satellites: SatelliteFacts['satellites'] = {};
    for (const [key, dir] of satRoots) {
        const name = packageOf(key);
        const surface = lib.readSurfaceOrDerive(dir, name, captures.get(key));
        const previous = lib.readPreviousSurface(dir, name);
        const delta = lib.diffSurface(previous, surface);
        surfaces.set(key, surface);
        deltas.set(key, delta);
        satellites[name] = { surface, previous, delta, manifestToday: manifestRow(key) };
    }
    const blindSpots: readonly BlindSpot[] = lib.blindSpotTable();
    const facts: SatelliteFacts = {
        generatedOn: opts.date,
        engineVersion: manifest.packages?.pdfnative?.version ?? '',
        satellites,
    };
    write('facts.json', `${JSON.stringify(facts, null, 2)}\n`);
    write('facts.md', lib.renderFactsMarkdown(facts));
    say(`  +  ${rel(join(outDir, 'facts.md'))} + facts.json — ${surfaces.size} satellite${surfaces.size === 1 ? '' : 's'}`);

    // 4. --apply
    let problems = 0;
    let changed = 0;
    let current = 0;
    let npmInstall = false;
    const applyLog: string[] = [];
    if (opts.apply) {
        const mark = opts.dryRun ? '~' : '+';
        /** Read, rewrite, report, and write unless --dry-run. `optional`: a missing pattern is informational. */
        const edit = (relPath: string, what: string, fn: (text: string) => Rewrite, optional = false): boolean => {
            const abs = join(root, relPath);
            const before = readTextOr(abs);
            if (before === null) {
                say(`  !  ${relPath} — missing`);
                problems++;
                return false;
            }
            const r = fn(before);
            if (r.matched === 0) {
                if (optional) {
                    applyLog.push(`  -  ${relPath} — ${what}: not present`);
                } else {
                    say(`  !  ${relPath} — ${what}: pattern not found, edit by hand`);
                    problems++;
                }
                return false;
            }
            if (r.text === before) {
                applyLog.push(`  =  ${relPath} — ${what}: already current`);
                current++;
                return false;
            }
            say(`  ${mark}  ${relPath} — ${what}`);
            applyLog.push(`  ${mark}  ${relPath} — ${what}`);
            changed++;
            if (!opts.dryRun) writeFileSync(abs, r.text);
            return true;
        };
        const rows = new Map<SatelliteKey, PackageRow>();
        for (const [key, surface] of surfaces) {
            // Only the counters the manifest already polices are synced, and only when the
            // surface verified them: a count taken from a previous capture (listed under
            // `unverified`) must never overwrite a policed value.
            const existing = manifestRow(key).counts;
            rows.set(key, { version: surface.version, pin: surface.engine.pin, counts: Object.keys(existing).length > 0 ? syncCounts(existing, surface.counts, surface.unverified) : undefined });
        }

        edit('docs/assets/ecosystem.json', `packages.* version/pin/counts + verifiedOn ${opts.date}`, (t) => {
            let text = t;
            let matched = 0;
            for (const [key, row] of rows) {
                const r = bumpPackageRow(text, `pdfnative-${key}`, row);
                text = r.text;
                matched += r.matched;
            }
            const d = restampVerifiedOn(text, opts.date);
            return { text: d.text, matched: matched + d.matched };
        });
        for (const stamped of ['llms.txt', 'docs/llms.txt', 'docs/agent-brief.md', 'docs/data/surfaces.json', 'docs/data/errors.json', 'docs/data/playgrounds.json']) {
            edit(stamped, `Verified on ${opts.date}`, (t) => restampVerifiedOn(t, opts.date));
        }
        edit('docs/assets/versions.js', 'FALLBACK rows', (t) => {
            let text = t;
            let matched = 0;
            for (const [key, row] of rows) {
                const r = bumpVersionsFallback(text, `pdfnative-${key}`, row.version, row.pin);
                text = r.text;
                matched += r.matched;
            }
            return { text, matched };
        });
        edit('docs/index.html', 'JSON-LD softwareVersion + badges', (t) => {
            let text = t;
            let matched = 0;
            for (const [key, row] of rows) {
                const ld = bumpJsonLdVersion(text, `https://pdfnative.dev/#${key}`, row.version);
                const badge = bumpBadge(ld.text, `pdfnative-${key}`, row.version);
                text = badge.text;
                matched += ld.matched + badge.matched;
            }
            return { text, matched };
        });
        for (const [key, row] of rows) {
            let pins = 0;
            for (const file of walk(join(root, 'docs'), (p) => p.endsWith('.html'))) {
                const r = bumpImportmapPin(readTextOr(file) ?? '', `pdfnative-${key}`, row.version);
                if (r.matched === 0) continue;
                pins += r.matched;
                edit(rel(file), `importmap pdfnative-${key}@${row.version}`, (t) => bumpImportmapPin(t, `pdfnative-${key}`, row.version));
            }
            applyLog.push(`  ${pins > 0 ? '=' : '-'}  docs/**/*.html — ${pins} importmap pin${pins === 1 ? '' : 's'} pdfnative-${key}@`);
        }
        for (const [key, row] of rows) {
            if (edit('package.json', `devDependencies.pdfnative-${key} ^${row.version}`, (t) => bumpDevDependency(t, `pdfnative-${key}`, `^${row.version}`), true)) npmInstall = true;
        }
        edit('README.md', 'ecosystem table version cells', (t) => {
            let text = t;
            let matched = 0;
            for (const [key, row] of rows) {
                const r = bumpReadmeEcosystemRow(text, `pdfnative-${key}`, row.version);
                text = r.text;
                matched += r.matched;
            }
            return { text, matched };
        });
        for (const llms of ['llms.txt', 'docs/llms.txt']) {
            edit(llms, 'ecosystem lines (version, requires, pins)', (t) => {
                let text = t;
                let matched = 0;
                for (const [key, row] of rows) {
                    const r = bumpLlmsEcosystemLine(text, `pdfnative-${key}`, row.version, row.pin);
                    text = r.text;
                    matched += r.matched;
                }
                return { text, matched };
            });
        }
        write('apply.log', `${applyLog.join('\n')}\n`);
        say(`  apply: ${changed} ${opts.dryRun ? 'would change' : 'changed'}, ${current} already current, ${problems} not found (${rel(join(outDir, 'apply.log'))})`);
        if (npmInstall) say(`  →  package.json devDependency changed: run \`npm install\` (not run by this script)`);
    }

    // 5. --worklist
    let worklist: Worklist | null = null;
    if (opts.worklist) {
        const r = run('npx tsx scripts/verify-docs.ts --json', root);
        if (r.error !== null) {
            console.error(`satellite-sync: could not spawn verify-docs: ${r.error}`);
            return 3;
        }
        const findings = parseVerifyDocsJson(r.stdout);
        if (findings === null) {
            console.error(`satellite-sync: verify-docs --json printed no findings array (exit ${r.status ?? 'signal'})\n${r.stderr.slice(-2000)}`);
            return 3;
        }
        const expected: Partial<Record<SatelliteKey, Expected>> = {};
        for (const key of SATELLITE_KEYS) {
            const row = manifestRow(key);
            if (row.version) expected[key] = { version: row.version, pin: row.pin };
        }
        const spots = evaluateBlindSpots(blindSpots as readonly BlindSpotRow[], blindSpotFiles(root), expected);
        const deltaText: Partial<Record<SatelliteKey, string[]>> = {};
        for (const [key, delta] of deltas) {
            const prev = surfaces.get(key)?.previous ?? '?';
            deltaText[key] = deltaLines(`pdfnative-${key} ${prev} → ${versions[key] ?? '?'}`, delta);
        }
        worklist = buildWorklist(opts.date, r.status, findings, spots, deltaText);
        write('worklist.json', `${JSON.stringify(worklist, null, 2)}\n`);
        write('worklist.md', renderWorklist(worklist));
        const files = new Set(findings.map((f) => f.file)).size;
        const active = BATCH_IDS.filter((id) => {
            const b = worklist?.batches[id];
            return b !== undefined && (b.findings.length > 0 || b.blindSpots.length > 0 || b.deltas.length > 0);
        });
        say(`  +  ${rel(join(outDir, 'worklist.md'))} — ${findings.length} finding${findings.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}, ${spots.length} blind spot${spots.length === 1 ? '' : 's'}, batches ${active.join(' ') || 'none'}`);
    }

    const code = problems > 0 ? 1 : 0;
    if (opts.json) {
        console.log(JSON.stringify({
            ok: code === 0,
            exitCode: code,
            date: opts.date,
            dryRun: opts.dryRun,
            satellites: versions,
            skipped,
            outputs,
            apply: opts.apply ? { changed, current, problems, npmInstall } : null,
            worklist: worklist ? { ...worklist.verifyDocs, batches: Object.fromEntries(Object.entries(worklist.batches).map(([id, b]) => [id, b.files])) } : null,
            summary,
        }, null, 2));
    } else {
        say(code === 0 ? 'satellite-sync: done' : `satellite-sync: ${problems} edit${problems === 1 ? '' : 's'} found no pattern — see above`);
    }
    return code;
}

const isMain = import.meta.filename === resolve(process.argv[1] ?? '');
if (isMain) {
    main().then((code) => process.exit(code), (e: unknown) => {
        console.error(`satellite-sync: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    });
}
