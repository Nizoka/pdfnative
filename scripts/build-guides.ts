#!/usr/bin/env tsx
/**
 * pdfnative — guide pre-renderer
 * ==============================
 * Renders each `docs/guides/*.md` into its companion `.html` shell, between
 * `<!-- guide:render:start -->` / `<!-- guide:render:end -->` markers, and
 * injects the page's schema.org JSON-LD (TechArticle + BreadcrumbList, plus
 * FAQPage for the FAQ) between `<!-- guide:ld:start -->` / `<!-- guide:ld:end -->`
 * markers in the head.
 *
 * Why: the shells used to ship an empty `<article>` filled in by `guide.js` at
 * runtime, so any fetcher that does not execute JavaScript (most AI crawlers,
 * social scrapers, `curl`) received the word "Loading…" instead of the guide —
 * and the client-injected JSON-LD was equally invisible. Pre-rendering makes
 * every canonical URL serve its full content and markup; `guide.js` detects the
 * pre-rendered content and skips the fetch, keeping its old behaviour as a
 * fallback for shells that have not been generated.
 *
 * The served site stays fully static: this script runs at authoring time, its
 * output is committed, and `scripts/verify-docs.ts` (rule `guide-render-sync`)
 * rebuilds everything in memory and fails the build when a committed shell is
 * stale — the exact pattern established by `build-llms-full.ts` + `llms-sync`.
 *
 * Rendering is deterministic: marked@12.0.2 pinned as an exact devDependency
 * (the same version the pages load from the CDN), LF endings, and a
 * GitHub-style heading slugger implemented here (marked ≥ 5 no longer emits
 * heading ids itself). Content is first-party Markdown reviewed in the repo, so
 * no sanitiser runs at build time; the client fallback path keeps DOMPurify.
 *
 * Usage:
 *   npx tsx scripts/build-guides.ts          # rewrite all docs/guides/*.html
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { marked } from 'marked';

function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

marked.use({ gfm: true, breaks: false });

// ── Heading slugs (GitHub convention, deterministic) ────────────────

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
    return html.replace(/<[^>]+>/g, '');
}

export function slugify(text: string): string {
    // GitHub convention: strip punctuation, then EVERY whitespace character
    // becomes its own hyphen ("Flag & ZWJ" → "flag--zwj", not "flag-zwj") —
    // existing deep links across the guides were written against that shape.
    return decodeEntities(stripTags(text))
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-');
}

/**
 * Add `id` attributes and a visible anchor link to every h1–h4 in rendered
 * Markdown output. marked emits headings on a single line, so a line-scoped
 * regex is reliable here (this is generator output, not arbitrary HTML).
 */
function addHeadingAnchors(html: string): string {
    const seen = new Map<string, number>();
    return html.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
        let slug = slugify(inner) || 'section';
        const n = seen.get(slug) ?? 0;
        seen.set(slug, n + 1);
        if (n > 0) slug = `${slug}-${n}`;
        const anchor =
            level === '1'
                ? ''
                : `<a class="heading-anchor" href="#${slug}" aria-label="Link to this section">#</a>`;
        return `<h${level} id="${slug}">${inner}${anchor}</h${level}>`;
    });
}

/** Open external links in a new tab (mirrors the old guide.js behaviour). */
function externaliseLinks(html: string): string {
    return html.replace(/<a href="(https?:\/\/[^"]+)">/g, '<a href="$1" target="_blank" rel="noopener">');
}

// ── Rendering ───────────────────────────────────────────────────────

/** Render one guide's Markdown into the article HTML committed in its shell. */
export function renderGuideArticle(root: string, mdName: string): string {
    const md = lf(readFileSync(join(root, 'docs', 'guides', mdName), 'utf8'));
    const html = marked.parse(md) as string;
    return externaliseLinks(addHeadingAnchors(html)).trimEnd() + '\n';
}

// ── Structured data ─────────────────────────────────────────────────

interface JsonLdNode {
    [key: string]: unknown;
}

