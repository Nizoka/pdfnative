#!/usr/bin/env tsx
/**
 * pdfnative — documentation consistency verifier
 * ================================================
 * Every version string, tool count and command count quoted in the docs is
 * hand-copied across ~40 files, including JSON-LD blocks and the `<desc>` of an
 * SVG. Nothing checked them, so they drifted a full release train apart: the
 * site advertised 19 MCP tools (real: 24) and 11 CLI commands (real: 17), and
 * three guides taught streaming functions that were never exported.
 *
 * This script makes `docs/assets/ecosystem.json` the single source of truth and
 * fails the build when any documentation file disagrees with it.
 *
 * Usage:
 *   npm run verify:docs                 # offline, hermetic — safe in CI
 *   npm run verify:docs -- --online     # also compare against the npm registry
 *   npm run verify:docs -- --json       # machine-readable, for CI annotations
 *
 * Exit codes:
 *   0 — every rule passes.
 *   1 — at least one rule failed; each problem is printed as `path:line [rule] message`.
 *
 * The script never writes. It is safe to run against a dirty tree.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative, resolve, dirname, posix, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { findNonEnglishProse } from './lib/prose-language.js';
import {
    INSTRUCTIONS_DIR,
    RULES_DIR,
    checkAgentConfigParity,
    checkClaudeRulesBudget,
    checkEol,
    checkNodeVersionPin,
    checkPrTemplateParity,
    checkSkillShape,
    checkTagRuleset,
    type Finding,
} from './lib/agent-config.js';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = join(ROOT, 'docs', 'assets', 'ecosystem.json');

const ONLINE = process.argv.includes('--online');
const STRICT = process.argv.includes('--strict');
const JSON_OUT = process.argv.includes('--json');

// ── Problem collection ──────────────────────────────────────────────

interface Problem {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly message: string;
    readonly severity: 'error' | 'warn';
}

const problems: Problem[] = [];

function fail(file: string, line: number, rule: string, message: string): void {
    problems.push({ file, line, rule, message, severity: 'error' });
}

function warn(file: string, line: number, rule: string, message: string): void {
    problems.push({ file, line, rule, message, severity: 'warn' });
}

// ── Filesystem helpers ──────────────────────────────────────────────

function walk(dir: string, filter: (p: string) => boolean, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, filter, out);
        else if (filter(full)) out.push(full);
    }
    return out;
}

function rel(p: string): string {
    return relative(ROOT, p).replace(/\\/g, '/');
}

function read(p: string): string {
    return readFileSync(p, 'utf8');
}

/** Line number (1-based) of a character offset. */
function lineOf(text: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i++) {
        if (text.charCodeAt(i) === 10) line++;
    }
    return line;
}

// ── Manifest ────────────────────────────────────────────────────────

interface PackageEntry {
    version: string;
    pinField: 'dependencies' | 'peerDependencies' | null;
    pin: string | null;
    toolCount?: number;
    tools?: string[];
    commandCount?: number;
    commandGroups?: Record<string, string[]>;
}

interface Assertion {
    id: string;
    canonical: string;
    /**
     * Regex whose first capture group is the number to compare against
     * `expect`. Preferred over `forbid`, which could only list values already
     * known to be wrong — it caught yesterday's drift and nothing else, and it
     * is how "19 pdfnative-mcp tools" slipped through: the intervening word was
     * not in the alternation.
     */
    match?: string;
    /** The value the captured number must equal. */
    expect?: number;
    /**
     * `declared.<key>` or `derived.<key>`: the manifest field `expect` is
     * resolved from, so the assertion cannot drift from the counter it
     * polices (a literal `expect` that disagrees fails manifest-shape). The
     * canonical sentence follows the same value: `{declared.<key>}` /
     * `{derived.<key>}` placeholders are substituted, and a bare leading
     * number is checked against it.
     */
    expectFrom?: string;
    /** Legacy blocklist form, still honoured for un-migrated assertions. */
    forbid?: string;
    requireIn: string[];
}

interface Manifest {
    verifiedOn: string;
    packages: Record<string, PackageEntry>;
    derived: Record<string, number>;
    declared: Record<string, unknown>;
    assertions: Assertion[];
    apiDenylist: Record<string, string>;
    learnPath: string[];
}

if (!existsSync(MANIFEST_PATH)) {
    console.error(`verify-docs: manifest not found at ${rel(MANIFEST_PATH)}`);
    process.exit(1);
}

let manifest: Manifest;
try {
    manifest = JSON.parse(read(MANIFEST_PATH)) as Manifest;
} catch (err) {
    console.error(`verify-docs: manifest is not valid JSON — ${(err as Error).message}`);
    process.exit(1);
}

const MANIFEST_REL = rel(MANIFEST_PATH);

// ── The documentation corpus ────────────────────────────────────────

const DOC_FILES: string[] = [
    // llms-full.txt and llms-recipes.txt are generated from files already in
    // the corpus; scanning a concatenation would double-report every finding
    // at line numbers nobody can act on.
    ...walk(
        join(ROOT, 'docs'),
        (p) =>
            /\.(html|md|js|svg|xml|txt)$/.test(p) &&
            !p.includes('ecosystem.json') &&
            !p.endsWith('llms-full.txt') &&
            !p.endsWith('llms-recipes.txt'),
    ),
    ...['README.md', 'ROADMAP.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'llms.txt']
        .map((f) => join(ROOT, f))
        .filter(existsSync),
    ...['.github/copilot-instructions.md'].map((f) => join(ROOT, f)).filter(existsSync),
    // Agent-facing instruction files are documentation too — three of them
    // taught denylisted phantom APIs for a full release train because they
    // were outside the corpus.
    ...walk(join(ROOT, '.github', 'instructions'), (p) => p.endsWith('.md')),
    ...walk(join(ROOT, '.github', 'prompts'), (p) => p.endsWith('.md')),
    // The recipes ARE documentation — executable documentation is the whole
    // point — so their source is scanned directly (the generated llms-recipes
    // concatenation above is excluded in their favour).
    ...walk(join(ROOT, 'recipes'), (p) => p.endsWith('.ts')),
];

const HTML_FILES = walk(join(ROOT, 'docs'), (p) => p.endsWith('.html'));

// ── Rule: manifest-shape ────────────────────────────────────────────

const SEMVER = /^\d+\.\d+\.\d+$/;

for (const [name, pkg] of Object.entries(manifest.packages)) {
    if (!SEMVER.test(pkg.version)) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `${name}.version "${pkg.version}" is not a plain semver triple`);
    }
    if (pkg.pinField !== null && pkg.pinField !== 'dependencies' && pkg.pinField !== 'peerDependencies') {
        fail(MANIFEST_REL, 1, 'manifest-shape', `${name}.pinField must be "dependencies", "peerDependencies" or null`);
    }
    if (pkg.pinField !== null && !pkg.pin) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `${name} declares pinField "${pkg.pinField}" but no pin`);
    }
}

const mcp = manifest.packages['pdfnative-mcp'];
if (mcp?.tools && mcp.toolCount !== mcp.tools.length) {
    fail(MANIFEST_REL, 1, 'manifest-shape', `pdfnative-mcp.toolCount is ${mcp.toolCount} but ${mcp.tools.length} tools are listed`);
}

const cli = manifest.packages['pdfnative-cli'];
if (cli?.commandGroups) {
    const listed = Object.values(cli.commandGroups).flat().length;
    if (cli.commandCount !== listed) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `pdfnative-cli.commandCount is ${cli.commandCount} but ${listed} commands are grouped`);
    }
}

/**
 * `declared.<key>` / `derived.<key>` → the manifest number, or undefined when
 * the reference is malformed or the field is not a number.
 */
function manifestRef(ref: string): number | undefined {
    const m = /^(declared|derived)\.([A-Za-z_]\w*)$/.exec(ref);
    if (!m) return undefined;
    const value = (m[1] === 'declared' ? manifest.declared : manifest.derived)[m[2]];
    return typeof value === 'number' ? value : undefined;
}

/** Substitute `{declared.x}` / `{derived.x}` placeholders in a canonical sentence. */
function resolveCanonical(canonical: string): string {
    return canonical.replace(/\{((?:declared|derived)\.\w+)\}/g, (whole, ref: string) => {
        const value = manifestRef(ref);
        return value === undefined ? whole : String(value);
    });
}

// assertions-vs-declared: an assertion's `expect` and canonical sentence are
// tied to the counter they police. The 1.8.0 audit found `pdfa-sample-count`
// carrying its own copy of `declared.pdfaSamples` — two numbers, one truth.
for (const assertion of manifest.assertions) {
    if (assertion.expectFrom === undefined) continue;
    const resolved = manifestRef(assertion.expectFrom);
    if (resolved === undefined) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `assertion "${assertion.id}" has expectFrom "${assertion.expectFrom}", which is not a numeric declared.* or derived.* field`);
        continue;
    }
    if (assertion.expect !== undefined && assertion.expect !== resolved) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `assertion "${assertion.id}" says expect ${assertion.expect} but ${assertion.expectFrom} is ${resolved} — drop the literal, expectFrom is the source`);
    }
    const canonical = resolveCanonical(assertion.canonical);
    const lead = /^(\d[\d , ]*)/.exec(canonical);
    if (lead && !assertion.canonical.startsWith('{') && Number(lead[1].replace(/[\s ,]/g, '')) !== resolved) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `assertion "${assertion.id}" canonical "${assertion.canonical}" contradicts ${assertion.expectFrom} = ${resolved} — use a {${assertion.expectFrom}} placeholder`);
    }
    for (const placeholder of canonical.matchAll(/\{((?:declared|derived)\.\w+)\}/g)) {
        fail(MANIFEST_REL, 1, 'manifest-shape', `assertion "${assertion.id}" canonical references {${placeholder[1]}}, which is not a numeric manifest field`);
    }
}

// ── Rule: derived-counts ────────────────────────────────────────────

