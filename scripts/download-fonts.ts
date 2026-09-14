#!/usr/bin/env tsx
/**
 * pdfnative — Pinned source-font download (v1.8.0)
 * ==================================================
 * Populates fonts/ttf/ with the exact TTFs the bundled `fonts/*-data.js`
 * modules were built from, as recorded in fonts/SOURCES.json:
 *
 *   - `fonts[]` entries are fetched from the google/fonts repository at the
 *     commit the manifest pins (`upstream.commit`, or an entry's own `commit`
 *     when a later upstream release replaced the file the module uses), and
 *     every byte is SHA-256-checked before the file is written. A mismatch
 *     is an error, not a warning: a silently different source font would
 *     make `npm run verify:fonts` fail for a reason nobody could see.
 *   - `fonts[]` entries with `"origin": "tree"` and every `derived[]` entry
 *     are committed to fonts/ttf/ (small static instances and the five
 *     pyftsubset Latin subsets that no upstream URL reproduces); they are
 *     only verified here, never downloaded.
 *
 * Usage:
 *   npm run fonts:download                       # fetch what is missing, verify the rest
 *   npx tsx scripts/download-fonts.ts --force    # re-download every upstream font
 *   npx tsx scripts/download-fonts.ts --dir <path>
 *   npx tsx scripts/download-fonts.ts --update-manifest --commit <40-hex sha>
 *       rewrites fonts/SOURCES.json from the files on disk (hashes, sizes,
 *       the new commit and today's date). Run `--force` afterwards to prove
 *       the pinned commit really serves those bytes.
 *
 * Exit codes:
 *   0 — every manifest entry is on disk with the recorded hash
 *   1 — a download failed, a hash differed, or a committed file is missing
 *   2 — bad usage
 *
 * License: all Noto fonts are distributed under the SIL Open Font License 1.1.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(REPO_ROOT, 'fonts', 'SOURCES.json');
const DEFAULT_TTF_DIR = join(REPO_ROOT, 'fonts', 'ttf');
const RAW_BASE = 'https://raw.githubusercontent.com';

// ── Manifest ────────────────────────────────────────────────────────

export interface UpstreamFont {
    /** Local filename in fonts/ttf/ — the name the module's "Source:" header names. */
    readonly local: string;
    /** google/fonts `ofl/<dir>` subdirectory. */
    readonly dir: string;
    /** Remote filename, URL-encoded (`%5B`/`%5D` around the axis list). */
    readonly remote: string;
    readonly sha256: string;
    readonly bytes: number;
    /** Pins this file to a different google/fonts commit than `upstream.commit`. */
    readonly commit?: string;
    readonly note?: string;
}

export interface TreeFont {
    readonly local: string;
    readonly origin: 'tree';
    readonly sha256: string;
    readonly bytes: number;
    readonly note: string;
}

export interface DerivedFont {
    readonly local: string;
    readonly from: string;
    readonly tool: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly note: string;
}

export interface SourcesManifest {
    readonly upstream: {
        readonly repo: string;
        readonly commit: string;
        readonly resolvedOn: string;
        readonly note?: string;
    };
    readonly fonts: readonly (UpstreamFont | TreeFont)[];
    readonly derived: readonly DerivedFont[];
}

export function isTreeFont(f: UpstreamFont | TreeFont): f is TreeFont {
    return (f as TreeFont).origin === 'tree';
}

export function readManifest(path: string = MANIFEST_PATH): SourcesManifest {
    return JSON.parse(readFileSync(path, 'utf8')) as SourcesManifest;
}

export function sha256Of(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
}

/** Every file the manifest expects in fonts/ttf/, keyed by local name. */
export function expectedHashes(manifest: SourcesManifest): Map<string, { sha256: string; bytes: number }> {
    const m = new Map<string, { sha256: string; bytes: number }>();
    for (const f of [...manifest.fonts, ...manifest.derived]) m.set(f.local, { sha256: f.sha256, bytes: f.bytes });
    return m;
}

function upstreamUrl(manifest: SourcesManifest, font: UpstreamFont): string {
    const commit = font.commit ?? manifest.upstream.commit;
    return `${RAW_BASE}/${manifest.upstream.repo}/${commit}/ofl/${font.dir}/${font.remote}`;
}

// ── Reporting ───────────────────────────────────────────────────────

const out = (line: string): void => { process.stdout.write(`${line}\n`); };
const err = (line: string): void => { process.stderr.write(`${line}\n`); };

function kb(n: number): string {
    return `${Math.round(n / 1024)} KB`;
}

// ── Verification and download ───────────────────────────────────────

interface Tally { downloaded: number; verified: number; failed: number }

function checkOnDisk(path: string, expected: { sha256: string; bytes: number }): string | null {
    const data = readFileSync(path);
    const actual = sha256Of(data);
    if (actual === expected.sha256) return null;
    return `hash mismatch\n         expected ${expected.sha256} (${expected.bytes} B)\n         actual   ${actual} (${data.length} B)`;
}

async function fetchUpstream(manifest: SourcesManifest, font: UpstreamFont, dest: string): Promise<string | null> {
    const url = upstreamUrl(manifest, font);
    const res = await fetch(url);
    if (!res.ok) return `HTTP ${res.status} for ${url}`;
    const data = new Uint8Array(await res.arrayBuffer());
    const actual = sha256Of(data);
    if (actual !== font.sha256) {
        return `downloaded bytes differ from fonts/SOURCES.json — not written\n` +
            `         expected ${font.sha256} (${font.bytes} B)\n` +
            `         actual   ${actual} (${data.length} B)\n` +
            `         ${url}`;
    }
    writeFileSync(dest, data);
    return null;
}

