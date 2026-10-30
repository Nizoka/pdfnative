#!/usr/bin/env tsx
/**
 * pdfnative — conformance-claim validation runner
 * =================================================
 * Validates every generated sample PDF that claims a conformance level:
 *   - PDF/A (`pdfaid:part` / `pdfaid:conformance` in XMP) against the official
 *     veraPDF reference validator (https://verapdf.org), flavour 1b/2b/2u/3b;
 *   - PDF/X (`pdfxid:GTS_PDFXVersion` in XMP) against pdfnative's own structural
 *     validator `validatePdfX()` (src/parser/pdf-x-validator.ts) — veraPDF covers
 *     PDF/A and PDF/UA, never PDF/X, and the project bundles no other tool.
 * A file with both claims (the PDF/A-2 + PDF/X-4 dual claim) goes through both.
 *
 * Usage:
 *   npm run validate:pdfa                          # PASS/FAIL per file at a terminal
 *   npx tsx scripts/validate-pdfa.ts --quiet      # failures + the one-line footer
 *   npx tsx scripts/validate-pdfa.ts --verbose    # per-file lines, even through a pipe
 *   npx tsx scripts/validate-pdfa.ts --json       # { claimed, compliant, failures: [{ file, profile, rules }], pdfx: { claimed, valid, failures } }
 *
 * Quiet is the default when stdout is not a terminal (CI, `scripts/gate.ts`,
 * an agent capturing the output).
 *
 * Requirements:
 *   - veraPDF CLI on $PATH OR `VERAPDF_HOME` env var pointing at a veraPDF install.
 *   - Run `npm run test:generate` first to populate `test-output/`.
 *
 * Exit codes:
 *   0 — every PDF/X-claiming file is valid and every PDF/A-claiming file
 *       passes; or veraPDF is not available (the PDF/A pass is skipped, the
 *       PDF/X pass still runs and still decides the exit code).
 *   1 — a file claims PDF/A or PDF/X in XMP but fails its validation, or the
 *       number of detected claiming samples does not match
 *       `declared.pdfaSamples` / `declared.pdfxSamples` in
 *       docs/assets/ecosystem.json (coverage canary: a silent drop in claim
 *       detection or sample generation must fail loudly, and a new claiming
 *       sample must bump the counter).
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
import { validatePdfX } from '../src/parser/pdf-x-validator.js';

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

/** A PDF/X claim (`pdfxid:GTS_PDFXVersion`) and the profile label shown for it. */
interface PdfXClaim {
    readonly version: string;
    readonly profile: string;
}

/**
 * Detect PDF/A claim by searching XMP metadata for `pdfaid:part` / conformance,
 * written as XMP elements (what pdfnative emits) or as attributes of the
 * description element (the other form ISO 16684-1 allows, which a modifier
 * or another producer may have written). Returns null if the file does not
 * claim PDF/A (skip validation). XMP is never compressed, so the raw bytes
 * carry the claim as text.
 */
function detectPdfAClaim(file: string): Claim | null {
    const buf = readFileSync(file);
    const txt = buf.toString('latin1');
    const part = txt.match(/<pdfaid:part>(\d)<\/pdfaid:part>/)?.[1] ?? txt.match(/\bpdfaid:part="(\d)"/)?.[1];
    const conf = txt.match(/<pdfaid:conformance>([A-Z])<\/pdfaid:conformance>/)?.[1] ?? txt.match(/\bpdfaid:conformance="([A-Z])"/)?.[1];
    if (!part || !conf) return null;
    const partN = Number.parseInt(part, 10);
    const confL = conf.toLowerCase();
    return {
        part: partN,
        conformance: conf,
        profile: `${partN}${confL}`,
    };
}

/**
 * Detect a PDF/X claim: `pdfxid:GTS_PDFXVersion` as an XMP element or an
 * attribute. The profile label is the version in short form (`PDF/X-4` →
 * `x4`), the counterpart of veraPDF's `2b`.
 */
function detectPdfXClaim(file: string): PdfXClaim | null {
    const txt = readFileSync(file).toString('latin1');
    const version = txt.match(/<pdfxid:GTS_PDFXVersion>([^<]+)<\/pdfxid:GTS_PDFXVersion>/)?.[1]
        ?? txt.match(/\bpdfxid:GTS_PDFXVersion="([^"]+)"/)?.[1];
    if (!version) return null;
    return { version, profile: version.replace(/^PDF\/X-?/i, 'x').toLowerCase() };
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

interface PdfXFailure {
    readonly file: string;
    readonly errors: readonly string[];
}

/** The PDF/X half of the report: `validatePdfX()` over every `pdfxid` claim. */
interface PdfXReport {
    readonly claimed: number;
    readonly valid: number;
    readonly failures: readonly PdfXFailure[];
}

/** The `--json` document. `error` is set when nothing (or not everything) was validated. */
interface JsonReport {
    readonly claimed: number;
    readonly compliant: number;
    readonly failures: readonly Failure[];
    readonly veraPdf: string | null;
    readonly pdfx?: PdfXReport;
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

    const root = resolve(process.cwd(), 'test-output');
    const claimed: Array<[string, Claim]> = [];
    const pdfxClaimed: Array<[string, PdfXClaim]> = [];
    let totalSeen = 0;
    for (const f of walk(root)) {
        totalSeen++;
        const claim = detectPdfAClaim(f);
        if (claim) claimed.push([f, claim]);
        const x = detectPdfXClaim(f);
        if (x) pdfxClaimed.push([f, x]);
    }
    const skipped = totalSeen - claimed.length;
    if (totalSeen === 0) {
        if (mode.json) {
            emitJson({ claimed: 0, compliant: 0, failures: [], veraPdf: null, error: 'test-output/ is empty' });
        } else {
            process.stderr.write('No PDFs found in test-output/. Run `npm run test:generate` first.\n');
        }
        return 0;
    }