const actualDerived: Record<string, number> = {
    testFiles: walk(join(ROOT, 'tests'), (p) => p.endsWith('.test.ts')).length,
    sampleGenerators: existsSync(join(ROOT, 'scripts', 'generators'))
        ? readdirSync(join(ROOT, 'scripts', 'generators')).filter((f) => f.endsWith('.ts')).length
        : 0,
    guides: existsSync(join(ROOT, 'docs', 'guides'))
        ? readdirSync(join(ROOT, 'docs', 'guides')).filter((f) => f.endsWith('.md')).length
        : 0,
    // Live playgrounds only — retired ones survive as noindex redirect stubs.
    playgrounds: existsSync(join(ROOT, 'docs', 'playgrounds'))
        ? readdirSync(join(ROOT, 'docs', 'playgrounds')).filter(
              (f) =>
                  f.endsWith('.html') &&
                  f !== 'index.html' &&
                  !/name=["']robots["'][^>]*noindex/i.test(read(join(ROOT, 'docs', 'playgrounds', f))),
          ).length
        : 0,
    learnSteps: manifest.learnPath.length,
    recipes: existsSync(join(ROOT, 'recipes'))
        ? readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.ts')).length
        : 0,
};

// Two hand-maintained `declared.*` figures the tree CAN check, added after
// the 1.8.0 review found that mutating `declared.tests` to 9999 passed every
// rule: the font-module count is a directory listing, and the test count is
// whatever the last gate run recorded (`test-output/.gate/vitest.json` is
// written by `npm run gate`, whose `test` step precedes `verify:docs`).
{
    const fontsDir = join(ROOT, 'fonts');
    const modules = existsSync(fontsDir) ? readdirSync(fontsDir).filter((f) => f.endsWith('-data.js')).length : 0;
    if (modules > 0 && manifest.declared['bundledFontModules'] !== modules) {
        fail(MANIFEST_REL, 1, 'derived-counts', `declared.bundledFontModules says ${manifest.declared['bundledFontModules']} but fonts/ holds ${modules} *-data.js modules — update the manifest, not the docs`);
    }
    // Only a report newer than every test file is evidence; an older one
    // predates a test that was added since and would fail the wrong side.
    const vitestJson = join(ROOT, 'test-output', '.gate', 'vitest.json');
    const newestTest = walk(join(ROOT, 'tests'), (p) => p.endsWith('.test.ts'))
        .reduce((max, p) => Math.max(max, statSync(p).mtimeMs), 0);
    if (existsSync(vitestJson) && statSync(vitestJson).mtimeMs >= newestTest) {
        // The tests that ran: passed plus failed, which is the figure the gate
        // prints on a green run ("3459 tests") and stays the same on a red one,
        // so a single failing test does not also turn this rule red. The
        // total would count skipped placeholders as well.
        let total: number | undefined;
        try {
            const report = JSON.parse(read(vitestJson)) as { numPassedTests?: number; numFailedTests?: number };
            total = typeof report.numPassedTests === 'number' ? report.numPassedTests + (report.numFailedTests ?? 0) : undefined;
        } catch {
            total = undefined;
        }
        if (typeof total === 'number' && total > 0 && manifest.declared['tests'] !== total) {
            fail(MANIFEST_REL, 1, 'derived-counts', `declared.tests says ${manifest.declared['tests']} but the last gate run counted ${total} tests — update the manifest (and every doc quoting it)`);
        }
    }
}

// A misspelt derived key (e.g. "recipies") would silently drop both the typo
// AND the real counter from verification — reject unknown keys outright.
{
    const KNOWN_DERIVED = new Set([...Object.keys(actualDerived), 'samplePdfs', 'sampleCategories', '$comment']);
    for (const key of Object.keys(manifest.derived)) {
        if (!KNOWN_DERIVED.has(key)) {
            fail(MANIFEST_REL, 1, 'manifest-shape', `derived.${key} is not computed by any rule — typo, or add it to derived-counts`);
        }
    }
}

// samplePdfs only counts when the samples have actually been generated;
// test-output/ is git-ignored, so an empty tree is not a failure. A partially
// generated tree is not one either — it is the normal local state after a
// single generator run — so a shortfall only warns. Overcounting still fails:
// more PDFs on disk than the manifest declares means the manifest is stale.
const samplePdfs = walk(join(ROOT, 'test-output'), (p) => p.endsWith('.pdf')).length;
const declaredSamplePdfs = manifest.derived['samplePdfs'];
if (samplePdfs > 0 && declaredSamplePdfs !== undefined) {
    if (samplePdfs > declaredSamplePdfs) {
        fail(
            MANIFEST_REL,
            1,
            'derived-counts',
            `derived.samplePdfs says ${declaredSamplePdfs} but the tree has ${samplePdfs} — update the manifest, not the docs`,
        );
    } else if (samplePdfs < declaredSamplePdfs) {
        warn(
            MANIFEST_REL,
            1,
            'derived-counts',
            `test-output/ holds ${samplePdfs} of ${declaredSamplePdfs} declared sample PDFs — run \`npm run test:generate\` for a full check`,
        );
    }
}

// sampleCategories is the number of category directories under test-output/
// (one per generator family: `financial/`, `shaping/`, …). Same doctrine as
// samplePdfs: only asserted once samples exist on disk, a shortfall warns, an
// overcount fails.
const TEST_OUTPUT = join(ROOT, 'test-output');
const sampleCategories = existsSync(TEST_OUTPUT)
    ? readdirSync(TEST_OUTPUT).filter((f) => !f.startsWith('.') && statSync(join(TEST_OUTPUT, f)).isDirectory()).length
    : 0;
const declaredCategories = manifest.derived['sampleCategories'];
if (samplePdfs > 0 && declaredCategories !== undefined) {
    if (sampleCategories > declaredCategories) {
        fail(MANIFEST_REL, 1, 'derived-counts', `derived.sampleCategories says ${declaredCategories} but test-output/ has ${sampleCategories} directories — update the manifest, not the docs`);
    } else if (sampleCategories < declaredCategories) {
        warn(MANIFEST_REL, 1, 'derived-counts', `test-output/ holds ${sampleCategories} of ${declaredCategories} declared sample categories — run \`npm run test:generate\` for a full check`);
    }
}

for (const [key, actual] of Object.entries(actualDerived)) {
    const declared = manifest.derived[key];
    if (declared !== undefined && declared !== actual) {
        fail(
            MANIFEST_REL,
            1,
            'derived-counts',
            `derived.${key} says ${declared} but the tree has ${actual} — update the manifest, not the docs`,
        );
    }
}

// ── Rule: stale-token / canonical-present ───────────────────────────

/**
 * Historical prose legitimately quotes superseded numbers ("v1.0.0: first
 * stable release with 12 tools"). Rewriting those would falsify the changelog,
 * so a line may opt out with `verify-docs:allow <rule>` on itself or on the
 * line immediately above — a visible, greppable marker rather than a silent
 * exclusion list that nobody maintains.
 */
function isSuppressed(lines: string[], lineNo: number, rule: string): boolean {
    const marker = `verify-docs:allow ${rule}`;
    return (lines[lineNo - 1]?.includes(marker) ?? false) || (lines[lineNo - 2]?.includes(marker) ?? false);
}

for (const assertion of manifest.assertions) {
    const pattern = assertion.match ?? assertion.forbid;
    const expect = assertion.expectFrom !== undefined ? manifestRef(assertion.expectFrom) : assertion.expect;
    const canonical = resolveCanonical(assertion.canonical);
    if (pattern) {
        const re = new RegExp(pattern, 'g');
        const isEquality = assertion.match !== undefined && expect !== undefined;
        for (const file of DOC_FILES) {
            const text = read(file);
            const lines = text.split(/\r?\n/);
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(text)) !== null) {
                const line = lineOf(text, m.index);
                if (isSuppressed(lines, line, 'stale-token')) continue;
                if (isEquality) {
                    // "2 388" and "2,388" are the same number as 2388.
                    const found = Number(m[1].replace(/[\s  ,]/g, ''));
                    if (!Number.isFinite(found) || found === expect) continue;
                    fail(rel(file), line, 'stale-token', `"${m[0].trim()}" — the manifest says ${expect} (${assertion.id})`);
                } else {
                    fail(
                        rel(file),
                        line,
                        'stale-token',
                        `"${m[0].trim()}" contradicts the manifest — canonical value is "${canonical}"`,
                    );
                }
            }
        }
    }
    for (const required of assertion.requireIn) {
        const full = join(ROOT, required);
        if (!existsSync(full)) {
            fail(MANIFEST_REL, 1, 'canonical-present', `assertion "${assertion.id}" requires ${required}, which does not exist`);
            continue;
        }
        if (!read(full).includes(canonical)) {
            fail(required, 1, 'canonical-present', `must state the canonical value "${canonical}" (assertion "${assertion.id}")`);
        }
    }
}

// ── Rule: version-token ─────────────────────────────────────────────

/**
 * A package name with a nearby semver that disagrees with the manifest is the
 * most damaging drift a doc can carry — "pdfnative-mcp v1.3.0 is a Model
 * Context Protocol server" survived two releases because stale-token only
 * matches counted nouns ("24 tools"), never version strings. Historical prose
 * ("v1.4.0 upgraded the engine to pdfnative 1.5.0") opts out with the same
 * `verify-docs:allow` marker; `stale-token` allows are honoured too, since
 * every existing historical annotation predates this rule.
 *
 * Range specifiers (`^1.29.0`, `~4.0.0`) are dependency pins and API floors
 * (`pdfnative ≥ 1.5.0`) are minimums, not claims about the package's current
 * version — both are skipped via lookbehind, as are ISO clause numbers
 * (`§6.3.2`). The gap between name and version must not cross a quote, a
 * slash, a paren or a sentence boundary: a GitHub URL segment
 * (`pdfnative/blob/main/release-notes/v1.5.0`), a parenthesised historical
 * aside, or the next sentence's feature tag is not a claim about the
 * package's current version. What remains is exactly the prose form that
 * drifted: `pdfnative-mcp v1.3.0 is a …`.
 */
for (const [name, pkg] of Object.entries(manifest.packages)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // "pdfnative" must not match inside "pdfnative-cli" / "pdfnative-react.js".
    const re = new RegExp(
        `\\b${escaped}(?![\\w-])[^\\n'"\`/().]{0,60}?(?<![\\^~\\d.§])(?<![<>≥≤=]\\s{0,3})\\bv?(\\d+\\.\\d+\\.\\d+)\\b`,
        'g',
    );
    // Two forms the prose regex cannot reach, both of which carried
    // "pdfnative v1.7.0" through the 1.8.0 bump: a Markdown table row whose
    // package name is a link (`[\`pdfnative\`](url) | **v1.7.0**`) and the
    // homepage's static badge (`data-pn-badge="pdfnative">v1.7.0<`), which
    // JavaScript overwrites at runtime but a non-JS fetcher reads as is.
    const structural = [
        new RegExp(`\\[\`${escaped}\`\\]\\([^)]*\\)\\s*\\|\\s*\\*{0,2}v?(\\d+\\.\\d+\\.\\d+)\\*{0,2}`, 'g'),
        new RegExp(`data-pn-badge=["']${escaped}["'][^>]*>\\s*v?(\\d+\\.\\d+\\.\\d+)\\s*<`, 'g'),
    ];
    for (const file of DOC_FILES) {
        const text = read(file);
        const lines = text.split(/\r?\n/);
        for (const pattern of [re, ...structural]) {
            pattern.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = pattern.exec(text)) !== null) {
                if (m[1] === pkg.version) continue;
                const line = lineOf(text, m.index);
                if (isSuppressed(lines, line, 'version-token') || isSuppressed(lines, line, 'stale-token')) continue;
                fail(rel(file), line, 'version-token', `"${m[0].trim()}" — the manifest says ${name} is ${pkg.version}`);
            }
        }
    }
}

// ── Rule: count-tokens ──────────────────────────────────────────────

/**
 * The counters quoted in prose — "3214+ tests across 150 files", "271 sample
 * PDFs", "49 generators", "90%+ statement coverage", "Current version:" —
 * were only ever pinned where an assertion happened to name them, and the
 * 1.8.0 audit found the same sentence carrying three different figures across
 * the README, the homepage and llms.txt. Every such token in the corpus must
 * now equal its manifest counter (a `+` suffix is a floor and is allowed).
 * Coverage is bounded rather than matched: `declared.coverageStatements` is
 * the integer floor of the measured figure, so a doc may state "90%+" or the
 * measured "90.9 %" but never a percentage whose integer part is higher.
 *
 * Companion-package guides (cli, mcp, react) quote THEIR OWN test suites and
 * coverage; those figures are a companion-repo concern and are skipped, as
 * the api-exists span scan already does. Historical prose opts out with
 * `verify-docs:allow count-tokens` (a `stale-token` allow is honoured too).
 */
{
    interface CountToken {
        readonly pattern: RegExp;
        readonly source: string;
        readonly mode: 'equal' | 'floor';
        readonly requireIn?: readonly string[];
    }
    const COUNT_TOKENS: readonly CountToken[] = [
        {
            pattern: /\b(\d{1,3}(?:[ , ]\d{3})*|\d+)\+?\s+tests\b/g,
            source: 'declared.tests',
            mode: 'equal',
            requireIn: ['AGENTS.md', 'README.md'],
        },
        { pattern: /\bacross\s+(\d+)\+?\s+(?:test\s+)?files\b/g, source: 'derived.testFiles', mode: 'equal' },
        { pattern: /\((\d+)\+?\s+(?:test\s+)?files\b/g, source: 'derived.testFiles', mode: 'equal' },
        { pattern: /\b(\d+)\+?\s+test files\b/g, source: 'derived.testFiles', mode: 'equal' },
        { pattern: /\b(\d+)\s+sample PDFs\b/g, source: 'derived.samplePdfs', mode: 'equal' },
        { pattern: /\b(\d+)\s+reference PDFs\b/g, source: 'derived.samplePdfs', mode: 'equal' },
        { pattern: /\b(\d+)\s+(?:sample\s+)?generators\b/g, source: 'derived.sampleGenerators', mode: 'equal' },
        { pattern: /\b(\d+)\s+PDF\/A-claiming samples\b/g, source: 'declared.pdfaSamples', mode: 'equal' },
        // "across 38 categories" — a chart's "2 series, 4 categories" alt text
        // is not a sample-tree claim, so the preposition is part of the token.
        { pattern: /\b(?:across|in|into)\s+(\d+)\s+(?:sample\s+)?categories\b/g, source: 'derived.sampleCategories', mode: 'equal' },
        { pattern: /(\d+(?:\.\d+)?)\s?%\+?\s+statement coverage\b/g, source: 'declared.coverageStatements', mode: 'floor' },
        { pattern: /(\d+(?:\.\d+)?)\s?%\+?\s+statements\b/g, source: 'declared.coverageStatements', mode: 'floor' },
        // "27 Unicode scripts", "27 scripts", "27-script world tour" — the
        // homepage heading and the all-scripts playground kept 22 through
        // the 1.8.0 bump while every sentence around them said 27. Word
        // numerals count too: the playground index said "Ten" playgrounds.
        { pattern: /\b(\d+)[ -](?:Unicode\s+)?scripts?\b/gi, source: 'declared.scripts', mode: 'equal' },
        { pattern: /\b(\d+|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\s+(?:zero-install\s+|hands-on\s+|interactive\s+|live\s+)?(?:pdfnative\s+)?playgrounds\b/gi, source: 'derived.playgrounds', mode: 'equal' },
    ];
    const NUMERALS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16 };
    const COMPANION_DOC = /docs[\\/](?:guides|playgrounds)[\\/](?:react|cli|mcp)\.(?:md|html)$/;
    const corpus = DOC_FILES.filter((f) => !COMPANION_DOC.test(f));
    const texts = new Map(corpus.map((f) => [f, read(f)] as const));

    for (const token of COUNT_TOKENS) {
        const expected = manifestRef(token.source);
        if (expected === undefined) {
            fail(MANIFEST_REL, 1, 'manifest-shape', `${token.source} is missing — count-tokens needs it to police "${token.pattern.source}"`);
            continue;
        }
        const seenIn = new Set<string>();
        for (const file of corpus) {
            const text = texts.get(file)!;
            const lines = text.split(/\r?\n/);
            token.pattern.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = token.pattern.exec(text)) !== null) {
                seenIn.add(rel(file));
                const found = NUMERALS[m[1].toLowerCase()] ?? Number(m[1].replace(/[\s ,]/g, ''));
                if (!Number.isFinite(found)) continue;
                // A coverage figure quoted with a decimal claims a measurement,
                // not a floor: it must equal declared.coverageMeasured when the
                // manifest records one (three different decimals shipped in 1.8.0).
                const measured = manifest.declared['coverageMeasured'];
                if (token.mode === 'floor' && m[1].includes('.') && typeof measured === 'number') {
                    if (Math.abs(found - measured) > 0.001) {
                        const line = lineOf(text, m.index);
                        if (isSuppressed(lines, line, 'count-tokens') || isSuppressed(lines, line, 'stale-token')) continue;
                        fail(rel(file), line, 'count-tokens', `"${m[0].trim()}" — the manifest says the measured figure is ${measured} % (declared.coverageMeasured)`);
                    }
                    continue;
                }
                const ok = token.mode === 'equal' ? found === expected : Math.floor(found) <= expected;
                if (ok) continue;
                const line = lineOf(text, m.index);
                if (isSuppressed(lines, line, 'count-tokens') || isSuppressed(lines, line, 'stale-token')) continue;
                const verdict = token.mode === 'equal'
                    ? `the manifest says ${expected} (${token.source})`
                    : `the manifest floor is ${expected} % (${token.source}) — a doc may not claim more coverage than was measured`;
                fail(rel(file), line, 'count-tokens', `"${m[0].trim()}" — ${verdict}`);
            }
        }
        for (const required of token.requireIn ?? []) {
            if (!existsSync(join(ROOT, required))) {
                fail(required, 1, 'count-tokens', `missing — it must state the ${token.source} count`);
            } else if (!seenIn.has(required)) {
                fail(required, 1, 'count-tokens', `never states the ${token.source} count ("${expected} tests") — it is the figure agents quote`);
            }
        }
    }

    // "Current version: X.Y.Z" is the one place llms.txt and the agent brief
    // name the library version in prose without the package name beside it,
    // so version-token cannot see it.
    const CURRENT_VERSION = /Current version:\s*(\d+\.\d+\.\d+)/g;
    const coreVersion = manifest.packages['pdfnative'].version;
    for (const file of corpus) {
        const text = texts.get(file)!;
        const lines = text.split(/\r?\n/);
        CURRENT_VERSION.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CURRENT_VERSION.exec(text)) !== null) {
            if (m[1] === coreVersion) continue;
            const line = lineOf(text, m.index);
            if (isSuppressed(lines, line, 'count-tokens') || isSuppressed(lines, line, 'version-token')) continue;
            fail(rel(file), line, 'count-tokens', `"${m[0].trim()}" — the manifest says pdfnative is ${coreVersion}`);
        }
    }
}

