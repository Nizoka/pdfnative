#!/usr/bin/env tsx
/**
 * pdfnative — Claude Code rules generator
 * ========================================
 * `.github/instructions/*.instructions.md` are the per-area rules (Copilot
 * reads their `applyTo` frontmatter). Claude Code reads the same idea from
 * `.claude/rules/*.md` with a `paths:` frontmatter, and loads a rule only when
 * a touched file matches — so the instruction files stay the single source of
 * truth and this script projects them. Every generated rule is scoped: a rule
 * without `paths` would load on every session and blow the context budget
 * that `verify:docs` (`claude-rules-budget`) enforces.
 *
 * Usage:
 *   npm run agents:rules             # (re)generate .claude/rules/, delete orphans
 *   npm run agents:rules -- --check  # exit 1 listing stale / missing / extra rules
 *   npm run agents:rules -- --json   # machine-readable diff, no writes
 *
 * Exit: 0 in sync (or generated), 1 when --check finds drift or a source has
 * no `applyTo` (named in the output). Pure Node + tsx, zero dependencies; the
 * logic lives in scripts/lib/agent-config.ts and is unit-tested there.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUCTIONS_DIR, RULES_DIR, diffRules, type RulesDiff } from './lib/agent-config.js';

/** `name → text` of every instruction file under `<root>/.github/instructions/`. */
export function readInstructionSources(root: string): Record<string, string> {
    const dir = join(root, INSTRUCTIONS_DIR);
    const out: Record<string, string> = {};
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.instructions.md')).sort()) {
        out[name] = readFileSync(join(dir, name), 'utf8');
    }
    return out;
}

/** `name → text` of every rule file under `<root>/.claude/rules/`. */
export function readRuleFiles(root: string): Record<string, string> {
    const dir = join(root, RULES_DIR);
    const out: Record<string, string> = {};
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
        out[name] = readFileSync(join(dir, name), 'utf8');
    }
    return out;
}

export function diffClaudeRules(root: string): RulesDiff {
    return diffRules(readInstructionSources(root), readRuleFiles(root));
}

function main(argv: readonly string[]): number {
    const root = resolve(import.meta.dirname, '..');
    const check = argv.includes('--check');
    const json = argv.includes('--json');
    const diff = diffClaudeRules(root);

    if (json) {
        const { stale, missing, extra, invalid } = diff;
        console.log(JSON.stringify({ stale, missing, extra, invalid, inSync: stale.length + missing.length + extra.length + invalid.length === 0 }, null, 2));
        return diff.invalid.length > 0 || (check && !(diff.stale.length === 0 && diff.missing.length === 0 && diff.extra.length === 0)) ? 1 : 0;
    }

    for (const bad of diff.invalid) {
        console.error(`build-claude-rules: refusing ${INSTRUCTIONS_DIR}/${bad.source} — ${bad.error}`);
    }
    if (diff.invalid.length > 0) return 1;

    if (check) {
        const drift = [
            ...diff.stale.map((f) => `stale    ${RULES_DIR}/${f}`),
            ...diff.missing.map((f) => `missing  ${RULES_DIR}/${f}`),
            ...diff.extra.map((f) => `extra    ${RULES_DIR}/${f}`),
        ];
        if (drift.length === 0) {
            console.log(`build-claude-rules: ${Object.keys(diff.expected).length} rules in sync with ${INSTRUCTIONS_DIR}/.`);
            return 0;
        }
        for (const line of drift) console.error(`build-claude-rules: ${line}`);
        console.error('build-claude-rules: run `npm run agents:rules` to regenerate.');
        return 1;
    }

    const dir = join(root, RULES_DIR);
    mkdirSync(dir, { recursive: true });
    let written = 0;
    for (const [name, content] of Object.entries(diff.expected)) {
        const target = join(dir, name);
        if (existsSync(target) && readFileSync(target, 'utf8') === content) continue;
        writeFileSync(target, content, 'utf8');
        written++;
    }
    for (const orphan of diff.extra) unlinkSync(join(dir, orphan));
    console.log(`build-claude-rules: ${Object.keys(diff.expected).length} rules (${written} written, ${diff.extra.length} orphan${diff.extra.length === 1 ? '' : 's'} removed) in ${RULES_DIR}/.`);
    return 0;
}

// Run only when invoked directly (keeps the module import-safe for verify-docs and tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    process.exit(main(process.argv));
}
