/**
 * I/O helpers for sample PDF generation.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(__dirname, '..', '..', 'test-output');

/**
 * The instant every sample is stamped with.
 *
 * Unencrypted pdfnative output is a pure function of its inputs plus this one
 * date — the trailer `/ID` is an MD5 of title + creation date + object count —
 * so pinning it makes the whole sample suite byte-reproducible and lets
 * `npm run verify:samples` detect regressions by hash. Changing this value
 * invalidates every baseline hash.
 *
 * Reproducibility also requires the process timezone to be UTC, because PDF
 * dates carry a local offset — see `scripts/helpers/tz.ts`.
 */
export const SAMPLE_CREATION_DATE = new Date('2026-01-01T00:00:00Z');

export interface SampleResult {
    file: string;
    size: number;
    pages: number;
}

export interface GenerateContext {
    outputDir: string;
    results: SampleResult[];
    /** Files that could not be written (open in another program) — never fatal. */
    skipped: string[];
    writeSafe: (filepath: string, filename: string, bytes: Uint8Array) => void;
}

export function createContext(): GenerateContext {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const results: SampleResult[] = [];
    const skipped: string[] = [];

    function writeSafe(filepath: string, filename: string, bytes: Uint8Array): void {
        try {
            mkdirSync(dirname(filepath), { recursive: true });
            writeFileSync(filepath, bytes);
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EBUSY') {
                skipped.push(filename);
                console.warn(`⚠ Skipped ${filename} (file is open in another program)`);
                return;
            }
            throw err;
        }
        const pdfStr = new TextDecoder('latin1').decode(bytes);
        const pageCount = (pdfStr.match(/\/Type \/Page[^s]/g) || []).length;
        results.push({ file: filename, size: bytes.length, pages: pageCount });
    }

    return { outputDir: OUTPUT_DIR, results, skipped, writeSafe };
}

export interface OutputMode {
    /** Summary lines only. Implied when stdout is not a terminal, unless --verbose. */
    readonly quiet: boolean;
    /** Machine-readable output on stdout. Implies quiet for everything else. */
    readonly json: boolean;
}

/**
 * Parse the `--quiet` / `--verbose` / `--json` trio shared by the sample
 * scripts. A pipe (CI log, an agent's captured output, `scripts/gate.ts`)
 * gets the quiet form by default so a human at a terminal sees the full
 * table and everyone else sees a few lines; `--verbose` forces the table
 * through a pipe, `--quiet` forces the summary at a terminal.
 *
 * Returns an error message for anything else, so callers can exit 2.
 */
export function parseOutputMode(argv: readonly string[], isTTY: boolean = process.stdout.isTTY === true): OutputMode | { readonly error: string } {
    let quiet = false;
    let verbose = false;
    let json = false;
    for (const a of argv) {
        if (a === '--quiet') quiet = true;
        else if (a === '--verbose') verbose = true;
        else if (a === '--json') json = true;
        else return { error: `Unknown argument "${a}". Expected --quiet, --verbose and/or --json.` };
    }
    if (quiet && verbose) return { error: '--quiet and --verbose are mutually exclusive.' };
    return { quiet: json || quiet || (!isTTY && !verbose), json };
}

export interface SummaryOptions {
    /** One line instead of the table — for logs, CI and agents. */
    quiet?: boolean;
    /** Machine-readable summary on stdout, nothing else. */
    json?: boolean;
    /** Wall-clock duration of the run, for the quiet line and the JSON. */
    seconds?: number;
    /** Files skipped because they were open elsewhere (see `GenerateContext`). */
    skipped?: readonly string[];
}

function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function printSummary(results: SampleResult[], outputDir: string, options: SummaryOptions = {}): void {
    const totalBytes = results.reduce((sum, r) => sum + r.size, 0);
    const skipped = options.skipped ?? [];

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            generated: results.length,
            bytes: totalBytes,
            seconds: options.seconds ?? null,
            outputDir,
            skipped,
            files: results,
        }, null, 2)}\n`);
        return;
    }

    if (options.quiet) {
        const clock = options.seconds === undefined ? '' : `, ${options.seconds.toFixed(1)} s`;
        const rel = outputDir.replace(/\\/g, '/').replace(/\/?$/, '/');
        process.stdout.write(`${results.length} PDFs, ${formatBytes(totalBytes)}${clock} → ${rel}\n`);
        if (skipped.length > 0) {
            process.stdout.write(`${skipped.length} skipped (open in another program): ${skipped.join(', ')}\n`);
        }
        return;
    }

    console.log('\n┌──────────────────────────────────────────────────────────────┐');
    console.log('│  pdfnative – Sample PDF Generation Report                    │');
    console.log('├──────────────────────────────────────────────────────────────┤');
    console.log(`│  Output: ${outputDir}`);
    console.log('├──────────────────────────────────┬────────┬─────────────────┤');
    console.log('│ File                             │ Pages  │ Size            │');
    console.log('├──────────────────────────────────┼────────┼─────────────────┤');
    for (const r of results) {
        const f = r.file.padEnd(32);
        const p = String(r.pages).padStart(4);
        const s = (r.size < 1024 ? `${r.size} B` : `${(r.size / 1024).toFixed(1)} KB`).padStart(13);
        console.log(`│ ${f} │ ${p}   │ ${s}   │`);
    }
    console.log('├──────────────────────────────────┴────────┴─────────────────┤');
    console.log(`│  Total: ${results.length} PDFs generated                                     │`);
    console.log('└──────────────────────────────────────────────────────────────┘\n');
}
