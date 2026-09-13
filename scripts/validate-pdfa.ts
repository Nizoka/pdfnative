#!/usr/bin/env tsx
/**
 * pdfnative — veraPDF batch validation runner
 * =============================================
 * Validates every generated sample PDF that claims PDF/A conformance against
 * the official veraPDF reference validator (https://verapdf.org).
 *
 * Usage:
 *   npm run validate:pdfa                          # PASS/FAIL per file at a terminal
 *   npx tsx scripts/validate-pdfa.ts --quiet      # failures + the one-line footer
 *   npx tsx scripts/validate-pdfa.ts --verbose    # per-file lines, even through a pipe
 *   npx tsx scripts/validate-pdfa.ts --json       # { claimed, compliant, failures: [{ file, profile, rules }] }
 *
 * Quiet is the default when stdout is not a terminal (CI, `scripts/gate.ts`,
 * an agent capturing the output).
 *
 * Requirements:
 *   - veraPDF CLI on $PATH OR `VERAPDF_HOME` env var pointing at a veraPDF install.
 *   - Run `npm run test:generate` first to populate `test-output/`.
 *
 * Exit codes:
 *   0 — all PDF/A-claiming files pass; or veraPDF is not available (skip).
 *   1 — one or more files claim PDF/A in XMP but fail validation, or the
 *       number of detected PDF/A-claiming samples does not match
 *       `declared.pdfaSamples` in docs/assets/ecosystem.json (coverage
 *       canary: a silent drop in claim detection or sample generation must
 *       fail loudly, and a new PDF/A-claiming sample must bump the counter).
 *   2 — veraPDF is installed but could not run (broken Java), or bad usage.
 *
 * Skipping veraPDF locally:
 *   If `verapdf` is missing this script prints install instructions and exits
 *   with code 0 — it never blocks local development. CI installs veraPDF so
 *   this script becomes blocking on PRs (see .github/workflows/verapdf.yml).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { parseOutputMode, type OutputMode } from './helpers/io.js';

// ── Locate veraPDF CLI ──────────────────────────────────────────────

function locateVeraPdf(): string | null {
    const home = process.env.VERAPDF_HOME;
    if (home) {
        const candidates = [
            join(home, 'verapdf'),
            join(home, 'verapdf.bat'),
            join(home, 'bin', 'verapdf'),
            join(home, 'bin', 'verapdf.bat'),
        ];
        for (const c of candidates) {
            if (existsSync(c)) return c;
        }
    }
    // Probe PATH
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['verapdf'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout) {
        return probe.stdout.trim().split(/\r?\n/)[0];
    }
    return null;
}

// ── Discover sample PDFs ────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) yield* walk(p);
        else if (entry.endsWith('.pdf')) yield p;
    }
}

interface Claim {
    readonly part: number;
    readonly conformance: string;
    readonly profile: string;
}

/**
 * Detect PDF/A claim by searching XMP metadata for `pdfaid:part` / conformance.
 * Returns null if the file does not claim PDF/A (skip validation).
 */
function detectPdfAClaim(file: string): Claim | null {
    const buf = readFileSync(file);
    const txt = buf.toString('latin1');
    const part = txt.match(/<pdfaid:part>(\d)<\/pdfaid:part>/)?.[1];
    const conf = txt.match(/<pdfaid:conformance>([A-Z])<\/pdfaid:conformance>/)?.[1];
    if (!part || !conf) return null;
    const partN = Number.parseInt(part, 10);
    const confL = conf.toLowerCase();
    return {
        part: partN,
        conformance: conf,
        profile: `${partN}${confL}`,
    };
}

// ── veraPDF invocation ──────────────────────────────────────────────

interface ValidationResult {
    readonly file: string;
    readonly profile: string;
    readonly compliant: boolean;
    readonly failedRules: readonly string[];
    /**
     * Set when veraPDF could not run at all (rather than running and
     * rejecting the file) — a broken Java runtime, a missing plugin, a
     * corrupt install. Without this, every file reports FAIL with no rules
     * listed, which reads as "the library broke PDF/A" when in fact nothing
     * was validated.
     */
    readonly infraError?: string;
}

