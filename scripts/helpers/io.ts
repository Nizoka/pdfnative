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
    writeSafe: (filepath: string, filename: string, bytes: Uint8Array) => void;
}

export function createContext(): GenerateContext {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    const results: SampleResult[] = [];

    function writeSafe(filepath: string, filename: string, bytes: Uint8Array): void {
        try {
            mkdirSync(dirname(filepath), { recursive: true });
            writeFileSync(filepath, bytes);
        } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'EBUSY') {
                console.warn(`⚠ Skipped ${filename} (file is open in another program)`);
                return;
            }
            throw err;
        }
        const pdfStr = new TextDecoder('latin1').decode(bytes);
        const pageCount = (pdfStr.match(/\/Type \/Page[^s]/g) || []).length;
        results.push({ file: filename, size: bytes.length, pages: pageCount });
    }

    return { outputDir: OUTPUT_DIR, results, writeSafe };
}

export function printSummary(results: SampleResult[], outputDir: string): void {
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
