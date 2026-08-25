/**
 * Executable-documentation recipes (`recipes/`).
 *
 * Every recipe is a standalone consumer example importing only from
 * 'pdfnative' (aliased to `src/index.ts` in vitest.config.ts). Each file
 * declares its machine-checkable outcomes as `@expect` header lines; this
 * suite runs every recipe and asserts each declared outcome with the
 * library's own readers (openPdf / extractText / listSignatures / the
 * layout inspector), so a recipe that drifts from the engine fails loudly
 * rather than rotting as prose. A final test keeps `recipes/index.json`
 * in lock-step with the headers on disk.
 */

import { describe, it, expect } from 'vitest';
import { createMockPki } from '../../scripts/helpers/mock-pki.js';

// Dynamic node imports via string indirection (tests avoid @types/node).
async function nodeFs(): Promise<{
    readFileSync(p: string, enc: 'utf8'): string;
    readdirSync(p: string): string[];
}> {
    return (await import('node:' + 'fs')) as never;
}

const RECIPES_DIR = `${import.meta.dirname}/../../recipes`;

function latin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

// ── The recipes ──────────────────────────────────────────────────────

describe('recipe: invoice-pdfa2b', () => {
    // The bundled Noto Sans data module is large; its first import dominates
    // the runtime and slows further under coverage instrumentation.
    it('builds a one-page PDF/A-2b invoice whose text and claim check out', { timeout: 60_000 }, async () => {
        const { run } = await import('../../recipes/invoice-pdfa2b.js');
        const { bytes, pages, text } = await run();
        expect(pages).toBe(1);
        expect(text).toContain('Invoice');
        const pdf = latin1(bytes);
        expect(pdf).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(pdf).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    });
});

describe('recipe: multipage-table', () => {
    it('paginates to two pages and repeats the header row on page 1', async () => {
        const { run } = await import('../../recipes/multipage-table.js');
        const { pages, page1Text } = await run();
        expect(pages).toBe(2);
        expect(page1Text).toContain('Description');
    });
});

describe('recipe: arabic-rtl', () => {
    it('embeds a subsetted Identity-H Arabic font on a single page', { timeout: 60_000 }, async () => {
        const { run } = await import('../../recipes/arabic-rtl.js');
        const { bytes, pages } = await run();
        expect(pages).toBe(1);
        const pdf = latin1(bytes);
        expect(pdf).toContain('/FontFile2');
        expect(pdf).toContain('/Identity-H');
    });
});

describe('recipe: signed-pades', () => {
    it('produces exactly one signed ETSI.CAdES.detached signature', async () => {
        const { run } = await import('../../recipes/signed-pades.js');
        const pki = createMockPki();
        const { signatures } = await run({
            cert: pki.signerCert,
            key: pki.signerKey,
            chain: [pki.rootCert],
        });
        expect(signatures.length).toBe(1);
        expect(signatures[0].subFilter).toBe('ETSI.CAdES.detached');
        expect(signatures[0].isPlaceholder).toBe(false);
    });
});

describe('recipe: form-fill-roundtrip', () => {
    it('fills the text field and finds the value in the flattened page text', async () => {
        const { run } = await import('../../recipes/form-fill-roundtrip.js');
        const { fields, filledValue, flattenedText } = await run();
        expect(fields.map(f => f.name)).toContain('fullName');
        expect(filledValue).toBe('Ada Lovelace');
        expect(flattenedText).toContain('Ada Lovelace');
    });
});

describe('recipe: text-extraction-rag', () => {
    it('returns reading-order text plus positioned runs', async () => {
        const { run } = await import('../../recipes/text-extraction-rag.js');
        const { pages } = await run();
        expect(pages[0].text).toContain('retrieval');
        const runs = pages[0].runs ?? [];
        expect(runs.length).toBeGreaterThan(0);
        for (const r of runs) {
            expect(Number.isFinite(r.x)).toBe(true);
            expect(Number.isFinite(r.y)).toBe(true);
            expect(Number.isFinite(r.fontSize)).toBe(true);
        }
    });
});

describe('recipe: merge-encrypted', () => {
    it('merges two documents into an AES-128 protected two-pager', { timeout: 60_000 }, async () => {
        const { run } = await import('../../recipes/merge-encrypted.js');
        const { pages, encryption } = await run();
        expect(pages).toBe(2);
        expect(encryption?.algorithm).toBe('aes128');
    });
});

describe('recipe: charts-v2', () => {
    it('renders the stacked-bar and scatter charts across two pages', async () => {
        const { run } = await import('../../recipes/charts-v2.js');
        const { pages } = await run();
        expect(pages).toBe(2);
    });
});