function firstHeadline(articleHtml: string): string {
    const m = articleHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    return m ? decodeEntities(stripTags(m[1])).trim() : '';
}

function metaContent(shell: string, name: string): string {
    const m = shell.match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
    return m ? decodeEntities(m[1]) : '';
}

function canonicalOf(shell: string): string {
    const m = shell.match(/<link rel="canonical" href="([^"]+)"/);
    return m ? m[1] : '';
}

/** Plain text of a marked token tree (for FAQPage answers). */
function tokenText(tokens: Array<Record<string, unknown>> | undefined): string {
    if (!tokens) return '';
    const parts: string[] = [];
    for (const t of tokens) {
        if (t['type'] === 'table') {
            // A table-only answer is still an answer: serialise header and
            // body cells (each cell is { text, tokens }).
            const header = t['header'] as Array<Record<string, unknown>> | undefined;
            const rows = t['rows'] as Array<Array<Record<string, unknown>>> | undefined;
            if (header) parts.push(header.map((c) => String(c['text'] ?? '')).join(' — '));
            for (const row of rows ?? []) {
                parts.push(row.map((c) => String(c['text'] ?? '')).join(' — '));
            }
        } else if (typeof t['text'] === 'string' && !t['tokens'] && !t['items']) {
            parts.push(t['text'] as string);
        } else if (Array.isArray(t['items'])) {
            parts.push(tokenText(t['items'] as Array<Record<string, unknown>>));
        } else if (Array.isArray(t['tokens'])) {
            parts.push(tokenText(t['tokens'] as Array<Record<string, unknown>>));
        } else if (typeof t['text'] === 'string') {
            parts.push(t['text'] as string);
        }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** FAQPage mainEntity derived from the FAQ's `###` questions, via the lexer. */
function buildFaqEntities(md: string): JsonLdNode[] {
    const tokens = marked.lexer(md) as unknown as Array<Record<string, unknown>>;
    const entities: JsonLdNode[] = [];
    let question: string | null = null;
    let answerTokens: Array<Record<string, unknown>> = [];
    const flush = () => {
        if (question) {
            const answer = tokenText(answerTokens);
            if (answer) {
                entities.push({
                    '@type': 'Question',
                    name: question,
                    acceptedAnswer: { '@type': 'Answer', text: answer },
                });
            }
        }
        question = null;
        answerTokens = [];
    };
    for (const t of tokens) {
        if (t['type'] === 'heading' && (t['depth'] as number) <= 3) {
            flush();
            if ((t['depth'] as number) === 3) question = String(t['text'] ?? '').trim();
        } else if (question) {
            answerTokens.push(t);
        }
    }
    flush();
    return entities;
}

/** The JSON-LD graph for one guide, serialised for the committed shell. */
export function buildGuideJsonLd(root: string, mdName: string, shell: string, articleHtml: string): string {
    const canonical = canonicalOf(shell);
    const headline = firstHeadline(articleHtml) || metaContent(shell, 'description');
    const graph: JsonLdNode[] = [];

    graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://pdfnative.dev/' },
            { '@type': 'ListItem', position: 2, name: 'Guides', item: 'https://pdfnative.dev/guides/' },
            { '@type': 'ListItem', position: 3, name: headline, item: canonical },
        ],
    });

    // No dateModified: schema.org defines it as the date the WORK was last
    // modified, and the only honest per-guide source (git history) is not
    // available to the CI verifier's shallow checkout. Stamping the manifest's
    // verifiedOn here claimed a modification date for guides whose Markdown
    // had not changed — a false date is worse than no date.
    graph.push({
        '@type': 'TechArticle',
        headline,
        description: metaContent(shell, 'description'),
        inLanguage: 'en',
        author: { '@type': 'Organization', name: 'Nizoka', url: 'https://github.com/Nizoka' },
        publisher: {
            '@type': 'Organization',
            name: 'pdfnative',
            url: 'https://pdfnative.dev',
            logo: { '@type': 'ImageObject', url: 'https://pdfnative.dev/assets/logo.svg' },
        },
        mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
        isPartOf: { '@type': 'WebSite', name: 'pdfnative', url: 'https://pdfnative.dev' },
    });

    if (mdName === 'faq.md') {
        const md = lf(readFileSync(join(root, 'docs', 'guides', mdName), 'utf8'));
        const mainEntity = buildFaqEntities(md);
        if (mainEntity.length > 0) graph.push({ '@type': 'FAQPage', mainEntity });
    }

    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

