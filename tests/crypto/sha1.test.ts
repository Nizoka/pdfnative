/**
 * SHA-1 tests — official FIPS 180-4 vectors (NIST CAVP / RFC 3174).
 * SHA-1 exists in pdfnative solely for /VRI keying and OCSP CertID
 * identification — see the sha1() docblock.
 */

import { describe, it, expect } from 'vitest';
import { sha1 } from '../../src/crypto/sha.js';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha1 — FIPS 180-4 vectors', () => {
    it('hashes the empty string', () => {
        const hash = sha1(new Uint8Array(0));
        expect(hash.length).toBe(20);
        expect(toHex(hash)).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    });

    it('hashes "abc"', () => {
        expect(toHex(sha1(new TextEncoder().encode('abc')))).toBe(
            'a9993e364706816aba3e25717850c26c9cd0d89d',
        );
    });

    it('hashes the 448-bit two-block message', () => {
        const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
        expect(toHex(sha1(new TextEncoder().encode(msg)))).toBe(
            '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
        );
    });

    it('hashes the 896-bit message', () => {
        const msg = 'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmn' +
            'hijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu';
        expect(toHex(sha1(new TextEncoder().encode(msg)))).toBe(
            'a49b2446a02c645bf419f995b67091253a04a259',
        );
    });

    it('hashes one million "a" characters', () => {
        const msg = new Uint8Array(1_000_000).fill(0x61);
        expect(toHex(sha1(msg))).toBe('34aa973cd4c4daa4f61eeb2bdbad27316534016f');
    });

    it('handles block-boundary lengths (55/56/64 bytes)', () => {
        for (const len of [55, 56, 64]) {
            expect(sha1(new Uint8Array(len)).length).toBe(20);
        }
    });
});
