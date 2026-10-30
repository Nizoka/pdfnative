#!/usr/bin/env tsx
/**
 * pdfnative — compat-previous: the previous release's own test suite,
 * run against the current sources (v1.9.0)
 * ==================================================================
 * The zero-breaking-change policy (SECURITY.md §Compatibility promise) is
 * proven mechanically in two halves: `tests/tools/api-compat.test.ts` checks
 * that every export, diagnostic code and build-error message of the previous
 * release still exists with the same kind and signature, and THIS script
 * checks that the previous release's behaviour still holds — by running its
 * test suite, exactly as it was tagged, against today's `src/`.
 *
 * What it does:
 *   1. `git archive <tag> tests recipes vitest.config.ts` into
 *      `test-output/.compat/<version>/` (git-ignored; a dot-directory, which
 *      the sample walkers skip, removed again when the run ends unless
 *      `--keep`);
 *   2. copies the current `src/`, `fonts/`, `scripts/` and `tools/` next to
 *      it (and the root tsconfigs `scripts/tsconfig.json` extends), so the
 *      archived tests' relative imports (`../../src/…`, `../../fonts/…`,
 *      `../../scripts/…`) and the archived config's `pdfnative` alias
 *      resolve to the sources under test;
 *   3. runs vitest in that directory with the archived configuration,
 *      excluding the files listed in `tests/compat/allow-<version>.json` —
 *      each with a reason and, for a behaviour change, the compatibility
 *      ledger entry (C1…Cn in the release note) that justifies it.
 *
 * Exit code: vitest's (0 green, 1 red), 2 on usage or git failure — among
 * them a tag that is not available locally, named with the fetch command,
 * so that the gate's `--require-all` reports the cause rather than an opaque
 * failure.
 *
 * Usage:
 *   npx tsx scripts/run-compat.ts                 # tag from tests/compat/allow-*.json
 *   npx tsx scripts/run-compat.ts --tag v1.8.0
 *   npx tsx scripts/run-compat.ts --list          # print the exclusions and exit
 *   npx tsx scripts/run-compat.ts --keep          # leave test-output/.compat/<version> behind for inspection
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

/** The current trees the archived suite imports, besides its own files. */
const CURRENT_TREES = ['src', 'fonts', 'scripts', 'tools'] as const;
/** Root files the copied trees reach for: scripts/tsconfig.json extends ../tsconfig.scripts.json. */
const CURRENT_FILES = ['tsconfig.json', 'tsconfig.scripts.json', 'tsconfig.test.json', 'package.json'] as const;

export interface CompatExclusion {
    /** A vitest include-style glob, relative to the archived tree (e.g. `tests/docs/**`). */
    readonly pattern: string;
    /** Why this file of the previous suite cannot run against the current sources. */
    readonly reason: string;
    /** The release note's compatibility-ledger entry (`C1`…) when the reason is a behaviour change. */
    readonly ledger?: string;
}

export interface CompatAllowList {
    readonly tag: string;
    readonly exclude: readonly CompatExclusion[];
}

/** The newest `tests/compat/allow-<version>.json` — the previous release's. */
export function findAllowList(root: string): string | null {
    const dir = join(root, 'tests', 'compat');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => /^allow-\d+\.\d+\.\d+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return files.length === 0 ? null : join(dir, files[files.length - 1]);
}

export function parseAllowList(text: string): CompatAllowList {
    const parsed = JSON.parse(text) as { tag?: unknown; exclude?: unknown };
    if (typeof parsed.tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(parsed.tag)) throw new Error('allow-list: "tag" must be a vX.Y.Z string');
    if (!Array.isArray(parsed.exclude)) throw new Error('allow-list: "exclude" must be an array');
    for (const e of parsed.exclude as Array<Record<string, unknown>>) {
        if (typeof e.pattern !== 'string' || e.pattern === '') throw new Error('allow-list: every exclusion needs a "pattern"');
        if (typeof e.reason !== 'string' || e.reason.length < 20) throw new Error(`allow-list: ${String(e.pattern)} needs a "reason" (a sentence, not a word)`);
        if (e.ledger !== undefined && (typeof e.ledger !== 'string' || !/^C\d+$/.test(e.ledger))) throw new Error(`allow-list: ${e.pattern} ledger must look like "C3"`);
    }
    return { tag: parsed.tag, exclude: parsed.exclude as CompatExclusion[] };
}

