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
    // llms-full.txt is generated from files already in the corpus; scanning the
    // concatenation would double-report every finding at useless line numbers.
    ...walk(
        join(ROOT, 'docs'),
        (p) => /\.(html|md|js|svg|xml|txt)$/.test(p) && !p.includes('ecosystem.json') && !p.endsWith('llms-full.txt'),
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
    if (pattern) {
        const re = new RegExp(pattern, 'g');
        const isEquality = assertion.match !== undefined && assertion.expect !== undefined;
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
                    if (!Number.isFinite(found) || found === assertion.expect) continue;
                    fail(rel(file), line, 'stale-token', `"${m[0].trim()}" — the manifest says ${assertion.expect} (${assertion.id})`);
                } else {
                    fail(
                        rel(file),
                        line,
                        'stale-token',
                        `"${m[0].trim()}" contradicts the manifest — canonical value is "${assertion.canonical}"`,
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
        if (!read(full).includes(assertion.canonical)) {
            fail(required, 1, 'canonical-present', `must state the canonical value "${assertion.canonical}" (assertion "${assertion.id}")`);
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
    for (const file of DOC_FILES) {
        const text = read(file);
        const lines = text.split(/\r?\n/);
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            if (m[1] === pkg.version) continue;
            const line = lineOf(text, m.index);
            if (isSuppressed(lines, line, 'version-token') || isSuppressed(lines, line, 'stale-token')) continue;
            fail(rel(file), line, 'version-token', `"${m[0].trim()}" — the manifest says ${name} is ${pkg.version}`);
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
        'fetch', 'import', 'require', 'atob', 'btoa', 'structuredClone', 'run',
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
const MD_DOCS = walk(join(ROOT, 'docs'), (p) => p.endsWith('.md'));
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
    const today = new Date().toISOString().slice(0, 10);

    for (const m of xml.matchAll(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/g)) {
        const value = m[1];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is not ISO-8601 (YYYY-MM-DD)`);
        } else if (value > today) {
            fail('docs/sitemap.xml', lineOf(xml, m.index!), 'sitemap-parity', `lastmod "${value}" is in the future`);
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
 * codes. Two-way check against reality: every `PDFA_*` token the docs mention
 * must exist both in the registry and in src/, and every registry entry must
 * exist in src/ — a registry entry for a code the engine no longer emits
 * teaches agents a ghost.
 */
{
    const ERRORS_JSON = join(ROOT, 'docs', 'data', 'errors.json');
    if (!existsSync(ERRORS_JSON)) {
        fail('docs/data/errors.json', 1, 'error-parity', 'missing — the engine diagnostic registry must be served');
    } else {
        const registry = JSON.parse(read(ERRORS_JSON)) as { diagnostics: Array<{ code: string }> };
        const registered = new Set(registry.diagnostics.map((d) => d.code));
        const srcCodes = new Set<string>();
        for (const f of walk(join(ROOT, 'src'), (p) => p.endsWith('.ts'))) {
            for (const m of read(f).matchAll(/\bPDFA_[A-Z_]+\b/g)) srcCodes.add(m[0]);
        }
        for (const code of registered) {
            if (!srcCodes.has(code)) {
                fail('docs/data/errors.json', 1, 'error-parity', `registry lists "${code}" but src/ never emits it`);
            }
        }
        for (const file of DOC_FILES) {
            const text = read(file);
            for (const m of text.matchAll(/\bPDFA_[A-Z_]+\b/g)) {
                if (registered.has(m[0])) continue;
                fail(rel(file), lineOf(text, m.index!), 'error-parity', `diagnostic "${m[0]}" is not in docs/data/errors.json`);
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
    const LINK_WITH_FRAG = /(?:\]\(|href=["'])([^)"'#\s]*)#([\p{L}][\p{L}\p{N}_-]*)/gu;
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
const { buildLlmsIndex } = await import('./build-llms-full.ts');

const LLMS_INDEX = join(ROOT, 'docs', 'llms-index.json');
if (!existsSync(LLMS_INDEX)) {
    fail('docs/llms-index.json', 1, 'llms-index-sync', 'missing — generate it with `npm run docs:llms`');
} else if (read(LLMS_INDEX).replace(/\r\n/g, '\n') !== buildLlmsIndex(ROOT)) {
    fail('docs/llms-index.json', 1, 'llms-index-sync', 'stale — regenerate with `npm run docs:llms`');
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

const OFFLINE_RULES = [
    'manifest-shape',
    'derived-counts',
    'stale-token',
    'canonical-present',
    'version-token',
    'api-exists',
    'jsonld-version',
    'internal-links',
    'seo-head',
    'sitemap-parity',
    'cdn-sri',
    'switcher-parity',
    'learn-chain',
    'bench-parity',
    'contrast',
    'llms-sync',
    'llms-index-sync',
    'error-parity',
    'anchor-parity',
    'guide-render-sync',
    'api-json-sync',
    'playground-syntax',
] as const;

if (problems.length === 0) {
    console.log(`verify-docs: ${OFFLINE_RULES.length} rules passed across ${DOC_FILES.length} files.`);
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