function validateFile(verapdf: string, file: string, profile: string): ValidationResult {
    // veraPDF prints XML to stdout; non-zero exit codes happen on infra failure,
    // not on validation failure. Always parse XML.
    // Windows: a .bat/.cmd cannot be spawned without a shell (Node throws
    // EINVAL since the CVE-2024-27980 hardening) — quote every argument
    // ourselves because shell mode performs no escaping.
    const isBatch = /\.(bat|cmd)$/i.test(verapdf);
    const quote = (s: string): string => (isBatch ? `"${s}"` : s);
    let xml: string;
    let stderr = '';
    try {
        xml = execFileSync(quote(verapdf), ['--format', 'xml', '--flavour', profile, quote(file)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: isBatch,
        });
    } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        xml = e.stdout ?? '';
        stderr = (e.stderr ?? e.message ?? '').trim();
    }

    // No report element at all means veraPDF never validated anything.
    // Distinguish that from a genuine rejection, which always emits a report.
    if (!/<report|<validationReport|isCompliant=/i.test(xml)) {
        return {
            file,
            profile,
            compliant: false,
            failedRules: [],
            infraError: stderr || 'veraPDF produced no validation report',
        };
    }

    const compliant = /isCompliant="true"/i.test(xml);
    const failedRules = Array.from(xml.matchAll(/<rule[^>]*specification="[^"]*"[^>]*clause="([^"]+)"[^>]*testNumber="([^"]+)"[^>]*status="failed"/gi))
        .map(m => `${m[1]} t${m[2]}`);
    return { file, profile, compliant, failedRules };
}

// ── Main ─────────────────────────────────────────────────────────────

function printMissingVeraPdfHelp(): void {
    const lines = [
        'veraPDF CLI not found.',
        '',
        '  pdfnative does not bundle a validator (zero-dependency policy).',
        '  Install veraPDF locally to validate PDF/A claims, or use the',
        '  online demo at https://demo.verapdf.org for a one-off check.',
        '',
        '  Install hints:',
        '    macOS    : brew install --cask verapdf',
        '    Linux    : https://docs.verapdf.org/install/ → download zip → java -jar installer',
        '    Windows  : https://docs.verapdf.org/install/ (GUI installer) or Chocolatey/Scoop',
        '',
        '  After install, expose it via PATH or set VERAPDF_HOME to the',
        '  install directory (the one containing `verapdf` or `verapdf.bat`).',
        '',
        '  See docs/guides/pdfa.html for a full walkthrough.',
        '',
        '  Skipping validation (exit 0).',
    ];
    for (const l of lines) process.stderr.write(`${l}\n`);
}

interface Failure {
    readonly file: string;
    readonly profile: string;
    readonly rules: readonly string[];
}

/** The `--json` document. `error` is set when nothing (or not everything) was validated. */
interface JsonReport {
    readonly claimed: number;
    readonly compliant: number;
    readonly failures: readonly Failure[];
    readonly veraPdf: string | null;
    readonly error?: string;
}

