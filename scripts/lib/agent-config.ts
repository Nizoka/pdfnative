/**
 * pdfnative — agent configuration checks
 * =======================================
 * Pure functions over file contents and paths, shared by
 * `scripts/verify-docs.ts` (rules `agent-config-parity`, `claude-rules-sync`,
 * `claude-rules-budget`, `pr-template-parity`, `eol-lf`, `skills-shape` and
 * the `node-pin-parity` / `ruleset-parity` extensions) and by
 * `scripts/build-claude-rules.ts` (the `.claude/rules/` generator). Nothing
 * here reads the filesystem or spawns a process: callers hand in the bytes,
 * so `tests/tools/agent-config.test.ts` covers every branch with inline
 * fixtures.
 */

export interface Finding {
    readonly severity: 'error' | 'warn';
    readonly file: string;
    readonly line: number;
    readonly message: string;
}

function error(file: string, message: string, line = 1): Finding {
    return { severity: 'error', file, line, message };
}

function warning(file: string, message: string, line = 1): Finding {
    return { severity: 'warn', file, line, message };
}

function lf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

// ── Claude Code rules generated from .github/instructions ────────────

export const INSTRUCTIONS_DIR = '.github/instructions';
export const RULES_DIR = '.claude/rules';
export const RULES_GENERATOR = 'scripts/build-claude-rules.ts';

export interface ParsedInstruction {
    readonly applyTo: readonly string[];
    readonly description: string | null;
    readonly body: string;
}

export interface InstructionError {
    readonly error: string;
}

/** Split a `key: value` frontmatter block; returns null when the file has none. */
function frontmatter(text: string): { fields: Map<string, string>; body: string } | null {
    const normalised = lf(text);
    if (!normalised.startsWith('---\n')) return null;
    const end = normalised.indexOf('\n---', 4);
    if (end === -1) return null;
    const block = normalised.slice(4, end);
    const afterFence = normalised.indexOf('\n', end + 1);
    const body = afterFence === -1 ? '' : normalised.slice(afterFence + 1);
    const fields = new Map<string, string>();
    let current: string | null = null;
    for (const line of block.split('\n')) {
        const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if (kv) {
            current = kv[1];
            fields.set(current, kv[2].trim());
        } else if (current !== null && /^\s+-\s+/.test(line)) {
            // A YAML list continues the current key: `paths:\n  - "a"\n  - "b"`.
            const item = line.replace(/^\s+-\s+/, '').trim();
            const prev = fields.get(current) ?? '';
            fields.set(current, prev === '' ? item : `${prev},${item}`);
        }
    }
    return { fields, body };
}

