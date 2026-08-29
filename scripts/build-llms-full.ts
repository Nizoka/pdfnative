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

// The ONE slugger: the same implementation that assigns heading ids in the
// pre-rendered shells, so the anchors this index publishes always resolve.
// (Raw-Markdown headings get their inline backticks stripped first — the
// equivalent of the tag-stripping the renderer does on the HTML side.)
import { slugify as slugifyHeading } from './build-guides.ts';
function slugify(text: string): string {
    return slugifyHeading(text.replace(/`/g, ''));
}

function approxTokens(bytes: number): number {
    // Rough English-text heuristic (~4 bytes per token); good enough for an
    // agent's fetch-or-not decision, and labelled as approximate in the output.
    return Math.round(bytes / 4);
}

/**
 * Budget for a page summary, exported so the `llms-index-quality` rule in
 * scripts/verify-docs.ts asserts against the same number the generator
 * enforces — a drifted copy of this constant would be exactly the kind of
 * silent divergence these rules exist to prevent.
 */
export const SUMMARY_MAX = 400;

/**
 * The lede blockquote: the contiguous run of `>` lines that follows the H1.
 * Anchored on the H1 rather than searched globally, because a mid-document
 * callout is not the page's summary (docs/guides/tables.md once shipped its
 * line-150 behaviour-change box as its index entry); taken as a whole block
 * rather than one line, because most ledes wrap over 4-9 physical lines and
 * the `$`-under-/m regex this replaces kept only the first, severing 23 of
 * 31 summaries mid-sentence.
 */
function ledeQuote(md: string): string {
    const lines = md.split('\n');
    const h1 = lines.findIndex((l) => /^# /.test(l));
    if (h1 < 0) return '';
    let j = h1 + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (!/^>/.test(lines[j] ?? '')) return '';
    const out: string[] = [];
    for (let k = j; k < lines.length && /^>/.test(lines[k]); k++) out.push(lines[k]);
    return out.join('\n');
}

function cleanSummary(quote: string): string {
    return quote
        .replace(/^> ?/gm, '')
        .replace(/\*\*/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
        // A lede written entirely in italics (anchored on the whole string, so
        // inline code such as `E_*` elsewhere is never touched).
        .replace(/^_(.*)_$/, '$1')
        .trim();
}

/**
 * Trim to the budget without ever cutting a word. Prefer the last sentence
 * boundary in the final stretch (a summary that ends on a full stop reads as
 * written, not as severed); fall back to the last word boundary plus an
 * ellipsis, so a machine consumer can tell a truncated summary from a
 * complete one.
 */
function truncateSummary(s: string, max = SUMMARY_MAX): string {
    if (s.length <= max) return s;
    const head = s.slice(0, max - 1);
    const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
    if (stop >= max * 0.6) return head.slice(0, stop + 1);
    const space = head.lastIndexOf(' ');
    return (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:—-]+$/, '') + '…';
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
        const quote = ledeQuote(md);
        // Fallback for a guide without a lede; the fence guard keeps a code
        // block from ever becoming a summary (the FAQ shipped one for three
        // releases before the lede extraction above was anchored).
        const firstPara = md
            .split(/\n\n+/)
            .find((p) => /^[A-Za-z[]/.test(p.trim()) && !p.includes('```')) ?? '';
        const summary = truncateSummary(cleanSummary(quote || firstPara));
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
        [`${site}/assets/api.json`, join(root, 'docs', 'assets', 'api.json'), 'The public API surface derived from the src/index.ts exports — name, kind, module, signature, TSDoc summary. The substitute for the unpublished index.d.ts.'],
        [`${site}/data/surfaces.json`, join(root, 'docs', 'data', 'surfaces.json'), 'The capability × surface matrix (library / CLI / MCP / React) behind the choose guide, with an honest note on every unsupported cell.'],
        [`${site}/data/errors.json`, join(root, 'docs', 'data', 'errors.json'), 'The engine diagnostic registry (PDFA_* codes), two-way checked against src/ by the error-parity rule.'],
        ['https://github.com/Nizoka/pdfnative/blob/main/README.md', join(root, 'README.md'), 'Complete feature and API reference (also embedded in llms-full.txt).'],
    ];
    for (const [url, path, description] of artefactSources) {
        if (!existsSync(path)) continue;
        // Byte size of the LF-normalised content — the size of the committed
        // blob GitHub Pages serves. statSync().size would measure the working
        // tree, which is CRLF-inflated on autocrlf Windows clones and would
        // make llms-index-sync fail on a pristine checkout.
        const bytes = Buffer.byteLength(lf(readFileSync(path, 'utf8')), 'utf8');
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

const isMain = import.meta.filename === resolve(process.argv[1] ?? '');
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