// ── Rule: claude-md-budget ──────────────────────────────────────────

/**
 * The three agent entry files are loaded into every session's context, so
 * their size is a tax on every task. CLAUDE.md must start by importing
 * AGENTS.md (one source of truth, not a fork), both stay under 120 lines, the
 * Copilot file under 16 KiB, and no line in any of them exceeds 240
 * characters — a line longer than that is a paragraph pretending to be a
 * bullet, and it is the first thing a diff reviewer skips.
 */
{
    const MAX_LINE = 240;
    const budgets: Array<{ file: string; maxLines?: number; maxBytes?: number; firstLine?: string }> = [
        { file: 'CLAUDE.md', maxLines: 120, firstLine: '@AGENTS.md' },
        { file: 'AGENTS.md', maxLines: 120 },
        { file: '.github/copilot-instructions.md', maxBytes: 16384 },
    ];
    for (const budget of budgets) {
        const full = join(ROOT, budget.file);
        if (!existsSync(full)) {
            fail(budget.file, 1, 'claude-md-budget', 'missing — every agent entry file must exist');
            continue;
        }
        const text = read(full);
        const lines = text.replace(/\r\n/g, '\n').split('\n');
        const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
        if (budget.maxLines !== undefined && lineCount > budget.maxLines) {
            fail(budget.file, 1, 'claude-md-budget', `${lineCount} lines — the budget is ${budget.maxLines}; move detail to .github/instructions/`);
        }
        const bytes = Buffer.byteLength(text, 'utf8');
        if (budget.maxBytes !== undefined && bytes > budget.maxBytes) {
            fail(budget.file, 1, 'claude-md-budget', `${bytes} bytes — the budget is ${budget.maxBytes}; move detail to .github/instructions/`);
        }
        lines.forEach((line, i) => {
            if (line.length > MAX_LINE) {
                fail(budget.file, i + 1, 'claude-md-budget', `line is ${line.length} characters — the limit is ${MAX_LINE}`);
            }
        });
        if (budget.firstLine !== undefined) {
            const first = lines.find((l) => l.trim() !== '')?.trim();
            if (first !== budget.firstLine) {
                fail(budget.file, 1, 'claude-md-budget', `first non-empty line is "${first ?? ''}" — it must be "${budget.firstLine}" so Claude Code loads AGENTS.md instead of a fork of it`);
            }
        }
    }
}

// ── Rule: governance-sources ────────────────────────────────────────

/**
 * `.github/ai-governance.json` tells agents which files to load before
 * proposing a change. A path that no longer exists teaches them nothing, and
 * an always-loaded set over 16 KiB taxes every session — the on_demand list
 * exists so that the bulk can be loaded by topic instead.
 */
{
    const GOVERNANCE = join(ROOT, '.github', 'ai-governance.json');
    const MAX_SOURCES_BYTES = 16 * 1024;
    if (existsSync(GOVERNANCE)) {
        let policy: { capability_manifest?: { sources?: unknown; on_demand?: unknown } } = {};
        try {
            policy = JSON.parse(read(GOVERNANCE)) as typeof policy;
        } catch (err) {
            fail('.github/ai-governance.json', 1, 'governance-sources', `not valid JSON — ${(err as Error).message}`);
        }
        const asPaths = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
        const sources = asPaths(policy.capability_manifest?.sources);
        const onDemand = asPaths(policy.capability_manifest?.on_demand);
        let total = 0;
        for (const [list, entries] of [['sources', sources], ['on_demand', onDemand]] as const) {
            for (const p of entries) {
                const full = join(ROOT, p);
                if (!existsSync(full)) {
                    fail('.github/ai-governance.json', 1, 'governance-sources', `capability_manifest.${list} names "${p}", which does not exist`);
                } else if (list === 'sources' && statSync(full).isFile()) {
                    total += statSync(full).size;
                }
            }
        }
        if (total >= MAX_SOURCES_BYTES) {
            fail('.github/ai-governance.json', 1, 'governance-sources', `capability_manifest.sources total ${total} bytes — the always-loaded set must stay under ${MAX_SOURCES_BYTES}; move a file to on_demand`);
        }
    }
}

// ── Rule: node-pin-parity ───────────────────────────────────────────