function unquote(value: string): string {
    return value.replace(/^["']|["']$/g, '');
}

/** Parse a Copilot instruction file: `applyTo` (required, comma-separated globs), `description`, body. */
export function parseInstruction(text: string): ParsedInstruction | InstructionError {
    const fm = frontmatter(text);
    if (fm === null) return { error: 'no frontmatter block (--- … ---) at the top of the file' };
    const applyRaw = fm.fields.get('applyTo');
    if (applyRaw === undefined || unquote(applyRaw).trim() === '') {
        return { error: 'frontmatter has no `applyTo` — every instruction file must scope itself to paths' };
    }
    const applyTo = unquote(applyRaw)
        .split(',')
        .map((g) => unquote(g.trim()))
        .filter((g) => g.length > 0);
    const description = fm.fields.has('description') ? unquote(fm.fields.get('description') ?? '') : null;
    return { applyTo, description, body: fm.body };
}

/** `pdf-core.instructions.md` → `pdf-core.md`. */
export function ruleNameFor(sourceName: string): string {
    return sourceName.replace(/\.instructions\.md$/, '.md');
}

export function bannerFor(sourceName: string): string {
    return `<!-- GENERATED from ${INSTRUCTIONS_DIR}/${sourceName} by ${RULES_GENERATOR} — do not edit -->`;
}

/** Render the `.claude/rules/` file for one instruction source (LF endings, one trailing newline). */
export function renderRule(sourceName: string, text: string): string | InstructionError {
    const parsed = parseInstruction(text);
    if ('error' in parsed) return parsed;
    const paths = parsed.applyTo.map((g) => `  - ${JSON.stringify(g)}`).join('\n');
    const body = parsed.body.replace(/^\n+/, '').replace(/\s+$/, '');
    return `---\npaths:\n${paths}\n---\n${bannerFor(sourceName)}\n\n${body}\n`;
}

export interface RulesDiff {
    /** Rule files whose content differs from a fresh render. */
    readonly stale: string[];
    /** Instruction sources with no rule file. */
    readonly missing: string[];
    /** Rule files with no instruction source. */
    readonly extra: string[];
    /** Instruction sources the generator refuses. */
    readonly invalid: Array<{ readonly source: string; readonly error: string }>;
    /** Every expected rule file and its rendered content. */
    readonly expected: Record<string, string>;
}

/**
 * Compare the instruction sources (`name → text`) with the rule files
 * (`name → text`). Line endings are normalised for the comparison; `eol-lf`
 * is the rule that insists on LF.
 */
export function diffRules(sources: Readonly<Record<string, string>>, rules: Readonly<Record<string, string>>): RulesDiff {
    const stale: string[] = [];
    const missing: string[] = [];
    const invalid: Array<{ source: string; error: string }> = [];
    const expected: Record<string, string> = {};
    for (const source of Object.keys(sources).sort()) {
        const rendered = renderRule(source, sources[source]);
        if (typeof rendered !== 'string') {
            invalid.push({ source, error: rendered.error });
            continue;
        }
        const name = ruleNameFor(source);
        expected[name] = rendered;
        if (!(name in rules)) missing.push(name);
        else if (lf(rules[name]) !== rendered) stale.push(name);
    }
    const extra = Object.keys(rules).filter((r) => !(r in expected)).sort();
    return { stale, missing, extra, invalid, expected };
}

/** True when a rule file declares a `paths:` scope (unscoped rules load on every session). */
export function ruleHasPaths(text: string): boolean {
    const fm = frontmatter(text);
    return fm !== null && (fm.fields.get('paths') ?? '').trim() !== '';
}

// ── agent-config-parity ──────────────────────────────────────────────

export interface ClaudeSettings {
    attribution?: { commit?: unknown };
    permissions?: { allow?: unknown; deny?: unknown };
    hooks?: { PreToolUse?: unknown };
    env?: Record<string, unknown>;
}

/** The HITL command families that must stay denied in `permissions.deny`, alongside the hook. */
export const HITL_BASH_DENY_FAMILIES: readonly string[] = ['npm publish', 'git push', 'gh pr create', 'gh issue create', 'gh release'];

/**
 * The globs of the "Never Read …" bullet in CLAUDE.md §Token discipline: the
 * backticked tokens of the bullet line and its indented continuation lines.
 */
export function neverReadGlobs(claudeMd: string): string[] {
    const lines = lf(claudeMd).split('\n');
    const start = lines.findIndex((l) => /^-\s+Never Read\b/.test(l));
    if (start === -1) return [];
    const bullet: string[] = [lines[start]];
    for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) bullet.push(lines[i]);
    const globs: string[] = [];
    for (const m of bullet.join(' ').matchAll(/`([^`]+)`/g)) {
        const token = m[1].trim();
        // The bullet also names `.claude/settings.json` and lookup files; only
        // path-like tokens with a glob or a trailing slash, or a bulk file, are
        // deny targets.
        if (/[*]/.test(token) || token.endsWith('/') || /^(?:package-lock\.json|docs\/llms-(?:full|recipes)\.txt|docs\/llms-index\.json)$/.test(token)) {
            globs.push(token);
        }
    }
    return globs;
}

/** `coverage/` → `Read(coverage/**)`, `fonts/*.js` → `Read(fonts/*.js)`. */
export function denyEntryFor(glob: string): string {
    return glob.endsWith('/') ? `Read(${glob}**)` : `Read(${glob})`;
}

export interface AgentConfigInput {
    readonly settingsText: string | null;
    readonly claudeMd: string;
    readonly hook: { readonly exists: boolean; readonly checkStatus: number | null; readonly checkStderr: string };
}

export function checkAgentConfigParity(input: AgentConfigInput): Finding[] {
    const SETTINGS = '.claude/settings.json';
    const HOOK = '.claude/hooks/guard.mjs';
    const out: Finding[] = [];
    if (input.settingsText === null) {
        out.push(error(SETTINGS, 'missing — the shared Claude Code settings carry the deny list and the guard hook'));
        return out;
    }
    let settings: ClaudeSettings;
    try {
        settings = JSON.parse(input.settingsText) as ClaudeSettings;
    } catch (err) {
        out.push(error(SETTINGS, `not valid JSON — ${(err as Error).message}`));
        return out;
    }
    if (settings.attribution?.commit !== '') {
        out.push(error(SETTINGS, `attribution.commit must be "" (no Co-Authored-By trailers) — found ${JSON.stringify(settings.attribution?.commit ?? null)}`));
    }
    const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny.filter((d): d is string => typeof d === 'string') : [];
    for (const glob of neverReadGlobs(input.claudeMd)) {
        const entry = denyEntryFor(glob);
        if (!deny.includes(entry)) {
            out.push(error(SETTINGS, `CLAUDE.md says "Never Read \`${glob}\`" but permissions.deny has no ${entry}`));
        }
    }
    for (const family of HITL_BASH_DENY_FAMILIES) {
        if (!deny.some((d) => d.startsWith(`Bash(${family}`))) {
            out.push(error(SETTINGS, `permissions.deny has no Bash(${family}…) entry — the HITL gate is enforced twice, by the deny list and by the hook`));
        }
    }
    const pre = Array.isArray(settings.hooks?.PreToolUse) ? (settings.hooks.PreToolUse as Array<{ matcher?: unknown; hooks?: Array<{ command?: unknown }> }>) : [];
    const wired = pre.some((h) => h.matcher === 'Bash' && (h.hooks ?? []).some((x) => typeof x.command === 'string' && x.command.includes('guard.mjs')));
    if (!wired) out.push(error(SETTINGS, 'hooks.PreToolUse has no Bash matcher running .claude/hooks/guard.mjs'));
    if (!input.hook.exists) {
        out.push(error(HOOK, 'missing — settings.json wires it as the PreToolUse hook on Bash'));
    } else if (input.hook.checkStatus !== 0) {
        out.push(error(HOOK, `\`node --check\` fails (exit ${input.hook.checkStatus ?? 'null'}) — a broken hook refuses every Bash call: ${input.hook.checkStderr.trim().split('\n')[0] ?? ''}`));
    }
    return out;
}

// ── claude-rules-budget ──────────────────────────────────────────────

export const CLAUDE_CONTEXT_BUDGET = 16 * 1024;
export const SCOPED_RULE_WARN_BYTES = 32 * 1024;

export interface RulesBudgetInput {
    readonly claudeMd: string;
    /** `@name` imports of CLAUDE.md → their text (null when the file is missing). */
    readonly resolveImport: (name: string) => string | null;
    /** `.claude/rules/<name>` → text. */
    readonly rules: Readonly<Record<string, string>>;
}

/** The `@file` imports of CLAUDE.md (a line that is only `@path`). */
export function claudeImports(claudeMd: string): string[] {
    return lf(claudeMd)
        .split('\n')
        .map((l) => /^@(\S+)\s*$/.exec(l)?.[1])
        .filter((p): p is string => p !== undefined);
}

export function checkClaudeRulesBudget(input: RulesBudgetInput): Finding[] {
    const out: Finding[] = [];
    const parts: Array<{ name: string; bytes: number }> = [{ name: 'CLAUDE.md', bytes: Buffer.byteLength(input.claudeMd, 'utf8') }];
    for (const name of claudeImports(input.claudeMd)) {
        const text = input.resolveImport(name);
        if (text === null) out.push(error('CLAUDE.md', `imports @${name}, which does not exist`));
        else parts.push({ name, bytes: Buffer.byteLength(text, 'utf8') });
    }
    for (const [name, text] of Object.entries(input.rules).sort()) {
        const bytes = Buffer.byteLength(text, 'utf8');
        if (!ruleHasPaths(text)) {
            parts.push({ name: `${RULES_DIR}/${name}`, bytes });
            out.push(error(`${RULES_DIR}/${name}`, 'has no `paths:` scope — an unscoped rule loads on every session; generate it from an instruction file with applyTo'));
        } else if (bytes > SCOPED_RULE_WARN_BYTES) {
            out.push(warning(`${RULES_DIR}/${name}`, `${bytes} bytes — a scoped rule over ${SCOPED_RULE_WARN_BYTES} taxes every task that touches its paths; split the instruction file`));
        }
    }
    const total = parts.reduce((n, p) => n + p.bytes, 0);
    if (total > CLAUDE_CONTEXT_BUDGET) {
        out.push(error('CLAUDE.md', `${total} bytes always loaded (${parts.map((p) => `${p.name} ${p.bytes}`).join(', ')}) — the budget is ${CLAUDE_CONTEXT_BUDGET}; move detail to a scoped rule`));
    }
    return out;
}

// ── pr-template-parity ───────────────────────────────────────────────

const PR_TEMPLATE = '.github/pull_request_template.md';

/**
 * The `- [ ] …` items of a Markdown checklist, trimmed, with link targets
 * dropped (`[Release](../CONTRIBUTING.md#release)` → `[Release]`): the
 * template lives in `.github/` and must re-point relative links, but the
 * wording stays verbatim.
 */
export function checklistItems(text: string): string[] {
    return lf(text)
        .split('\n')
        .map((l) => /^\s*-\s+\[[ xX]\]\s+(.*\S)\s*$/.exec(l)?.[1])
        .filter((l): l is string => l !== undefined)
        .map((l) => l.replace(/\]\([^)]*\)/g, ']'));
}

/** The body of the `## <heading>` section of a Markdown file (up to the next `## `). */
export function markdownSection(text: string, heading: string): string | null {
    const lines = lf(text).split('\n');
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start === -1) return null;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^##\s/.test(l));
    return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

export function checkPrTemplateParity(template: string | null, contributing: string): Finding[] {
    const out: Finding[] = [];
    if (template === null) {
        out.push(error(PR_TEMPLATE, 'missing — every PR opens with the CONTRIBUTING.md checklist pre-filled'));
        return out;
    }
    const section = markdownSection(contributing, 'Pull Request Checklist');
    if (section === null) {
        out.push(error('CONTRIBUTING.md', 'has no "## Pull Request Checklist" section — the PR template mirrors it'));
        return out;
    }
    const canonical = new Set(checklistItems(section));
    const items = checklistItems(template);
    if (items.length === 0) out.push(error(PR_TEMPLATE, 'has no `- [ ]` checklist items'));
    const lines = lf(template).split('\n');
    for (const item of items) {
        if (canonical.has(item)) continue;
        const line = lines.findIndex((l) => l.replace(/\]\([^)]*\)/g, ']').includes(item)) + 1;
        out.push(error(PR_TEMPLATE, `checklist item is not verbatim in CONTRIBUTING.md §Pull Request Checklist: "${item.length > 80 ? `${item.slice(0, 77)}…` : item}"`, line || 1));
    }
    if (!template.includes('npm run gate')) out.push(error(PR_TEMPLATE, 'does not mention `npm run gate` — the gate is the one command a contributor must run'));
    return out;
}

