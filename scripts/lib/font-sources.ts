/**
 * SHARED FONT-SOURCE MANIFEST CORE (v1.8.0)
 * ==========================================
 * The `fonts/SOURCES.json` types and the small helpers every font tool needs:
 *   - scripts/download-fonts.ts       (fetches, verifies, rewrites the manifest)
 *   - scripts/verify-fonts.ts         (proves every module from its source)
 *   - scripts/lib/latin-subsets.ts    (derives the five Latin subsets)
 *   - scripts/build-latin-subsets.ts  (their CLI)
 *
 * Pure, synchronous, zero external dependency. Nothing here performs I/O
 * beyond reading the manifest on request.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_PATH = join(REPO_ROOT, 'fonts', 'SOURCES.json');
export const DEFAULT_TTF_DIR = join(REPO_ROOT, 'fonts', 'ttf');

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
    /** The font's own copyright statement (`name` ID 0), retained as OFL §2 requires. */
    readonly copyright?: string;
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
    /** The font's own copyright statement (`name` ID 0), retained as OFL §2 requires. */
    readonly copyright?: string;
    readonly note?: string;
}

/**
 * A subset the repository derives itself from a pinned upstream font with
 * `subsetTTF()` — never downloaded, never committed. `sha256`/`bytes` are
 * what the recorded command produces; a change to the subsetter or to the
 * code-point list moves them, which `verify:fonts` reports.
 *
 * @since 1.8.0 (derived by the library; the pyftsubset files before were committed)
 */
export interface DerivedFont {
    readonly local: string;
    /** The `fonts[]` entry the subset is cut from. */
    readonly from: string;
    readonly tool: string;
    /** Repository-relative path of the code-point list, `/`-separated. */
    readonly codepoints: string;
    /** Keep `GSUB`/`GPOS`/`GDEF` (with the GSUB closure of the kept glyphs). */
    readonly layout: boolean;
    /** The command that regenerates the file. */
    readonly command: string;
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

// ── sfnt helpers ────────────────────────────────────────────────────

/** The table directory of a TrueType / OpenType font: tag → byte range. */
export function sfntTables(ttf: Uint8Array): Map<string, { offset: number; length: number }> {
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const tables = new Map<string, { offset: number; length: number }>();
    if (ttf.length < 12) return tables;
    const numTables = view.getUint16(4);
    for (let i = 0; i < numTables && 12 + i * 16 + 16 <= ttf.length; i++) {
        const o = 12 + i * 16;
        const tag = String.fromCharCode(ttf[o], ttf[o + 1], ttf[o + 2], ttf[o + 3]);
        tables.set(tag, { offset: view.getUint32(o + 8), length: view.getUint32(o + 12) });
    }
    return tables;
}

/**
 * One string of the `name` table (OpenType §5.3): the Windows Unicode
 * record (platform 3, encoding 1, language 0x0409, then any language) is
 * preferred, the Macintosh Roman record (platform 1) is the fallback.
 * `null` when the font carries no such record.
 */
export function readNameRecord(ttf: Uint8Array, nameId: number): string | null {
    const name = sfntTables(ttf).get('name');
    if (!name) return null;
    const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const count = view.getUint16(name.offset + 2);
    const stringsAt = name.offset + view.getUint16(name.offset + 4);
    let best: { score: number; text: string } | null = null;
    for (let i = 0; i < count; i++) {
        const r = name.offset + 6 + i * 12;
        if (view.getUint16(r + 6) !== nameId) continue;
        const platform = view.getUint16(r);
        const encoding = view.getUint16(r + 2);
        const language = view.getUint16(r + 4);
        const length = view.getUint16(r + 8);
        const start = stringsAt + view.getUint16(r + 10);
        if (start + length > ttf.length) continue;
        let score: number;
        let text: string;
        if (platform === 3 && (encoding === 1 || encoding === 10)) {
            score = language === 0x0409 ? 3 : 2;
            let s = '';
            for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(view.getUint16(start + k));
            text = s;
        } else if (platform === 1 && encoding === 0) {
            score = 1;
            let s = '';
            for (let k = 0; k < length; k++) s += String.fromCharCode(ttf[start + k]);
            text = s;
        } else continue;
        if (!best || score > best.score) best = { score, text };
    }
    return best ? best.text.replace(/\s+/g, ' ').trim() : null;
}