/**
 * One Node pin, three readers: `.nvmrc` (setup-node in every workflow),
 * `engines.node` in package.json (npm) and the CI matrix. A workflow that
 * hard-codes its own version drifts the day the pin moves; the CI matrix is
 * the one sanctioned exception because it deliberately spans versions, and
 * it must still include the pinned major.
 */
{
    const NVMRC = join(ROOT, '.nvmrc');
    const PKG = join(ROOT, 'package.json');
    const WORKFLOWS = join(ROOT, '.github', 'workflows');
    let pinnedMajor: number | null = null;
    if (!existsSync(NVMRC)) {
        fail('.nvmrc', 1, 'node-pin-parity', 'missing — every workflow reads its Node version from it');
    } else {
        const raw = read(NVMRC).trim();
        const m = /^v?(\d+)/.exec(raw);
        if (!m) fail('.nvmrc', 1, 'node-pin-parity', `"${raw}" is not a Node version`);
        else pinnedMajor = Number(m[1]);
    }
    if (existsSync(PKG)) {
        const pkg = JSON.parse(read(PKG)) as { engines?: { node?: string }; packageManager?: string };
        const enginesMajor = /(\d+)/.exec(pkg.engines?.node ?? '')?.[1];
        if (enginesMajor === undefined) {
            fail('package.json', 1, 'node-pin-parity', 'engines.node is missing or names no major version');
        } else if (pinnedMajor !== null && Number(enginesMajor) !== pinnedMajor) {
            fail('package.json', 1, 'node-pin-parity', `engines.node "${pkg.engines?.node}" but .nvmrc pins ${pinnedMajor} — the two majors must agree`);
        }
        if (typeof pkg.packageManager !== 'string' || !pkg.packageManager.startsWith('npm@')) {
            fail('package.json', 1, 'node-pin-parity', `packageManager must be present and start with "npm@" (found ${JSON.stringify(pkg.packageManager ?? null)})`);
        }
    }
    if (existsSync(WORKFLOWS)) {
        for (const name of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
            const relPath = `.github/workflows/${name}`;
            const text = read(join(WORKFLOWS, name));
            const uses = [...text.matchAll(/uses:\s*actions\/setup-node@/g)];
            if (uses.length === 0) continue;
            const withFile = [...text.matchAll(/node-version-file:\s*\.nvmrc\b/g)].length;
            if (withFile >= uses.length) continue;
            const matrix = /node-version:\s*\$\{\{\s*matrix\.node-version\s*\}\}/.test(text)
                && /node-version:\s*\[([^\]]*)\]/.exec(text);
            if (name === 'ci.yml' && matrix) {
                const majors = matrix[1].split(',').map((s) => Number(s.trim().replace(/['"]/g, '')));
                if (pinnedMajor !== null && !majors.includes(pinnedMajor)) {
                    fail(relPath, lineOf(text, matrix.index), 'node-pin-parity', `matrix [${matrix[1].trim()}] does not include the .nvmrc major ${pinnedMajor}`);
                }
                continue;
            }
            fail(relPath, lineOf(text, uses[0].index), 'node-pin-parity', 'actions/setup-node must read `node-version-file: .nvmrc` (only ci.yml may span a matrix)');
        }
    }
}

// ── Rule: ruleset-parity ────────────────────────────────────────────

/**
 * `.github/rulesets/main.json` is the committed copy of the branch
 * protection, and its required status checks are matched by NAME against
 * the jobs GitHub actually reports. A context naming a job that no workflow
 * defines is never satisfied — every PR to main is blocked, or, if the
 * maintainer removes it in the UI, the committed copy lies. `sample-regression`
 * must be required: the byte manifest is the release's safety net.
 */
{
    const RULESET = join(ROOT, '.github', 'rulesets', 'main.json');
    const WORKFLOWS = join(ROOT, '.github', 'workflows');
    if (existsSync(RULESET)) {
        let ruleset: { rules?: Array<{ type?: string; parameters?: { required_status_checks?: Array<{ context?: string }> } }> } = {};
        let parsed = true;
        try {
            ruleset = JSON.parse(read(RULESET)) as typeof ruleset;
        } catch (err) {
            parsed = false;
            fail('.github/rulesets/main.json', 1, 'ruleset-parity', `not valid JSON — ${(err as Error).message}`);
        }
        if (parsed) {
            // Job ids and display names, plus every matrix value, from each workflow.
            const jobs = new Set<string>();
            const matrixValues = new Map<string, Set<string>>();
            if (existsSync(WORKFLOWS)) {
                for (const name of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
                    const lines = read(join(WORKFLOWS, name)).replace(/\r\n/g, '\n').split('\n');
                    let inJobs = false;
                    let current: string | null = null;
                    for (const line of lines) {
                        if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
                        if (!inJobs) continue;
                        if (/^\S/.test(line)) { inJobs = false; continue; }
                        const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
                        if (id) {
                            current = id[1];
                            jobs.add(current);
                            matrixValues.set(current, new Set());
                            continue;
                        }
                        if (!current) continue;
                        const jobName = /^ {4}name:\s*(.+?)\s*$/.exec(line);
                        if (jobName) jobs.add(jobName[1].replace(/^["']|["']$/g, ''));
                        const list = /^ {8}[A-Za-z0-9_-]+:\s*\[([^\]]*)\]\s*$/.exec(line);
                        if (list) {
                            for (const v of list[1].split(',')) matrixValues.get(current)!.add(v.trim().replace(/['"]/g, ''));
                        }
                    }
                }
            }
            const contexts: string[] = [];
            for (const rule of ruleset.rules ?? []) {
                if (rule.type !== 'required_status_checks') continue;
                for (const check of rule.parameters?.required_status_checks ?? []) {
                    if (typeof check.context === 'string') contexts.push(check.context);
                }
            }
            for (const context of contexts) {
                if (jobs.has(context)) continue;
                const m = /^(.+?)\s*\((.+)\)$/.exec(context);
                if (m && jobs.has(m[1]) && m[2].split(',').every((v) => matrixValues.get(m[1])?.has(v.trim()))) continue;
                fail('.github/rulesets/main.json', 1, 'ruleset-parity', `required status check "${context}" names no job in .github/workflows/ — every PR to main would block on it`);
            }
            if (!contexts.includes('sample-regression')) {
                fail('.github/rulesets/main.json', 1, 'ruleset-parity', '"sample-regression" is not a required status check — the byte manifest must block merges');
            }
        }
    }
}

// ── Rules: agent-config-parity, claude-rules-sync, claude-rules-budget,
//           pr-template-parity, eol-lf, skills-shape, and the .node-version /
//           tags.json extensions of node-pin-parity and ruleset-parity ─────

/**
 * The Claude Code configuration is a second copy of the governance policy:
 * the "Never Read" bullet of CLAUDE.md and the deny list of settings.json,
 * the HITL commands and the guard hook, the instruction files and the rules
 * generated from them, the skills and the templates they hand to agents. Each
 * pair drifts silently — a glob added to the prose but not to the deny list
 * is read anyway; a stale rule teaches last release's contract. The checks
 * are pure functions in scripts/lib/agent-config.ts; this block only reads
 * files and spawns `node --check` and `git ls-files --eol`.
 */
{
    const report = (findings: readonly Finding[], rule: string): void => {
        for (const f of findings) (f.severity === 'error' ? fail : warn)(f.file, f.line, rule, f.message);
    };
    const readOr = (p: string): string | null => (existsSync(join(ROOT, p)) ? read(join(ROOT, p)) : null);
    const claudeMd = readOr('CLAUDE.md') ?? '';

    // agent-config-parity
    const hookPath = join(ROOT, '.claude', 'hooks', 'guard.mjs');
    const hookExists = existsSync(hookPath);
    const hookCheck = hookExists ? spawnSync(process.execPath, ['--check', hookPath], { encoding: 'utf8', windowsHide: true }) : null;
    report(
        checkAgentConfigParity({
            settingsText: readOr('.claude/settings.json'),
            claudeMd,
            hook: { exists: hookExists, checkStatus: hookCheck?.status ?? null, checkStderr: hookCheck?.stderr ?? '' },
        }),
        'agent-config-parity',
    );

    // claude-rules-sync — the generator's own check mode.
    const { diffClaudeRules, readRuleFiles } = await import('./build-claude-rules.ts');
    const diff = diffClaudeRules(ROOT);
    for (const bad of diff.invalid) fail(`${INSTRUCTIONS_DIR}/${bad.source}`, 1, 'claude-rules-sync', `${bad.error} — the generator refuses it`);
    for (const f of diff.missing) fail(`${RULES_DIR}/${f}`, 1, 'claude-rules-sync', 'missing — run `npm run agents:rules`');
    for (const f of diff.stale) fail(`${RULES_DIR}/${f}`, 1, 'claude-rules-sync', 'differs from its instruction file — edit the .github/instructions/ source, then run `npm run agents:rules`');
    for (const f of diff.extra) fail(`${RULES_DIR}/${f}`, 1, 'claude-rules-sync', 'has no instruction source — delete it, or add the .github/instructions/<area>.instructions.md it should come from');

    // claude-rules-budget
    report(checkClaudeRulesBudget({ claudeMd, resolveImport: (name) => readOr(name), rules: readRuleFiles(ROOT) }), 'claude-rules-budget');

    // pr-template-parity
    report(checkPrTemplateParity(readOr('.github/pull_request_template.md'), readOr('CONTRIBUTING.md') ?? ''), 'pr-template-parity');

    // eol-lf — git checkouts only (the test sandbox is a plain directory).
    const gitOut = (...args: string[]): string | null => {
        const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true });
        return r.status === 0 ? r.stdout : null;
    };
    const top = gitOut('rev-parse', '--show-toplevel')?.trim().replace(/\\/g, '/');
    if (top !== undefined && top === ROOT.replace(/\\/g, '/')) {
        report(checkEol(gitOut('ls-files', '--eol') ?? ''), 'eol-lf');
    }

    // node-pin-parity — .node-version agrees with engines.node and the CI floor.
    const pkgText = readOr('package.json');
    const engines = pkgText === null ? null : ((JSON.parse(pkgText) as { engines?: { node?: string } }).engines?.node ?? null);
    const ciMatrix = /node-version:\s*\[([^\]]*)\]/.exec(readOr('.github/workflows/ci.yml') ?? '')?.[1]
        .split(',').map((s) => Number(s.trim().replace(/['"]/g, ''))).filter((n) => Number.isFinite(n)) ?? [];
    report(checkNodeVersionPin({ nodeVersion: readOr('.node-version'), enginesNode: engines, ciMatrix }), 'node-pin-parity');

    // ruleset-parity — the tag protection is committed too.
    report(checkTagRuleset(readOr('.github/rulesets/tags.json')), 'ruleset-parity');

    // skills-shape — walk() skips dot-directories, so .claude/skills is listed here.
    const skillsDir = join(ROOT, '.claude', 'skills');
    if (existsSync(skillsDir)) {
        for (const dir of readdirSync(skillsDir).sort()) {
            if (!statSync(join(skillsDir, dir)).isDirectory()) continue;
            report(
                checkSkillShape({
                    dir,
                    text: readOr(`.claude/skills/${dir}/SKILL.md`),
                    existsInSkill: (name) => existsSync(join(skillsDir, dir, name)),
                    existsInRepo: (p) => existsSync(join(ROOT, p)),
                }),
                'skills-shape',
            );
        }
    }
}

// ── Rule: api-exists ────────────────────────────────────────────────

// The denylist scan spans src/ as well. JSDoc from src/ is emitted into
// dist/index.d.ts, so a phantom identifier there reaches every consumer's
// IntelliSense — which is exactly how two of them survived the first pass.
// CHANGELOG.md joins the scan here (but not the full corpus: its historical
// prose legitimately quotes superseded counts). Phantom API names are never
// legitimate, even in history — v1.0.0 already exported the real ones.
const DENYLIST_FILES = [
    ...DOC_FILES,
    ...walk(join(ROOT, 'src'), (f) => f.endsWith('.ts')),
    ...['CHANGELOG.md'].map((f) => join(ROOT, f)).filter(existsSync),
];

for (const [phantom, replacement] of Object.entries(manifest.apiDenylist)) {
    if (phantom.startsWith('$')) continue;
    const re = new RegExp(`\\b${phantom}\\b`, 'g');
    for (const file of DENYLIST_FILES) {
        const text = read(file);
        const lines = text.split(/\r?\n/);
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            const line = lineOf(text, m.index);
            // The only legitimate mention of a phantom is the one that bans it
            // (e.g. the changelog entry describing this very denylist).
            if (isSuppressed(lines, line, 'api-exists')) continue;
            fail(rel(file), line, 'api-exists', `${phantom}() is not exported by pdfnative — use ${replacement}`);
        }
    }
}

// Cross-check every build*/stream* identifier in the docs against the real
// export surface. Contributor-facing docs legitimately name internal helpers
// (e.g. buildPdfMetadata in pdf-tags.ts), so the set spans all of src/ — the
// rule is "this symbol exists somewhere", not "this symbol is public".
const SRC_FILES = walk(join(ROOT, 'src'), (p) => p.endsWith('.ts'));
if (SRC_FILES.length > 0) {
    const exported = new Set<string>();
    for (const srcFile of SRC_FILES) {
        const srcText = read(srcFile);
        for (const m of srcText.matchAll(/\bexport\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_]\w*)/g)) {
            exported.add(m[1]);
        }
        // Re-export blocks: `export { a, b as c } from './x.js'`
        for (const block of srcText.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
            for (const raw of block[1].split(',')) {
                const name = raw.split(/\s+as\s+/).pop()?.trim();
                if (name) exported.add(name);
            }
        }
    }
    const CANDIDATE = /\b(?:build|stream|assemble)[A-Za-z]*(?:PDF|Pdf)[A-Za-z]*\b/g;
    for (const file of DOC_FILES) {
        const text = read(file);
        CANDIDATE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CANDIDATE.exec(text)) !== null) {
            const id = m[0];
            if (exported.has(id)) continue;
            if (Object.prototype.hasOwnProperty.call(manifest.apiDenylist, id)) continue; // already reported above
            fail(rel(file), lineOf(text, m.index), 'api-exists', `"${id}" is not declared anywhere in src/`);
        }
    }

    // Generalisation of the scan above: ANY identifier written call-shaped at
    // the very start of an inline code span — `name(…)` in Markdown, or
    // <code>name(…)</code> in rendered/authored HTML — must exist somewhere in
    // src/. "Exists" is the same doctrine as the build*/stream* scan: docs may
    // name internal helpers and interface methods, so the reference set is
    // every call- or declaration-shaped identifier in the sources, not just
    // the exports. Anchoring on the span opener keeps prose and member calls
    // (`mod.updateMetadata(…)`) out of scope; fenced code blocks never start
    // an identifier with a backtick, so they stay out too. Platform globals
    // that docs legitimately call in spans are allow-listed here.
    const callable = new Set<string>(exported);
    const CALLABLE_FILES = [
        ...SRC_FILES,
        // Repo tooling the agent docs legitimately reference (verify-issue.mjs & co).
        ...walk(join(ROOT, 'scripts'), (p) => p.endsWith('.ts') || p.endsWith('.mjs')),
    ];
    for (const srcFile of CALLABLE_FILES) {
        for (const m of read(srcFile).matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
            callable.add(m[1]);
        }
    }
    const SPAN_GLOBALS = new Set([
        // Platform / runtime globals docs legitimately call in spans.
        'fetch', 'import', 'require', 'atob', 'btoa', 'structuredClone',
        // Test-framework globals (vitest) named by the testing instructions.
        'describe', 'it', 'test', 'expect', 'bench', 'vi',
        'beforeAll', 'beforeEach', 'afterAll', 'afterEach',
        // Conventional-commit prefixes written call-shaped (`feat(scope):`).
        'feat', 'fix', 'chore', 'refactor', 'perf', 'style', 'ci',
        // Companion-package exports named in ecosystem prose outside the
        // dedicated companion guides (their drift is a companion-repo concern,
        // caught by the weekly --online npm-drift run, not this offline scan).
        'validateGovernanceDraft', // pdfnative-cli
        'docSpecSchema', // pdfnative-react (README ecosystem row)
        'lintDocument', // pdfnative-react (cited by the PDF/A guide)
    ]);
    // Guides DEDICATED to a companion package document that package's API
    // throughout — checking those names against this repo's src/ would be a
    // category error, so they are out of this scan's scope entirely.
    const SPAN_SKIP = /docs[\\/](?:guides|playgrounds)[\\/](react|cli|mcp)\.(md|html)$/;
    // Companion-package exports are legitimate wherever the docs corpus shows
    // them imported from that package (`import { usePdf } from
    // 'pdfnative-react'`) — the import example is itself the documentation
    // that the name exists there.
    const companionImported = new Set<string>();
    for (const file of DOC_FILES) {
        for (const m of read(file).matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]pdfnative-[\w-]+['"]/g)) {
            for (const raw of m[1].split(',')) {
                const name = raw.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
                if (name) companionImported.add(name);
            }
        }
    }
    // In Markdown a backtick opens a code span; in HTML a backtick is almost
    // always a JS template literal inside an inline <script>, so only the
    // literal <code> opener counts there.
    const SPAN_CALL_MD = /(?:`|<code>)([A-Za-z_]\w*)\(/g;
    const SPAN_CALL_HTML = /<code>([A-Za-z_]\w*)\(/g;
    for (const file of DOC_FILES) {
        if (SPAN_SKIP.test(file)) continue;
        const SPAN_CALL = file.endsWith('.html') ? SPAN_CALL_HTML : SPAN_CALL_MD;
        const text = read(file);
        const lines = text.split(/\r?\n/);
        SPAN_CALL.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SPAN_CALL.exec(text)) !== null) {
            const id = m[1];
            if (callable.has(id) || SPAN_GLOBALS.has(id) || companionImported.has(id)) continue;
            if (Object.prototype.hasOwnProperty.call(manifest.apiDenylist, id)) continue;
            const line = lineOf(text, m.index);
            if (isSuppressed(lines, line, 'api-exists')) continue;
            fail(rel(file), line, 'api-exists', `"${id}()" is not declared anywhere in src/`);
        }
    }
}

// ── Rule: api-json-sync ─────────────────────────────────────────────

/**
 * `docs/assets/api.json` is the served, machine-readable export surface —
 * the substitute for the gitignored `dist/index.d.ts` that agents cannot
 * otherwise reach. A stale copy teaches last release's API, so it is policed
 * like every other generated artefact: rebuilt in memory and compared.
 */
const { buildApiJson } = await import('./build-api-json.ts');

const API_JSON = join(ROOT, 'docs', 'assets', 'api.json');
if (!existsSync(API_JSON)) {
    fail('docs/assets/api.json', 1, 'api-json-sync', 'missing — generate it with `npm run docs:api`');
} else if (read(API_JSON).replace(/\r\n/g, '\n') !== buildApiJson(ROOT)) {
    fail('docs/assets/api.json', 1, 'api-json-sync', 'stale — regenerate with `npm run docs:api`');
}

// ── Rule: jsonld-version ────────────────────────────────────────────

const PKG_BY_ANCHOR: Record<string, string> = {
    '#library': 'pdfnative',
    '#cli': 'pdfnative-cli',
    '#mcp': 'pdfnative-mcp',
    '#react': 'pdfnative-react',
};

/**
 * Page-level JSON-LD types must declare their language — crawlers use
 * `inLanguage` for locale selection, and a graph that states it on one node
 * but not its siblings reads as an oversight, not a choice. `WebSite` is
 * deliberately excluded: it appears as a bare `isPartOf` reference on most
 * pages, where repeating `inLanguage` would be noise.
 */
const LANGUAGE_BEARING_TYPES = new Set(['WebApplication', 'CollectionPage', 'AboutPage', 'SoftwareApplication']);

function walkJsonLd(node: unknown, file: string, line: number): void {
    if (Array.isArray(node)) {
        for (const child of node) walkJsonLd(child, file, line);
        return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
    if (types.some((t) => typeof t === 'string' && LANGUAGE_BEARING_TYPES.has(t)) && obj['inLanguage'] === undefined) {
        fail(file, line, 'seo-head', `JSON-LD ${types.filter(Boolean).join('/')} node does not declare "inLanguage"`);
    }
    const id = typeof obj['@id'] === 'string' ? obj['@id'] : null;
    if (id) {
        for (const [anchor, pkgName] of Object.entries(PKG_BY_ANCHOR)) {
            if (!id.endsWith(anchor)) continue;
            const expected = manifest.packages[pkgName]?.version;
            const actual = obj['softwareVersion'];
            if (expected && actual !== undefined && actual !== expected) {
                fail(file, line, 'jsonld-version', `${id} declares softwareVersion "${String(actual)}" but ${pkgName} is ${expected}`);
            }
        }
    }
    for (const value of Object.values(obj)) walkJsonLd(value, file, line);
}

const LD_BLOCK = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
for (const file of HTML_FILES) {
    const text = read(file);
    LD_BLOCK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LD_BLOCK.exec(text)) !== null) {
        const line = lineOf(text, m.index);
        // Strip HTML comments — the release-checklist notes live inside these
        // blocks. Looped to a fixed point: a single pass over nested or
        // overlapping comment markers can leave a residual "<!--" behind, so
        // repeat until nothing changes regardless of how they are nested.
        let body = m[1];
        let strippedPrevious: string;
        do {
            strippedPrevious = body;
            body = body.replace(/<!--[\s\S]*?-->/g, '');
        } while (body !== strippedPrevious);
        body = body.trim();
        if (!body) continue;
        try {
            walkJsonLd(JSON.parse(body), rel(file), line);
        } catch (err) {
            fail(rel(file), line, 'jsonld-version', `JSON-LD block is not valid JSON — ${(err as Error).message}`);
        }
    }
}

// ── Rule: internal-links ────────────────────────────────────────────

const HREF = /(?:href|src)=["']([^"'#?]+)(?:[#?][^"']*)?["']/g;

for (const file of HTML_FILES) {
    const text = read(file);
    HREF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HREF.exec(text)) !== null) {
        const href = m[1];
        if (/^(https?:|mailto:|data:|\/\/)/.test(href) || href === '') continue;
        // Skip hrefs built at runtime — template placeholders (`${url}`) and
        // handlebars-style tokens are not paths and cannot be resolved on disk.
        if (href.includes('${') || href.includes('{{')) continue;
        const target = href.startsWith('/')
            ? join(ROOT, 'docs', href)
            : resolve(dirname(file), href);
        const candidates = href.endsWith('/') || !posix.basename(href).includes('.')
            ? [target, join(target, 'index.html')]
            : [target];
        if (!candidates.some(existsSync)) {
            fail(rel(file), lineOf(text, m.index), 'internal-links', `"${href}" does not resolve on disk`);
        }
    }
}

const MD_LINK = /\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g;
// docs/ Markdown, plus the three repo-root documents an agent reads from
// GitHub: the README, the CHANGELOG (four links to draft files deleted two
// releases earlier survived until the 1.8.0 final review) and the current
// release note.
const MD_DOCS = [
    ...walk(join(ROOT, 'docs'), (p) => p.endsWith('.md')),
    ...['README.md', 'CHANGELOG.md', `release-notes/v${manifest.packages['pdfnative']?.version ?? ''}.md`]
        .map((p) => join(ROOT, p))
        .filter((p) => existsSync(p)),
];
for (const file of MD_DOCS) {
    const text = read(file);
    MD_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MD_LINK.exec(text)) !== null) {
        const href = m[1];
        if (/^(https?:|mailto:|data:|\/\/)/.test(href)) continue;
        if (!existsSync(resolve(dirname(file), href))) {
            fail(rel(file), lineOf(text, m.index), 'internal-links', `"${href}" does not resolve on disk`);
        }
    }
}

// Absolute links into the site itself resolve against docs/ like relative
// ones, fragment included: `https://pdfnative.dev/#api` pointed at an id the
// homepage never had.
const SITE_LINK = /(?:\]\(|href=["'])https:\/\/pdfnative\.dev\/([^)"'\s#]*)(?:#([^)"'\s]+))?/g;
for (const file of [...MD_DOCS, ...HTML_FILES]) {
    const text = read(file);
    SITE_LINK.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SITE_LINK.exec(text)) !== null) {
        let target = m[1];
        if (target === '' || target.endsWith('/')) target += 'index.html';
        if (!posix.basename(target).includes('.')) target += '.html';
        const abs = join(ROOT, 'docs', target);
        const line = lineOf(text, m.index);
        if (!existsSync(abs)) {
            fail(rel(file), line, 'internal-links', `"https://pdfnative.dev/${m[1]}" has no page under docs/`);
            continue;
        }
        if (m[2] && abs.endsWith('.html') && !new RegExp(`\\bid=["']${m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(read(abs))) {
            fail(rel(file), line, 'internal-links', `"https://pdfnative.dev/${m[1]}#${m[2]}" — no id "${m[2]}" in docs/${target}`);
        }
    }
}

// ── Rule: seo-head ──────────────────────────────────────────────────

/**
 * International discoverability for a monolingual site: every indexable page
 * must self-reference with hreflang "en" AND "x-default" (the x-default is
 * what tells search engines this URL serves every locale), carry og:locale,
 * and keep those hrefs strictly equal to the canonical — the classic failure
 * mode is a self-reference that points somewhere else, which search engines
 * silently discard.
 */
for (const file of HTML_FILES) {
    const text = read(file);
    if (/name=["']robots["'][^>]*noindex/i.test(text)) continue;
    const relFile = rel(file);
    if (!/<html\b[^>]*\blang=["'][A-Za-z-]+["']/.test(text)) {
        fail(relFile, 1, 'seo-head', '<html> has no lang attribute');
    }
    const canons = [...text.matchAll(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/g)];
    if (canons.length !== 1) {
        fail(relFile, 1, 'seo-head', `expected exactly one <link rel="canonical">, found ${canons.length}`);
        continue;
    }
    const canon = canons[0][1];
    if (!/^https:\/\//.test(canon)) {
        fail(relFile, lineOf(text, canons[0].index!), 'seo-head', `canonical "${canon}" must be an absolute https URL`);
    }
    for (const variant of ['en', 'x-default']) {
        const re = new RegExp(`<link\\s+rel=["']alternate["']\\s+hreflang=["']${variant}["']\\s+href=["']([^"']+)["']`);
        const m = re.exec(text);
        if (!m) {
            fail(relFile, 1, 'seo-head', `missing <link rel="alternate" hreflang="${variant}"> self-reference`);
        } else if (m[1] !== canon) {
            fail(relFile, lineOf(text, m.index), 'seo-head', `hreflang="${variant}" href "${m[1]}" must equal the canonical "${canon}"`);
        }
    }
    if (!/<meta\s+property=["']og:locale["']\s+content=["']en_US["']/.test(text)) {
        fail(relFile, 1, 'seo-head', 'missing <meta property="og:locale" content="en_US">');
    }
    if (!/<meta\s+name=["']description["']\s+content=["'][^"']+["']/.test(text)) {
        fail(relFile, 1, 'seo-head', 'missing or empty <meta name="description">');
    }
}

// ── Rule: sitemap-parity ────────────────────────────────────────────

const SITEMAP = join(ROOT, 'docs', 'sitemap.xml');
if (existsSync(SITEMAP)) {
    const xml = read(SITEMAP);
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]);
    // +1 day of tolerance: a contributor east of UTC editing after their
    // local midnight writes a lastmod the UTC runner would call "future".
    const today = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);

    // lastmod is the date of the page's last documentation audit, not its
    // last commit — git history is unavailable to the CI verifier's shallow
    // checkout, the same reason the guides carry no JSON-LD dateModified
    // (scripts/build-guides.ts, "No dateModified" note). What CAN be checked
    // offline is coherence with the audit cycle: no page may claim a review
    // date after the manifest's verifiedOn, nor sit more than STALE_WINDOW
    // days behind it — a sitemap frozen across audit trains is exactly the
    // drift this bound exists to catch.
    const STALE_WINDOW_DAYS = 45;
    const verifiedMs = Date.parse(manifest.verifiedOn);
    const oldestAllowed = new Date(verifiedMs - STALE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const newestAllowed = new Date(verifiedMs + 24 * 3600 * 1000).toISOString().slice(0, 10);

    for (const m of xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)) {
        const value = m[1];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is not ISO-8601 (YYYY-MM-DD)`);
        } else if (value > today) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is in the future`);
        } else if (value > newestAllowed) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is after the manifest's verifiedOn (${manifest.verifiedOn}) — audit the page and bump the manifest, or fix the date`);
        } else if (value < oldestAllowed) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is more than ${STALE_WINDOW_DAYS} days behind the manifest's verifiedOn (${manifest.verifiedOn}) — the page has missed an audit train`);
        }
    }

    const listed = new Set(
        locs.map((u) => u.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').replace(/\/$/, '/index.html') || 'index.html'),
    );
    for (const file of HTML_FILES) {
        const text = read(file);
        if (/name=["']robots["'][^>]*noindex/i.test(text)) continue;
        const key = rel(file).replace(/^docs\//, '');
        if (!listed.has(key)) {
            fail(rel(file), 1, 'sitemap-parity', 'indexable page is missing from docs/sitemap.xml');
        }
    }
    for (const loc of locs) {
        const key = loc.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
        const candidate = key === '' ? join(ROOT, 'docs', 'index.html') : join(ROOT, 'docs', key.endsWith('/') ? join(key, 'index.html') : key);
        if (!existsSync(candidate)) {
            fail('docs/sitemap.xml', 1, 'sitemap-parity', `<loc>${loc}</loc> has no file on disk`);
        }
    }

    // Every <url> must carry the same en + x-default alternates the pages
    // declare in HTML — the sitemap form is the signal search engines process
    // most reliably, and a missing xmlns makes them ignore all of it.
    if (!/xmlns:xhtml=["']http:\/\/www\.w3\.org\/1999\/xhtml["']/.test(xml)) {
        fail('docs/sitemap.xml', 1, 'sitemap-parity', '<urlset> must declare xmlns:xhtml for the hreflang alternates');
    }
    for (const urlBlock of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
        const body = urlBlock[1];
        const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1];
        if (!loc) continue;
        const line = lineOf(xml, urlBlock.index!);
        for (const variant of ['en', 'x-default']) {
            const re = new RegExp(`<xhtml:link\\s+rel=["']alternate["']\\s+hreflang=["']${variant}["']\\s+href=["']([^"']+)["']\\s*/>`);
            const m = re.exec(body);
            if (!m) {
                fail('docs/sitemap.xml', line, 'sitemap-parity', `<url> for ${loc} lacks its hreflang="${variant}" alternate`);
            } else if (m[1] !== loc) {
                fail('docs/sitemap.xml', line, 'sitemap-parity', `hreflang="${variant}" alternate "${m[1]}" must equal its <loc> ${loc}`);
            }
        }
    }

    // ── Rule: sitemap-lastmod-vs-git ────────────────────────────────
    //
    // The audit-window bound above cannot see a page edited AFTER its
    // lastmod was written. Where git history is available (a full local
    // clone — the maintainer's gate, not CI's shallow checkout, where a
    // grafted HEAD would date every file today), each <url>'s lastmod must
    // be on or after the last commit touching any of its source files, and
    // never after the manifest's verifiedOn. One `git log` over docs/ dates
    // every tracked file; a page edited since is a page whose lastmod lies.
    const git = (...args: string[]): string | null => {
        const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', windowsHide: true });
        return r.status === 0 ? r.stdout : null;
    };
    const toplevel = git('rev-parse', '--show-toplevel')?.trim().replace(/\\/g, '/');
    const shallow = git('rev-parse', '--is-shallow-repository')?.trim();
    if (toplevel !== undefined && toplevel === ROOT.replace(/\\/g, '/') && shallow === 'false') {
        const tracked = new Set((git('ls-files', '--', 'docs') ?? '').split(/\r?\n/).filter(Boolean));
        const lastCommit = new Map<string, string>();
        const log = git('log', '--format=%x01%cs', '--name-only', '--', 'docs') ?? '';
        let date = '';
        for (const raw of log.split(/\r?\n/)) {
            if (raw.startsWith('')) { date = raw.slice(1).trim(); continue; }
            const file = raw.trim();
            if (file && !lastCommit.has(file)) lastCommit.set(file, date);
        }
        const sourcesOf = (loc: string): string[] => {
            let path = loc.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
            if (path === '' || path.endsWith('/')) path += 'index.html';
            const out = [`docs/${path}`];
            const guide = /^guides\/([^/]+)\.html$/.exec(path);
            if (guide && guide[1] !== 'index') out.push(`docs/guides/${guide[1]}.md`);
            return out;
        };
        for (const urlBlock of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
            const body = urlBlock[1];
            const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1];
            const lastmod = /<lastmod>\s*(\d{4}-\d{2}-\d{2})\s*<\/lastmod>/.exec(body)?.[1];
            if (!loc || !lastmod) continue;
            const line = lineOf(xml, urlBlock.index!);
            if (lastmod > manifest.verifiedOn) {
                fail('docs/sitemap.xml', line, 'sitemap-lastmod-vs-git', `${loc} lastmod ${lastmod} is after the manifest's verifiedOn ${manifest.verifiedOn}`);
                continue;
            }
            for (const src of sourcesOf(loc)) {
                if (!tracked.has(src)) continue;
                const committed = lastCommit.get(src);
                if (committed !== undefined && committed > lastmod) {
                    fail('docs/sitemap.xml', line, 'sitemap-lastmod-vs-git', `${loc} lastmod ${lastmod} but ${src} was last committed ${committed} — re-audit the page (release-prepare bumps it) or set lastmod to ${committed}`);
                }
            }
        }
    }
}

// ── Rule: cdn-sri ───────────────────────────────────────────────────

const EXTERNAL_TAG = /<(script|link)\b[^>]*\b(?:src|href)=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
for (const file of HTML_FILES) {
    const text = read(file);
    EXTERNAL_TAG.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = EXTERNAL_TAG.exec(text)) !== null) {
        const [tag, kind, url] = m;
        if (kind.toLowerCase() === 'link' && !/rel=["']stylesheet["']/i.test(tag)) continue;
        if (!/\bintegrity=/.test(tag)) {
            fail(rel(file), lineOf(text, m.index), 'cdn-sri', `third-party ${kind} has no integrity hash: ${url}`);
        } else if (!/\bcrossorigin=/.test(tag)) {
            fail(rel(file), lineOf(text, m.index), 'cdn-sri', `integrity without crossorigin is ignored by browsers: ${url}`);
        }
    }
}

// pdfnative CDN imports must be pinned to the manifest version — everywhere,
// not just in HTML. The homepage demo runner (docs/app.js) and the quickstart
// guide both imported the registry's `latest` for a full release train because
// this scan used to stop at HTML_FILES.
const CORE_VERSION = manifest.packages['pdfnative'].version;
const UNPINNED = /['"]https:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(pdfnative(?:-cli|-mcp|-react)?)(?![@\w-])/g;
for (const file of DOC_FILES) {
    const text = read(file);
    UNPINNED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UNPINNED.exec(text)) !== null) {
        fail(rel(file), lineOf(text, m.index), 'cdn-sri', `"${m[1]}" is imported unpinned — pin it (core is ${CORE_VERSION})`);
    }
}

// ── Rule: switcher-parity ───────────────────────────────────────────

/**
 * Retired playgrounds are kept as noindex redirect stubs so their indexed URLs
 * stay served. They carry no switcher and must not be linked from one.
 */
const PLAYGROUNDS = existsSync(join(ROOT, 'docs', 'playgrounds'))
    ? readdirSync(join(ROOT, 'docs', 'playgrounds')).filter(
          (f) =>
              f.endsWith('.html') &&
              f !== 'index.html' &&
              !/name=["']robots["'][^>]*noindex/i.test(read(join(ROOT, 'docs', 'playgrounds', f))),
      )
    : [];

// ── Rule: playgrounds-manifest ──────────────────────────────────────

/**
 * `docs/data/playgrounds.json` is the machine-readable inventory of the live
 * playgrounds — the only way an agent learns that a playground exists, what
 * it exercises and which DOM controls drive it (the 1.8.0 review found the
 * two new playgrounds absent from every agent-facing surface). Every live
 * page is listed exactly once, every listed page exists, the count equals
 * `derived.playgrounds`, and every control id names a real element.
 */
{
    const MANIFEST_FILE = join(ROOT, 'docs', 'data', 'playgrounds.json');
    const relManifest = 'docs/data/playgrounds.json';
    if (!existsSync(MANIFEST_FILE)) {
        fail(relManifest, 1, 'playgrounds-manifest', 'missing — the live playgrounds must be inventoried for agents');
    } else {
        interface Control { readonly id: string; readonly kind?: string }
        interface Entry { readonly id: string; readonly file: string; readonly url?: string; readonly controls?: readonly Control[]; readonly exercises?: readonly string[] }
        let entries: Entry[] = [];
        try {
            entries = (JSON.parse(read(MANIFEST_FILE)) as { playgrounds?: Entry[] }).playgrounds ?? [];
        } catch (err) {
            fail(relManifest, 1, 'playgrounds-manifest', `not valid JSON — ${(err as Error).message}`);
        }
        const listed = new Map<string, Entry>();
        for (const entry of entries) {
            if (listed.has(entry.file)) fail(relManifest, 1, 'playgrounds-manifest', `"${entry.file}" is listed twice`);
            listed.set(entry.file, entry);
            if (!PLAYGROUNDS.includes(entry.file)) {
                fail(relManifest, 1, 'playgrounds-manifest', `lists "${entry.file}", which is not a live playground`);
                continue;
            }
            if (entry.url && entry.url !== `https://pdfnative.dev/playgrounds/${entry.file}`) {
                fail(relManifest, 1, 'playgrounds-manifest', `"${entry.id}" url does not point at /playgrounds/${entry.file}`);
            }
            const page = read(join(ROOT, 'docs', 'playgrounds', entry.file));
            const ids = new Set([...page.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
            for (const control of entry.controls ?? []) {
                if (!ids.has(control.id)) {
                    fail(relManifest, 1, 'playgrounds-manifest', `"${entry.id}" names control #${control.id}, which ${entry.file} does not contain`);
                }
            }
            if (!entry.exercises || entry.exercises.length === 0) {
                fail(relManifest, 1, 'playgrounds-manifest', `"${entry.id}" lists nothing under exercises — say which options and exports the page drives`);
            }
        }
        for (const file of PLAYGROUNDS) {
            if (!listed.has(file)) fail(relManifest, 1, 'playgrounds-manifest', `live playground "${file}" is not listed`);
        }
        const declared = manifest.derived['playgrounds'];
        if (declared !== undefined && listed.size !== declared) {
            fail(relManifest, 1, 'playgrounds-manifest', `lists ${listed.size} playgrounds but derived.playgrounds says ${declared}`);
        }
    }
}

const SWITCHER = /<nav class="playground-switcher"[\s\S]*?<\/nav>/;

function normaliseSwitcher(block: string): string {
    return block.replace(/\s*aria-current="page"/g, '').replace(/\s+/g, ' ').trim();
}

const switchers = new Map<string, string>();
for (const name of PLAYGROUNDS) {
    const file = join(ROOT, 'docs', 'playgrounds', name);
    const text = read(file);
    const m = SWITCHER.exec(text);
    if (!m) {
        fail(rel(file), 1, 'switcher-parity', 'no .playground-switcher block found');
        continue;
    }
    switchers.set(name, normaliseSwitcher(m[0]));
    // Each playground must mark itself as the current page.
    if (!/aria-current="page"/.test(m[0])) {
        fail(rel(file), lineOf(text, m.index), 'switcher-parity', 'switcher does not mark any entry as aria-current="page"');
    }
    // Every playground must be linked.
    for (const other of PLAYGROUNDS) {
        if (!m[0].includes(other)) {
            fail(rel(file), lineOf(text, m.index), 'switcher-parity', `switcher does not link ${other}`);
        }
    }
}

/*
 * A page retired behind a noindex stub must not be linked from an indexable
 * page. The rule comment above promised this and no code did it, which is how
 * seven live links to the retired medical-800 playground survived a pass that
 * updated every switcher.
 */
const NOINDEX_PAGES = HTML_FILES.filter((f) => /name=["']robots["'][^>]*noindex/i.test(read(f))).map((f) =>
    posix.basename(f.replace(/\\/g, '/')),
);

for (const stub of NOINDEX_PAGES) {
    const re = new RegExp(`href="[^"]*${stub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
    for (const file of HTML_FILES) {
        const text = read(file);
        if (/name=["']robots["'][^>]*noindex/i.test(text)) continue; // stubs may reference each other
        re.lastIndex = 0;
        let hit: RegExpExecArray | null;
        while ((hit = re.exec(text)) !== null) {
            fail(
                rel(file),
                lineOf(text, hit.index),
                'switcher-parity',
                `links ${stub}, which is a noindex stub — point at its replacement instead`,
            );
        }
    }
}

const shapes = [...new Set(switchers.values())];
if (shapes.length > 1) {
    const majority = shapes
        .map((s) => ({ s, n: [...switchers.values()].filter((v) => v === s).length }))
        .sort((a, b) => b.n - a.n)[0].s;
    for (const [name, shape] of switchers) {
        if (shape !== majority) {
            fail(`docs/playgrounds/${name}`, 1, 'switcher-parity', 'switcher markup differs from the other playgrounds');
        }
    }
}

// ── Rule: learn-chain ───────────────────────────────────────────────

if (manifest.learnPath.length > 0) {
    const learnDir = join(ROOT, 'docs', 'learn');
    for (let i = 0; i < manifest.learnPath.length; i++) {
        const name = manifest.learnPath[i];
        const file = join(learnDir, name);
        if (!existsSync(file)) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', 'listed in manifest.learnPath but missing on disk');
            continue;
        }
        const text = read(file);
        const prev = /rel=["']prev["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["']prev["']/.exec(text);
        const next = /rel=["']next["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*rel=["']next["']/.exec(text);
        const prevHref = prev ? (prev[1] ?? prev[2]) : null;
        const nextHref = next ? (next[1] ?? next[2]) : null;
        const expectedPrev = i === 0 ? null : manifest.learnPath[i - 1];
        const expectedNext = i === manifest.learnPath.length - 1 ? null : manifest.learnPath[i + 1];
        if (expectedPrev && prevHref !== expectedPrev) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', `rel="prev" is "${prevHref ?? 'missing'}", expected "${expectedPrev}"`);
        }
        // The first step may point back at the path overview, which is the entry
        // page rather than a step and so is not part of learnPath. Any other
        // target would mean the chain does not start where the manifest says.
        if (!expectedPrev && prevHref && prevHref !== 'index.html') {
            fail(
                `docs/learn/${name}`,
                1,
                'learn-chain',
                `first step may only link back to "index.html", not "${prevHref}"`,
            );
        }
        if (expectedNext && nextHref !== expectedNext) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', `rel="next" is "${nextHref ?? 'missing'}", expected "${expectedNext}"`);
        }
        if (!expectedNext && nextHref) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', 'last step must not declare rel="next"');
        }
    }
}

// ── Rule: bench-parity ──────────────────────────────────────────────

/**
 * The homepage benchmark bars and `bench/RESULTS.md` are two statements of the
 * same measurement. They drifted apart by a factor of three to six, on a site
 * whose whole argument is that its numbers are checked — so they are now tied
 * together mechanically.
 *
 * `RESULTS.md` is the source. Each homepage `.bench-value` must round to the
 * mean recorded there for the row its `.bench-label` names.
 */
const RESULTS = join(ROOT, 'bench', 'RESULTS.md');
const HOMEPAGE = join(ROOT, 'docs', 'index.html');

if (existsSync(RESULTS) && existsSync(HOMEPAGE)) {
    const md = read(RESULTS);

    // Collect "| 500 | 11.21 | …" rows under each measurement heading.
    const means = new Map<string, number>();
    let section: 'latin' | 'embedded' | null = null;
    for (const line of md.split(/\r?\n/)) {
        if (/^###\s+.*Latin/i.test(line)) section = 'latin';
        else if (/^###\s+.*embedded-font/i.test(line)) section = 'embedded';
        else if (/^###\s/.test(line)) section = null;
        if (!section) continue;
        const m = /^\|\s*([\d\s]+?)\s*\|\s*([\d.]+)\s*\|/.exec(line);
        if (!m) continue;
        const rows = m[1].replace(/\s/g, '');
        means.set(`${rows}|${section}`, parseFloat(m[2]));
    }

    const html = read(HOMEPAGE);
    const ROW =
        /<span class="bench-label">([^<]+)<\/span>\s*<div class="bench-bar-bg">[\s\S]*?<\/div>\s*<span class="bench-value">~?([\d.]+)\s*ms<\/span>/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = ROW.exec(html)) !== null) {
        const label = m[1];
        const shown = parseFloat(m[2]);
        const rows = label.replace(/[^\d]/g, '');
        const kind = /embedded/i.test(label) ? 'embedded' : 'latin';
        const mean = means.get(`${rows}|${kind}`);
        const line = lineOf(html, m.index);
        if (mean === undefined) {
            fail('docs/index.html', line, 'bench-parity', `no row for "${label}" in bench/RESULTS.md`);
            continue;
        }
        checked++;
        // The homepage rounds; accept anything within 10% of the recorded mean.
        if (Math.abs(shown - mean) / mean > 0.1) {
            fail(
                'docs/index.html',
                line,
                'bench-parity',
                `"${label}" shows ~${shown} ms but bench/RESULTS.md records ${mean} ms`,
            );
        }
    }
    if (checked === 0 && means.size > 0) {
        fail('docs/index.html', 1, 'bench-parity', 'no .bench-value rows matched — has the markup changed?');
    }
}

// ── Rule: contrast ──────────────────────────────────────────────────

function srgbToLinear(c: number): number {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: string, b: string): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const STYLE = join(ROOT, 'docs', 'style.css');
if (existsSync(STYLE)) {
    const css = read(STYLE);
    // Check each themed block independently: :root (light) and every dark override.
    const blocks = [...css.matchAll(/(:root(?:\[[^\]]*\])?|@media[^{]*prefers-color-scheme:\s*dark[^{]*\{\s*:root[^{]*)\s*\{([\s\S]*?)\}/g)];
    for (const block of blocks) {
        const body = block[2];
        const pick = (token: string): string | undefined =>
            new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,6})`).exec(body)?.[1];
        // Every surface these tokens are actually placed on, not just --c-bg.
        // Checking only the page background is why five real failures passed:
        // .rs-verify sits on --c-surface, where the same token scored 4.34:1.
        const surfaces: Array<[string, string | undefined]> = [
            ['--c-bg', pick('--c-bg')],
            ['--c-surface', pick('--c-surface')],
            ['--c-bg-card', pick('--c-bg-card')],
        ];
        for (const token of ['--c-text-muted', '--c-text-dim']) {
            const fg = pick(token);
            if (!fg) continue;
            for (const [surfaceName, bg] of surfaces) {
                if (!bg) continue;
                const ratio = contrastRatio(fg, bg);
                if (ratio >= 4.5) continue;
                fail(
                    'docs/style.css',
                    lineOf(css, block.index! + block[0].indexOf(token)),
                    'contrast',
                    `${token} (${fg}) on ${surfaceName} (${bg}) is ${ratio.toFixed(2)}:1 — WCAG AA body text needs 4.5:1`,
                );
            }
        }
    }
}

// ── Rule: llms-sync ─────────────────────────────────────────────────

/**
 * The site is served from docs/ (CNAME lives there), so the repo-root
 * `llms.txt` is invisible to any agent probing https://pdfnative.dev/llms.txt
 * unless an identical copy sits in docs/. Same story for `llms-full.txt`,
 * which is generated — a stale copy would quietly serve last release's guides.
 */
const { buildLlmsFull } = await import('./build-llms-full.ts');

const LLMS_ROOT = join(ROOT, 'llms.txt');
const LLMS_SITE = join(ROOT, 'docs', 'llms.txt');
if (existsSync(LLMS_ROOT)) {
    if (!existsSync(LLMS_SITE)) {
        fail('docs/llms.txt', 1, 'llms-sync', 'missing — the site is served from docs/, so llms.txt must be copied there');
    } else if (read(LLMS_ROOT).replace(/\r\n/g, '\n') !== read(LLMS_SITE).replace(/\r\n/g, '\n')) {
        fail('docs/llms.txt', 1, 'llms-sync', 'differs from the root llms.txt — the two copies must stay identical');
    }
    // The index must link the CURRENT release note: 1.8.0 shipped with the
    // list stopping at v1.7.0, so an agent reading llms.txt learned nothing
    // about the release it was installing.
    const current = manifest.packages['pdfnative']?.version;
    if (current && !read(LLMS_ROOT).includes(`release-notes/v${current}.md`)) {
        fail('llms.txt', 1, 'llms-sync', `does not link release-notes/v${current}.md — the current release note must be indexed`);
    }
}

const LLMS_FULL = join(ROOT, 'docs', 'llms-full.txt');
const expectedFull = buildLlmsFull(ROOT);
if (!existsSync(LLMS_FULL)) {
    fail('docs/llms-full.txt', 1, 'llms-sync', 'missing — generate it with `npx tsx scripts/build-llms-full.ts`');
} else if (read(LLMS_FULL).replace(/\r\n/g, '\n') !== expectedFull) {
    fail('docs/llms-full.txt', 1, 'llms-sync', 'stale — regenerate with `npx tsx scripts/build-llms-full.ts`');
}

const { buildLlmsRecipes } = await import('./build-llms-full.ts');
const LLMS_RECIPES = join(ROOT, 'docs', 'llms-recipes.txt');
if (!existsSync(LLMS_RECIPES)) {
    fail('docs/llms-recipes.txt', 1, 'llms-sync', 'missing — generate it with `npm run docs:llms`');
} else if (read(LLMS_RECIPES).replace(/\r\n/g, '\n') !== buildLlmsRecipes(ROOT)) {
    fail('docs/llms-recipes.txt', 1, 'llms-sync', 'stale — regenerate with `npm run docs:llms`');
}

// ── Rule: error-parity ──────────────────────────────────────────────

/**
 * `docs/data/errors.json` is the served registry of the engine's diagnostic
 * codes. The source of truth is the `PdfDiagnosticCode` union in
 * src/types/pdf-types.ts — not a prefix list: the 1.8.0 review found
 * `TYPOGRAPHY_FEATURE_INEFFECTIVE` declared, emitted and documented while
 * the registry (and this rule, which only knew `PDFA_` / `PDFX_`) had
 * never heard of it. Three directions: every union member is registered
 * and emitted somewhere in src/ outside the union itself; every registry
 * entry is a union member (a ghost teaches agents a code the engine never
 * raises); every code-shaped token the docs mention is registered.
 *
 * `buildErrors` is the second half of the registry: the messages the
 * builders THROW (PDF/X coherence, print geometry, OutputIntent profiles)
 * rather than report. Each registered message must exist verbatim in src/,
 * and every `throw new Error(…)` in src/core that names PDF/X or
 * `layout.pdfx` must be registered — those are the strings a CLI or a
 * server maps to an input-error code, and until 1.8.0 they lived only in a
 * release note.
 */
{
    const ERRORS_JSON = join(ROOT, 'docs', 'data', 'errors.json');
    const TYPES = join(ROOT, 'src', 'types', 'pdf-types.ts');
    const union = /export type PdfDiagnosticCode =([\s\S]*?);/.exec(existsSync(TYPES) ? read(TYPES) : '');
    const unionCodes = new Set([...(union?.[1] ?? '').matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]));
    if (unionCodes.size === 0) {
        fail('src/types/pdf-types.ts', 1, 'error-parity', 'the PdfDiagnosticCode union was not found — it is the source of truth for docs/data/errors.json');
    }
    if (!existsSync(ERRORS_JSON)) {
        fail('docs/data/errors.json', 1, 'error-parity', 'missing — the engine diagnostic registry must be served');
    } else {
        const registry = JSON.parse(read(ERRORS_JSON)) as {
            diagnostics: Array<{ code: string }>;
            buildErrors?: Array<{ message: string; thrownBy?: string }>;
        };
        const registered = new Set(registry.diagnostics.map((d) => d.code));
        const srcFiles = walk(join(ROOT, 'src'), (p) => p.endsWith('.ts') && resolve(p) !== resolve(TYPES));
        const srcText = srcFiles.map((f) => read(f)).join('\n');
        for (const code of unionCodes) {
            if (!registered.has(code)) {
                fail('docs/data/errors.json', 1, 'error-parity', `PdfDiagnosticCode declares "${code}" but the served registry does not list it`);
            }
            if (!srcText.includes(`'${code}'`)) {
                fail('src/types/pdf-types.ts', 1, 'error-parity', `PdfDiagnosticCode declares "${code}" but nothing in src/ emits it`);
            }
        }
        for (const code of registered) {
            if (!unionCodes.has(code)) {
                fail('docs/data/errors.json', 1, 'error-parity', `registry lists "${code}" but PdfDiagnosticCode does not declare it`);
            }
        }
        // Any token shaped like a code of a family the union knows
        // (PDFA_…, PDFX_…, TYPOGRAPHY_…) must be registered wherever it
        // appears in the docs.
        const families = [...new Set([...unionCodes].map((c) => c.slice(0, c.indexOf('_') + 1)))];
        const codeToken = new RegExp(`\\b(?:${families.join('|')})[A-Z][A-Z0-9_]*\\b`, 'g');
        for (const file of DOC_FILES) {
            const text = read(file);
            for (const m of text.matchAll(codeToken)) {
                if (registered.has(m[0])) continue;
                fail(rel(file), lineOf(text, m.index!), 'error-parity', `diagnostic "${m[0]}" is not in docs/data/errors.json`);
            }
        }

        // Build-time errors.
        const buildErrors = registry.buildErrors ?? [];
        if (buildErrors.length === 0) {
            fail('docs/data/errors.json', 1, 'error-parity', 'buildErrors is missing — the thrown PDF/X and print messages must be served for downstream error mapping');
        }
        const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim();
        const srcFlat = normalise(srcText.replace(/['`]\s*\n\s*\+\s*['`]/g, '').replace(/\\'/g, "'"));
        for (const entry of buildErrors) {
            // A message may carry `${…}` placeholders; the literal fragments
            // around them must all be present in src/.
            const fragments = normalise(entry.message).split(/\$\{[^}]*\}|<[^>]+>/).map((f) => f.trim()).filter((f) => f.length >= 12);
            for (const fragment of fragments) {
                if (!srcFlat.includes(fragment)) {
                    fail('docs/data/errors.json', 1, 'error-parity', `buildErrors message "${fragment}" is not thrown anywhere in src/`);
                }
            }
        }
        const registeredText = normalise(buildErrors.map((e) => e.message).join('\n'));
        for (const f of srcFiles) {
            const text = read(f);
            const throwRe = /throw new Error\(\s*((?:`[^`]*`|'[^'\n]*'|\s*\+\s*|\n)+)\s*\)/g;
            for (const m of text.matchAll(throwRe)) {
                const literals = [...m[1].matchAll(/'([^'\n]*)'|`([^`]*)`/g)].map((l) => l[1] ?? l[2]);
                const joined = literals.join('');
                // The families a downstream tool classifies: PDF/X and PDF/A
                // coherence, print geometry, OutputIntent profiles, attachments.
                if (!/PDF\/X|layout\.pdfx|^print\.|^outputIntent\.|PDF\/A|^File attachments/.test(joined)) continue;
                const fragments = normalise(joined).split(/\$\{[^}]*\}/).map((s) => s.trim()).filter((s) => s.length >= 12);
                for (const fragment of fragments) {
                    if (!registeredText.includes(fragment)) {
                        fail(rel(f), lineOf(text, m.index!), 'error-parity', `thrown PDF/X message "${fragment.slice(0, 60)}…" is not in docs/data/errors.json buildErrors`);
                        break;
                    }
                }
            }
        }
    }
}

// ── Rule: anchor-parity ─────────────────────────────────────────────

/**
 * `internal-links` deliberately strips `#fragments` — so a deep link to a
 * renamed section rots invisibly, which matters twice as much now that AI
 * answers cite section-level URLs. With every guide pre-rendered, anchors are
 * plain `id="…"` attributes in committed HTML: every internal link that
 * carries a fragment must point at an id that exists in its target page.
 * Links written against a `.md` target are checked against the paired `.html`
 * (that is where the pre-rendered ids live).
 */
{
    const anchorCache = new Map<string, Set<string> | null>();
    const anchorsOf = (absPath: string): Set<string> | null => {
        if (anchorCache.has(absPath)) return anchorCache.get(absPath)!;
        if (!existsSync(absPath) || !absPath.endsWith('.html')) {
            anchorCache.set(absPath, null);
            return null;
        }
        const ids = new Set<string>();
        for (const m of read(absPath).matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1]);
        anchorCache.set(absPath, ids);
        return ids;
    };
    // Fragment may start with a digit: numbered headings ("## 1. Render…")
    // slug to ids like "1-render-a-document".
    const LINK_WITH_FRAG = /(?:\]\(|href=["'])([^)"'#\s]*)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
    for (const file of DOC_FILES) {
        if (!file.endsWith('.md') && !file.endsWith('.html')) continue;
        const text = read(file);
        const lines = text.split(/\r?\n/);
        LINK_WITH_FRAG.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = LINK_WITH_FRAG.exec(text)) !== null) {
            let target = m[1];
            const frag = m[2];
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // external / mailto
            if (target === '') target = rel(file).split('/').pop()!; // same-page link
            let abs = resolve(dirname(file), target);
            if (abs.endsWith(sep)) abs = join(abs, 'index.html');
            if (abs.endsWith('.md')) abs = abs.slice(0, -3) + '.html';
            const ids = anchorsOf(abs);
            if (ids === null) continue; // non-HTML target or missing file: internal-links' turf
            if (ids.has(frag)) continue;
            const line = lineOf(text, m.index);
            if (isSuppressed(lines, line, 'anchor-parity')) continue;
            fail(rel(file), line, 'anchor-parity', `link fragment "#${frag}" has no matching id in ${rel(abs)}`);
        }
    }
}

// ── Rule: llms-index-sync ───────────────────────────────────────────

/**
 * `docs/llms-index.json` tells an agent what every page costs before it
 * spends the tokens (URLs, anchors, exact bytes). A stale index quietly
 * advertises last release's sizes and anchors, so it is policed exactly like
 * `llms-full.txt`. Runs after llms-sync: the index reports the on-disk size
 * of llms-full.txt, which the previous rule has just proven fresh.
 */
const { buildLlmsIndex, SUMMARY_MAX } = await import('./build-llms-full.ts');

const LLMS_INDEX = join(ROOT, 'docs', 'llms-index.json');
if (!existsSync(LLMS_INDEX)) {
    fail('docs/llms-index.json', 1, 'llms-index-sync', 'missing — generate it with `npm run docs:llms`');
} else if (read(LLMS_INDEX).replace(/\r\n/g, '\n') !== buildLlmsIndex(ROOT)) {
    fail('docs/llms-index.json', 1, 'llms-index-sync', 'stale — regenerate with `npm run docs:llms`');
}

// ── Rule: llms-index-quality ────────────────────────────────────────

/**
 * `llms-index-sync` proves the index is *fresh* — it rebuilds it in memory
 * and compares byte for byte. That check is blind to a deterministic defect
 * in the generator: a bug that truncates every summary mid-sentence produces
 * the same bytes on both sides and passes forever (it did — 23 of 31
 * summaries shipped severed, and the FAQ's was a line of source code). This
 * rule reads the committed index as *content* and asserts each summary is
 * usable prose, so a generator regression fails the build instead of
 * shipping.
 */
const CODEY_START = /^(const |let |var |import |export |function |class |return |await |async |type |interface |npm |npx |\{|\}|\[|\/\/|\/\*|<|```)/;
const SUMMARY_MIN = 60;

if (existsSync(LLMS_INDEX)) {
    const rawIndex = read(LLMS_INDEX);
    let indexDoc: { guides?: Array<{ title?: string; summary?: string; markdown?: string }> } = {};
    try {
        indexDoc = JSON.parse(rawIndex) as typeof indexDoc;
    } catch (err) {
        fail('docs/llms-index.json', 1, 'llms-index-quality', `not valid JSON — ${(err as Error).message}`);
    }
    for (const page of indexDoc.guides ?? []) {
        const src = page.markdown?.split('/').pop() ?? page.title ?? '?';
        const s = (page.summary ?? '').trim();
        const at = rawIndex.indexOf(JSON.stringify(page.summary ?? ''));
        const line = at >= 0 ? lineOf(rawIndex, at) : 1;
        const bad = (msg: string): void =>
            fail('docs/llms-index.json', line, 'llms-index-quality', `${src}: ${msg}`);

        if (!s) { bad('summary is empty'); continue; }
        if (CODEY_START.test(s)) bad(`summary starts with source code, not prose — the lede blockquote of docs/guides/${src} was not picked up`);
        if (!/[.!?…]$/.test(s)) bad(`summary is cut mid-sentence: "…${s.slice(-40)}"`);
        if (s.length < SUMMARY_MIN) bad(`summary is ${s.length} chars — too short to be useful (min ${SUMMARY_MIN})`);
        if (s.length > SUMMARY_MAX) bad(`summary is ${s.length} chars — over the index budget (max ${SUMMARY_MAX})`);
        if (/[\s,;:—-]…$/.test(s)) bad('truncated summary keeps a dangling separator before its ellipsis');
        if (s.includes('**') || s.includes('> ')) bad('summary carries unstripped Markdown');
        if (!page.title || page.title === src) bad('title fell back to the filename — the guide has no H1');
    }
}

// ── Rule: verified-on-parity ────────────────────────────────────────

/**
 * The entry-point artefacts agents consume carry a "Verified on" stamp (and
 * the machine-data files a `verifiedOn` field) so a reader can judge
 * freshness without git. A hand-maintained date is a lie waiting to happen —
 * errors.json drifted four days behind the manifest before this rule
 * existed — so every stamp must equal the manifest's `verifiedOn` exactly:
 * bumping the manifest without re-stamping (or vice versa) fails the build.
 * The date itself lives in exactly one place, docs/assets/ecosystem.json.
 */
const STAMPED = [
    'llms.txt',
    'docs/llms.txt',
    'docs/agent-brief.md',
    'docs/data/surfaces.json',
    'docs/data/errors.json',
    'docs/data/playgrounds.json',
];
for (const relPath of STAMPED) {
    const full = join(ROOT, relPath);
    if (!existsSync(full)) continue; // parity rules elsewhere report missing files
    const text = read(full);
    const m = /(?:"verifiedOn"\s*:\s*"|Verified on )(\d{4}-\d{2}-\d{2})/.exec(text);
    if (!m) {
        fail(relPath, 1, 'verified-on-parity', `carries no verifiedOn stamp (manifest says ${manifest.verifiedOn})`);
    } else if (m[1] !== manifest.verifiedOn) {
        fail(relPath, lineOf(text, m.index), 'verified-on-parity',
            `stamped ${m[1]} but the manifest was verified on ${manifest.verifiedOn}`);
    }
}

// ── Rule: guide-render-sync ─────────────────────────────────────────

/**
 * Guide shells carry the pre-rendered HTML of their Markdown source (between
 * `guide:render` markers) plus server-side JSON-LD, so crawlers that do not
 * execute JavaScript — most AI fetchers — receive the full guide instead of
 * "Loading…". The renderer is `scripts/build-guides.ts`; this rule rebuilds
 * every shell in memory and fails when a committed copy is stale, exactly as
 * `llms-sync` polices `llms-full.txt`. A shell whose article has never been
 * generated (no marker) fails too: an empty article is the defect this whole
 * mechanism exists to remove.
 */
const { applyGuideRender, listGuideShells } = await import('./build-guides.ts');

for (const htmlName of listGuideShells(ROOT)) {
    const relPath = `docs/guides/${htmlName}`;
    const committed = read(join(ROOT, 'docs', 'guides', htmlName)).replace(/\r\n/g, '\n');
    if (!committed.includes('<!-- guide:render:start -->')) {
        fail(relPath, 1, 'guide-render-sync', 'article is not pre-rendered — run `npm run docs:guides`');
        continue;
    }
    const expected = applyGuideRender(ROOT, htmlName);
    if (committed !== expected) {
        fail(relPath, 1, 'guide-render-sync', 'stale — the committed render differs from its Markdown source; run `npm run docs:guides`');
    }
}

// ── Rule: playground-syntax ─────────────────────────────────────────

/**
 * The playgrounds and the homepage demo are the only pages whose inline
 * `<script type="module">` code executes in visitors' browsers — a syntax
 * error there ships a silently dead page (the CDN import never even fires).
 * No headless browser (zero-dependency policy): each module block is
 * extracted to a temp `.mjs` and parsed with `node --check`, which validates
 * full ESM syntax without executing anything or resolving CDN imports.
 */
const SYNTAX_PAGES = [
    ...PLAYGROUNDS.map((name) => join(ROOT, 'docs', 'playgrounds', name)),
    join(ROOT, 'docs', 'index.html'),
].filter(existsSync);

const syntaxTmp = mkdtempSync(join(tmpdir(), 'pdfnative-playground-syntax-'));
try {
    const MODULE_SCRIPT = /<script\s+type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (const file of SYNTAX_PAGES) {
        const text = read(file);
        let m: RegExpExecArray | null;
        let blockIdx = 0;
        MODULE_SCRIPT.lastIndex = 0;
        while ((m = MODULE_SCRIPT.exec(text)) !== null) {
            const code = m[1];
            if (code.trim() === '') continue;
            const blockLine = lineOf(text, m.index);
            const tmpFile = join(syntaxTmp, `block-${blockIdx++}.mjs`);
            writeFileSync(tmpFile, code);
            const check = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' });
            if (check.status !== 0) {
                const detail = (check.stderr || '').split(/\r?\n/).find((l) => l.trim() !== '') ?? 'syntax error';
                const tmpLine = Number.parseInt(detail.match(/\.mjs:(\d+)/)?.[1] ?? '1', 10);
                fail(
                    rel(file),
                    blockLine + tmpLine - 1,
                    'playground-syntax',
                    `inline module script fails \`node --check\`: ${detail.replace(tmpFile, '<script>').trim()}`,
                );
            }
        }
    }
} finally {
    rmSync(syntaxTmp, { recursive: true, force: true });
}

// ── Rule: npm-drift (--online only) ─────────────────────────────────

/** True when semver a is strictly lower than b (plain x.y.z triples only). */
function semverLess(a: string, b: string): boolean {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
    }
    return false;
}

