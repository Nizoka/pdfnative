#!/usr/bin/env tsx
/**
 * pdfnative — veraPDF batch validation runner
 * =============================================
 * Validates every generated sample PDF that claims PDF/A conformance against
 * the official veraPDF reference validator (https://verapdf.org).
 *
 * Usage:
 *   npm run validate:pdfa
 *
 * Requirements:
 *   - veraPDF CLI on $PATH OR `VERAPDF_HOME` env var pointing at a veraPDF install.
 *   - Run `npm run test:generate` first to populate `test-output/`.
 *
 * Exit codes:
 *   0 — all PDF/A-claiming files pass; or veraPDF is not available (skip).
 *   1 — one or more files claim PDF/A in XMP but fail validation.
 *
 * Skipping veraPDF locally:
 *   If `verapdf` is missing this script prints install instructions and exits
 *   with code 0 — it never blocks local development. CI installs veraPDF so
 *   this script becomes blocking on PRs (see .github/workflows/verapdf.yml).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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
}

function validateFile(verapdf: string, file: string, profile: string): ValidationResult {
    // veraPDF prints XML to stdout; non-zero exit codes happen on infra failure,
    // not on validation failure. Always parse XML.
    let xml: string;
    try {
        xml = execFileSync(verapdf, ['--format', 'xml', '--flavour', profile, file], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (err) {
        const e = err as { stdout?: string };
        xml = e.stdout ?? '';
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

function main(): number {
    const verapdf = locateVeraPdf();
    if (!verapdf) {
        printMissingVeraPdfHelp();
        return 0;
    }
    process.stderr.write(`Using veraPDF: ${verapdf}\n`);

    const root = resolve(process.cwd(), 'test-output');
    const claimed: Array<[string, Claim]> = [];
    let totalSeen = 0;
    for (const f of walk(root)) {
        totalSeen++;
        const claim = detectPdfAClaim(f);
        if (claim) claimed.push([f, claim]);
    }
    const skipped = totalSeen - claimed.length;
    if (claimed.length === 0) {
        process.stderr.write('No PDF/A-claiming files found in test-output/.\n');
        if (totalSeen === 0) {
            process.stderr.write('Run `npm run test:generate` first.\n');
        } else {
            process.stderr.write(`Scanned ${totalSeen} PDF(s); none declared pdfaid:part in XMP.\n`);
            process.stderr.write('This is expected for plain ISO 32000-1 documents — they are not\n');
            process.stderr.write('PDF/A and validating them under a PDF/A profile would surface\n');
            process.stderr.write('false positives. See docs/guides/pdfa.html#troubleshooting.\n');
        }
        return 0;
    }

    process.stderr.write(`Scanned ${totalSeen} PDF(s); ${claimed.length} claim PDF/A, ${skipped} skipped (not PDF/A).\n`);
    process.stderr.write(`Validating ${claimed.length} PDF/A-claiming file(s)…\n`);

    let failed = 0;
    for (const [file, claim] of claimed) {
        const rel = relative(process.cwd(), file);
        const result = validateFile(verapdf, file, claim.profile);
        if (result.compliant) {
            process.stdout.write(`  PASS  [${claim.profile}]  ${rel}\n`);
        } else {
            failed++;
            process.stdout.write(`  FAIL  [${claim.profile}]  ${rel}\n`);
            const unique = Array.from(new Set(result.failedRules)).slice(0, 5);
            for (const rule of unique) process.stdout.write(`        - ${rule}\n`);
            if (result.failedRules.length > unique.length) {
                process.stdout.write(`        … (${result.failedRules.length - unique.length} more)\n`);
            }
        }
    }

    process.stderr.write(`\n${claimed.length - failed}/${claimed.length} compliant (${skipped} non-PDF/A files skipped).\n`);
    return failed === 0 ? 0 : 1;
}

process.exit(main());