// ── Shell surgery ───────────────────────────────────────────────────

const ARTICLE_RE = /(<article id="guide-content"[^>]*>)([\s\S]*?)(<\/article>)/;
const LD_BLOCK_RE = /[ \t]*<!-- guide:ld:start -->[\s\S]*?<!-- guide:ld:end -->\n?/;
const MD_ALT_RE = /([ \t]*)(<link rel="alternate" type="text\/markdown"[^>]*>)/;

/** Return the fully updated shell for one guide (deterministic). */
export function applyGuideRender(root: string, htmlName: string): string {
    const path = join(root, 'docs', 'guides', htmlName);
    let shell = lf(readFileSync(path, 'utf8'));

    const article = shell.match(ARTICLE_RE);
    if (!article) return shell;
    const mdAttr = article[1].match(/data-md="([^"]+)"/);
    if (!mdAttr) return shell;
    const mdName = mdAttr[1];
    if (!existsSync(join(root, 'docs', 'guides', mdName))) return shell;

    const rendered = renderGuideArticle(root, mdName);

    // Article: replace inner content, mark as pre-rendered for guide.js.
    let openTag = article[1];
    if (!openTag.includes('data-prerendered')) {
        openTag = openTag.replace(/>$/, ' data-prerendered="true">');
    }
    shell = shell.replace(
        ARTICLE_RE,
        () => `${openTag}\n<!-- guide:render:start -->\n${rendered}<!-- guide:render:end -->\n  ${article[3]}`,
    );

    // Head: llms.txt discovery link, right after the markdown alternate.
    if (!shell.includes('href="../llms.txt"')) {
        shell = shell.replace(
            MD_ALT_RE,
            '$1$2\n$1<link rel="alternate" type="text/plain" href="../llms.txt" title="llms.txt — machine-readable documentation index">',
        );
    }

    // Head: server-side JSON-LD between markers (replace any previous block).
    const ld = buildGuideJsonLd(root, mdName, shell, rendered);
    const ldBlock = `  <!-- guide:ld:start -->\n  <script type="application/ld+json">${ld}</script>\n  <!-- guide:ld:end -->\n`;
    shell = shell.replace(LD_BLOCK_RE, '');
    // Function replacer: the JSON-LD may legitimately contain `$'`/`$&`
    // sequences (e.g. a FAQ answer about regex replacement patterns), which a
    // string replacement would expand into silent corruption.
    shell = shell.replace(/<\/head>/, () => `${ldBlock}</head>`);

    return shell;
}

/** All guide shells that pair with a Markdown source, alphabetical. */
export function listGuideShells(root: string): string[] {
    const dir = join(root, 'docs', 'guides');
    return readdirSync(dir)
        .filter((f) => f.endsWith('.html') && f !== 'index.html')
        .filter((f) => existsSync(join(dir, f.replace(/\.html$/, '.md'))))
        .sort();
}

// Exact-path check: a substring test would make any importer whose argv[1]
// merely contains "build-guides" rewrite 30 shells as an import side effect.
const isMain = import.meta.filename === resolve(process.argv[1] ?? '');
if (isMain) {
    const root = resolve(import.meta.dirname, '..');
    let changed = 0;
    for (const htmlName of listGuideShells(root)) {
        const path = join(root, 'docs', 'guides', htmlName);
        const before = readFileSync(path, 'utf8');
        const after = applyGuideRender(root, htmlName);
        if (before !== after) {
            writeFileSync(path, after);
            changed++;
        }
    }
    console.log(`build-guides: ${changed} shell(s) updated, ${listGuideShells(root).length} total.`);
}
