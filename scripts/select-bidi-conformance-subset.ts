#!/usr/bin/env tsx
/**
 * pdfnative – BidiCharacterTest subset selector
 * =============================================
 * Writes `scripts/data/BidiCharacterTest-subset.txt`, the vendored slice of
 * the Unicode Character Database's BidiCharacterTest.txt that
 * `tests/shaping/bidi-conformance.test.ts` runs at every gate.
 *
 * The full file (≈ 92 000 test lines, 6.9 MB) is too large to vendor; the
 * subset keeps its header verbatim and **every 11th test line** — a
 * deterministic, uniform sample of a combinatorially generated corpus, so
 * every rule family (brackets, isolates, embeddings, overrides, marks, the
 * three paragraph directions) is represented. The conformance test runs the
 * full file instead when `BIDI_CHARACTER_TEST=<path>` is set.
 *
 * Dev-time only. Run:
 *   npx tsx scripts/select-bidi-conformance-subset.ts <path-to>/BidiCharacterTest.txt
 *
 * To upgrade the Unicode version, download the new BidiCharacterTest.txt from
 * https://www.unicode.org/Public/<version>/ucd/ and re-run.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = resolve(root, 'scripts/data/BidiCharacterTest-subset.txt');

/** Every Nth test line is kept. */
const STRIDE = 11;

const sourcePath = process.argv[2];
if (!sourcePath) {
    process.stderr.write('usage: npx tsx scripts/select-bidi-conformance-subset.ts <path-to>/BidiCharacterTest.txt\n');
    process.exit(2);
}
const source = readFileSync(sourcePath, 'utf8');
const versionMatch = source.match(/^# BidiCharacterTest-(\d+\.\d+\.\d+)\.txt/);
if (!versionMatch) throw new Error(`${sourcePath}: missing version header line`);

const header: string[] = [];
const data: string[] = [];
let inHeader = true;
for (const line of source.split(/\r?\n/)) {
    if (inHeader && (line.startsWith('#') || line === '')) {
        if (line.startsWith('#')) header.push(line);
        continue;
    }
    inHeader = false;
    if (line && !line.startsWith('#')) data.push(line);
}
if (data.length === 0) throw new Error(`${sourcePath}: no test lines parsed`);

const selected = data.filter((_, i) => i % STRIDE === 0);
const out = [
    ...header,
    `# pdfnative: every ${STRIDE}th test line of BidiCharacterTest-${versionMatch[1]}.txt (${selected.length} of ${data.length}),`,
    '# selected by scripts/select-bidi-conformance-subset.ts — see scripts/data/README.md.',
    '#',
    ...selected,
].join('\n') + '\n';
writeFileSync(outPath, out, 'utf8');
process.stdout.write(`BidiCharacterTest-subset.txt: ${selected.length} of ${data.length} lines (Unicode ${versionMatch[1]}) → ${outPath}\n`);