// ── eol-lf ───────────────────────────────────────────────────────────

/**
 * `'warn'` while the tree still carries CRLF blobs; flip to `'fail'` in the
 * renormalisation commit (`git add --renormalize .`, run by the maintainer
 * after `.gitattributes` gained `eol=lf`).
 */
export const EOL_LF_MODE: 'warn' | 'fail' = 'warn';

export interface EolEntry {
    readonly index: string;
    readonly worktree: string;
    readonly attrs: string;
    readonly path: string;
}

/** Parse `git ls-files --eol` output. */
export function parseLsFilesEol(output: string): EolEntry[] {
    const out: EolEntry[] = [];
    for (const line of lf(output).split('\n')) {
        const m = /^(i\/\S+)\s+(w\/\S+)\s+(attr\/[^\t]*)\t(.+)$/.exec(line);
        if (m) out.push({ index: m[1], worktree: m[2], attrs: m[3].slice('attr/'.length).trim(), path: m[4] });
    }
    return out;
}

/** Tracked text files whose blob is CRLF or mixed and that are not declared `-text` or binary. */
export function crlfTextFiles(entries: readonly EolEntry[]): EolEntry[] {
    return entries.filter((e) => (e.index === 'i/crlf' || e.index === 'i/mixed') && !/(?:^|\s)-text(?:\s|$)/.test(e.attrs) && !/\bbinary\b/.test(e.attrs));
}

