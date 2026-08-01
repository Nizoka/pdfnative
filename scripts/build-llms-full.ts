#!/usr/bin/env tsx
/**
 * pdfnative — llms-full.txt generator
 * ====================================
 * Emits `docs/llms-full.txt`: the root `llms.txt` index followed by the full
 * Markdown source of every guide, so an agent can ingest the whole
 * documentation set in a single request (the llmstxt.org "full" convention).
 *
 * The output is deterministic (alphabetical guide order, LF line endings), so
 * `scripts/verify-docs.ts` can rebuild it in memory and fail the build when the
 * committed copy is stale.
 *
 * Usage:
 *   npx tsx scripts/build-llms-full.ts          # rewrite docs/llms-full.txt
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** Build the full concatenation for the repo rooted at `root`. */
export function buildLlmsFull(root: string): string {
    const parts: string[] = [];

    const index = join(root, 'llms.txt');
    if (existsSync(index)) parts.push(lf(readFileSync(index, 'utf8')).trimEnd());

    const guidesDir = join(root, 'docs', 'guides');
    const guides = existsSync(guidesDir)
        ? readdirSync(guidesDir).filter((f) => f.endsWith('.md')).sort()
        : [];
    for (const name of guides) {
        parts.push(`\n\n---\n<!-- source: docs/guides/${name} -->\n`);
        parts.push(lf(readFileSync(join(guidesDir, name), 'utf8')).trimEnd());
    }

    return parts.join('') + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]).includes('build-llms-full');
if (isMain) {
    const root = resolve(import.meta.dirname, '..');
    const out = join(root, 'docs', 'llms-full.txt');
    writeFileSync(out, buildLlmsFull(root));
    console.log(`build-llms-full: wrote ${out}`);
}
