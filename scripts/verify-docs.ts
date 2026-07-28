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

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname, posix } from 'node:path';

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
    forbid: string;
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
    ...walk(join(ROOT, 'docs'), (p) => /\.(html|md|js|svg|xml|txt)$/.test(p) && !p.includes('ecosystem.json')),
    ...['README.md', 'ROADMAP.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'llms.txt']
        .map((f) => join(ROOT, f))
        .filter(existsSync),
    ...['.github/copilot-instructions.md'].map((f) => join(ROOT, f)).filter(existsSync),
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
    playgrounds: existsSync(join(ROOT, 'docs', 'playgrounds'))
        ? readdirSync(join(ROOT, 'docs', 'playgrounds')).filter((f) => f.endsWith('.html') && f !== 'index.html').length
        : 0,
    learnSteps: manifest.learnPath.length,
};

// samplePdfs only counts when the samples have actually been generated;
// test-output/ is git-ignored, so an empty tree is not a failure.
const samplePdfs = walk(join(ROOT, 'test-output'), (p) => p.endsWith('.pdf')).length;
if (samplePdfs > 0) actualDerived.samplePdfs = samplePdfs;

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

for (const assertion of manifest.assertions) {
    const forbid = new RegExp(assertion.forbid, 'g');
    for (const file of DOC_FILES) {
        const text = read(file);
        forbid.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = forbid.exec(text)) !== null) {
            fail(
                rel(file),
                lineOf(text, m.index),
                'stale-token',
                `"${m[0].trim()}" contradicts the manifest — canonical value is "${assertion.canonical}"`,
            );
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

// ── Rule: api-exists ────────────────────────────────────────────────

for (const [phantom, replacement] of Object.entries(manifest.apiDenylist)) {
    if (phantom.startsWith('$')) continue;
    const re = new RegExp(`\\b${phantom}\\b`, 'g');
    for (const file of DOC_FILES) {
        const text = read(file);
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            fail(rel(file), lineOf(text, m.index), 'api-exists', `${phantom}() is not exported by pdfnative — use ${replacement}`);
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
}

// ── Rule: jsonld-version ────────────────────────────────────────────

const PKG_BY_ANCHOR: Record<string, string> = {
    '#library': 'pdfnative',
    '#cli': 'pdfnative-cli',
    '#mcp': 'pdfnative-mcp',
    '#react': 'pdfnative-react',
};

function walkJsonLd(node: unknown, file: string, line: number): void {
    if (Array.isArray(node)) {
        for (const child of node) walkJsonLd(child, file, line);
        return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
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
        // Strip HTML comments — the release-checklist notes live inside these blocks.
        const body = m[1].replace(/<!--[\s\S]*?-->/g, '').trim();
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

// Playground pdfnative imports must be pinned to the manifest version.
const CORE_VERSION = manifest.packages['pdfnative'].version;
const UNPINNED = /['"]https:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm|unpkg\.com)\/(pdfnative(?:-cli|-mcp|-react)?)(?![@\w-])/g;
for (const file of HTML_FILES) {
    const text = read(file);
    UNPINNED.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = UNPINNED.exec(text)) !== null) {
        fail(rel(file), lineOf(text, m.index), 'cdn-sri', `"${m[1]}" is imported unpinned — pin it (core is ${CORE_VERSION})`);
    }
}

// ── Rule: switcher-parity ───────────────────────────────────────────

const PLAYGROUNDS = existsSync(join(ROOT, 'docs', 'playgrounds'))
    ? readdirSync(join(ROOT, 'docs', 'playgrounds')).filter((f) => f.endsWith('.html') && f !== 'index.html')
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
        if (!expectedPrev && prevHref) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', 'first step must not declare rel="prev"');
        }
        if (expectedNext && nextHref !== expectedNext) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', `rel="next" is "${nextHref ?? 'missing'}", expected "${expectedNext}"`);
        }
        if (!expectedNext && nextHref) {
            fail(`docs/learn/${name}`, 1, 'learn-chain', 'last step must not declare rel="next"');
        }
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
        const bg = /--c-bg:\s*(#[0-9a-fA-F]{3,6})/.exec(body)?.[1];
        for (const token of ['--c-text-muted', '--c-text-dim']) {
            const fg = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,6})`).exec(body)?.[1];
            if (!bg || !fg) continue;
            const ratio = contrastRatio(fg, bg);
            if (ratio < 4.5) {
                fail(
                    'docs/style.css',
                    lineOf(css, block.index! + block[0].indexOf(token)),
                    'contrast',
                    `${token} (${fg}) on ${bg} is ${ratio.toFixed(2)}:1 — WCAG AA body text needs 4.5:1`,
                );
            }
        }
    }
}

// ── Rule: npm-drift (--online only) ─────────────────────────────────

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
                const report = STRICT ? fail : warn;
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

if (problems.length === 0) {
    const ruleCount = 11;
    console.log(`verify-docs: ${ruleCount} rules passed across ${DOC_FILES.length} files.`);
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
