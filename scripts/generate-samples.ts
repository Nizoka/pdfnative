/**
 * pdfnative – PDF Sample Generator
 * ===================================
 * Generates sample PDFs for every supported language + Latin baseline.
 * Output: test-output/*.pdf (git-ignored directory).
 *
 * Run:   npm run test:generate
 * Then:  open test-output/ and visually inspect each PDF.
 */

import { initNodeCompression } from '../src/index.js';
import { registerAllFonts } from './helpers/fonts.js';
import { createContext, printSummary } from './helpers/io.js';

import { generate as generateFinancial } from './generators/financial-statements.js';
import { generate as generateDiverse } from './generators/diverse-use-cases.js';
import { generate as generateAlphabet } from './generators/alphabet-coverage.js';
import { generate as generatePdfA } from './generators/pdfa-variants.js';
import { generate as generateEncryption } from './generators/encryption.js';
import { generate as generateDocBuilder } from './generators/document-builder.js';
import { generate as generateCompression } from './generators/compression.js';
import { generate as generateStressEdge } from './generators/stress-edge.js';

async function generateAll(): Promise<void> {
    registerAllFonts();
    await initNodeCompression();

    const ctx = createContext();

    // ── Financial statements (12 langs + multi + pagination) ─────
    await generateFinancial(ctx);

    // ── Diverse use-cases (12 non-financial tables) ──────────────
    await generateDiverse(ctx);

    // ── Alphabet / character coverage (11 scripts) ───────────────
    await generateAlphabet(ctx);

    // ── PDF/A variants (4 conformance levels) ────────────────────
    await generatePdfA(ctx);

    // ── Encryption variants (AES-128/256, permissions) ───────────
    await generateEncryption(ctx);

    // ── Document builder (DOC_SAMPLES + Unicode docs) ────────────
    await generateDocBuilder(ctx);

    // ── FlateDecode compression samples ──────────────────────────
    await generateCompression(ctx);

    // ── Stress tests + edge cases ────────────────────────────────
    await generateStressEdge(ctx);

    // ── Summary ──────────────────────────────────────────────────
    printSummary(ctx.results, ctx.outputDir);
}

generateAll().catch((err: unknown) => {
    console.error('❌ Sample generation failed:', err);
    process.exit(1);
});
