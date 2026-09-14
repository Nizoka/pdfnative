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
 *   - `fonts[]` entries with `"origin": "release"` are the hinted static
 *     instances the notofonts project publishes as release archives
 *     (google/fonts carries only the variable font of those families): the
 *     pinned asset is downloaded, the one entry `path` names is extracted
 *     with node:zlib, hash-checked and written.
 *   - `derived[]` entries are committed to fonts/ttf/ (the five pyftsubset
 *     Latin subsets that no upstream URL reproduces); they are only verified
 *     here, never downloaded.
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
import { inflateRawSync } from 'node:zlib';

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

/** A static instance served inside a GitHub release archive of the notofonts project. */
export interface ReleaseFont {
    readonly local: string;
    readonly origin: 'release';
    /** GitHub repository, e.g. `notofonts/arabic`. */
    readonly repo: string;
    /** Release tag, e.g. `NotoSansArabic-v2.013`. */
    readonly tag: string;
    /** Asset file name attached to that release. */
    readonly asset: string;
    /** Entry inside the archive, e.g. `NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf`. */
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly note?: string;
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
    readonly fonts: readonly (UpstreamFont | ReleaseFont)[];
    readonly derived: readonly DerivedFont[];
}

export function isReleaseFont(f: UpstreamFont | ReleaseFont): f is ReleaseFont {
    return (f as ReleaseFont).origin === 'release';
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

export function releaseUrl(font: ReleaseFont): string {
    return `https://github.com/${font.repo}/releases/download/${font.tag}/${font.asset}`;
}

// ── Minimal ZIP reader (stored and deflate entries, no zip64) ───────

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * The bytes of one entry of a ZIP archive, located through the central
 * directory (APPNOTE.TXT §4.3); `null` when the archive has no such entry.
 * Throws on a structure the reader does not handle.
 */
export function extractZipEntry(zip: Uint8Array, entryPath: string): Uint8Array | null {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xFFFF); i--) {
        if (view.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a ZIP archive (no end-of-central-directory record)');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let k = 0; k < count; k++) {
        if (view.getUint32(p, true) !== CENTRAL_SIG) throw new Error('corrupt central directory');
        const method = view.getUint16(p + 10, true);
        const compressed = view.getUint32(p + 20, true);
        const uncompressed = view.getUint32(p + 24, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (name !== entryPath) continue;
        if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error(`corrupt local header for ${name}`);
        const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
        const raw = zip.subarray(start, start + compressed);
        if (method === 0) return raw;
        if (method === 8) {
            const data = new Uint8Array(inflateRawSync(raw));
            if (data.length !== uncompressed) throw new Error(`${name}: inflated ${data.length} B, expected ${uncompressed}`);
            return data;
        }
        throw new Error(`${name}: unsupported compression method ${method}`);
    }
    return null;
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

async function fetchRelease(font: ReleaseFont, dest: string): Promise<string | null> {
    const url = releaseUrl(font);
    const res = await fetch(url);
    if (!res.ok) return `HTTP ${res.status} for ${url}`;
    const zip = new Uint8Array(await res.arrayBuffer());
    let data: Uint8Array | null;
    try {
        data = extractZipEntry(zip, font.path);
    } catch (e) {
        return `${url}: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (data === null) return `${font.path} is not in ${url}`;
    const actual = sha256Of(data);
    if (actual !== font.sha256) {
        return `extracted bytes differ from fonts/SOURCES.json — not written\n` +
            `         expected ${font.sha256} (${font.bytes} B)\n` +
            `         actual   ${actual} (${data.length} B)\n` +
            `         ${url} :: ${font.path}`;
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
        const problem = isReleaseFont(font) ? await fetchRelease(font, dest) : await fetchUpstream(manifest, font, dest);
        const from = isReleaseFont(font) ? `${font.repo} ${font.tag}` : 'google/fonts';
        if (problem) { err(`  FAIL ${font.local}: ${problem}`); tally.failed++; } else { out(`  GET  ${font.local} (${kb(font.bytes)}, ${from})`); tally.downloaded++; }
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