export function checkEol(lsFilesEol: string, mode: 'warn' | 'fail' = EOL_LF_MODE): Finding[] {
    const offenders = crlfTextFiles(parseLsFilesEol(lsFilesEol));
    if (offenders.length === 0) return [];
    const make = mode === 'fail' ? error : warning;
    return offenders.map((e) =>
        make(e.path, `blob is ${e.index.slice(2).toUpperCase()} — .gitattributes says eol=lf; the maintainer's renormalisation commit (\`git add --renormalize .\`) rewrites it`),
    );
}

// ── node-pin-parity extension (.node-version) ────────────────────────

export interface NodePinInput {
    readonly nodeVersion: string | null;
    readonly enginesNode: string | null;
    /** Node majors of the CI matrix (empty when none is declared). */
    readonly ciMatrix: readonly number[];
}

export function checkNodeVersionPin(input: NodePinInput): Finding[] {
    const FILE = '.node-version';
    const out: Finding[] = [];
    if (input.nodeVersion === null) {
        out.push(error(FILE, 'missing — the pin fnm / volta / asdf read; it must equal the engines.node major and the lowest CI matrix version'));
        return out;
    }
    const m = /^v?(\d+)(?:\.\d+)*\s*$/.exec(input.nodeVersion);
    if (!m) {
        out.push(error(FILE, `"${input.nodeVersion.trim()}" is not a Node version (expected a bare major such as "22")`));
        return out;
    }
    const pinned = Number(m[1]);
    const enginesMajor = /(\d+)/.exec(input.enginesNode ?? '')?.[1];
    if (enginesMajor !== undefined && Number(enginesMajor) !== pinned) {
        out.push(error(FILE, `pins ${pinned} but package.json engines.node is "${input.enginesNode}" — the majors must agree`));
    }
    if (input.ciMatrix.length > 0) {
        const lowest = Math.min(...input.ciMatrix);
        if (lowest !== pinned) out.push(error(FILE, `pins ${pinned} but the lowest CI matrix version is ${lowest} — the pin is the floor CI proves`));
    }
    if (!/\n$/.test(input.nodeVersion)) out.push(warning(FILE, 'has no trailing newline'));
    return out;
}