describe('recipe: print-bleed', () => {
    it('derives TrimBox and BleedBox from the bleed shorthand', async () => {
        const { run } = await import('../../recipes/print-bleed.js');
        const { bytes, trimBox, bleedBox } = await run();
        expect(trimBox).toEqual([8.5, 8.5, 603.78, 850.39]);
        expect(bleedBox).toEqual([0, 0, 612.28, 858.89]);
        expect(latin1(bytes)).toContain('/TrimBox');
    });
});

describe('recipe: toc-outline', () => {
    it('renders a linked TOC page and a catalog /Outlines tree', async () => {
        const { run } = await import('../../recipes/toc-outline.js');
        const { pages, hasOutlines, tocText } = await run();
        expect(pages).toBe(3);
        expect(hasOutlines).toBe(true);
        expect(tocText).toContain('Table of Contents');
    });
});

describe('recipe: watermark', () => {
    it('keeps the body text extractable alongside the watermark', async () => {
        const { run } = await import('../../recipes/watermark.js');
        const { text } = await run();
        expect(text).toContain('Confidential clause');
        expect(text).toContain('DRAFT');
    });
});

describe('recipe: streaming-large', () => {
    it('streams chunks whose concatenation matches the buffered build', { timeout: 60_000 }, async () => {
        const { run } = await import('../../recipes/streaming-large.js');
        const { pages, identical } = await run();
        expect(identical).toBe(true);
        expect(pages).toBe(8);
    });
});

describe('recipe: layout-preview', () => {
    it('reports two pages and the first block geometry without rendering', async () => {
        const { run } = await import('../../recipes/layout-preview.js');
        const { inspection } = await run();
        expect(inspection.totalPages).toBe(2);
        const first = inspection.pages[0].blocks[0];
        expect(first.type).toBe('heading');
        expect(first.page).toBe(0);
        expect(first.width).toBeGreaterThan(0);
    });
});

describe('recipe: update-metadata', () => {
    it('re-reads the incrementally updated title', async () => {
        const { run } = await import('../../recipes/update-metadata.js');
        const { title } = await run();
        expect(title).toBe('Quarterly report (revised)');
    });
});

// ── Index consistency ────────────────────────────────────────────────

interface IndexEntry {
    readonly file: string;
    readonly task: string;
    readonly surface: string;
    readonly since: string;
    readonly expects: readonly string[];
}

/** Parse the structured `@tag` lines out of a recipe's header comment. */
function parseHeader(source: string): { task: string; surface: string; since: string; expects: string[] } {
    const tags: { task?: string; surface?: string; since?: string; expects: string[] } = { expects: [] };
    const re = /^\s*\*\s*@(task|surface|since|expect)\s+(.+?)\s*$/gm;
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
        const [, tag, value] = m;
        if (tag === 'expect') tags.expects.push(value);
        else tags[tag as 'task' | 'surface' | 'since'] = value;
    }
    expect(tags.task, 'header must carry @task').toBeDefined();
    expect(tags.surface, 'header must carry @surface').toBeDefined();
    expect(tags.since, 'header must carry @since').toBeDefined();
    return { task: tags.task!, surface: tags.surface!, since: tags.since!, expects: tags.expects };
}

describe('recipes/index.json', () => {
    it('mirrors the header tags of every recipe on disk, with none missing', async () => {
        const fs = await nodeFs();
        const index = JSON.parse(fs.readFileSync(`${RECIPES_DIR}/index.json`, 'utf8')) as IndexEntry[];

        const onDisk = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.ts')).sort();
        expect(index.map(e => e.file)).toEqual(onDisk);
        // The count comes from the manifest, never a literal: derived.recipes
        // is what verify-docs asserts against the tree.
        const manifest = JSON.parse(
            fs.readFileSync(`${RECIPES_DIR}/../docs/assets/ecosystem.json`, 'utf8'),
        ) as { derived: { recipes: number } };
        expect(index.length).toBe(manifest.derived.recipes);

        for (const entry of index) {
            const source = fs.readFileSync(`${RECIPES_DIR}/${entry.file}`, 'utf8');
            const header = parseHeader(source);
            expect(header.task, `${entry.file}: @task`).toBe(entry.task);
            expect(header.surface, `${entry.file}: @surface`).toBe(entry.surface);
            expect(header.since, `${entry.file}: @since`).toBe(entry.since);
            expect(header.expects, `${entry.file}: @expect lines`).toEqual([...entry.expects]);
        }
    });

    it('recipes import only from pdfnative — never from src or relative paths', async () => {
        const fs = await nodeFs();
        const files = fs.readdirSync(RECIPES_DIR).filter(f => f.endsWith('.ts'));
        for (const file of files) {
            const source = fs.readFileSync(`${RECIPES_DIR}/${file}`, 'utf8');
            const re = /from\s+'([^']+)'/g;
            for (let m = re.exec(source); m !== null; m = re.exec(source)) {
                expect(
                    m[1] === 'pdfnative' || m[1].startsWith('pdfnative/'),
                    `${file} imports '${m[1]}'`,
                ).toBe(true);
            }
        }
    });
});