if (ONLINE) {
    for (const [name, pkg] of Object.entries(manifest.packages)) {
        try {
            const res = await fetch(`https://registry.npmjs.org/${name}/latest`);
            if (!res.ok) {
                warn(MANIFEST_REL, 1, 'npm-drift', `registry returned ${res.status} for ${name}`);
                continue;
            }
            const data = (await res.json()) as Record<string, Record<string, string> | string>;
            const published = data['version'] as string;
            if (published !== pkg.version) {
                // Direction matters: docs behind npm is the drift this rule
                // exists to catch; a manifest *ahead* of npm is the normal
                // pre-publication window of a release train and must not turn
                // the weekly cron red.
                const docsBehind = semverLess(pkg.version, published);
                const report = STRICT && docsBehind ? fail : warn;
                report(MANIFEST_REL, 1, 'npm-drift', `${name} is ${published} on npm but the manifest says ${pkg.version}`);
            }
            if (pkg.pinField) {
                const field = data[pkg.pinField] as Record<string, string> | undefined;
                const actualPin = field?.['pdfnative'];
                if (actualPin && actualPin !== pkg.pin) {
                    const report = STRICT ? fail : warn;
                    report(MANIFEST_REL, 1, 'npm-drift', `${name} pins pdfnative ${actualPin} but the manifest says ${pkg.pin}`);
                }
            }
        } catch (err) {
            warn(MANIFEST_REL, 1, 'npm-drift', `could not reach the registry for ${name}: ${(err as Error).message}`);
        }
    }
}

