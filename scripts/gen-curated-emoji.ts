/**
 * Maintainer generator for the curated colour-emoji codepoint list.
 * Selects every single-codepoint emoji in the ranges below that
 * NotoColorEmoji-Regular.ttf resolves to a colour glyph, and rewrites
 * scripts/lib/curated-emoji.ts.
 *
 * Until v1.8.0 this generator no longer reproduced the list it claimed to
 * own: it capped the selection at 850 and included Extended-A, while the
 * committed list held 1 167 code points and excluded that block. Anyone
 * following the "regenerate, do not edit" instruction would have silently
 * removed 326 emoji. It now encodes the rule the committed list follows —
 * whole ranges, no cap, Extended-A left to the CLI — and the module's size
 * budget is enforced where the module is built.
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
    // Symbols & Pictographs Extended-A (U+1FA70–1FAFF) is not bundled; build
    // a custom module with `npx pdfnative-build-emoji-font` for it.
];
const EXCLUDE = (cp: number) =>
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin-tone modifiers
    (cp >= 0x1f1e6 && cp <= 0x1f1ff);   // regional indicators (flags need sequences)

const SELECT_BMP = [
    0x231a, 0x231b, 0x23f0, 0x23f3, 0x25b6, 0x25c0, 0x2b50, 0x2b55, 0x2b1b, 0x2b1c,
    0x2764, 0x203c, 0x2049, 0x2122, 0x2139, 0x2611, 0x2714, 0x2716, 0x274c, 0x2753,
];

// No count cap: the size budget belongs to build-color-emoji-data.ts, which
// measures the real module and refuses to write one that is over it.
const chosen: number[] = [];
const seen = new Set<number>();
const add = (cp: number): void => {
    if (seen.has(cp) || EXCLUDE(cp) || !available.has(cp)) return;
    seen.add(cp); chosen.push(cp);
};

for (const cp of SELECT_BMP) add(cp);
for (const { from, to } of RANGES) {
    for (let cp = from; cp <= to; cp++) add(cp);
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
 * Selection (${chosen.length} code points): every single-codepoint emoji
 * NotoColorEmoji-Regular.ttf resolves to a colour glyph in
 *   1. Emoticons (U+1F600–1F64F);
 *   2. Supplemental Symbols & Pictographs (U+1F900–1F9FF): faces, hands,
 *      people, animals;
 *   3. Miscellaneous Symbols (U+2600–26FF) and Dingbats (U+2700–27BF);
 *   4. Miscellaneous Symbols & Pictographs (U+1F300–1F5FF);
 *   5. Transport & Map (U+1F680–1F6FF).
 * Symbols & Pictographs Extended-A (U+1FA70–1FAFF) is not bundled — build a
 * custom module with \`npx pdfnative-build-emoji-font\` if you need it. The
 * module's size budget (5 MB) is enforced by build-color-emoji-data.ts.
 *
 * Multi-codepoint emoji — flags, ZWJ sequences and a curated set of skin-tone
 * forms — are bundled too, from scripts/lib/curated-emoji-sequences.ts.
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
