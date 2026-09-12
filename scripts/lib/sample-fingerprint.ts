/**
 * pdfnative — Sample fingerprinting core (v1.8.0)
 * =================================================
 * Shared by the `verify:samples` CLI and the vitest regression gate, so both
 * compute the identical fingerprint and there is one definition of what
 * "unchanged output" means.
 *
 * Two modes:
 *   • `bytes`    — SHA-256 of the file. Valid for every sample that is
 *     byte-reproducible once `setDefaultCreationDate()` pins the creation
 *     instant and the process runs in UTC (see scripts/helpers/tz.ts).
 *   • `semantic` — SHA-256 of a canonical JSON projection of the decrypted
 *     document. Required for encrypted samples: the file key, the AES IVs
 *     and the derived /O /U /Perms values all come from a CSPRNG by design
 *     (ISO 32000-1 §7.6), so their bytes can never repeat. Hashing what the
 *     document says rather than how it is sealed still catches every
 *     content, structure and permission regression.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openPdf, extractText } from '../../src/index.js';
import type { PdfReader, PdfValue, ParsedDict } from '../../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, '..', '..');
export const OUTPUT_DIR = join(REPO_ROOT, 'test-output');
export const BASELINE_PATH = join(REPO_ROOT, 'tests', 'regression', 'baselines', 'samples.sha256.json');

/**
 * Encrypted samples, mapped to the password that opens them.
 *
 * Kept explicit rather than derived: a sample that silently stops being
 * encrypted — or starts being encrypted — must fail loudly instead of
 * quietly switching fingerprint mode. The value is the password the
 * generator used; owner-only samples still need it here because the reader
 * tries user and owner passwords alike.
 */
export const ENCRYPTED_SAMPLES: Readonly<Record<string, string>> = {
    'annotations/annotated-encrypted.pdf': 'pdfnative',
    'compression/compressed-encrypted-aes128.pdf': 'compress-owner',
    'document/doc-encrypted-aes128.pdf': 'docuser',
    'document/doc-encrypted-aes256.pdf': '',
    'encryption/encrypted-aes128.pdf': 'owner123',
    'encryption/encrypted-aes256.pdf': 'owner256',
    'encryption/encrypted-aes128-user.pdf': 'user456',
    'encryption/encrypted-aes256-user.pdf': 'user789',
    'encryption/encrypted-readonly.pdf': 'owner-ro',
    'encryption/encrypted-noprint.pdf': 'owner-np',
    'forms/filled-encrypted.pdf': 'pdfnative',
    'forms/flattened-encrypted.pdf': 'pdfnative',
    'manipulation/merged-reencrypted.pdf': 'pdfnative',
    'manipulation/stream-split-encrypted-0.pdf': 'pdfnative',
};

export type FingerprintMode = 'bytes' | 'semantic';

/** What fingerprinting a sample yields, independent of any baseline. */
export interface Fingerprint {
    readonly mode: FingerprintMode;
    readonly hash: string;
    /** Byte length — informational, and a cheap first signal in diffs. */
    readonly size: number;
}

export interface BaselineEntry extends Fingerprint {
    /**
     * Release whose output this fingerprint captures — the sample's oldest
     * verified reference, carried forward untouched by every later
     * rebaseline. A sample first fingerprinted in 1.8.0 reads `"1.8.0"` and
     * has no earlier reference to be compared against; one that reads
     * `"1.7.0"` is still being held to the bytes v1.7.0 emitted.
     */
    readonly since: string;
}

export interface Baseline {
    readonly $comment: string;
    /** Release at which the manifest was last written. */
    readonly baselineVersion: string;
    /** How the oldest entries were verified against the previous release. */
    readonly provenance: string;
    readonly creationDate: string;
    readonly timezone: string;
    readonly entries: Record<string, BaselineEntry>;
}

/** The version in package.json — stamped on newly baselined samples. */
export function currentVersion(): string {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
    return pkg.version;
}

// ── Helpers ──────────────────────────────────────────────────────────

export function sha256Hex(data: Uint8Array | string): string {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return createHash('sha256').update(buf).digest('hex');
}

/** Yield every `.pdf` under `dir`, depth-first, in a stable order. */
export function* walkPdfs(dir: string): Generator<string> {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir).sort()) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) yield* walkPdfs(p);
        else if (entry.endsWith('.pdf')) yield p;
    }
}

/** Repo-relative, forward-slashed path of a sample under `test-output/`. */
export function relPath(abs: string): string {
    return relative(OUTPUT_DIR, abs).split('\\').join('/');
}

/**
 * Canonical JSON: object keys sorted at every depth, so the projection is
 * insertion-order independent and the hash is stable across runs.
 */
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Render a parsed PDF value as a stable, printable structure. */
function showValue(reader: PdfReader, value: PdfValue | undefined): unknown {
    if (value === undefined) return null;
    const v = reader.resolveValue(value);
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => showValue(reader, x));
    if (v instanceof Map) {
        const out: Record<string, unknown> = {};
        for (const key of [...v.keys()].sort()) out[key] = showValue(reader, v.get(key));
        return out;
    }
    return String(v);
}

