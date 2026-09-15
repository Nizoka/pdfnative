#!/usr/bin/env tsx
/**
 * pdfnative — Quality gate (v1.8.0)
 * ===================================
 * The single definition of what "green" means. CI, the contributor docs and
 * the agent instructions all point here instead of each carrying its own
 * list of commands, so the list cannot drift between them.
 *
 * Every step is an existing npm script (plus one inline check that dist/ is
 * complete). The gate runs them in order, captures each one's full output to
 * `test-output/.gate/<id>.log`, and prints ONE line per step — a passing run
 * is under twenty lines, which is what makes it usable from an agent loop
 * where every line of output costs tokens. On the first failure it prints
 * the tail of that step's log and stops.
 *
 * Usage:
 *   npm run gate                     # --ci: everything except the two optional steps
 *   npm run gate:fast                # typecheck, lint, test, verify:docs
 *   npx tsx scripts/gate.ts --publish   # everything, including validate:pdfa and verify:fonts
 *   npx tsx scripts/gate.ts --only lint
 *   npx tsx scripts/gate.ts --from build
 *   npx tsx scripts/gate.ts --ci --json
 *   npx tsx scripts/gate.ts --publish --require-all   # what publish.yml runs
 *
 * (PowerShell swallows a bare `--`, so call the script directly when passing
 * flags rather than `npm run gate -- --fast`; `npm run gate:fast` exists for
 * the common case.)
 *
 * Profiles:
 *   --fast     typecheck:all, lint, test, verify:docs
 *   --ci       every step except validate:pdfa and verify:fonts (default)
 *   --publish  every step; validate:pdfa and verify:fonts SKIP with a reason
 *              when veraPDF or fonts/ttf/ is absent, like the scripts they wrap
 *
 * Flags:
 *   --require-all  a step that would SKIP fails instead, with
 *                  `required by --require-all: <reason>`. CI and the release
 *                  workflow pass it: a runner without veraPDF or without the
 *                  source fonts must go red, never quietly skip a check.
 *
 * Exit codes:
 *   0 — every selected step passed or was skipped with a reason
 *   1 — a step failed (its log tail is printed; the full log is on disk),
 *       or a step would have skipped under --require-all
 *   2 — bad usage
 */

import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(REPO_ROOT, 'test-output', '.gate');
const VITEST_JSON = join(LOG_DIR, 'vitest.json');
const COVERAGE_SUMMARY = join(REPO_ROOT, 'coverage', 'coverage-summary.json');

type Profile = 'fast' | 'ci' | 'publish';

export interface Step {
    readonly id: string;
    /** The npm script this step runs. Absent for the inline `dist-check`. */
    readonly npmScript?: string;
    readonly profiles: readonly Profile[];
    /** Returns a reason to skip the step, or null to run it. */
    readonly skipWhen?: () => string | null;
    /** Extra environment for the child process. */
    readonly env?: Readonly<Record<string, string>>;
    /** In-process check; returns the failure lines, empty when it passes. */
    readonly inline?: () => readonly string[];
    /** A short figure to show next to PASS, read after the step succeeds. */
    readonly note?: () => string | null;
}

// ── Skip conditions ─────────────────────────────────────────────────

/**
 * Mirrors `locateVeraPdf()` in scripts/validate-pdfa.ts, which cannot be
 * imported because that module runs its `main()` at load time.
 */
function veraPdfInstalled(): boolean {
    const home = process.env.VERAPDF_HOME;
    if (home) {
        for (const c of ['verapdf', 'verapdf.bat', join('bin', 'verapdf'), join('bin', 'verapdf.bat')]) {
            if (existsSync(join(home, c))) return true;
        }
    }
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['verapdf'], { encoding: 'utf8' });
    return probe.status === 0 && probe.stdout.trim().length > 0;
}

/**
 * Mirrors the skip condition of scripts/verify-fonts.ts: at least one of the
 * fonts `npm run fonts:download` fetches is present. The subsets and static
 * instances committed to fonts/ttf/ do not count — they are always there.
 */
function sourceFontsPresent(): boolean {
    const ttf = join(REPO_ROOT, 'fonts', 'ttf');
    const manifest = join(REPO_ROOT, 'fonts', 'SOURCES.json');
    if (!existsSync(ttf) || !existsSync(manifest)) return false;
    const { fonts } = JSON.parse(readFileSync(manifest, 'utf8')) as { fonts: Array<{ local: string }> };
    const present = new Set(readdirSync(ttf));
    return fonts.some(f => present.has(f.local));
}

// ── Notes (figures shown next to PASS) ──────────────────────────────

function testCount(): string | null {
    if (!existsSync(VITEST_JSON)) return null;
    // The whole suite, skipped tests included — the figure `declared.tests`
    // in docs/assets/ecosystem.json is held to, identical on a machine with
    // the source fonts downloaded and on CI without them.
    const report = JSON.parse(readFileSync(VITEST_JSON, 'utf8')) as { numTotalTests?: number; numPassedTests?: number };
    const total = report.numTotalTests ?? report.numPassedTests;
    return typeof total === 'number' ? `${total} tests` : null;
}

