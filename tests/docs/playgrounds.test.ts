/**
 * Playground code views (`docs/playgrounds/*.html`).
 *
 * Every playground with a `#code-view` shows one snippet per preset (the
 * `CODE` object of its inline module script) and offers it through a Copy
 * button; llms.txt and agent-brief.md promise that the snippet reproduces
 * the result outside the browser. The 1.8.0 review found 11 of the 14
 * typography and print views referencing identifiers they never declared.
 *
 * This suite extracts the `CODE` object of every such page and runs every
 * view in Node: `import { … } from 'pdfnative'` becomes a destructuring of
 * the in-repo entry point, `import('pdfnative/fonts/<name>')` resolves to
 * the bundled font module, `fetch()` of the synthetic CMYK profile serves
 * `docs/assets/synthetic-cmyk.icc`, and `downloadBlob` captures the bytes.
 * A page whose manifest entry says `selfContained: false` is skipped with
 * its note; a page that claims `true` is held to it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PLAYGROUNDS = join(ROOT, 'docs', 'playgrounds');
const MANIFEST = join(ROOT, 'docs', 'data', 'playgrounds.json');
const ICC_URL = 'https://pdfnative.dev/assets/synthetic-cmyk.icc';
const ICC_FILE = join(ROOT, 'docs', 'assets', 'synthetic-cmyk.icc');

interface ManifestEntry {
    readonly id: string;
    readonly file: string;
    readonly codeView: string | null;
    readonly selfContained?: boolean;
    readonly note?: string;
}

/** Font modules a view may import through `pdfnative/fonts/<name>`. */
const FONT_MODULES: Record<string, () => Promise<unknown>> = {
    'noto-sans-data.js': () => import('../../fonts/noto-sans-data.js'),
};

/**
 * Slice the `const CODE = { … };` object literal out of a page. The values are
 * template strings that may themselves contain `\n};` (an object literal inside
 * a view), so the closing `};` is the first one at column 0 that leaves an even
 * count of unescaped backticks behind it.
 */
function extractCodeObject(html: string): string {
    const start = html.indexOf('\nconst CODE = {');
    expect(start, 'page declares `const CODE = {`').toBeGreaterThan(-1);
    const bodyStart = start + '\nconst CODE = '.length;
    const re = /\n\};/g;
    re.lastIndex = start;
    for (let m = re.exec(html); m !== null; m = re.exec(html)) {
        const segment = html.slice(bodyStart, m.index);
        let backticks = 0;
        for (let i = 0; i < segment.length; i++) {
            if (segment[i] === '\\') { i++; continue; }
            if (segment[i] === '`') backticks++;
        }
        if (backticks % 2 === 0) return html.slice(bodyStart, m.index + '\n}'.length);
    }
    throw new Error('unterminated CODE object');
}

// The CODE object is plain JavaScript (template strings, no page variables):
// evaluating the literal itself reproduces exactly what the browser shows.
type ObjectFactory = () => Record<string, string>;
const ObjectFn = Function as unknown as new (body: string) => ObjectFactory;
function loadCodeViews(file: string): Record<string, string> {
    const html = readFileSync(join(PLAYGROUNDS, file), 'utf8');
    return new ObjectFn('return (' + extractCodeObject(html) + ')')();
}

/** A view as the visitor copies it, rewritten to run against the in-repo tree. */
function toNodeSource(view: string): string {
    return view
        .replace(/^import\s*\{([^}]+)\}\s*from\s*'pdfnative';/gm, 'const {$1} = pdfnative;')
        .replace(/import\('pdfnative\/fonts\/([^']+)'\)/g, "fonts['$1']()");
}

type ViewRunner = (
    pdfnative: Record<string, unknown>,
    fonts: Record<string, () => Promise<unknown>>,
    fetch: (url: string) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>,
    console: Record<'log' | 'warn' | 'error', (...args: unknown[]) => void>,
) => Promise<void>;
const AsyncFn = Object.getPrototypeOf(async function () { /* prototype probe */ }).constructor as
    new (...params: string[]) => ViewRunner;

interface RunResult {
    readonly bytes: Uint8Array | null;
    readonly warn: string[];
    readonly error: string[];
    readonly log: string[];
}

