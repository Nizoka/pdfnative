/**
 * AES decryption + SHA-384/512 primitive tests (v1.6.0).
 * NIST FIPS 197 / FIPS 180-4 known-answer vectors, plus encrypt↔decrypt
 * inverse checks for the pdfnative AES-CBC implementation.
 */

import { describe, it, expect } from 'vitest';
import {
    aesCBC, aesCBCDecrypt, aesECBDecrypt, sha384, sha512,
} from '../../src/core/pdf-encrypt.js';

function hexToBytes(hex: string): Uint8Array {
    const b = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.substr(i, 2), 16);
    return b;
}
function bytesToHex(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
}

// ── AES block inverse (FIPS 197 Appendix B/C) ────────────────────────

describe('aesECBDecrypt', () => {
    it('inverts the FIPS 197 AES-128 example block', () => {
        const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c');
        const ct = hexToBytes('3ad77bb40d7a3660a89ecaf32466ef97');
        expect(bytesToHex(aesECBDecrypt(ct, key))).toBe('6bc1bee22e409f96e93d7e117393172a');
    });

    it('inverts an AES-256 block (FIPS 197 Appendix C.3)', () => {
        const key = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
        const ct = hexToBytes('8ea2b7ca516745bfeafc49904b496089');
        expect(bytesToHex(aesECBDecrypt(ct, key))).toBe('00112233445566778899aabbccddeeff');
    });
});

// ── AES-CBC round-trip ───────────────────────────────────────────────

describe('aesCBCDecrypt', () => {
    it('inverts aesCBC (PKCS7) for AES-128', () => {
        const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
        const iv = hexToBytes('0f0e0d0c0b0a09080706050403020100');
        const plain = new TextEncoder().encode('The quick brown fox jumps over 13 lazy dogs.');
        const ct = aesCBC(plain, key, iv);
        const back = aesCBCDecrypt(ct, key, iv, 'pkcs7');
        expect(bytesToHex(back)).toBe(bytesToHex(plain));
    });

    it('inverts aesCBC (PKCS7) for AES-256 at a block boundary', () => {
        const key = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
        const iv = new Uint8Array(16);
        const plain = new Uint8Array(32).map((_, i) => i);
        const ct = aesCBC(plain, key, iv);
        const back = aesCBCDecrypt(ct, key, iv, 'pkcs7');
        expect(bytesToHex(back)).toBe(bytesToHex(plain));
    });

    it("'none' mode returns raw block-aligned plaintext", () => {
        const key = new Uint8Array(32);
        const iv = new Uint8Array(16);
        const plain = new Uint8Array(16).fill(7);
        // aesCBC adds a PKCS7 block; decrypt with 'none' keeps all 32 bytes.
        const ct = aesCBC(plain, key, iv);
        const back = aesCBCDecrypt(ct, key, iv, 'none');
        expect(back.length).toBe(32);
        expect(bytesToHex(back.subarray(0, 16))).toBe(bytesToHex(plain));
    });

    it('is lenient with malformed padding (returns unpadded bytes)', () => {
        const key = new Uint8Array(16);
        const iv = new Uint8Array(16);
        // Encrypt exactly one block with 'none'-style content: craft ciphertext
        // whose decrypted last byte is not a valid pad length.
        const raw = new Uint8Array(16).fill(0xAB);
        const ct = aesCBC(raw, key, iv); // 32 bytes (raw + pad block)
        // Decrypt only the first block → last byte 0xAB is an invalid padLen.
        const back = aesCBCDecrypt(ct.subarray(0, 16), key, iv, 'pkcs7');
        expect(back.length).toBe(16);
        expect(bytesToHex(back)).toBe(bytesToHex(raw));
    });

    it('handles empty input', () => {
        expect(aesCBCDecrypt(new Uint8Array(0), new Uint8Array(16), new Uint8Array(16)).length).toBe(0);
    });
});

// ── SHA-384 / SHA-512 (FIPS 180-4) ───────────────────────────────────

describe('sha384 / sha512', () => {
    it('sha384("abc")', () => {
        expect(bytesToHex(sha384(new TextEncoder().encode('abc')))).toBe(
            'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
        );
    });

    it('sha384("")', () => {
        expect(bytesToHex(sha384(new Uint8Array(0)))).toBe(
            '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da274edebfe76f65fbd51ad2f14898b95b',
        );
    });

    it('sha512("abc")', () => {
        expect(bytesToHex(sha512(new TextEncoder().encode('abc')))).toBe(
            'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
            '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
        );
    });

    it('sha512("")', () => {
        expect(bytesToHex(sha512(new Uint8Array(0)))).toBe(
            'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce' +
            '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
        );
    });

    it('sha512 of a two-block message (>112 bytes)', () => {
        const msg = new TextEncoder().encode('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu');
        expect(bytesToHex(sha512(msg))).toBe(
            '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018' +
            '501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
        );
    });
});