function coverageFigure(): string | null {
    if (!existsSync(COVERAGE_SUMMARY)) return null;
    const summary = JSON.parse(readFileSync(COVERAGE_SUMMARY, 'utf8')) as {
        total?: { statements?: { pct?: number } };
    };
    const pct = summary.total?.statements?.pct;
    return typeof pct === 'number' ? `${pct.toFixed(1)}% stmts` : null;
}

function joinNotes(...parts: Array<string | null>): string | null {
    const kept = parts.filter((p): p is string => p !== null);
    return kept.length > 0 ? kept.join(', ') : null;
}

// ── The gate ────────────────────────────────────────────────────────

/** Files `npm run build` must leave behind for the package to be complete. */
const DIST_FILES = [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/worker/index.js',
    'dist/tools/index.js',
    'dist/tools/build-emoji-font.js',
] as const;

export const STEPS: readonly Step[] = [
    { id: 'typecheck:all', npmScript: 'typecheck:all', profiles: ['fast', 'ci', 'publish'] },
    { id: 'lint', npmScript: 'lint', profiles: ['fast', 'ci', 'publish'] },
    { id: 'verify:unicode', npmScript: 'verify:unicode', profiles: ['ci', 'publish'] },
    {
        id: 'test', npmScript: 'test', profiles: ['fast'],
        env: { GATE: '1' }, note: testCount,
    },
    {
        id: 'test:coverage', npmScript: 'test:coverage', profiles: ['ci', 'publish'],
        env: { GATE: '1' }, note: () => joinNotes(testCount(), coverageFigure()),
    },
    { id: 'build', npmScript: 'build', profiles: ['ci', 'publish'] },
    {
        id: 'dist-check', profiles: ['ci', 'publish'],
        inline: () => DIST_FILES.filter(f => !existsSync(join(REPO_ROOT, f))).map(f => `missing: ${f}`),
    },
    { id: 'verify:bundle', npmScript: 'verify:bundle', profiles: ['ci', 'publish'] },
    { id: 'verify:docs', npmScript: 'verify:docs', profiles: ['fast', 'ci', 'publish'] },
    { id: 'test:generate', npmScript: 'test:generate', profiles: ['ci', 'publish'] },
    { id: 'verify:samples', npmScript: 'verify:samples', profiles: ['ci', 'publish'] },
    {
        id: 'validate:pdfa', npmScript: 'validate:pdfa', profiles: ['publish'],
        skipWhen: () => (veraPdfInstalled() ? null : 'veraPDF not installed'),
    },
    {
        id: 'verify:fonts', npmScript: 'verify:fonts', profiles: ['publish'],
        skipWhen: () => (sourceFontsPresent() ? null : 'fonts/ttf is absent'),
    },
];

// ── Running a step ──────────────────────────────────────────────────

/**
 * Run an npm script with its stdout and stderr interleaved into one log
 * file. `npm_execpath` is set whenever this script itself was started by
 * npm, and running that CLI under the current node keeps the whole gate on
 * one toolchain; outside npm (a bare `tsx scripts/gate.ts`) fall back to
 * whatever `npm` is on PATH — through a shell, since on Windows that is an
 * `npm.cmd` shim which Node refuses to spawn directly.
 */
function runNpmScript(script: string, logPath: string, extraEnv: Readonly<Record<string, string>>): number {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv, NO_COLOR: '1', FORCE_COLOR: '0' };
    const fd = openSync(logPath, 'w');
    try {
        const npmCli = process.env.npm_execpath;
        const common: SpawnSyncOptions = { cwd: REPO_ROOT, env, stdio: ['ignore', fd, fd], windowsHide: true };
        const result = npmCli && existsSync(npmCli)
            ? spawnSync(process.execPath, [npmCli, 'run', script], common)
            : spawnSync('npm', ['run', script], { ...common, shell: true });
        if (result.error) throw result.error;
        return result.status ?? 1;
    } finally {
        closeSync(fd);
    }
}

function runInline(check: () => readonly string[], logPath: string): number {
    const failures = check();
    const fd = openSync(logPath, 'w');
    try {
        writeSync(fd, failures.length === 0 ? 'ok\n' : `${failures.join('\n')}\n`);
    } finally {
        closeSync(fd);
    }
    return failures.length === 0 ? 0 : 1;
}

function tail(file: string, lines: number): string[] {
    if (!existsSync(file)) return [];
    const all = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
    return all.slice(-lines);
}

// ── CLI ─────────────────────────────────────────────────────────────

interface Options {
    readonly profile: Profile;
    readonly only: string | null;
    readonly from: string | null;
    readonly json: boolean;
    /** Turn every SKIP into a FAIL (CI and the release workflow). */
    readonly requireAll: boolean;
}

function usage(): string {
    return [
        'Usage: npx tsx scripts/gate.ts [--fast | --ci | --publish] [--only <id>] [--from <id>] [--require-all] [--json]',
        '',
        `Steps: ${STEPS.map(s => s.id).join(', ')}`,
    ].join('\n');
}

