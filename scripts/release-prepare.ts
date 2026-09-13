#!/usr/bin/env tsx
/**
 * pdfnative — Release preparation (v1.8.0)
 * ==========================================
 * Applies the mechanical part of a version bump in one pass. Until 1.8.0 a
 * release spread the same number across two commits and some thirty files
 * edited by hand — package manifests, the ecosystem manifest, CITATION.cff,
 * the SECURITY.md support table, forty-odd CDN pins, JSON-LD, an SVG label
 * and the sitemap — and `verify:docs` only caught the drift afterwards.
 *
 * What it edits, in order (every touched file is printed):
 *   1. package.json + package-lock.json `version`
 *   2. docs/assets/ecosystem.json `packages.pdfnative.version` + `verifiedOn`,
 *      and the "Verified on" stamps that the verified-on-parity rule holds
 *      to that date (llms.txt, docs/llms.txt, docs/agent-brief.md,
 *      docs/data/surfaces.json, docs/data/errors.json)
 *   3. CITATION.cff `version` + `date-released`
 *   4. SECURITY.md supported-versions table
 *   5. CDN pins `pdfnative@<previous>` → `pdfnative@<version>` across docs/,
 *      README.md and llms.txt
 *   6. docs/index.html JSON-LD `softwareVersion` of the library entry, and
 *      the architecture diagram's alt text
 *   7. docs/assets/architecture.svg version label
 *   8. docs/sitemap.xml `<lastmod>` for every page whose source changed
 *      since the previous tag
 *   9. release-notes/vX.Y.Z.md scaffolded from release-notes/TEMPLATE.md
 *
 * It never reserialises JSON, YAML or XML: each edit is a targeted regex on
 * the one field it owns, so formatting, key order and comments survive and
 * the diff reads as the bump and nothing else.
 *
 * Usage:
 *   npx tsx scripts/release-prepare.ts --version 1.9.0
 *   npx tsx scripts/release-prepare.ts --version 1.9.0 --date 2026-10-01 --previous v1.8.0
 *   npx tsx scripts/release-prepare.ts --version 1.9.0 --dry-run
 *
 * (PowerShell swallows a bare `--`, so call the script directly rather than
 * going through `npm run`.)
 *
 * Exit codes:
 *   0 — done, or the dry run reported what would change
 *   1 — a file the bump owns is missing, or a pattern it edits was not found
 *   2 — bad usage (invalid semver or date), or git could not name the previous tag
 *
 * The pure functions are exported and covered by
 * tests/tools/release-prepare.test.ts; only `main()` touches git and disk.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// ── Types ───────────────────────────────────────────────────────────

/** Result of one targeted edit. `text` equals the input when nothing changed. */
export interface Rewrite {
    readonly text: string;
    /** How many places the owning pattern was found — changed or already right. */
    readonly matched: number;
}

export interface Options {
    readonly version: string;
    readonly date: string;
    readonly previous: string | null;
    readonly dryRun: boolean;
}

// ── Small helpers ───────────────────────────────────────────────────

const SEMVER = /^\d+\.\d+\.\d+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isSemver(v: string): boolean {
    return SEMVER.test(v);
}

export function isIsoDate(d: string): boolean {
    return ISO_DATE.test(d) && !Number.isNaN(Date.parse(d));
}

