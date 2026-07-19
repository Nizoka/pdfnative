/**
 * Maintainer generator for the curated colour-emoji codepoint list.
 * Selects a priority-ordered ~850 single-codepoint emoji covering everyday
 * use, intersected with the glyphs NotoColorEmoji-Regular.ttf actually
 * provides, and rewrites scripts/lib/curated-emoji.ts.
 *
 * Run this, then regenerate the bundled module:
 *   npx tsx scripts/gen-curated-emoji.ts
 *   npx tsx scripts/build-color-emoji-data.ts
 *
 * Requires the (uncommitted) source font at fonts/ttf/NotoColorEmoji-Regular.ttf.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allColorCodepoints } from './lib/emoji-font-core.js';

const ROOT = join(import.meta.dirname, '..');
const ttf = new Uint8Array(readFileSync(join(ROOT, 'fonts', 'ttf', 'NotoColorEmoji-Regular.ttf')));
const available = new Set(allColorCodepoints(ttf));

// Priority-ordered single-codepoint ranges (most-used first). Skin-tone
// modifiers (1F3FB–1F3FF), regional indicators, variation selectors and tag
// characters are excluded — they are combining/sequence code points, not
// standalone emoji.
const RANGES: Array<{ from: number; to: number }> = [
    { from: 0x1f600, to: 0x1f64f }, // Emoticons + hands
    { from: 0x1f900, to: 0x1f9ff }, // Supplemental Symbols & Pictographs (faces, hands, people, animals)
    { from: 0x2600, to: 0x26ff },   // Misc Symbols (weather, signs, hearts, sports)
    { from: 0x2700, to: 0x27bf },   // Dingbats (checks, stars, crosses)
    { from: 0x1f300, to: 0x1f5ff }, // Misc Symbols & Pictographs (nature, food, objects, symbols)
    { from: 0x1f680, to: 0x1f6ff }, // Transport & Map
    { from: 0x1fa70, to: 0x1faff }, // Symbols & Pictographs Extended-A
];
const EXCLUDE = (cp: number) =>
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin-tone modifiers
    (cp >= 0x1f1e6 && cp <= 0x1f1ff);   // regional indicators (flags need sequences)

const SELECT_BMP = [
    0x231a, 0x231b, 0x23f0, 0x23f3, 0x25b6, 0x25c0, 0x2b50, 0x2b55, 0x2b1b, 0x2b1c,
    0x2764, 0x203c, 0x2049, 0x2122, 0x2139, 0x2611, 0x2714, 0x2716, 0x274c, 0x2753,
];

const BUDGET = 850;
const chosen: number[] = [];
const seen = new Set<number>();
const add = (cp: number): void => {
    if (chosen.length >= BUDGET) return;
    if (seen.has(cp) || EXCLUDE(cp) || !available.has(cp)) return;
    seen.add(cp); chosen.push(cp);
};

for (const cp of SELECT_BMP) add(cp);
for (const { from, to } of RANGES) {
    for (let cp = from; cp <= to; cp++) add(cp);
    if (chosen.length >= BUDGET) break;
}

chosen.sort((a, b) => a - b);

// Emit the TS module with 8 hex codepoints per line.
const hex = (cp: number) => '0x' + cp.toString(16);
const lines: string[] = [];
for (let i = 0; i < chosen.length; i += 8) {
    lines.push('    ' + chosen.slice(i, i + 8).map(hex).join(', ') + ',');
}

const file = `/**
 * CURATED COLOUR-EMOJI CODEPOINTS
 * ===============================
 * The default bundled set for \`fonts/noto-color-emoji-data.js\`. Shared by
 * \`scripts/build-color-emoji-data.ts\` (regenerates the bundled module) and the
 * public \`pdfnative-build-emoji-font\` CLI (\`--preset curated\`).
 *
 * Selection criteria (v1.6.0 — expanded from 221 to ~${chosen.length}):
 *   1. Complete Emoticons block (U+1F600–1F64F).
 *   2. Complete Supplemental Symbols & Pictographs (U+1F900–1F9FF): faces,
 *      hands, people, animals.
 *   3. Miscellaneous Symbols (U+2600–26FF) and Dingbats (U+2700–27BF).
 *   4. Miscellaneous Symbols & Pictographs (U+1F300–1F5FF): nature, food,
 *      objects, symbols.
 *   5. Transport & Map (U+1F680–1F6FF) and Extended-A (U+1FA70–1FAFF).
 * Only single-codepoint emoji that resolve to a COLR glyph are kept; the list
 * is capped to keep the bundled module within a ~3.5 MB budget.
 *
 * OUT OF SCOPE (render as monochrome/tofu — build a full module with
 * \`npx pdfnative-build-emoji-font --download --all\` for these): flag
 * sequences (regional-indicator pairs), ZWJ sequences (e.g. family, roles),
 * and skin-tone-modified forms. These require GSUB ligature lookups the
 * generated single-codepoint cmap does not carry.
 *
 * DO NOT EDIT BY HAND — regenerate the ranges via the maintainer generator,
 * then rebuild the module with: npx tsx scripts/build-color-emoji-data.ts
 */
export const CURATED_EMOJI: readonly number[] = [
${lines.join('\n')}
];
`;

writeFileSync(join(ROOT, 'scripts', 'lib', 'curated-emoji.ts'), file);
console.log(`wrote curated-emoji.ts with ${chosen.length} codepoints`);