    progress(`Scanned ${totalSeen} PDF(s); ${claimed.length} claim PDF/A, ${pdfxClaimed.length} claim PDF/X, ${skipped} skipped (not PDF/A).`);

    // Coverage canaries: the ecosystem manifest declares how many samples
    // claim PDF/A and how many claim PDF/X. A mismatch means either a new
    // claiming sample was added (bump `declared.pdfaSamples` /
    // `declared.pdfxSamples`) or claim detection / sample generation
    // silently regressed — both must fail loudly rather than shrink the
    // validated corpus unnoticed.
    const manifest = JSON.parse(
        readFileSync(resolve(process.cwd(), 'docs', 'assets', 'ecosystem.json'), 'utf8'),
    ) as { declared?: { pdfaSamples?: number; pdfxSamples?: number } };
    const canaries: Array<[number, number | undefined, string, string]> = [
        [claimed.length, manifest.declared?.pdfaSamples, 'pdfaSamples', 'PDF/A'],
        [pdfxClaimed.length, manifest.declared?.pdfxSamples, 'pdfxSamples', 'PDF/X'],
    ];
    for (const [detected, expected, key, label] of canaries) {
        if (typeof expected !== 'number' || detected === expected) continue;
        const why = `Coverage canary: detected ${detected} ${label}-claiming sample(s) but `
            + `docs/assets/ecosystem.json declares ${key}: ${expected}.`;
        if (mode.json) {
            emitJson({ claimed: claimed.length, compliant: 0, failures: [], veraPdf: null, error: why });
        } else {
            explain(
                `\n${why}\n`
                + `Added or removed a ${label}-claiming sample? Update declared.${key}.\n`
                + 'Neither added nor removed one? Claim detection or sample generation regressed.\n',
            );
        }
        return 1;
    }

    // ── PDF/X pass — pdfnative's own structural validator ──────────────
    // veraPDF covers PDF/A and PDF/UA, never PDF/X (ISO 15930), so a
    // `pdfxid:GTS_PDFXVersion` claim is held to `validatePdfX()`: the same
    // check the print guide offers to callers, run here over every sample
    // that makes the claim. It needs no external tool, so it runs — and
    // fails the step — whether or not veraPDF is installed.
    progress(`Validating ${pdfxClaimed.length} PDF/X-claiming file(s) with validatePdfX()…`);
    const pdfxFailures: PdfXFailure[] = [];
    for (const [file, claim] of pdfxClaimed) {
        const rel = relative(process.cwd(), file).replace(/\\/g, '/');
        const result = validatePdfX(new Uint8Array(readFileSync(file)));
        if (result.valid) {
            if (!mode.quiet) process.stdout.write(`  PASS  [${claim.profile}]  ${rel}\n`);
            continue;
        }
        pdfxFailures.push({ file: rel, errors: result.errors });
        if (mode.json) continue;
        if (mode.quiet) {
            const shown = result.errors.slice(0, 3).join(' | ');
            const more = result.errors.length > 3 ? ` (+${result.errors.length - 3} more)` : '';
            process.stdout.write(`FAIL  [${claim.profile}]  ${rel} — ${shown}${more}\n`);
        } else {
            process.stdout.write(`  FAIL  [${claim.profile}]  ${rel}\n`);
            for (const e of result.errors.slice(0, 5)) process.stdout.write(`        - ${e}\n`);
            if (result.errors.length > 5) process.stdout.write(`        … (${result.errors.length - 5} more)\n`);
        }
    }
    const pdfx: PdfXReport = { claimed: pdfxClaimed.length, valid: pdfxClaimed.length - pdfxFailures.length, failures: pdfxFailures };
    const pdfxFooter = `${pdfx.valid}/${pdfx.claimed} PDF/X-claiming samples valid (validatePdfX)`;

    // ── PDF/A pass — veraPDF ───────────────────────────────────────────
    const verapdf = locateVeraPdf();
    if (!verapdf) {
        if (mode.json) {
            emitJson({ claimed: claimed.length, compliant: 0, failures: [], veraPdf: null, pdfx, error: 'veraPDF not installed' });
        } else if (mode.quiet) {
            process.stdout.write(`${pdfxFooter}\n`);
            process.stderr.write('veraPDF CLI not found — skipping PDF/A validation (exit 0).\n');
        } else {
            process.stderr.write(`\n${pdfxFooter}\n`);
            printMissingVeraPdfHelp();
        }
        return pdfxFailures.length === 0 ? 0 : 1;
    }
    progress(`Using veraPDF: ${verapdf}`);
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
                    claimed: claimed.length, compliant: 0, failures: [], veraPdf: verapdf, pdfx,
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
        emitJson({ claimed: claimed.length, compliant, failures, veraPdf: verapdf, pdfx });
    } else if (mode.quiet) {
        process.stdout.write(`${compliant}/${claimed.length} PDF/A-claiming samples compliant\n${pdfxFooter}\n`);
    } else {
        process.stderr.write(`\n${compliant}/${claimed.length} compliant (${skipped} non-PDF/A files skipped); ${pdfxFooter}.\n`);
    }
    return failures.length === 0 && pdfxFailures.length === 0 ? 0 : 1;
}

const mode = parseOutputMode(process.argv.slice(2));
if ('error' in mode) {
    process.stderr.write(`${mode.error}\n`);
    process.exit(2);
}
process.exit(main(mode));