// ── Report ──────────────────────────────────────────────────────────

const errors = problems.filter((p) => p.severity === 'error');
const warnings = problems.filter((p) => p.severity === 'warn');

if (JSON_OUT) {
    console.log(JSON.stringify(problems, null, 2));
    process.exit(errors.length > 0 ? 1 : 0);
}

// ── prose-language: the project language is English ─────────────────
//
// Thirteen typography samples, the signature sample, the benchmark fixture
// and a guide shipped French prose in 1.8.0 while every page declared
// og:locale en_US. Another language is allowed only as demonstrated content
// (a French punctuation convention, a script), marked `demo-language:` on
// or above the line; scripts/lib/prose-language.ts is the shared detector,
// also run by the regression suite over generators, benchmarks and tests.
{
    const releaseNotes = existsSync(join(ROOT, 'release-notes'))
        ? walk(join(ROOT, 'release-notes'), (p) => p.endsWith('.md'))
        : [];
    for (const file of [...DOC_FILES, ...releaseNotes]) {
        const relFile = rel(file);
        const text = readFileSync(file, 'utf8');
        for (const finding of findNonEnglishProse(text, file, { suppress: 'verify-docs:allow prose-language' })) {
            fail(relFile, finding.line, 'prose-language',
                `${finding.reason}: "${finding.snippet}" — write it in English, or mark demonstrated content with \`demo-language: <tag> (reason)\` on or above the line`);
        }
    }
}

