#!/usr/bin/env tsx
/**
 * pdfnative — api.json generator
 * ==============================
 * Emits `docs/assets/api.json`: the public API surface of the engine, derived
 * mechanically from the export statements of `src/index.ts` — name, kind
 * (value or type), source module, and, when extractable, the declaration's
 * signature line and the first sentence of its TSDoc.
 *
 * Why: `dist/index.d.ts` is gitignored and never served, so an agent that has
 * not run `npm install` has no source of truth for what pdfnative exports or
 * what a function's shape is — the root condition for hallucinated APIs. This
 * file is committed, served at https://pdfnative.dev/assets/api.json, listed
 * in llms.txt, and policed by the `api-json-sync` rule of verify-docs (same
 * pattern as llms-full.txt): regenerate with `npm run docs:api`.
 *
 * Honesty rule: fields that cannot be extracted mechanically are `null`,
 * never guessed. The signature text is the declaration as written in source
 * (first line, normalised whitespace), not a reconstruction.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

interface ApiEntry {
    name: string;
    kind: 'value' | 'type';
    module: string;
    signature: string | null;
    summary: string | null;
}

/** First sentence of the JSDoc block immediately above `index` in `text`. */
function docSummaryAbove(text: string, index: number): string | null {
    const before = text.slice(0, index);
    // Tempered body — cannot cross a `*/` — so this can only match the block
    // IMMEDIATELY above the declaration; a lazy [\s\S]*? here would match from
    // the file's banner comment and attribute it to every symbol.
    const m = before.match(/\/\*\*((?:[^*]|\*(?!\/))*)\*\/\s*$/);
    if (!m) return null;
    const body = m[1]
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter((l) => l && !l.startsWith('@') && !/^[=\-─═]{3,}$/.test(l))
        .join(' ');
    const sentence = body.match(/^(.*?[.!?])(\s|$)/);
    const summary = (sentence ? sentence[1] : body).replace(/\{@link\s+([^}|]+)(?:\|[^}]*)?\}/g, '$1').trim();
    return summary.length > 0 ? summary.slice(0, 240) : null;
}

/** Declaration line for `name` in `text`, normalised, or null. */
function declarationOf(text: string, name: string): { signature: string | null; summary: string | null } {
    const re = new RegExp(
        `export\\s+(?:async\\s+)?(?:function\\*?|const|let|class|type|interface|enum)\\s+${name}\\b[^\\n]*`,
    );
    const m = re.exec(text);
    if (!m) return { signature: null, summary: null };
    let sig = m[0];
    // Functions: extend to the closing paren of the parameter list (may span lines).
    if (/export\s+(?:async\s+)?function/.test(sig) && !/\)/.test(sig)) {
        const rest = text.slice(m.index + m[0].length);
        const upTo = rest.slice(0, rest.indexOf(')') + 1 + (rest.slice(rest.indexOf(')') + 1).match(/^[^\n{;]*/)?.[0].length ?? 0));
        sig += upTo;
    }
    sig = sig.replace(/\s+/g, ' ').replace(/\s*\{\s*$/, '').trim();
    return { signature: sig.length > 300 ? sig.slice(0, 297) + '…' : sig, summary: docSummaryAbove(text, m.index) };
}

/** Build the api.json content for the repo rooted at `root`. */
export function buildApiJson(root: string): string {
    const indexPath = join(root, 'src', 'index.ts');
    const index = lf(readFileSync(indexPath, 'utf8'));
    const entries: ApiEntry[] = [];
    const seen = new Set<string>();
    const moduleCache = new Map<string, string>();

    const readModule = (spec: string): string => {
        if (moduleCache.has(spec)) return moduleCache.get(spec)!;
        const path = join(dirname(indexPath), spec.replace(/\.js$/, '.ts'));
        const text = existsSync(path) ? lf(readFileSync(path, 'utf8')) : '';
        moduleCache.set(spec, text);
        return text;
    };

    // `export { a, b as c } from './x.js'` and `export type { … } from './x.js'`
    const RE_BLOCK = /export\s*(type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = RE_BLOCK.exec(index)) !== null) {
        const blockIsType = Boolean(m[1]);
        const spec = m[3];
        const moduleText = readModule(spec);
        for (const raw of m[2].split(',')) {
            const piece = raw.trim();
            if (!piece) continue;
            const isType = blockIsType || piece.startsWith('type ');
            const name = piece.replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const { signature, summary } = declarationOf(moduleText, name);
            entries.push({
                name,
                kind: isType ? 'type' : 'value',
                module: spec.replace(/^\.\//, 'src/').replace(/\.js$/, '.ts'),
                signature,
                summary,
            });
        }
    }

    // Direct declarations in index.ts itself (if any).
    for (const d of index.matchAll(/export\s+(?:async\s+)?(function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_]\w*)/g)) {
        const name = d[2];
        if (seen.has(name)) continue;
        seen.add(name);
        const isType = d[1] === 'type' || d[1] === 'interface';
        const { signature, summary } = declarationOf(index, name);
        entries.push({ name, kind: isType ? 'type' : 'value', module: 'src/index.ts', signature, summary });
    }

    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const out = {
        $comment:
            'Public API surface of pdfnative, derived mechanically from the export statements of src/index.ts by scripts/build-api-json.ts and policed by the api-json-sync rule of scripts/verify-docs.ts. Fields that cannot be extracted mechanically are null, never guessed. Regenerate with `npm run docs:api`.',
        package: 'pdfnative',
        source: 'src/index.ts',
        exportCount: entries.length,
        exports: entries,
    };
    return JSON.stringify(out, null, 2) + '\n';
}

const isMain = process.argv[1] && resolve(process.argv[1]).includes('build-api-json');
if (isMain) {
    const root = resolve(import.meta.dirname, '..');
    const out = join(root, 'docs', 'assets', 'api.json');
    writeFileSync(out, buildApiJson(root));
    const count = (JSON.parse(buildApiJson(root)) as { exportCount: number }).exportCount;
    console.log(`build-api-json: wrote ${out} (${count} exports)`);
}
