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
import { generate as generateBarcode } from './generators/barcode-showcase.js';
import { generate as generateWatermarks } from './generators/watermarks.js';
import { generate as generateHeadersFooters } from './generators/headers-footers.js';
import { generate as generatePageSizes } from './generators/page-sizes.js';
import { generate as generateTocShowcase } from './generators/toc-showcase.js';
import { generate as generateSvgShowcase } from './generators/svg-showcase.js';
import { generate as generateFormShowcase } from './generators/form-showcase.js';
import { generate as generateDigitalSignature } from './generators/digital-signature.js';
import { generate as generateSignaturePlaceholder } from './generators/signature-placeholder.js';
import { generate as generateBidiEmbeddings } from './generators/bidi-embeddings-showcase.js';
import { generate as generateTableParity } from './generators/document-table-parity.js';
import { generate as generateStreaming } from './generators/streaming-showcase.js';
import { generate as generateParser } from './generators/parser-showcase.js';
import { generate as generateTextShaping } from './generators/text-shaping-deep.js';
import { generate as generateUseLite } from './generators/use-lite-showcase.js';
import { generate as generateBidi } from './generators/bidi-algorithm.js';
import { generate as generateCrypto } from './generators/crypto-showcase.js';
import { generate as generateFontSubsetting } from './generators/font-subsetting-deep.js';
import { generate as generateParserDeep } from './generators/parser-deep.js';
import { generate as generateExtremeShaping } from './generators/extreme-shaping.js';
import { generate as generateEmoji } from './generators/emoji-showcase.js';
import { generate as generateColorEmoji } from './generators/color-emoji-showcase.js';
import { generate as generateCurrency } from './generators/currency-symbols.js';
import { generate as generatePdfALatin } from './generators/pdfa-latin-embedding.js';
import { generate as generateOutline } from './generators/outline-bookmarks.js';
import { generate as generateManipulation } from './generators/pdf-manipulation.js';
import { generate as generateViewerPrefs } from './generators/viewer-prefs-showcase.js';
import { generate as generateFontValidation } from './generators/font-validation-showcase.js';

async function generateAll(): Promise<void> {
    registerAllFonts();
    await initNodeCompression();

    const ctx = createContext();

    // ── Financial statements (12 langs + multi + pagination) ─────
    await generateFinancial(ctx);

    // ── Diverse use-cases (12 non-financial tables) ──────────────
    await generateDiverse(ctx);

    // ── Alphabet / character coverage (22 scripts) ───────────────
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

    // ── Barcode & QR Code showcase ───────────────────────────────
    await generateBarcode(ctx);

    // ── Watermark samples (text + image, bg/fg) ──────────────────
    await generateWatermarks(ctx);

    // ── Header & footer templates ────────────────────────────────
    await generateHeadersFooters(ctx);

    // ── Page size variants (A4, Letter, Legal, A3, Tabloid) ──────
    await generatePageSizes(ctx);

    // ── Table of Contents showcase ───────────────────────────────
    await generateTocShowcase(ctx);

    // ── SVG path rendering showcase ──────────────────────────────
    await generateSvgShowcase(ctx);

    // ── AcroForm interactive fields showcase ─────────────────────
    await generateFormShowcase(ctx);

    // ── Digital signature showcase (RSA + ECDSA) ─────────────────
    await generateDigitalSignature(ctx);

    // ── Signature placeholder workflow (v1.2 — issue #45) ────────
    await generateSignaturePlaceholder(ctx);

    // ── BiDi embeddings showcase (v1.2 — UAX #9 LRE/RLE/LRO/RLO) ─
    await generateBidiEmbeddings(ctx);

    // ── Smart-table parity samples (v1.2 — wrap/repeatHeader/zebra/caption) ─
    await generateTableParity(ctx);

    // ── Streaming output showcase (chunked emission) ─────────────
    await generateStreaming(ctx);

    // ── PDF parser & modifier showcase (round-trip) ──────────────
    await generateParser(ctx);

    // ── Text shaping deep-dive (Thai/Bengali/Tamil/Telugu) ──────
    await generateTextShaping(ctx);

    // ── USE-lite cluster classification (public API) ────────────
    await generateUseLite(ctx);

    // ── BiDi algorithm walkthrough (UAX #9, Arabic, Hebrew) ─────
    await generateBidi(ctx);

    // ── Crypto primitives showcase (SHA, RSA, ECDSA) ────────────
    await generateCrypto(ctx);

    // ── Font subsetting internals (TTF pipeline, CMap) ──────────
    await generateFontSubsetting(ctx);

    // ── Parser deep-dive (tokenizer, xref, /Prev chain) ────────
    await generateParserDeep(ctx);

    // ── Extreme-script shaping (BiDi, Tamil, Bengali+Devanagari, Arabic harakat) ─
    await generateExtremeShaping(ctx);

    // ── Emoji showcase (v1.1.0 — Noto Emoji monochrome) ───────
    await generateEmoji(ctx);

    // ── Colour-emoji showcase (v1.3.0 — Noto Color Emoji COLR/CPAL) ─
    await generateColorEmoji(ctx);

    // ── Currency symbols (v1.3.0 — base-14 + embedded Noto Sans) ─
    await generateCurrency(ctx);

    // ── PDF/A Latin embedding (v1.1.0 — Noto Sans VF, issue #28) ─
    await generatePdfALatin(ctx);

    // ── Outline/bookmarks + page labels (v1.4.0) ─────────────────
    await generateOutline(ctx);

    // ── Page-tree manipulation + streamToFile (v1.4.0) ───────────
    await generateManipulation(ctx);

    // ── Viewer preferences (v1.4.0 — /PageLayout / /PageMode) ────
    await generateViewerPrefs(ctx);

    // ── Font-data validator report (v1.4.0) ──────────────────────
    await generateFontValidation(ctx);

    // ── Summary ──────────────────────────────────────────────────
    printSummary(ctx.results, ctx.outputDir);
}

generateAll().catch((err: unknown) => {
    console.error('❌ Sample generation failed:', err);
    process.exit(1);
});