// ── ruleset-parity extension (tags.json) ─────────────────────────────

interface Ruleset {
    target?: unknown;
    conditions?: { ref_name?: { include?: unknown } };
    rules?: Array<{ type?: unknown }>;
}

export function checkTagRuleset(text: string | null): Finding[] {
    const FILE = '.github/rulesets/tags.json';
    const out: Finding[] = [];
    if (text === null) {
        out.push(error(FILE, 'missing — the committed copy of the tag protection (refs/tags/v*: no deletion, no force-update, no update)'));
        return out;
    }
    let ruleset: Ruleset;
    try {
        ruleset = JSON.parse(text) as Ruleset;
    } catch (err) {
        out.push(error(FILE, `not valid JSON — ${(err as Error).message}`));
        return out;
    }
    if (ruleset.target !== 'tag') out.push(error(FILE, `target must be "tag" (found ${JSON.stringify(ruleset.target ?? null)})`));
    const include = Array.isArray(ruleset.conditions?.ref_name?.include) ? ruleset.conditions.ref_name.include : [];
    if (!include.includes('refs/tags/v*')) out.push(error(FILE, 'conditions.ref_name.include must contain "refs/tags/v*"'));
    const types = new Set((ruleset.rules ?? []).map((r) => r.type).filter((t): t is string => typeof t === 'string'));
    for (const required of ['deletion', 'non_fast_forward', 'update']) {
        if (!types.has(required)) out.push(error(FILE, `rules must include { "type": "${required}" }`));
    }
    if (types.has('creation')) out.push(error(FILE, 'rules must not include "creation" — the maintainer creates release tags'));
    return out;
}

