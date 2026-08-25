#!/usr/bin/env tsx
/**
 * pdfnative — llms-full.txt + llms-index.json generator
 * =====================================================
 * Emits two machine-readable artefacts, both committed and both policed by
 * `scripts/verify-docs.ts` (rules `llms-sync` and `llms-index-sync`):
 *
 * - `docs/llms-full.txt` — the root `llms.txt` index followed by the full
 *   Markdown source of the README and of every guide, so an agent can ingest
 *   the whole documentation set in a single request (the llmstxt.org "full"
 *   convention).
 * - `docs/llms-index.json` — a per-page machine index: HTML and raw-Markdown
 *   URL, title, summary, section anchors, and exact byte / approximate token
 *   sizes, so an agent can decide what to fetch before spending the tokens.
 *   Sizes live here rather than in `llms.txt` itself so no artefact has to
 *   embed its own size (which would be circular).
 *
 * The output is deterministic (alphabetical guide order, LF line endings), so
 * the verifier can rebuild both in memory and fail the build when a committed
 * copy is stale.
 *
 * Usage:
 *   npx tsx scripts/build-llms-full.ts    # rewrite both artefacts
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** Build the full concatenation for the repo rooted at `root`. */
export function buildLlmsFull(root: string): string {
    const parts: string[] = [];

    const index = join(root, 'llms.txt');
    if (existsSync(index)) parts.push(lf(readFileSync(index, 'utf8')).trimEnd());

    const readme = join(root, 'README.md');
    if (existsSync(readme)) {
        parts.push('\n\n---\n<!-- source: README.md -->\n');
        parts.push(lf(readFileSync(readme, 'utf8')).trimEnd());
    }

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

// ── llms-recipes.txt ────────────────────────────────────────────────

/**
 * Concatenation of the executable recipe corpus (`recipes/*.ts`) — every file
 * is CI-executed with its `@expect` assertions verified, so an agent ingesting
 * this artefact copies code that is proven to compile and produce exactly the
 * artefact its header describes. The cheapest high-signal fetch for a coding
 * agent.
 */
export function buildLlmsRecipes(root: string): string {
    const dir = join(root, 'recipes');
    const parts: string[] = [
        '# pdfnative — executable recipes',
        '',
        '> Every file below lives in the repository as `recipes/<name>.ts`, imports only',
        "> from 'pdfnative', and is executed in CI with each `@expect` assertion checked",
        '> (tests/docs/recipes.test.ts). The machine index is recipes/index.json.',
    ];
    const files = existsSync(dir)
        ? readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()
        : [];
    for (const name of files) {
        parts.push(`\n---\n<!-- source: recipes/${name} -->\n`);
        parts.push('```ts');
        parts.push(lf(readFileSync(join(dir, name), 'utf8')).trimEnd());
        parts.push('```');
    }
    return parts.join('\n') + '\n';
}

// ── llms-index.json ─────────────────────────────────────────────────

/** Same GitHub-style slugger as scripts/build-guides.ts heading ids. */
function slugify(text: string): string {
    return text
        .replace(/`/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s+/g, '-');
}

function approxTokens(bytes: number): number {
    // Rough English-text heuristic (~4 bytes per token); good enough for an
    // agent's fetch-or-not decision, and labelled as approximate in the output.
    return Math.round(bytes / 4);
}

interface IndexPage {
    title: string;
    summary: string;
    html: string;
    markdown: string;
    anchors: string[];
    bytes: number;
    approxTokens: number;
}

interface LlmsIndex {
    $comment: string;
    site: string;
    artefacts: Array<{ url: string; description: string; bytes: number; approxTokens: number }>;
    guides: IndexPage[];
}

/** Build the machine index for the repo rooted at `root`. */
export function buildLlmsIndex(root: string): string {
    const site = 'https://pdfnative.dev';
    const guidesDir = join(root, 'docs', 'guides');
    const guides = readdirSync(guidesDir).filter((f) => f.endsWith('.md')).sort();

    const pages: IndexPage[] = [];
    for (const name of guides) {
        const md = lf(readFileSync(join(guidesDir, name), 'utf8'));
        const title = md.match(/^# (.+)$/m)?.[1].replace(/`/g, '').trim() ?? name;
        const quote = md.match(/^> \*\*([\s\S]*?)$/m)?.[0] ?? '';
        const firstPara = md.split(/\n\n+/).find((p) => /^[A-Za-z[]/.test(p.trim())) ?? '';
        const summary = (quote || firstPara)
            .replace(/^> /gm, '')
            .replace(/\*\*/g, '')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);
        const anchors = [...md.matchAll(/^## (.+)$/gm)].map((m) => slugify(m[1]));
        const bytes = Buffer.byteLength(md, 'utf8');
        pages.push({
            title,
            summary,
            html: `${site}/guides/${name.replace(/\.md$/, '.html')}`,
            markdown: `${site}/guides/${name}`,
            anchors,
            bytes,
            approxTokens: approxTokens(bytes),
        });
    }

    const artefactList: LlmsIndex['artefacts'] = [];
    const artefactSources: Array<[string, string, string]> = [
        [`${site}/llms.txt`, join(root, 'llms.txt'), 'Documentation index (llmstxt.org convention).'],
        [`${site}/agent-brief.md`, join(root, 'docs', 'agent-brief.md'), 'Compact paste-into-context briefing for coding agents: core API, verified pitfalls, surface decision tree, self-verification loop.'],
        [`${site}/llms-full.txt`, join(root, 'docs', 'llms-full.txt'), 'Full corpus: index + README + every guide, one request.'],
        [`${site}/llms-recipes.txt`, join(root, 'docs', 'llms-recipes.txt'), 'Executable recipes: CI-verified, copy-ready code for the most common tasks.'],
        ['https://github.com/Nizoka/pdfnative/blob/main/README.md', join(root, 'README.md'), 'Complete feature and API reference (also embedded in llms-full.txt).'],
    ];
    for (const [url, path, description] of artefactSources) {
        if (!existsSync(path)) continue;
        const bytes = statSync(path).size;
        artefactList.push({ url, description, bytes, approxTokens: approxTokens(bytes) });
    }

    const out: LlmsIndex = {
        $comment:
            'Machine index of the pdfnative documentation. Generated by scripts/build-llms-full.ts; verified by the llms-index-sync rule of scripts/verify-docs.ts. Token counts are approximate (bytes / 4).',
        site,
        artefacts: artefactList,
        guides: pages,
    };
    return JSON.stringify(out, null, 2) + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]).includes('build-llms-full');
if (isMain) {
    const root = resolve(import.meta.dirname, '..');
    const out = join(root, 'docs', 'llms-full.txt');
    writeFileSync(out, buildLlmsFull(root));
    console.log(`build-llms-full: wrote ${out}`);
    const rec = join(root, 'docs', 'llms-recipes.txt');
    writeFileSync(rec, buildLlmsRecipes(root));
    console.log(`build-llms-full: wrote ${rec}`);
    // Index last: it reports the other artefacts' on-disk sizes.
    const idx = join(root, 'docs', 'llms-index.json');
    writeFileSync(idx, buildLlmsIndex(root));
    console.log(`build-llms-full: wrote ${idx}`);
}
