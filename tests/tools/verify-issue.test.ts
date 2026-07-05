import { describe, it, expect } from 'vitest';
import { validateIssueMarkdown } from '../../scripts/verify-issue.mjs';

// #56 — AI governance: the draft-issue verifier enforces the zero-dependency
// policy and a mandatory reproduction code block, and warns on missing fields.

const GOOD = `# Bug: table clips descenders

## Environment
- pdfnative 1.5.0, Node 22, Windows

## Expected behavior
Descenders render fully.

## Minimal reproduction
\`\`\`ts
console.log("repro");
\`\`\`
`;

describe('verify-issue draft validator (#56)', () => {
    it('passes a well-formed draft', () => {
        const r = validateIssueMarkdown(GOOD);
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('rejects an npm install dependency request', () => {
        const r = validateIssueMarkdown('# X\nRun npm install left-pad\n```ts\nx\n```');
        expect(r.ok).toBe(false);
        expect(r.errors.some(e => /dependency/i.test(e))).toBe(true);
    });

    it('rejects yarn/pnpm/bun add', () => {
        for (const cmd of ['yarn add foo', 'pnpm add foo', 'bun add foo']) {
            const r = validateIssueMarkdown(`# X\n${cmd}\n\`\`\`ts\nx\n\`\`\``);
            expect(r.ok).toBe(false);
        }
    });

    it('rejects a draft without a reproduction code block', () => {
        const r = validateIssueMarkdown('# X\n## Environment\nNode 22\n## Expected behavior\nok');
        expect(r.ok).toBe(false);
        expect(r.errors.some(e => /reproduction code block/i.test(e))).toBe(true);
    });

    it('does not flag the mere word "dependencies" in prose', () => {
        const r = validateIssueMarkdown('# X\nThis is about the zero-dependencies policy.\n```ts\nx\n```');
        expect(r.ok).toBe(true);
    });

    it('warns (not errors) on missing recommended fields', () => {
        const r = validateIssueMarkdown('# X\n```ts\nx\n```');
        expect(r.ok).toBe(true);
        expect(r.warnings.length).toBeGreaterThan(0);
    });
});