// ── skills-shape ─────────────────────────────────────────────────────

export interface SkillInput {
    /** Directory name under `.claude/skills/`. */
    readonly dir: string;
    /** SKILL.md text, or null when the directory has none. */
    readonly text: string | null;
    /** Does `<name>` exist next to SKILL.md? */
    readonly existsInSkill: (name: string) => boolean;
    /** Does `<path>` exist from the repository root? */
    readonly existsInRepo: (path: string) => boolean;
}

/** Backticked file references the body makes, split into sibling names and repository paths; placeholders are skipped. */
export function skillFileReferences(body: string): { siblings: string[]; repo: string[] } {
    const siblings = new Set<string>();
    const repo = new Set<string>();
    for (const m of body.matchAll(/`([^`\s]+)`/g)) {
        const token = m[1];
        if (/[<>*$]|X\.Y|vX|\{/.test(token)) continue;
        if (/^[a-z0-9][a-z0-9-]*\.md$/.test(token)) siblings.add(token);
        else if (/^(?:\.github|\.claude|docs|scripts|tests|recipes|release-notes|src)\/[\w./-]+\.[a-z]+$/.test(token)) repo.add(token);
    }
    return { siblings: [...siblings], repo: [...repo] };
}

export function checkSkillShape(input: SkillInput): Finding[] {
    const FILE = `.claude/skills/${input.dir}/SKILL.md`;
    const out: Finding[] = [];
    if (input.text === null) {
        out.push(error(FILE, 'missing — every directory under .claude/skills/ is a skill and needs a SKILL.md'));
        return out;
    }
    const fm = frontmatter(input.text);
    if (fm === null) {
        out.push(error(FILE, 'has no frontmatter — Claude Code needs `name` and `description`'));
        return out;
    }
    const name = unquote(fm.fields.get('name') ?? '');
    if (name !== input.dir) out.push(error(FILE, `frontmatter name "${name}" must equal the directory name "${input.dir}"`));
    if (unquote(fm.fields.get('description') ?? '').trim() === '') out.push(error(FILE, 'frontmatter has no `description` — it is the only text the model sees before invoking the skill'));
    const refs = skillFileReferences(fm.body);
    for (const sibling of refs.siblings) {
        if (!input.existsInSkill(sibling)) out.push(error(FILE, `references \`${sibling}\`, which does not exist next to SKILL.md`));
    }
    for (const path of refs.repo) {
        if (!input.existsInRepo(path)) out.push(error(FILE, `references \`${path}\`, which does not exist in the repository`));
    }
    return out;
}
