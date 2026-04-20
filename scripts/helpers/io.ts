/**
 * I/O helpers for sample PDF generation.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = resolve(__dirname, '..', '..', 'test-output');

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