const OFFLINE_RULES = [
    'manifest-shape', // manifest fields are well-formed; assertions' expectFrom agrees with declared/derived
    'derived-counts', // derived.* equals what the tree holds (test files, generators, guides, samples, categories)
    'stale-token', // every assertion's counted noun matches its expect
    'canonical-present', // every assertion's canonical sentence appears where requireIn says
    'version-token', // "<package> vX.Y.Z" in prose equals the manifest version
    'count-tokens', // tests / files / sample PDFs / generators / categories / coverage / "Current version" tokens equal the manifest
    'claude-md-budget', // CLAUDE.md imports AGENTS.md; both ≤ 120 lines, Copilot file ≤ 16 KiB, no line > 240 chars
    'governance-sources', // ai-governance.json sources/on_demand exist; always-loaded sources < 16 KiB
    'node-pin-parity', // .nvmrc, .node-version, engines.node, the CI floor and every setup-node step agree; packageManager is npm@
    'ruleset-parity', // every required status check in rulesets/main.json names a real job; sample-regression required; tags.json protects refs/tags/v*
    'agent-config-parity', // settings.json parses; every CLAUDE.md "Never Read" glob is denied; HITL Bash denies present; guard hook passes node --check
    'claude-rules-sync', // .claude/rules/ equals a fresh render of .github/instructions/ (npm run agents:rules)
    'claude-rules-budget', // CLAUDE.md + its @imports + unscoped rules ≤ 16 KiB; a scoped rule > 32 KiB warns
    'pr-template-parity', // every PR-template checklist item is verbatim in CONTRIBUTING.md; the template mentions npm run gate
    'eol-lf', // (git checkouts only) tracked text blobs are LF — warn until the renormalisation commit flips EOL_LF_MODE
    'skills-shape', // every .claude/skills/*/SKILL.md names its directory, has a description, and its referenced templates exist
    'api-exists', // no phantom API identifier anywhere in docs or src
    'jsonld-version', // JSON-LD softwareVersion equals the manifest
    'internal-links', // every href/src and Markdown link resolves on disk
    'seo-head', // lang, canonical, hreflang self-references, og:locale, description
    'sitemap-parity', // sitemap lists every indexable page; lastmod inside the audit window
    'sitemap-lastmod-vs-git', // (full clones only) lastmod ≥ last commit of the page's sources and ≤ verifiedOn
    'cdn-sri', // third-party scripts carry integrity+crossorigin; pdfnative CDN imports are pinned
    'playgrounds-manifest', // docs/data/playgrounds.json lists every live playground with real control ids; count equals derived.playgrounds
    'switcher-parity', // playground switchers link every live playground, none link a noindex stub
    'learn-chain', // learn path prev/next links follow manifest.learnPath
    'bench-parity', // homepage benchmark bars round to bench/RESULTS.md
    'contrast', // muted text tokens reach WCAG AA on every surface
    'llms-sync', // docs/llms.txt equals root llms.txt; llms-full/recipes regenerated
    'llms-index-sync', // docs/llms-index.json regenerated
    'llms-index-quality', // every index summary is usable prose
    'verified-on-parity', // every "Verified on" stamp equals manifest.verifiedOn
    'error-parity', // docs/data/errors.json ↔ src/ diagnostic codes ↔ docs
    'anchor-parity', // every #fragment link targets an existing id
    'guide-render-sync', // guide shells carry the current render of their Markdown
    'api-json-sync', // docs/assets/api.json regenerated
    'playground-syntax', // inline module scripts pass `node --check`
    'prose-language', // docs, recipes and release notes are English unless marked demo-language
] as const;