async function runView(view: string): Promise<RunResult> {
    const lib = (await import('../../src/index.js')) as Record<string, unknown>;
    let bytes: Uint8Array | null = null;
    const pdfnative = { ...lib, downloadBlob: (b: Uint8Array) => { bytes = b; } };
    const out: { warn: string[]; error: string[]; log: string[] } = { warn: [], error: [], log: [] };
    const line = (args: unknown[]): string => args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    const console = {
        log: (...args: unknown[]) => { out.log.push(line(args)); },
        warn: (...args: unknown[]) => { out.warn.push(line(args)); },
        error: (...args: unknown[]) => { out.error.push(line(args)); },
    };
    const fetch = async (url: string) => {
        expect(url, 'views may only fetch the synthetic profile').toBe(ICC_URL);
        const icc = readFileSync(ICC_FILE);
        return { arrayBuffer: async () => icc.buffer.slice(icc.byteOffset, icc.byteOffset + icc.byteLength) };
    };
    const run = new AsyncFn('pdfnative', 'fonts', 'fetch', 'console', toNodeSource(view));
    await run(pdfnative, FONT_MODULES, fetch, console);
    return { bytes, ...out };
}

function pdfHeader(bytes: Uint8Array | null): string {
    return bytes ? String.fromCharCode(...bytes.subarray(0, 5)) : '';
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { playgrounds: ManifestEntry[] };
const pages = manifest.playgrounds.filter(
    e => e.codeView === '#code-view' && readFileSync(join(PLAYGROUNDS, e.file), 'utf8').includes('\nconst CODE = {'),
);

// The bundled Noto Sans data module is large; its first import dominates the runtime.
describe('playground code views run outside the browser', { timeout: 60_000 }, () => {
    it('covers every page that ships a CODE object', () => {
        expect(pages.map(p => p.id).sort()).toEqual(['authoring-plus', 'charts', 'print', 'reproducible', 'toolkit', 'typography']);
    });

    for (const page of pages) {
        if (page.selfContained !== true) {
            it.skip(`${page.id}: skipped — ${page.note ?? 'selfContained is not true in docs/data/playgrounds.json'}`, () => {});
            continue;
        }
        const views = loadCodeViews(page.file);
        expect(Object.keys(views).length, `${page.id} has code views`).toBeGreaterThan(0);

        for (const [key, view] of Object.entries(views)) {
            it(`${page.id} / ${key}`, async () => {
                expect(view.startsWith("import {"), 'the first line imports from pdfnative').toBe(true);
                expect(view, 'imports only from pdfnative').not.toMatch(/from\s+'(?!pdfnative')/);
                expect(view, 'loads no module from a CDN').not.toMatch(/import\('https?:/);

                const result = await runView(view);

                if (page.id === 'print' && key === 'errors') {
                    // No PDF: four incoherent PDF/X configurations, four thrown messages.
                    expect(result.bytes).toBeNull();
                    expect(result.error).toHaveLength(4);
                    expect(result.error[0]).toContain('layout.pdfx and layout.tagged cannot be combined');
                    expect(result.error[1]).toContain('PDF/X forbids encryption');
                    expect(result.error[2]).toContain('PDF/X-4 requires layout.outputIntent');
                    expect(result.error[3]).toContain('PDF/X requires the trapping state to be known');
                    return;
                }

                expect(pdfHeader(result.bytes), 'downloadBlob received a PDF').toBe('%PDF-');

                if (page.id === 'print' && key === 'pdfx') {
                    const { validatePdfX } = await import('../../src/index.js');
                    const report = validatePdfX(result.bytes!);
                    expect(report.errors).toEqual([]);
                    expect(report.valid).toBe(true);
                    expect(result.log.join('\n')).toContain('validatePdfX: valid');
                }
                if (page.id === 'typography') {
                    if (key === 'figures-tnum') {
                        expect(result.warn.some(l => l.startsWith('TYPOGRAPHY_FEATURE_INEFFECTIVE'))).toBe(true);
                    } else {
                        expect(result.warn, 'a coherent build raises no diagnostic').toEqual([]);
                    }
                }
                if (page.id === 'print') {
                    expect(result.warn, 'a coherent print job raises no diagnostic').toEqual([]);
                }
            });
        }
    }
});