/** Whether `tag` resolves to a commit in this clone (the gate's skip condition). */
export function tagAvailable(root: string, tag: string): boolean {
    return git(['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { cwd: root }).status === 0;
}

function git(args: string[], options: { cwd?: string } = {}): { status: number | null; stdout: Buffer; stderr: string } {
    const r = spawnSync('git', args, { cwd: options.cwd ?? ROOT, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), stderr: r.stderr?.toString('utf8') ?? '' };
}

function main(): number {
    const args = process.argv.slice(2);
    const tagArg = args.indexOf('--tag');
    const listOnly = args.includes('--list');

    const allowPath = findAllowList(ROOT);
    if (allowPath === null) {
        process.stderr.write('run-compat: no tests/compat/allow-<version>.json — nothing to check against\n');
        return 2;
    }
    const allow = parseAllowList(readFileSync(allowPath, 'utf8'));
    const tag = tagArg >= 0 ? (args[tagArg + 1] ?? '') : allow.tag;
    if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
        process.stderr.write(`run-compat: tag "${tag}" is not of the form vX.Y.Z\n`);
        return 2;
    }
    if (listOnly) {
        process.stdout.write(`compat-previous: ${tag} suite against the current sources; exclusions from ${allowPath}:\n`);
        for (const e of allow.exclude) process.stdout.write(`  ${e.pattern.padEnd(48)} ${e.ledger ? `[${e.ledger}] ` : ''}${e.reason}\n`);
        return 0;
    }

    if (!tagAvailable(ROOT, tag)) {
        process.stderr.write(`run-compat: tag ${tag} is not available — fetch it first (git fetch --no-tags origin +refs/tags/${tag}:refs/tags/${tag})\n`);
        return 2;
    }

    const version = tag.slice(1);
    const dir = join(ROOT, 'test-output', '.compat', version);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // 1. The archived tree: `git archive` writes a tar; extract it with the
    //    platform's tar (present on every GitHub runner and on Windows 10+).
    const archive = git(['archive', '--format=tar', tag, 'tests', 'recipes', 'vitest.config.ts']);
    if (archive.status !== 0) {
        process.stderr.write(`run-compat: git archive ${tag} failed — ${archive.stderr.trim()}\n`);
        return 2;
    }
    // Extract from inside the target directory: Git for Windows' tar reads a
    // `D:\…` argument to -C as a remote host.
    const untar = spawnSync('tar', ['-x', '-f', '-'], { cwd: dir, input: archive.stdout, windowsHide: true });
    if (untar.status !== 0) {
        process.stderr.write(`run-compat: tar extraction failed — ${untar.stderr?.toString('utf8').trim() ?? ''}\n`);
        return 2;
    }

    // 2. The sources under test, where the archived tests expect them.
    for (const tree of CURRENT_TREES) cpSync(join(ROOT, tree), join(dir, tree), { recursive: true });
    for (const file of CURRENT_FILES) cpSync(join(ROOT, file), join(dir, file));

    // 3. The archived suite with the archived configuration, minus the allow-list.
    const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
    if (!existsSync(vitest)) {
        process.stderr.write('run-compat: node_modules/vitest/vitest.mjs is missing — npm ci first\n');
        return 2;
    }
    const vitestArgs = ['run', '--config', 'vitest.config.ts'];
    for (const e of allow.exclude) vitestArgs.push('--exclude', e.pattern);
    process.stdout.write(`compat-previous: ${tag} suite (${allow.exclude.length} exclusion${allow.exclude.length === 1 ? '' : 's'}) against the current src/ in ${dir}\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: 'UTC' };
    delete env.GATE; // the archived config would otherwise write its JSON report over the gate's
    const r = spawnSync(process.execPath, [vitest, ...vitestArgs], { cwd: dir, stdio: 'inherit', env, windowsHide: true });
    // Left behind, the archived fixtures and the copied trees would be
    // walked by every sample and docs walker that does not skip dot-dirs.
    if (!args.includes('--keep')) rmSync(dir, { recursive: true, force: true });
    return r.status ?? 1;
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
    process.exit(main());
}
