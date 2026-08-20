/**
 * pdfnative-build-emoji-font — Colour-emoji font data module generator (CLI)
 * =========================================================================
 * Builds a tree-shakeable colour-emoji data module from a COLR/CPAL font
 * (Noto Color Emoji) for use with pdfnative's `registerFont('emoji', …)`.
 *
 * pdfnative bundles a lean 221-glyph curated subset by default. This CLI lets
 * any user of the `pdfnative` package generate a module with EXACTLY the emoji
 * they need — from a handful of codepoints up to the FULL ~3 600-glyph set —
 * without bloating every install. It dogfoods the same deterministic build
 * core that produces the bundled module.
 *
 * Usage:
 *   pdfnative-build-emoji-font [options]
 *
 * Source font (one of):
 *   --ttf <path>          Path to NotoColorEmoji-Regular.ttf (COLRv1/CPAL).
 *   --download            Fetch the official Noto Color Emoji (OFL-1.1) from
 *                         Google Fonts and verify its checksum.
 *
 * Glyph selection (combine freely; default: --preset curated):
 *   --all                 Every colour glyph in the font (~3 600, large module).
 *   --preset <curated|all>  Named selection. 'curated' = pdfnative's lean set.
 *   --codepoints <list>   Comma-separated hex scalars, e.g. 1F600,1F680,2764.
 *   --ranges <list>       Comma-separated inclusive hex ranges, e.g. 1F600-1F64F.
 *
 * Sequence selection (v1.7.0; default: none):
 *   --sequences <preset>  flags | zwj | all | none — curated flag/ZWJ sets.
 *   --sequence-list <list>  Country codes and/or hyphen-joined hex sequences,
 *                         e.g. FR,DE,1F468-200D-1F680 (skin-tone forms welcome).
 *
 * Output:
 *   --out <path>          Output .js path (a sibling .d.ts is written too).
 *                         Default: ./noto-color-emoji-data.js
 *   --font-name <name>    Embedded PostScript font name.
 *   --types <path>        Type import used in the .d.ts. Default: 'pdfnative'.
 *
 * Other:
 *   -h, --help            Show this help.
 *
 * Examples:
 *   pdfnative-build-emoji-font --download --all
 *   pdfnative-build-emoji-font --ttf ./NotoColorEmoji-Regular.ttf --codepoints 1F600,1F680
 *   pdfnative-build-emoji-font --download --ranges 1F600-1F64F,2600-27BF --out ./emoji.js
 *
 * Zero external dependency. Noto Color Emoji is OFL-1.1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildEmojiFontModule, allColorCodepoints } from './lib/emoji-font-core.js';
import { parseArgs, resolveCodepoints, resolveSequences } from './lib/emoji-cli.js';

/** Official Google Fonts source for Noto Color Emoji (COLRv1/CPAL, OFL-1.1). */
const DOWNLOAD_URL =
    'https://raw.githubusercontent.com/google/fonts/main/ofl/notocoloremoji/NotoColorEmoji-Regular.ttf';
/**
 * SHA-256 of the Noto Color Emoji build pdfnative was tested against. Upstream
 * Google Fonts periodically ships new Unicode revisions, so a mismatch is a
 * transparent WARNING (not a hard failure) — the download is still used.
 */
const DOWNLOAD_SHA256 = 'be73479ba4fa277c89b85cd6c71717df30d9d0eff6da8c1e1a201e5b95459299';