function parseArgs(argv: readonly string[]): Options | { error: string } {
    let profile: Profile | null = null;
    let only: string | null = null;
    let from: string | null = null;
    let json = false;
    let requireAll = false;
    const ids = new Set(STEPS.map(s => s.id));

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--fast' || a === '--ci' || a === '--publish') {
            const p = a.slice(2) as Profile;
            if (profile !== null && profile !== p) return { error: `--${profile} and ${a} are mutually exclusive` };
            profile = p;
        } else if (a === '--only' || a === '--from') {
            const id = argv[i + 1];
            if (id === undefined || id.startsWith('--')) return { error: `${a} needs a step id` };
            if (!ids.has(id)) return { error: `unknown step "${id}"` };
            if (a === '--only') only = id; else from = id;
            i++;
        } else if (a === '--json') {
            json = true;
        } else if (a === '--require-all') {
            requireAll = true;
        } else {
            return { error: `unknown argument "${a}"` };
        }
    }
    return { profile: profile ?? 'ci', only, from, json, requireAll };
}

interface StepOutcome {
    readonly id: string;
    readonly status: 'pass' | 'fail' | 'skip';
    readonly seconds: number;
    readonly note: string | null;
}

function selectSteps(opts: Options): readonly Step[] {
    if (opts.only !== null) return STEPS.filter(s => s.id === opts.only);
    let selected = STEPS.filter(s => s.profiles.includes(opts.profile));
    if (opts.from !== null) {
        const at = selected.findIndex(s => s.id === opts.from);
        if (at < 0) {
            // The step exists but is not in this profile: run the profile
            // from the position it would occupy in the full table.
            const full = STEPS.findIndex(s => s.id === opts.from);
            selected = selected.filter(s => STEPS.indexOf(s) >= full);
        } else {
            selected = selected.slice(at);
        }
    }
    return selected;
}

function main(): number {
    const parsed = parseArgs(process.argv.slice(2));
    if ('error' in parsed) {
        process.stderr.write(`gate: ${parsed.error}\n${usage()}\n`);
        return 2;
    }
    const opts = parsed;
    const steps = selectSteps(opts);
    const width = Math.max(...STEPS.map(s => s.id.length));
    const say = (line: string): void => { if (!opts.json) process.stdout.write(`${line}\n`); };

    mkdirSync(LOG_DIR, { recursive: true });
    const outcomes: StepOutcome[] = [];
    const startedAt = Date.now();
    say(`gate --${opts.profile}: ${steps.length} step(s)`);

    let failedAt: string | null = null;
    for (const step of steps) {
        const reason = step.skipWhen?.() ?? null;
        if (reason !== null) {
            if (opts.requireAll) {
                const note = `required by --require-all: ${reason}`;
                outcomes.push({ id: step.id, status: 'fail', seconds: 0, note });
                say(`FAIL  ${step.id.padEnd(width)}          ${note}`);
                failedAt = step.id;
                break;
            }
            outcomes.push({ id: step.id, status: 'skip', seconds: 0, note: reason });
            say(`SKIP  ${step.id.padEnd(width)}          (${reason})`);
            continue;
        }

        const logPath = join(LOG_DIR, `${step.id.replace(/[^a-z0-9-]/gi, '-')}.log`);
        // A stale report from an earlier run must never be reported as this run's.
        if (step.env?.GATE === '1') rmSync(VITEST_JSON, { force: true });
        if (step.id === 'test:coverage') rmSync(COVERAGE_SUMMARY, { force: true });

        const t0 = Date.now();
        const status = step.inline
            ? runInline(step.inline, logPath)
            : runNpmScript(step.npmScript ?? step.id, logPath, step.env ?? {});
        const seconds = (Date.now() - t0) / 1000;
        const clock = `${seconds.toFixed(1)}s`.padStart(7);

        if (status === 0) {
            const note = step.note?.() ?? null;
            outcomes.push({ id: step.id, status: 'pass', seconds, note });
            say(`PASS  ${step.id.padEnd(width)}  ${clock}${note ? `  ${note}` : ''}`);
            continue;
        }

        const rel = relative(REPO_ROOT, logPath).replace(/\\/g, '/');
        outcomes.push({ id: step.id, status: 'fail', seconds, note: `exit ${status}; log: ${rel}` });
        say(`FAIL  ${step.id.padEnd(width)}  ${clock}  exit ${status}`);
        for (const line of tail(logPath, 12)) say(`      ${line}`);
        say(`      (full log: ${rel})`);
        failedAt = step.id;
        break;
    }

    const total = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (opts.json) {
        process.stdout.write(`${JSON.stringify({ ok: failedAt === null, profile: opts.profile, steps: outcomes }, null, 2)}\n`);
    } else if (failedAt !== null) {
        process.stdout.write(`gate: failed at ${failedAt}\n`);
    } else {
        const passed = outcomes.filter(o => o.status === 'pass').length;
        const skipped = outcomes.filter(o => o.status === 'skip').length;
        process.stdout.write(`gate: ${passed} passed, ${skipped} skipped in ${total} s\n`);
    }
    return failedAt === null ? 0 : 1;
}

process.exit(main());