async function syncFonts(manifest: SourcesManifest, ttfDir: string, force: boolean): Promise<Tally> {
    const tally: Tally = { downloaded: 0, verified: 0, failed: 0 };
    mkdirSync(ttfDir, { recursive: true });
    const relDir = relative(REPO_ROOT, ttfDir).replace(/\\/g, '/') || '.';
    out(`Source fonts → ${relDir}/ (google/fonts @ ${manifest.upstream.commit.slice(0, 12)}, resolved ${manifest.upstream.resolvedOn})\n`);

    for (const font of manifest.fonts) {
        const dest = join(ttfDir, font.local);
        if (isTreeFont(font)) {
            if (!existsSync(dest)) {
                err(`  FAIL ${font.local}: committed to the tree but missing — git checkout -- fonts/ttf/${font.local}`);
                tally.failed++;
                continue;
            }
            const problem = checkOnDisk(dest, font);
            if (problem) { err(`  FAIL ${font.local}: ${problem}`); tally.failed++; } else { out(`  OK   ${font.local} (tree, ${kb(font.bytes)})`); tally.verified++; }
            continue;
        }
        if (!force && existsSync(dest)) {
            const problem = checkOnDisk(dest, font);
            if (problem) {
                err(`  FAIL ${font.local}: ${problem}\n         (re-download with --force, or update the manifest if the module was rebuilt from this file)`);
                tally.failed++;
            } else {
                out(`  OK   ${font.local} (present, ${kb(font.bytes)})`);
                tally.verified++;
            }
            continue;
        }
        const problem = await fetchUpstream(manifest, font, dest);
        if (problem) { err(`  FAIL ${font.local}: ${problem}`); tally.failed++; } else { out(`  GET  ${font.local} (${kb(font.bytes)})`); tally.downloaded++; }
    }

    out('');
    for (const font of manifest.derived) {
        const dest = join(ttfDir, font.local);
        if (!existsSync(dest)) {
            err(`  FAIL ${font.local}: derived subset committed to the tree but missing — git checkout -- fonts/ttf/${font.local}`);
            tally.failed++;
            continue;
        }
        const problem = checkOnDisk(dest, font);
        if (problem) { err(`  FAIL ${font.local}: ${problem}`); tally.failed++; } else { out(`  OK   ${font.local} (derived from ${font.from}, ${kb(font.bytes)})`); tally.verified++; }
    }
    return tally;
}

// ── --update-manifest ───────────────────────────────────────────────

function updateManifest(manifest: SourcesManifest, ttfDir: string, commit: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const measure = <T extends { local: string }>(entry: T): T & { sha256: string; bytes: number } => {
        const path = join(ttfDir, entry.local);
        if (!existsSync(path)) throw new Error(`${entry.local} is not in ${ttfDir}`);
        const data = readFileSync(path);
        return { ...entry, sha256: sha256Of(data), bytes: data.length };
    };
    try {
        const next: SourcesManifest = {
            upstream: { ...manifest.upstream, commit, resolvedOn: today },
            fonts: manifest.fonts.map(measure),
            derived: manifest.derived.map(measure),
        };
        writeFileSync(MANIFEST_PATH, `${JSON.stringify(next, null, 2)}\n`);
        out(`fonts/SOURCES.json rewritten: ${next.fonts.length} fonts + ${next.derived.length} derived, commit ${commit.slice(0, 12)}, ${today}.`);
        out('Prove the pin with: npx tsx scripts/download-fonts.ts --force');
        return 0;
    } catch (e) {
        err(`update-manifest: ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }
}

// ── CLI ─────────────────────────────────────────────────────────────

interface Options { force: boolean; dir: string; updateManifest: boolean; commit: string | null }

function parseArgs(argv: readonly string[]): Options | { error: string } {
    const opts: Options = { force: false, dir: DEFAULT_TTF_DIR, updateManifest: false, commit: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--force') opts.force = true;
        else if (a === '--update-manifest') opts.updateManifest = true;
        else if (a === '--dir' || a === '--commit') {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
            if (a === '--dir') opts.dir = resolve(REPO_ROOT, v); else opts.commit = v;
            i++;
        } else return { error: `unknown argument "${a}"` };
    }
    if (opts.updateManifest && (opts.commit === null || !/^[0-9a-f]{40}$/.test(opts.commit))) {
        return { error: '--update-manifest needs --commit <40-hex google/fonts commit sha>' };
    }
    if (!opts.updateManifest && opts.commit !== null) return { error: '--commit only makes sense with --update-manifest' };
    return opts;
}

async function main(): Promise<number> {
    const parsed = parseArgs(process.argv.slice(2));
    if ('error' in parsed) {
        err(`download-fonts: ${parsed.error}`);
        err('Usage: npx tsx scripts/download-fonts.ts [--force] [--dir <path>] | --update-manifest --commit <sha>');
        return 2;
    }
    const manifest = readManifest();
    if (parsed.updateManifest) return updateManifest(manifest, parsed.dir, parsed.commit as string);

    const tally = await syncFonts(manifest, parsed.dir, parsed.force);
    out(`\nDone: ${tally.downloaded} downloaded, ${tally.verified} verified, ${tally.failed} failed`);
    return tally.failed > 0 ? 1 : 0;
}

main().then(code => process.exit(code), e => { err(String(e)); process.exit(1); });