const HELP = `pdfnative-build-emoji-font — colour-emoji font data module generator

Source font (one of):
  --ttf <path>            Path to a COLRv1/CPAL colour font (NotoColorEmoji-Regular.ttf).
  --download              Fetch the official Noto Color Emoji (OFL-1.1) and verify checksum.

Glyph selection (combine freely; default: --preset curated):
  --all                   Every colour glyph in the font (large module).
  --preset <curated|all>  Named selection ('curated' = pdfnative's lean 221-glyph set).
  --codepoints <list>     Comma-separated hex scalars, e.g. 1F600,1F680,2764.
  --ranges <list>         Comma-separated inclusive hex ranges, e.g. 1F600-1F64F.

Sequence selection (v1.7.0; default: none):
  --sequences <preset>    flags | zwj | all | none — bundle the curated flag
                          and/or ZWJ sequence sets (GSUB-resolved ligatures).
  --sequence-list <list>  Comma-separated country codes and/or hyphen-joined
                          hex sequences, e.g. FR,DE,1F468-200D-1F680,
                          1F469-1F3FD-200D-2695-FE0F (skin tones welcome).

Output:
  --out <path>            Output .js path (a sibling .d.ts is written). Default ./noto-color-emoji-data.js
  --font-name <name>      Embedded PostScript font name.
  --types <path>          Type import used in the generated .d.ts. Default 'pdfnative'.

Other:
  -h, --help              Show this help.

Examples:
  pdfnative-build-emoji-font --download --all
  pdfnative-build-emoji-font --ttf ./NotoColorEmoji-Regular.ttf --codepoints 1F600,1F680
  pdfnative-build-emoji-font --download --ranges 1F600-1F64F,2600-27BF --out ./emoji.js
`;

async function fetchFont(): Promise<Uint8Array> {
    console.log(`Downloading Noto Color Emoji (OFL-1.1) …`);
    console.log(`  ${DOWNLOAD_URL}`);
    const res = await fetch(DOWNLOAD_URL);
    if (!res.ok) throw new Error(`Download failed — HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash === DOWNLOAD_SHA256) {
        console.log(`  checksum OK (sha256 ${hash.slice(0, 16)}…)`);
    } else {
        console.warn(`  WARNING: checksum differs from the tested build.`);
        console.warn(`    expected ${DOWNLOAD_SHA256}`);
        console.warn(`    actual   ${hash}`);
        console.warn(`  Upstream may have shipped a newer Unicode revision; proceeding.`);
    }
    return bytes;
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) { console.log(HELP); return; }

    if (!opts.ttf && !opts.download) {
        throw new Error('Provide a source font with --ttf <path> or --download (try --help)');
    }
    if (opts.ttf && opts.download) {
        throw new Error('Use either --ttf or --download, not both');
    }

    const ttf = opts.download
        ? await fetchFont()
        : new Uint8Array(readFileSync(resolve(opts.ttf as string)));

    const codepoints = resolveCodepoints(opts, () => allColorCodepoints(ttf));
    if (codepoints.length === 0) {
        throw new Error('No codepoints selected — use --all, --preset, --codepoints or --ranges');
    }

    const outJs = resolve(opts.out);
    const outDts = outJs.replace(/\.js$/i, '') + '.d.ts';
    const fontName = opts.fontName ?? 'NotoColorEmoji-Regular';

    const sequences = resolveSequences(opts);

    const { js, dts, stats } = buildEmojiFontModule(ttf, codepoints, {
        fontName,
        dtsTypeImport: opts.types,
        makeBanner: (kept) => `/**
 * COLOUR-EMOJI FONT DATA — ${fontName}
 * Generated by: pdfnative-build-emoji-font
 * Source: Noto Color Emoji (OFL-1.1). Colour glyphs: ${kept}.
 *
 * Opt in:
 *   import { registerFont } from 'pdfnative';
 *   registerFont('emoji', () => import('./${outJs.split(/[\\/]/).pop()}'));
 */`,
    }, sequences);

    writeFileSync(outJs, js);
    writeFileSync(outDts, dts);

    console.log(`Colour-emoji data module written:`);
    console.log(`  requested codepoints: ${codepoints.length}`);
    console.log(`  colour glyphs kept:   ${stats.kept}  (missing: ${stats.missing})`);
    if (sequences.length > 0) {
        console.log(`  sequences kept:       ${stats.keptSequences}  (missing: ${stats.missingSequences})`);
        for (const seq of stats.missingSequenceList) {
            console.log(`    unresolved: ${seq.map(c => c.toString(16).toUpperCase()).join('-')}`);
        }
    }
    console.log(`  embedded glyph ids:   ${stats.usedGids}`);
    console.log(`  module size:          ${stats.sizeKb} KB`);
    console.log(`  ${outJs}`);
    console.log(`  ${outDts}`);
}

main().catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
