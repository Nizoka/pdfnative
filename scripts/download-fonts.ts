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
 *   - `derived[]` entries are the five Latin subsets the repository cuts
 *     itself from the pinned `NotoSans-VF.ttf` with the library's own
 *     `subsetTTF()` (scripts/lib/latin-subsets.ts, code-point lists under
 *     fonts/subsets/): they are derived here once the variable font has been
 *     verified, and checked against the recorded hash — never downloaded and
 *     never committed.
 *
 * Usage:
 *   npm run fonts:download                       # fetch what is missing, verify the rest, derive the subsets
 *   npx tsx scripts/download-fonts.ts --force    # re-download every upstream font
 *   npx tsx scripts/download-fonts.ts --dir <path>
 *   npx tsx scripts/download-fonts.ts --update-manifest --commit <40-hex sha>
 *       rewrites fonts/SOURCES.json from the files on disk (hashes, sizes,
 *       copyright statements, the new commit and today's date) and from the
 *       freshly derived subsets. Run `--force` afterwards to prove the pinned
 *       commit really serves those bytes.
 *
 * Exit codes:
 *   0 — every manifest entry is on disk with the recorded hash
 *   1 — a download failed, a hash differed, or a subset no longer reproduces
 *   2 — bad usage
 *
 * License: all Noto fonts are distributed under the SIL Open Font License 1.1.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import {
    DEFAULT_TTF_DIR, MANIFEST_PATH, REPO_ROOT,
    expectedHashes, isReleaseFont, readManifest, readNameRecord, sha256Of,
} from './lib/font-sources.js';
import type { DerivedFont, ReleaseFont, SourcesManifest, UpstreamFont } from './lib/font-sources.js';
import { buildAllLatinSubsets, withDerivedHashes } from './lib/latin-subsets.js';
import type { DerivedBuild } from './lib/latin-subsets.js';

// The manifest types and helpers moved to scripts/lib/font-sources.ts in
// 1.8.0; they stay importable from here.
export { expectedHashes, isReleaseFont, readManifest, sha256Of };
export type { DerivedFont, ReleaseFont, SourcesManifest, UpstreamFont };

const RAW_BASE = 'https://raw.githubusercontent.com';

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
    deriveSubsets(manifest, ttfDir, tally);
    return tally;
}

/**
 * Derive the `derived[]` subsets from the verified upstream font and write
 * the ones that are absent or differ. A derived file whose bytes no longer
 * match the manifest is a failure: the subsetter or a code-point list moved,
 * and the manifest, the modules and the samples have to move with it.
 */
function deriveSubsets(manifest: SourcesManifest, ttfDir: string, tally: Tally): DerivedBuild[] {
    if (manifest.derived.length === 0) return [];
    let results: DerivedBuild[];
    try {
        results = buildAllLatinSubsets(manifest, ttfDir);
    } catch (e) {
        err(`  FAIL derived subsets: ${e instanceof Error ? e.message : String(e)}`);
        tally.failed += manifest.derived.length;
        return [];
    }
    for (const r of results) {
        const dest = join(ttfDir, r.entry.local);
        if (r.sha256 !== r.entry.sha256) {
            err(`  FAIL ${r.entry.local}: derived subset no longer reproduces fonts/SOURCES.json — not written\n` +
                `         expected ${r.entry.sha256} (${r.entry.bytes} B)\n` +
                `         derived  ${r.sha256} (${r.bytes.length} B)\n` +
                `         the subsetter or ${r.entry.codepoints} changed: npx tsx scripts/build-latin-subsets.ts --update-manifest, then rebuild the module`);
            tally.failed++;
            continue;
        }
        const present = existsSync(dest) && Buffer.from(readFileSync(dest)).equals(Buffer.from(r.bytes));
        if (!present) writeFileSync(dest, r.bytes);
        out(`  ${present ? 'OK  ' : 'GEN '} ${r.entry.local} (derived from ${r.entry.from} by subsetTTF, ${kb(r.bytes.length)})`);
        if (present) tally.verified++; else tally.downloaded++;
    }
    return results;
}

// ── --update-manifest ───────────────────────────────────────────────

function updateManifest(manifest: SourcesManifest, ttfDir: string, commit: string): number {
    const today = new Date().toISOString().slice(0, 10);
    const measure = <T extends { local: string; copyright?: string }>(entry: T): T => {
        const path = join(ttfDir, entry.local);
        if (!existsSync(path)) throw new Error(`${entry.local} is not in ${ttfDir}`);
        const data = new Uint8Array(readFileSync(path));
        const copyright = readNameRecord(data, 0) ?? entry.copyright;
        return { ...entry, sha256: sha256Of(data), bytes: data.length, ...(copyright ? { copyright } : {}) };
    };
    try {
        const fonts = manifest.fonts.map(measure);
        const derived = buildAllLatinSubsets({ ...manifest, fonts }, ttfDir);
        for (const r of derived) writeFileSync(join(ttfDir, r.entry.local), r.bytes);
        const next = withDerivedHashes({
            upstream: { ...manifest.upstream, commit, resolvedOn: today },
            fonts,
            derived: manifest.derived,
        }, derived);
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

// Run only as a script: verify-fonts.ts imports the helpers above and must
// not trigger a download.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().then(code => process.exit(code), e => { err(String(e)); process.exit(1); });
}