/**
 * A canonical projection of what an encrypted document *says*: page
 * geometry, metadata, page labels, per-page reading-order text and
 * annotation counts, plus the encryption scheme. Everything here is
 * invariant across runs; nothing depends on the random file key.
 */
export function semanticProjection(bytes: Uint8Array, password: string): string {
    const reader = openPdf(bytes, { password });
    const enc = reader.encryption;
    if (enc === null) {
        throw new Error('listed in ENCRYPTED_SAMPLES but the document is not encrypted');
    }

    const pages = [];
    for (let i = 0; i < reader.pageCount; i++) {
        const page: ParsedDict = reader.getPage(i);
        pages.push({
            index: i,
            mediaBox: showValue(reader, page.get('MediaBox')),
            trimBox: showValue(reader, page.get('TrimBox')),
            bleedBox: showValue(reader, page.get('BleedBox')),
            rotate: showValue(reader, page.get('Rotate')),
            annotations: reader.getAnnotations(i).length,
        });
    }

    const info = reader.getInfo();
    const infoOut: Record<string, unknown> = {};
    if (info) {
        // /CreationDate and /ModDate are pinned, so they are safe to hash.
        for (const key of [...info.keys()].sort()) infoOut[key] = showValue(reader, info.get(key));
    }

    return canonicalJson({
        pageCount: reader.pageCount,
        encryption: { algorithm: enc.algorithm, revision: enc.revision },
        info: infoOut,
        pageLabels: reader.getPageLabels(),
        pages,
        text: extractText(bytes, { password }).map(p => p.text),
    });
}

/** Fingerprint one sample. `rel` selects the mode via {@link ENCRYPTED_SAMPLES}. */
export function fingerprint(absPath: string, rel: string): Fingerprint {
    const bytes = readFileSync(absPath);
    const password = ENCRYPTED_SAMPLES[rel];
    if (password === undefined) {
        return { mode: 'bytes', hash: sha256Hex(bytes), size: bytes.length };
    }
    return { mode: 'semantic', hash: sha256Hex(semanticProjection(bytes, password)), size: bytes.length };
}

export interface FingerprintRun {
    readonly entries: Record<string, Fingerprint>;
    readonly unreadable: { readonly path: string; readonly error: string }[];
    /** Paths listed in {@link ENCRYPTED_SAMPLES} that were not generated. */
    readonly missingEncrypted: string[];
}

/** Fingerprint every sample currently in `test-output/`. */
export function fingerprintAll(): FingerprintRun {
    const entries: Record<string, Fingerprint> = {};
    const unreadable: { path: string; error: string }[] = [];
    for (const file of walkPdfs(OUTPUT_DIR)) {
        const rel = relPath(file);
        try {
            entries[rel] = fingerprint(file, rel);
        } catch (err) {
            unreadable.push({ path: rel, error: err instanceof Error ? err.message : String(err) });
        }
    }
    const missingEncrypted = Object.keys(ENCRYPTED_SAMPLES).filter(p => !(p in entries));
    return { entries, unreadable, missingEncrypted };
}

export function loadBaseline(): Baseline | null {
    if (!existsSync(BASELINE_PATH)) return null;
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
}

export interface Comparison {
    readonly changed: string[];
    readonly added: string[];
    readonly removed: string[];
}

export function compareToBaseline(entries: Record<string, Fingerprint>, baseline: Baseline): Comparison {
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    for (const [rel, entry] of Object.entries(entries)) {
        const base = baseline.entries[rel];
        if (!base) { added.push(rel); continue; }
        if (base.mode !== entry.mode || base.hash !== entry.hash) changed.push(rel);
    }
    for (const rel of Object.keys(baseline.entries)) {
        if (!(rel in entries)) removed.push(rel);
    }
    return { changed, added, removed };
}

/**
 * Stamp each fingerprint with the release whose output it is.
 *
 * An entry that still hashes to what the previous manifest recorded keeps its
 * `since` untouched, which is what gives the chain meaning: an entry reading
 * `1.7.0` really is being held to the bytes v1.7.0 emitted. An entry whose
 * hash changed is being re-anchored to the tree under development, so it
 * takes the current version — otherwise a deliberate rebaseline would hide
 * inside a one-line hash diff instead of announcing itself.
 *
 * @since 1.8.0
 */
export function chainSince(
    entries: Record<string, Fingerprint>,
    previous: Baseline | null,
    version: string,
): Record<string, BaselineEntry> {
    const out: Record<string, BaselineEntry> = {};
    for (const key of Object.keys(entries).sort()) {
        const before = previous?.entries[key];
        const unchanged = before !== undefined
            && before.mode === entries[key].mode
            && before.hash === entries[key].hash;
        out[key] = { ...entries[key], since: unchanged ? before.since : version };
    }
    return out;
}
