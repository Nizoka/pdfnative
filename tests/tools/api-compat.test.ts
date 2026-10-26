import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findAllowList, parseAllowList } from '../../scripts/run-compat.js';

// v1.9.0 — the zero-breaking-change policy, half one: every export, every
// diagnostic code and every build-error message of the previous release
// still exists, with the same kind and signature (SECURITY.md §Compatibility
// promise). The fixtures are the registries as tagged (`git show
// v1.8.0:docs/assets/api.json`, `…:docs/data/errors.json`), committed so the
// check runs without git history (CI's shallow checkout). Half two is
// scripts/run-compat.ts, which runs the previous suite itself.

interface ApiExport {
    readonly name: string;
    readonly kind: string;
    readonly module: string;
    readonly signature: string | null;
}
interface ApiJson { readonly exportCount: number; readonly exports: readonly ApiExport[] }
interface ErrorsJson {
    readonly diagnostics: ReadonlyArray<{ code: string; severity: string }>;
    readonly buildErrors: ReadonlyArray<{ message: string }>;
}

const PREVIOUS = 'v1.8.0';
const previous = JSON.parse(readFileSync('tests/compat/api-1.8.0.json', 'utf8')) as ApiJson;
const current = JSON.parse(readFileSync('docs/assets/api.json', 'utf8')) as ApiJson;
const previousErrors = JSON.parse(readFileSync('tests/compat/errors-1.8.0.json', 'utf8')) as ErrorsJson;
const currentErrors = JSON.parse(readFileSync('docs/data/errors.json', 'utf8')) as ErrorsJson;

/**
 * Signatures of 1.8.0 exports that legitimately read differently today.
 * Each entry names the ledger line of release-notes/v1.9.0.md that records
 * the change; anything else that differs is a breaking change by policy.
 * Widenings (an optional parameter or member added) are the only kind the
 * ledger admits: every 1.8.0 call site compiles unchanged.
 */
const SIGNATURE_LEDGER: Readonly<Record<string, string>> = {
    // Added (spot colours): PdfSpotColor and PdfInkMix join the union; every 1.8.0 value is still accepted.
    PdfColor: 'Added — spot colours',
    PdfColorSpace: 'Added — spot colours',
    // Added (JPEG 2000): 'jpx' joins the result union; 'jpeg', 'png' and null are unchanged.
    detectImageFormat: 'Added — JPEG 2000 pass-through',
    // Added (TEXT_GLYPH_NOT_COVERED): an optional trailing callback that receives each character
    // WinAnsi cannot encode; every 1.8.0 call and every output byte are unchanged.
    toWinAnsi: 'Added — optional onMiss callback (TEXT_GLYPH_NOT_COVERED)',
    pdfString: 'Added — optional onMiss callback (TEXT_GLYPH_NOT_COVERED)',
    // Added (C20): an optional trailing `actualText` flag, default true — the 1.8.0 call shape is unchanged.
    createEncodingContext: 'Added — optional actualText flag (C20)',
};

/**
 * Build-error messages of 1.8.0 that were replaced, each with the ledger
 * entry: a message is part of the contract only as far as the ledger says,
 * since callers match on it.
 */
const MESSAGE_LEDGER: Readonly<Record<string, string>> = {
    // C14 — the joint PDF/A-2 + PDF/X-4 claim is allowed: the single refusal became two, one per excluded level.
    'layout.pdfx and layout.tagged cannot be combined — pdfnative writes one conformance claim per file; drop one of them': 'C14',
};

