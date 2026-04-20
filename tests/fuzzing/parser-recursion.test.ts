/**
 * Fuzz tests for parser recursion-depth protection (CWE-674).
 *
 * Verifies that deeply-nested PDF arrays/dictionaries throw a descriptive
 * error instead of overflowing the JavaScript call stack.
 */

import { describe, it, expect } from 'vitest';
import { createTokenizer } from '../../src/parser/pdf-tokenizer.js';
import { parseValue, MAX_PARSE_DEPTH } from '../../src/parser/pdf-object-parser.js';

function bytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

describe('parser — recursion depth protection', () => {
    it('exposes MAX_PARSE_DEPTH as a positive integer', () => {
        expect(Number.isInteger(MAX_PARSE_DEPTH)).toBe(true);
        expect(MAX_PARSE_DEPTH).toBeGreaterThan(0);
    });

    it('parses deeply-but-safely nested arrays below the depth cap', () => {
        const depth = Math.min(100, MAX_PARSE_DEPTH - 1);
        const src = '['.repeat(depth) + '1' + ']'.repeat(depth);
        const tok = createTokenizer(bytes(src), 0);
        expect(() => parseValue(tok)).not.toThrow();
    });

    it('rejects arrays nested beyond MAX_PARSE_DEPTH with a descriptive error', () => {
        const depth = MAX_PARSE_DEPTH + 50;
        const src = '['.repeat(depth) + '1' + ']'.repeat(depth);
        const tok = createTokenizer(bytes(src), 0);
        expect(() => parseValue(tok)).toThrow(/depth|nested|recursion/i);
    });

    it('rejects dictionaries nested beyond MAX_PARSE_DEPTH', () => {
        const depth = MAX_PARSE_DEPTH + 10;
        const src = '<< /K '.repeat(depth) + '1' + ' >>'.repeat(depth);
        const tok = createTokenizer(bytes(src), 0);
        expect(() => parseValue(tok)).toThrow(/depth|nested|recursion/i);
    });

    it('rejects 10,000 levels of nesting without stack overflow', () => {
        const depth = 10_000;
        const src = '['.repeat(depth) + '1' + ']'.repeat(depth);
        const tok = createTokenizer(bytes(src), 0);
        // Must throw a controlled Error, not a RangeError from V8 stack.
        let err: unknown;
        try { parseValue(tok); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/depth|nested|recursion/i);
    });
});