function emitJson(report: JsonReport): void {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main(mode: OutputMode): number {
    // Progress chatter goes to stderr and only when a human is watching.
    const progress = (line: string): void => { if (!mode.quiet) process.stderr.write(`${line}\n`); };
    // Diagnostics that explain a non-zero exit are always shown, unless --json owns stdout.
    const explain = (text: string): void => { if (!mode.json) process.stderr.write(text); };

    const verapdf = locateVeraPdf();
    if (!verapdf) {
        if (mode.json) {
            emitJson({ claimed: 0, compliant: 0, failures: [], veraPdf: null, error: 'veraPDF not installed' });
        } else if (mode.quiet) {
            process.stderr.write('veraPDF CLI not found — skipping PDF/A validation (exit 0).\n');
        } else {
            printMissingVeraPdfHelp();
        }
        return 0;
    }
    progress(`Using veraPDF: ${verapdf}`);

    const root = resolve(process.cwd(), 'test-output');
    const claimed: Array<[string, Claim]> = [];
    let totalSeen = 0;
    for (const f of walk(root)) {
        totalSeen++;
        const claim = detectPdfAClaim(f);
        if (claim) claimed.push([f, claim]);
    }
    const skipped = totalSeen - claimed.length;
    if (totalSeen === 0) {
        if (mode.json) {
            emitJson({ claimed: 0, compliant: 0, failures: [], veraPdf: verapdf, error: 'test-output/ is empty' });
        } else {
            process.stderr.write('No PDFs found in test-output/. Run `npm run test:generate` first.\n');
        }
        return 0;
    }

    progress(`Scanned ${totalSeen} PDF(s); ${claimed.length} claim PDF/A, ${skipped} skipped (not PDF/A).`);

    // Coverage canary: the ecosystem manifest declares how many samples
    // claim PDF/A. A mismatch means either a new claiming sample was added
    // (bump `declared.pdfaSamples`) or claim detection / sample generation
    // silently regressed — both must fail loudly rather than shrink the
    // validated corpus unnoticed.
    const manifest = JSON.parse(
        readFileSync(resolve(process.cwd(), 'docs', 'assets', 'ecosystem.json'), 'utf8'),
    ) as { declared?: { pdfaSamples?: number } };
    const expected = manifest.declared?.pdfaSamples;
    if (typeof expected === 'number' && claimed.length !== expected) {
        const why = `Coverage canary: detected ${claimed.length} PDF/A-claiming sample(s) but `
            + `docs/assets/ecosystem.json declares pdfaSamples: ${expected}.`;
        if (mode.json) {
            emitJson({ claimed: claimed.length, compliant: 0, failures: [], veraPdf: verapdf, error: why });
        } else {
            explain(
                `\n${why}\n`
                + 'Added or removed a PDF/A-claiming sample? Update declared.pdfaSamples.\n'
                + 'Neither added nor removed one? Claim detection or sample generation regressed.\n',
            );
        }
        return 1;
    }

    progress(`Validating ${claimed.length} PDF/A-claiming file(s)…`);

    const failures: Failure[] = [];
    for (const [file, claim] of claimed) {
        const rel = relative(process.cwd(), file).replace(/\\/g, '/');
        const result = validateFile(verapdf, file, claim.profile);
        if (result.infraError !== undefined) {
            // Abort rather than mark every remaining file FAIL: nothing was
            // validated, so reporting failures would be actively misleading.
            if (mode.json) {
                emitJson({
                    claimed: claimed.length, compliant: 0, failures: [], veraPdf: verapdf,
                    error: `veraPDF could not run: ${result.infraError}`,
                });
            } else {
                explain(
                    `\nveraPDF could not run — no file was validated.\n\n`
                    + `  ${result.infraError.split('\n').join('\n  ')}\n\n`
                    + '  Most often a broken Java runtime: veraPDF needs a working JRE/JDK on\n'
                    + '  PATH, and JAVA_HOME must point at one that still exists. Check with\n'
                    + '  `java -version`, then re-run.\n',
                );
            }
            return 2;
        }
        if (result.compliant) {
            if (!mode.quiet) process.stdout.write(`  PASS  [${claim.profile}]  ${rel}\n`);
            continue;
        }
        const rules = Array.from(new Set(result.failedRules));
        failures.push({ file: rel, profile: claim.profile, rules });
        if (mode.json) continue;
        if (mode.quiet) {
            // One line per failure: the first rules inline, so the log
            // tail that scripts/gate.ts prints already says what broke.
            const shown = rules.slice(0, 3).join(', ');
            const more = rules.length > 3 ? ` (+${rules.length - 3} more)` : '';
            process.stdout.write(`FAIL  [${claim.profile}]  ${rel} — ${shown}${more}\n`);
        } else {
            process.stdout.write(`  FAIL  [${claim.profile}]  ${rel}\n`);
            for (const rule of rules.slice(0, 5)) process.stdout.write(`        - ${rule}\n`);
            if (rules.length > 5) process.stdout.write(`        … (${rules.length - 5} more)\n`);
        }
    }

    const compliant = claimed.length - failures.length;
    if (mode.json) {
        emitJson({ claimed: claimed.length, compliant, failures, veraPdf: verapdf });
    } else if (mode.quiet) {
        process.stdout.write(`${compliant}/${claimed.length} PDF/A-claiming samples compliant\n`);
    } else {
        process.stderr.write(`\n${compliant}/${claimed.length} compliant (${skipped} non-PDF/A files skipped).\n`);
    }
    return failures.length === 0 ? 0 : 1;
}

const mode = parseOutputMode(process.argv.slice(2));
if ('error' in mode) {
    process.stderr.write(`${mode.error}\n`);
    process.exit(2);
}
process.exit(main(mode));
