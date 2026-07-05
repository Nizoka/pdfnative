/**
 * pdfnative — Draft Issue Verifier
 * =================================
 * Validates a locally-drafted issue markdown against the project's AI
 * governance policy (.github/ai-governance.json) BEFORE a human reviews and
 * submits it. This is a guardrail, never an autonomous submitter.
 *
 * Checks:
 *   1. No external runtime-dependency requests (install commands / additions to
 *      a `dependencies` block) — enforces the zero-dependency policy.
 *   2. A reproduction code block (fenced ``` … ```) is present.
 *   3. (Advisory) The required issue fields are documented.
 *
 * Usage:  node scripts/verify-issue.mjs .github/drafts/my-issue.md
 * Exit:   0 on pass, 1 on policy violation, 2 on usage/IO error.
 *
 * The validation logic is exported as a pure function so it can be unit-tested
 * without touching the filesystem.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Patterns that indicate an external dependency is being proposed. */
const DEPENDENCY_PATTERNS = [
    /\bnpm\s+(install|i|add)\s+(?!--)[a-z@]/i,
    /\b(yarn|pnpm|bun)\s+add\s+/i,
    /\bpnpm\s+install\s+[a-z@]/i,
    /add\s+[`"']?[\w@/-]+[`"']?\s+to\s+(the\s+)?(runtime\s+)?dependencies\b/i,
    /"dependencies"\s*:\s*\{[^}]*[\w-]+[^}]*\}/i,
];

/** Required issue fields (advisory — surfaced as warnings when missing). */
const REQUIRED_FIELDS = [
    { key: 'minimal_reproduction', re: /repro|reproduc/i },
    { key: 'environment', re: /environment|version|node|os\b/i },
    { key: 'expected_behavior', re: /expected/i },
];

/**
 * Validate the text of a draft issue.
 *
 * @param {string} content Raw markdown.
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateIssueMarkdown(content) {
    const errors = [];
    const warnings = [];

    for (const re of DEPENDENCY_PATTERNS) {
        if (re.test(content)) {
            errors.push('Proposing an external dependency violates the zero-dependency policy.');
            break;
        }
    }

    const hasCodeBlock = /```[\s\S]*?```/.test(content);
    if (!hasCodeBlock) {
        errors.push('No reproduction code block found — include a minimal repro inside a fenced ``` block.');
    }

    for (const field of REQUIRED_FIELDS) {
        if (!field.re.test(content)) {
            warnings.push(`Recommended field appears to be missing: ${field.key}.`);
        }
    }

    return { ok: errors.length === 0, errors, warnings };
}

// ── CLI ──────────────────────────────────────────────────────────────

function main(argv) {
    const path = argv[2];
    if (!path) {
        console.error('Usage: node scripts/verify-issue.mjs <draft.md>');
        return 2;
    }

    let content;
    try {
        content = readFileSync(path, 'utf8');
    } catch (err) {
        console.error(`Cannot read "${path}": ${err instanceof Error ? err.message : String(err)}`);
        return 2;
    }

    const { ok, errors, warnings } = validateIssueMarkdown(content);

    for (const w of warnings) console.warn(`warning: ${w}`);
    if (!ok) {
        for (const e of errors) console.error(`error: ${e}`);
        console.error('Issue validation FAILED. A human must resolve these before submission.');
        return 1;
    }

    console.log('Issue validation passed. Reminder: this draft must be reviewed and submitted by a human under their own GitHub identity.');
    return 0;
}

// Run only when invoked directly (keeps the module import-safe for tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exit(main(process.argv));
}