/** Today as YYYY-MM-DD in UTC — the same clock CI and the sitemap rule use. */
export function todayUtc(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** `v1.7.0` → `1.7.0`. */
export function stripTag(tag: string): string {
    return tag.replace(/^v/, '');
}

/** `1.7.3` → `1.7`. */
export function minorLine(version: string): string {
    return version.split('.').slice(0, 2).join('.');
}

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

// ── 1. package.json / package-lock.json ─────────────────────────────

/**
 * The top-level `"version"` of an npm manifest sits at the file's base indent
 * (two spaces in npm's own output). Nested `version` keys — every dependency
 * in the lockfile — are deeper and are left alone.
 */
export function bumpJsonVersion(text: string, version: string): Rewrite {
    return replaceCounting(text, /^( {2}"version":[ \t]*")([^"]*)(")/m, (_m, a, _old, c) => `${a}${version}${c}`);
}

/** The lockfile carries the version twice: at the root and under `packages[""]`. */
export function bumpLockVersion(text: string, version: string): Rewrite {
    const root = bumpJsonVersion(text, version);
    const pkg = replaceCounting(
        root.text,
        /("packages":\s*\{\s*"":\s*\{[^}]*?"version":[ \t]*")([^"]*)(")/,
        (_m, a, _old, c) => `${a}${version}${c}`,
    );
    return { text: pkg.text, matched: root.matched + pkg.matched };
}

// ── 2. ecosystem.json + "Verified on" stamps ────────────────────────

/** `packages.pdfnative.version` and the top-level `verifiedOn`. */
export function bumpManifest(text: string, version: string, date: string): Rewrite {
    const v = replaceCounting(
        text,
        /("packages":\s*\{\s*"pdfnative":\s*\{\s*"version":[ \t]*")([^"]*)(")/,
        (_m, a, _old, c) => `${a}${version}${c}`,
    );
    const d = replaceCounting(v.text, /^( {2}"verifiedOn":[ \t]*")([^"]*)(")/m, (_m, a, _old, c) => `${a}${date}${c}`);
    return { text: d.text, matched: v.matched + d.matched };
}

/**
 * The entry-point artefacts carry a `Verified on YYYY-MM-DD` sentence (or a
 * `"verifiedOn"` field) that verify-docs requires to equal the manifest's
 * date exactly — bumping one without the other fails the build.
 */
export function restampVerifiedOn(text: string, date: string): Rewrite {
    return replaceCounting(
        text,
        /(Verified on |"verifiedOn":[ \t]*")\d{4}-\d{2}-\d{2}/,
        (_m, a) => `${a}${date}`,
    );
}

// ── 3. CITATION.cff ─────────────────────────────────────────────────

/**
 * The software's own `version:` — not `cff-version:`, which is the format
 * revision (the anchored `^version` cannot match a line starting with `cff-`).
 * `date-released` is optional in CFF 1.2.0; it is rewritten when present and
 * added directly under `version:` otherwise, so a citation names the date.
 */
export function bumpCitation(text: string, version: string, date: string): Rewrite {
    const v = replaceCounting(text, /^(version:[ \t]*)([^\r\n]*)/m, (_m, a) => `${a}${version}`);
    if (v.matched === 0) return v;
    if (/^date-released:/m.test(v.text)) {
        const d = replaceCounting(v.text, /^(date-released:[ \t]*)([^\r\n]*)/m, (_m, a) => `${a}${date}`);
        return { text: d.text, matched: v.matched + d.matched };
    }
    const eol = v.text.includes('\r\n') ? '\r\n' : '\n';
    const out = v.text.replace(/^(version:[^\r\n]*)/m, `$1${eol}date-released: ${date}`);
    return { text: out, matched: v.matched + 1 };
}

// ── 4. SECURITY.md ──────────────────────────────────────────────────

/**
 * The table has three rows: the supported line, the previous line on security
 * fixes, and everything older unsupported:
 *
 *   | 1.8.x   | ✅        |
 *   | 1.7.x   | ✅ (security fixes) |
 *   | < 1.7   | ❌        |
 *
 * Mapping on a bump to X.Y.Z: the row that was supported keeps its number and
 * drops to "security fixes", the new X.Y line takes the supported row, and
 * the cut-off becomes `< <old supported line>`. A patch release lands on the
 * line already listed, so the table is left as it is; a major release follows
 * the same rule (2.0.x supported, 1.N.x security fixes, < 1.N unsupported).
 */
export function bumpSecurityTable(text: string, version: string): Rewrite {
    const line = minorLine(version);
    const re =
        /^(\| )(\d+\.\d+)(\.x[ \t]*\| ✅[ \t]*\|[^\r\n]*\r?\n\| )(\d+\.\d+)(\.x[ \t]*\| ✅ \(security fixes\)[ \t]*\|[^\r\n]*\r?\n\| < )(\d+\.\d+)([ \t]*\| ❌)/m;
    return replaceCounting(text, re, (whole, a, supported, b, _security, c, _cutoff, d) =>
        supported === line ? whole : `${a}${line}${b}${supported}${c}${supported}${d}`,
    );
}

// ── 5. CDN pins ─────────────────────────────────────────────────────

/**
 * `pdfnative@1.7.0` → `pdfnative@1.8.0`, whatever the host: esm.sh,
 * jsdelivr's `/npm/…/+esm`, unpkg's `?module`, a `/fonts/…` sub-path, or a
 * pin inside a JS string. The lookahead keeps `1.7.0` from matching the
 * prefix of `1.7.01` or `1.7.0.1`.
 */
export function replacePins(text: string, from: string, to: string): Rewrite {
    const re = new RegExp(`pdfnative@${escapeRe(from)}(?!\\d|\\.\\d)`, 'g');
    return replaceCounting(text, re, () => `pdfnative@${to}`);
}

/** Every `pdfnative@x.y.z` in `text`, counted per version. */
export function pinVersions(text: string): Map<string, number> {
    const out = new Map<string, number>();
    for (const m of text.matchAll(/pdfnative@(\d+\.\d+\.\d+)(?!\d|\.\d)/g)) {
        out.set(m[1], (out.get(m[1]) ?? 0) + 1);
    }
    return out;
}

// ── 6./7. JSON-LD, alt text and the SVG label ───────────────────────

/**
 * The first `"softwareVersion"` after the JSON-LD node carrying `id`. The
 * homepage graph also lists the CLI, MCP server and React renderer, each
 * with its own version, so the field must be located by node, not by name.
 */
export function bumpJsonLdVersion(html: string, id: string, version: string): Rewrite {
    const at = new RegExp(`"@id"\\s*:\\s*"${escapeRe(id)}"`).exec(html);
    if (!at) return { text: html, matched: 0 };
    const head = html.slice(0, at.index);
    const tail = replaceCounting(
        html.slice(at.index),
        /("softwareVersion":[ \t]*")([^"]*)(")/,
        (_m, a, _old, c) => `${a}${version}${c}`,
    );
    return { text: head + tail.text, matched: tail.matched };
}

/** The prose form `pdfnative 1.7.0` (SVG `<desc>`, `<img alt>`), word-bounded. */
export function replaceProductVersion(text: string, from: string, to: string): Rewrite {
    const re = new RegExp(`(\\bpdfnative )${escapeRe(from)}(?!\\d|\\.\\d)`, 'g');
    return replaceCounting(text, re, (_m, a) => `${a}${to}`);
}

// ── 8. Sitemap ──────────────────────────────────────────────────────

/**
 * The docs files a sitemap URL is rendered from, relative to the repo root.
 * A directory URL is its index.html; a guide's `.html` shell is generated
 * from its `.md`, so either changing means the page changed.
 */
export function sitemapSources(loc: string): string[] {
    let path = loc.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
    if (path === '' || path.endsWith('/')) path += 'index.html';
    const out = [`docs/${path}`];
    const guide = /^guides\/([^/]+)\.html$/.exec(path);
    if (guide && guide[1] !== 'index') out.push(`docs/guides/${guide[1]}.md`);
    return out;
}

export interface SitemapEntry {
    readonly loc: string;
    readonly lastmod: string | null;
}

export function sitemapEntries(xml: string): SitemapEntry[] {
    const out: SitemapEntry[] = [];
    for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
        const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(block[1])?.[1];
        if (!loc) continue;
        out.push({ loc, lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(block[1])?.[1] ?? null });
    }
    return out;
}

/**
 * URLs whose sources intersect `changedFiles` (repo-relative, forward
 * slashes) and whose `<lastmod>` is not already `date`.
 */
export function sitemapCandidates(xml: string, changedFiles: Iterable<string>, date: string): { loc: string; because: string }[] {
    const changed = new Set([...changedFiles].map((f) => f.replace(/\\/g, '/')));
    const out: { loc: string; because: string }[] = [];
    for (const entry of sitemapEntries(xml)) {
        if (entry.lastmod === date) continue;
        const hit = sitemapSources(entry.loc).find((src) => changed.has(src));
        if (hit) out.push({ loc: entry.loc, because: hit });
    }
    return out;
}

/** Set `<lastmod>` to `date` on every `<url>` whose `<loc>` is in `locs`. */
export function sitemapTouch(xml: string, locs: Iterable<string>, date: string): Rewrite {
    const wanted = new Set(locs);
    let matched = 0;
    const text = xml.replace(/<url>([\s\S]*?)<\/url>/g, (whole, body: string) => {
        const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1];
        if (!loc || !wanted.has(loc)) return whole;
        matched++;
        return whole.replace(/<lastmod>\s*[^<]*?\s*<\/lastmod>/, `<lastmod>${date}</lastmod>`);
    });
    return { text, matched };
}

// ── 9. Release note scaffold ────────────────────────────────────────

/**
 * release-notes/TEMPLATE.md carries the note as a fenced ```markdown block
 * whose own code fences are escaped as \`\`\`. Extract it, resolve the
 * `vX.Y.Z` / `X.Y.Z` / `vX.Y.Z-1` / `YYYY-MM-DD` placeholders and unescape.
 */
export function scaffoldReleaseNote(template: string, version: string, date: string, previousTag: string): string {
    const m = /```markdown\r?\n([\s\S]*?)\r?\n```/.exec(template);
    if (!m) throw new Error('release-notes/TEMPLATE.md has no ```markdown block to scaffold from');
    return (
        m[1]
            .replace(/vX\.Y\.Z-1/g, previousTag)
            .replace(/vX\.Y\.Z/g, `v${version}`)
            .replace(/X\.Y\.Z/g, version)
            .replace(/YYYY-MM-DD/g, date)
            .replace(/\\`\\`\\`/g, '```') + '\n'
    );
}

// ── CLI ─────────────────────────────────────────────────────────────

export const USAGE =
    'usage: npx tsx scripts/release-prepare.ts --version X.Y.Z [--date YYYY-MM-DD] [--previous vA.B.C] [--dry-run]';

/** Returns the options, or a usage error message. */
export function parseArgs(argv: readonly string[]): Options | string {
    let version: string | null = null;
    let date: string | null = null;
    let previous: string | null = null;
    let dryRun = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = (): string | null => (i + 1 < argv.length ? argv[++i] : null);
        if (arg === '--dry-run') dryRun = true;
        else if (arg === '--version') version = value();
        else if (arg === '--date') date = value();
        else if (arg === '--previous') previous = value();
        else if (arg.startsWith('--version=')) version = arg.slice('--version='.length);
        else if (arg.startsWith('--date=')) date = arg.slice('--date='.length);
        else if (arg.startsWith('--previous=')) previous = arg.slice('--previous='.length);
        else return `unknown argument "${arg}"\n${USAGE}`;
    }
    if (version === null) return `--version is required\n${USAGE}`;
    if (!isSemver(version)) return `--version "${version}" is not a plain semver triple (X.Y.Z)`;
    if (date !== null && !isIsoDate(date)) return `--date "${date}" is not an ISO date (YYYY-MM-DD)`;
    if (previous !== null && !isSemver(stripTag(previous))) return `--previous "${previous}" is not a tag of the form vA.B.C`;
    return { version, date: date ?? todayUtc(), previous: previous === null ? null : `v${stripTag(previous)}`, dryRun };
}

function git(root: string, args: string[]): string | null {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
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

function main(): number {
    const parsed = parseArgs(process.argv.slice(2));
    if (typeof parsed === 'string') {
        console.error(`release-prepare: ${parsed}`);
        return 2;
    }
    const opts = parsed;
    const root = resolve(import.meta.dirname, '..');
    const rel = (p: string): string => relative(root, p).replace(/\\/g, '/');

    const previousTag = opts.previous ?? git(root, ['describe', '--tags', '--abbrev=0'])?.trim() ?? null;
    if (!previousTag || !isSemver(stripTag(previousTag))) {
        console.error('release-prepare: could not determine the previous tag (git describe --tags --abbrev=0); pass --previous vA.B.C');
        return 2;
    }
    const previousVersion = stripTag(previousTag);
    const { version, date, dryRun } = opts;
    const mark = dryRun ? '~' : '+';
    let problems = 0;

    console.log(
        `release-prepare: v${version} (previous ${previousTag}, date ${date})${dryRun ? ' — dry run, nothing is written' : ''}`,
    );

    /** Read, rewrite, report, and write unless --dry-run. */
    const edit = (relPath: string, what: string, fn: (text: string) => Rewrite): void => {
        const abs = join(root, relPath);
        if (!existsSync(abs)) {
            console.log(`  !  ${relPath} — missing`);
            problems++;
            return;
        }
        const before = readFileSync(abs, 'utf8');
        const r = fn(before);
        if (r.matched === 0) {
            console.log(`  !  ${relPath} — ${what}: pattern not found, edit by hand`);
            problems++;
        } else if (r.text === before) {
            console.log(`  =  ${relPath} — ${what}: already current`);
        } else {
            console.log(`  ${mark}  ${relPath} — ${what}`);
            if (!dryRun) writeFileSync(abs, r.text);
        }
    };

    console.log('\n1. Package manifests');
    edit('package.json', 'version', (t) => bumpJsonVersion(t, version));
    edit('package-lock.json', 'version (root + packages[""])', (t) => bumpLockVersion(t, version));

    console.log('\n2. Ecosystem manifest and the Verified-on stamps it governs');
    edit('docs/assets/ecosystem.json', `packages.pdfnative.version + verifiedOn ${date}`, (t) => bumpManifest(t, version, date));
    for (const stamped of ['llms.txt', 'docs/llms.txt', 'docs/agent-brief.md', 'docs/data/surfaces.json', 'docs/data/errors.json']) {
        edit(stamped, `Verified on ${date}`, (t) => restampVerifiedOn(t, date));
    }

    console.log('\n3. Citation metadata');
    edit('CITATION.cff', `version + date-released ${date}`, (t) => bumpCitation(t, version, date));

    console.log('\n4. Supported versions');
    edit('SECURITY.md', `${minorLine(version)}.x supported, previous line on security fixes`, (t) => bumpSecurityTable(t, version));

    console.log(`\n5. CDN pins pdfnative@${previousVersion} → pdfnative@${version}`);
    const pinFiles = [
        ...walk(join(root, 'docs'), (p) => /\.(html|js|md|txt)$/.test(p)),
        ...['README.md', 'llms.txt'].map((f) => join(root, f)).filter(existsSync),
    ];
    let replaced = 0;
    let alreadyRight = 0;
    const strays = new Map<string, number>();
    for (const file of pinFiles) {
        const before = readFileSync(file, 'utf8');
        const r = replacePins(before, previousVersion, version);
        if (r.matched > 0) {
            replaced += r.matched;
            console.log(`  ${mark}  ${rel(file)} — ${r.matched} pin${r.matched === 1 ? '' : 's'}`);
            if (!dryRun) writeFileSync(file, r.text);
        }
        for (const [v, n] of pinVersions(r.text)) {
            if (v === version) alreadyRight += n;
            else if (v !== previousVersion) strays.set(v, (strays.get(v) ?? 0) + n);
        }
    }
    console.log(`  ${replaced} pin${replaced === 1 ? '' : 's'} rewritten; ${alreadyRight} already at ${version}`);
    for (const [v, n] of strays) {
        console.log(`  !  ${n} pin${n === 1 ? '' : 's'} still at pdfnative@${v} (neither the previous nor the new version — historical prose, or a missed bump)`);
    }

    console.log('\n6. Homepage JSON-LD and architecture alt text');
    edit('docs/index.html', 'softwareVersion of #library + alt text', (t) => {
        const ld = bumpJsonLdVersion(t, 'https://pdfnative.dev/#library', version);
        const alt = replaceProductVersion(ld.text, previousVersion, version);
        return { text: alt.text, matched: ld.matched + alt.matched };
    });

    console.log('\n7. Architecture diagram');
    edit('docs/assets/architecture.svg', 'version label', (t) => {
        const r = replaceProductVersion(t, previousVersion, version);
        // Already relabelled in an earlier run: report "already at" rather than "not found".
        return r.matched === 0 && replaceProductVersion(t, version, version).matched > 0 ? { text: t, matched: 1 } : r;
    });

    console.log(`\n8. Sitemap lastmod → ${date} for pages changed since ${previousTag}`);
    const diff = git(root, ['diff', '--name-only', previousTag, '--', 'docs/']);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', 'docs/']);
    if (diff === null) {
        console.log(`  !  git diff --name-only ${previousTag} -- docs/ failed; sitemap left alone`);
        problems++;
    } else {
        const changed = `${diff}\n${untracked ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const sitemapPath = join(root, 'docs', 'sitemap.xml');
        if (!existsSync(sitemapPath)) {
            console.log('  !  docs/sitemap.xml — missing');
            problems++;
        } else {
            const xml = readFileSync(sitemapPath, 'utf8');
            const candidates = sitemapCandidates(xml, changed, date);
            for (const c of candidates) console.log(`  ${mark}  ${c.loc}  (${c.because})`);
            if (candidates.length === 0) {
                console.log(`  =  docs/sitemap.xml — every changed page already carries ${date}`);
            } else {
                const r = sitemapTouch(xml, candidates.map((c) => c.loc), date);
                console.log(`  ${mark}  docs/sitemap.xml — ${r.matched} lastmod${r.matched === 1 ? '' : 's'}`);
                if (!dryRun) writeFileSync(sitemapPath, r.text);
            }
        }
    }

    console.log('\n9. Release note');
    const notePath = join(root, 'release-notes', `v${version}.md`);
    const templatePath = join(root, 'release-notes', 'TEMPLATE.md');
    if (existsSync(notePath)) {
        console.log(`  =  ${rel(notePath)} — exists, left alone`);
    } else if (!existsSync(templatePath)) {
        console.log('  !  release-notes/TEMPLATE.md — missing');
        problems++;
    } else {
        console.log(`  ${mark}  ${rel(notePath)} — scaffolded from release-notes/TEMPLATE.md`);
        if (!dryRun) writeFileSync(notePath, scaffoldReleaseNote(readFileSync(templatePath, 'utf8'), version, date, previousTag));
    }

    console.log(`
Next steps
  1. git diff --stat                      review: the diff should read as the bump and nothing else
  2. npm run docs:all && npm run verify:docs
  3. write release-notes/v${version}.md and the CHANGELOG.md entry ## [${version}] – ${date}
     (every sample rebaseline goes in the note's Upgrade section)
  4. npm run gate -- --publish            the full release gate (PowerShell: npx tsx scripts/gate.ts --publish)
  5. draft the PR body from release-notes/PR_TEMPLATE.md into RELEASE_PR_v${version}.md (git-ignored)
  See CONTRIBUTING.md § Release for the merge, tag and publish steps.`);

    if (problems > 0) {
        console.log(`\nrelease-prepare: ${problems} step${problems === 1 ? '' : 's'} need${problems === 1 ? 's' : ''} a hand edit (marked "!").`);
        return 1;
    }
    return 0;
}

const isMain = import.meta.filename === resolve(process.argv[1] ?? '');
if (isMain) {
    process.exit(main());
}