describe(`api-compat: the ${PREVIOUS} surface is intact`, () => {
    const now = new Map(current.exports.map((e) => [e.name, e] as const));

    it('the fixture is the tagged 1.8.0 registry (503 exports, 9 diagnostics, 23 build errors)', () => {
        expect(previous.exportCount).toBe(503);
        expect(previous.exports).toHaveLength(503);
        expect(previousErrors.diagnostics).toHaveLength(9);
        expect(previousErrors.buildErrors).toHaveLength(23);
    });

    it('every 1.8.0 export still exists with the same kind', () => {
        const missing = previous.exports.filter((e) => !now.has(e.name)).map((e) => e.name);
        expect(missing, `exports removed since ${PREVIOUS} — semver-major`).toEqual([]);
        const kindChanged = previous.exports.filter((e) => now.get(e.name)?.kind !== e.kind).map((e) => `${e.name}: ${e.kind} → ${now.get(e.name)?.kind}`);
        expect(kindChanged).toEqual([]);
    });

    it('every 1.8.0 signature is unchanged, or its change is in the ledger', () => {
        const drifted = previous.exports
            .filter((e) => now.get(e.name)?.signature !== e.signature && !(e.name in SIGNATURE_LEDGER))
            .map((e) => `${e.name}:\n  ${PREVIOUS} ${e.signature}\n  now    ${now.get(e.name)?.signature ?? '(missing)'}`);
        expect(drifted, `signatures changed since ${PREVIOUS} without a ledger entry`).toEqual([]);
        for (const name of Object.keys(SIGNATURE_LEDGER)) {
            expect(previous.exports.find((e) => e.name === name), `${name} is in the ledger but was not a ${PREVIOUS} export`).toBeDefined();
        }
    });

    it('the surface only grew: the manifest counts at least the 1.8.0 exports', () => {
        expect(current.exportCount).toBeGreaterThanOrEqual(previous.exportCount);
        expect(current.exports.length).toBe(current.exportCount);
    });
});

describe('api-compat: the error vocabulary', () => {
    it('every 1.8.0 diagnostic code still exists with the same severity', () => {
        const severities = new Map(currentErrors.diagnostics.map((d) => [d.code, d.severity] as const));
        const missing = previousErrors.diagnostics.filter((d) => !severities.has(d.code)).map((d) => d.code);
        expect(missing, `diagnostic codes removed since ${PREVIOUS} — semver-major`).toEqual([]);
        const changed = previousErrors.diagnostics.filter((d) => severities.get(d.code) !== d.severity).map((d) => `${d.code}: ${d.severity} → ${severities.get(d.code)}`);
        expect(changed, 'a diagnostic that was a warning must not start throwing, nor the reverse').toEqual([]);
    });

    it('every 1.8.0 build-error message still exists, or its replacement is in the ledger', () => {
        const messages = new Set(currentErrors.buildErrors.map((e) => e.message));
        const gone = previousErrors.buildErrors.map((e) => e.message).filter((m) => !messages.has(m) && !(m in MESSAGE_LEDGER));
        expect(gone, `build-error messages removed since ${PREVIOUS} without a ledger entry`).toEqual([]);
        for (const message of Object.keys(MESSAGE_LEDGER)) {
            expect(previousErrors.buildErrors.some((e) => e.message === message), `"${message}" is in the ledger but was not a ${PREVIOUS} message`).toBe(true);
            expect(messages.has(message), `"${message}" is in the ledger as replaced, yet still exists`).toBe(false);
        }
    });
});

describe('api-compat: the compat-previous allow-list', () => {
    it('names the previous tag, and every exclusion carries a sentence-long reason', () => {
        const path = findAllowList(process.cwd());
        expect(path).not.toBeNull();
        const allow = parseAllowList(readFileSync(path!, 'utf8'));
        expect(allow.tag).toBe(PREVIOUS);
        for (const e of allow.exclude) {
            expect(e.reason.length).toBeGreaterThan(20);
            if (e.ledger !== undefined) expect(e.ledger).toMatch(/^C\d+$/);
        }
    });

    it('rejects an allow-list without reasons or with a malformed ledger reference', () => {
        expect(() => parseAllowList(JSON.stringify({ tag: PREVIOUS, exclude: [{ pattern: 'x', reason: 'short' }] }))).toThrow(/reason/);
        expect(() => parseAllowList(JSON.stringify({ tag: PREVIOUS, exclude: [{ pattern: 'x', reason: 'a reason long enough to pass', ledger: 'nope' }] }))).toThrow(/ledger/);
        expect(() => parseAllowList(JSON.stringify({ tag: '1.8.0', exclude: [] }))).toThrow(/tag/);
    });
});