if (errors.length === 0) {
    // Warnings never fail the run and are summarised per rule rather than
    // listed — the `eol-lf` rule alone names every CRLF-stored file until the
    // renormalisation commit, and a gate log is not the place for that list.
    const perRule = new Map<string, number>();
    for (const w of warnings) perRule.set(w.rule, (perRule.get(w.rule) ?? 0) + 1);
    const suffix = warnings.length === 0
        ? ''
        : ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${[...perRule.entries()].map(([r, n]) => `${r} ×${n}`).join(', ')})`;
    console.log(`verify-docs: ${OFFLINE_RULES.length} rules passed across ${DOC_FILES.length} files${suffix}.`);
    console.log(`             source of truth: ${MANIFEST_REL} (verified ${manifest.verifiedOn})`);
    process.exit(0);
}

const byFile = new Map<string, Problem[]>();
for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file)!.push(p);
}

for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`\n${file}`);
    for (const p of list.sort((a, b) => a.line - b.line)) {
        const mark = p.severity === 'error' ? '✗' : '!';
        console.log(`  ${mark} ${String(p.line).padStart(5)}  [${p.rule}]  ${p.message}`);
    }
}

const ruleSet = new Set(errors.map((p) => p.rule));
console.log(
    `\nverify-docs: ${errors.length} problem${errors.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'} (${ruleSet.size} rule${ruleSet.size === 1 ? '' : 's'})` +
        (warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''),
);
console.log(`             fix the docs, or update ${MANIFEST_REL} if the manifest is what is wrong.`);

process.exit(errors.length > 0 ? 1 : 0);
