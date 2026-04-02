/**
 * Phase 9 — PDF Encryption Tests
 * ================================
 * Tests for AES, MD5, SHA-256, and PDF encryption integration.
 * Includes NIST/RFC test vectors for crypto primitives.
 */

import { describe, it, expect } from 'vitest';
import {
    aesCBC, md5, sha256,
    computePermissions, generateDocId,
    initEncryption, encryptStream, encryptString,
    buildEncryptDict, buildIdArray,
} from '../../src/core/pdf-encrypt.js';
import type { EncryptionOptions } from '../../src/types/pdf-types.js';
import { buildPDF, buildPDFBytes } from '../../src/core/pdf-builder.js';
import { buildDocumentPDF, buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

function makeTableParams(): PdfParams {
    return {
        title: 'Encrypt Test',
        infoItems: [{ label: 'Account', value: '1234' }],
        balanceText: '1000.00',
        countText: '1 operation',
        headers: ['Date', 'Desc', 'Cat', 'Amount', 'Balance'],
        rows: [
            { cells: ['01/01', 'Test', 'Cat', '100', '900'], type: 'credit', pointed: false },
        ],
        footerText: 'Test Footer',
    };
}

function makeDocParams(): DocumentParams {
    return {
        title: 'Encrypt Doc Test',
        blocks: [
            { type: 'heading', level: 1 as const, text: 'Heading' },
            { type: 'paragraph', text: 'Paragraph content.' },
        ],
        footerText: 'Footer',
    };
}

// ── MD5 (RFC 1321 test vectors) ──────────────────────────────────────

describe('md5', () => {
    it('should hash empty string correctly', () => {
        const hash = md5(new Uint8Array(0));
        expect(bytesToHex(hash)).toBe('d41d8cd98f00b204e9800998ecf8427e');
    });

    it('should hash "a" correctly', () => {
        const hash = md5(new Uint8Array([0x61]));
        expect(bytesToHex(hash)).toBe('0cc175b9c0f1b6a831c399e269772661');
    });

    it('should hash "abc" correctly', () => {
        const hash = md5(new Uint8Array([0x61, 0x62, 0x63]));
        expect(bytesToHex(hash)).toBe('900150983cd24fb0d6963f7d28e17f72');
    });

    it('should hash "message digest" correctly', () => {
        const input = new TextEncoder().encode('message digest');
        const hash = md5(input);
        expect(bytesToHex(hash)).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    });

    it('should hash "abcdefghijklmnopqrstuvwxyz" correctly', () => {
        const input = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz');
        const hash = md5(input);
        expect(bytesToHex(hash)).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    });

    it('should return 16 bytes', () => {
        const hash = md5(new Uint8Array([1, 2, 3]));
        expect(hash.length).toBe(16);
    });
});

// ── SHA-256 (FIPS 180-4 test vectors) ────────────────────────────────

describe('sha256', () => {
    it('should hash empty string correctly', () => {
        const hash = sha256(new Uint8Array(0));
        expect(bytesToHex(hash)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should hash "abc" correctly', () => {
        const hash = sha256(new Uint8Array([0x61, 0x62, 0x63]));
        expect(bytesToHex(hash)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('should hash "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"', () => {
        const input = new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
        const hash = sha256(input);
        expect(bytesToHex(hash)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });

    it('should return 32 bytes', () => {
        const hash = sha256(new Uint8Array([1, 2, 3]));
        expect(hash.length).toBe(32);
    });
});

// ── AES-CBC ──────────────────────────────────────────────────────────

describe('aesCBC', () => {
    it('should encrypt with AES-128-CBC and correct block size', () => {
        const key = new Uint8Array(16); // all zeros
        const iv = new Uint8Array(16);
        const data = new Uint8Array(16); // one block
        const result = aesCBC(data, key, iv);
        // Should have 2 blocks: 1 data + 1 PKCS7 padding (full block)
        expect(result.length).toBe(32);
    });

    it('should encrypt with AES-256-CBC', () => {
        const key = new Uint8Array(32);
        const iv = new Uint8Array(16);
        const data = new Uint8Array(1); // 1 byte → pads to 16
        const result = aesCBC(data, key, iv);
        expect(result.length).toBe(16);
    });

    it('should produce different outputs for different keys', () => {
        const iv = new Uint8Array(16);
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const key1 = new Uint8Array(16);
        key1[0] = 1;
        const key2 = new Uint8Array(16);
        key2[0] = 2;
        const r1 = aesCBC(data, key1, iv);
        const r2 = aesCBC(data, key2, iv);
        expect(bytesToHex(r1)).not.toBe(bytesToHex(r2));
    });

    it('should produce different outputs for different IVs', () => {
        const key = new Uint8Array(16);
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const iv1 = new Uint8Array(16);
        iv1[0] = 1;
        const iv2 = new Uint8Array(16);
        iv2[0] = 2;
        const r1 = aesCBC(data, key, iv1);
        const r2 = aesCBC(data, key, iv2);
        expect(bytesToHex(r1)).not.toBe(bytesToHex(r2));
    });

    it('should apply PKCS7 padding for non-block-aligned input', () => {
        const key = new Uint8Array(16);
        const iv = new Uint8Array(16);
        const data = new Uint8Array(10); // 10 bytes → pad to 16 (6 bytes padding)
        const result = aesCBC(data, key, iv);
        expect(result.length).toBe(16); // exactly one block after padding
    });

    it('should apply full block padding for block-aligned input', () => {
        const key = new Uint8Array(16);
        const iv = new Uint8Array(16);
        const data = new Uint8Array(16); // exactly one block → add full padding block
        const result = aesCBC(data, key, iv);
        expect(result.length).toBe(32);
    });

    // NIST AES-128 ECB test vector (FIPS 197 Appendix B)
    it('should match NIST AES-128 test vector via CBC with zero IV', () => {
        const key = hexToBytes('2b7e151628aed2a6abf7158809cf4f3c');
        const iv = new Uint8Array(16);
        // Encrypting 16 zeros with zero IV in CBC = ECB of zeros
        const data = hexToBytes('6bc1bee22e409f96e93d7e117393172a');
        const result = aesCBC(data, key, iv);
        // First 16 bytes should be the AES-128 ECB encryption of the XOR(data, IV=0) = data
        // AES-128-ECB("6bc1bee22e409f96e93d7e117393172a", key) = "3ad77bb40d7a3660a89ecaf32466ef97"
        const firstBlock = bytesToHex(result.subarray(0, 16));
        expect(firstBlock).toBe('3ad77bb40d7a3660a89ecaf32466ef97');
    });
});

// ── Permission Computation ───────────────────────────────────────────

describe('computePermissions', () => {
    it('should return negative number (high bit set)', () => {
        const p = computePermissions();
        expect(p).toBeLessThan(0);
    });

    it('should enable print by default', () => {
        const p = computePermissions();
        expect(p & 0b100).toBe(0b100); // bit 3
    });

    it('should enable high-quality print by default', () => {
        const p = computePermissions();
        expect(p & 0b100000000000).toBe(0b100000000000); // bit 12
    });

    it('should enable extract by default', () => {
        const p = computePermissions();
        expect(p & 0b100000).toBe(0b100000); // bit 6
    });

    it('should disable print when print=false', () => {
        const p = computePermissions({ print: false });
        expect(p & 0b100).toBe(0); // bit 3 off
    });

    it('should enable copy when copy=true', () => {
        const p = computePermissions({ copy: true });
        expect(p & 0b10000).toBe(0b10000); // bit 5
    });

    it('should not enable copy by default', () => {
        const p = computePermissions();
        expect(p & 0b10000).toBe(0); // bit 5 off
    });

    it('should not enable modify by default', () => {
        const p = computePermissions();
        expect(p & 0b1000).toBe(0); // bit 4 off
    });

    it('should enable modify when modify=true', () => {
        const p = computePermissions({ modify: true });
        expect(p & 0b1000).toBe(0b1000); // bit 4
    });
});

// ── Document ID Generation ───────────────────────────────────────────

describe('generateDocId', () => {
    it('should return 16 bytes', () => {
        const id = generateDocId();
        expect(id.length).toBe(16);
    });

    it('should generate different IDs', () => {
        const id1 = generateDocId();
        const id2 = generateDocId();
        expect(bytesToHex(id1)).not.toBe(bytesToHex(id2));
    });
});

// ── Encryption Initialization ────────────────────────────────────────

describe('initEncryption', () => {
    it('should initialize AES-128 (R4) state', () => {
        const state = initEncryption({
            ownerPassword: 'owner123',
            userPassword: 'user456',
            algorithm: 'aes128',
        });
        expect(state.key.length).toBe(16);
        expect(state.oValue.length).toBe(32);
        expect(state.uValue.length).toBe(32);
        expect(state.oeValue).toBeNull();
        expect(state.ueValue).toBeNull();
        expect(state.permsValue).toBeNull();
        expect(state.algorithm).toBe('aes128');
        expect(state.docId.length).toBe(16);
    });

    it('should initialize AES-256 (R6) state', () => {
        const state = initEncryption({
            ownerPassword: 'owner123',
            userPassword: 'user456',
            algorithm: 'aes256',
        });
        expect(state.key.length).toBe(32);
        expect(state.oValue.length).toBe(48);
        expect(state.uValue.length).toBe(48);
        expect(state.oeValue).not.toBeNull();
        expect(state.oeValue!.length).toBe(32);
        expect(state.ueValue).not.toBeNull();
        expect(state.ueValue!.length).toBe(32);
        expect(state.permsValue).not.toBeNull();
        expect(state.permsValue!.length).toBe(16);
        expect(state.algorithm).toBe('aes256');
    });

    it('should default to AES-128', () => {
        const state = initEncryption({ ownerPassword: 'test' });
        expect(state.algorithm).toBe('aes128');
    });

    it('should handle empty user password', () => {
        const state = initEncryption({ ownerPassword: 'test', userPassword: '' });
        expect(state.key.length).toBe(16);
    });

    it('should handle omitted user password', () => {
        const state = initEncryption({ ownerPassword: 'test' });
        expect(state.key.length).toBe(16);
    });
});

// ── Stream Encryption ────────────────────────────────────────────────

describe('encryptStream', () => {
    it('should encrypt and return IV + ciphertext', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const result = encryptStream('Hello World', state, 5, 0);
        // IV (16) + ciphertext (16, rounded up from 11 bytes)
        expect(result.length).toBe(32);
    });

    it('should produce different outputs for different objects', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const r1 = encryptStream('Same data', state, 5, 0);
        const r2 = encryptStream('Same data', state, 6, 0);
        // Different due to different object keys AND random IVs
        expect(r1).not.toBe(r2);
    });

    it('should handle empty data', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const result = encryptStream('', state, 1, 0);
        // IV (16) + one padding block (16)
        expect(result.length).toBe(32);
    });

    it('should work with AES-256', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes256' });
        const result = encryptStream('Test content', state, 3, 0);
        expect(result.length).toBeGreaterThan(16); // at least IV
    });
});

// ── String Encryption ────────────────────────────────────────────────

describe('encryptString', () => {
    it('should return hex-encoded encrypted string', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const result = encryptString('Hello', state, 5, 0);
        expect(result.startsWith('<')).toBe(true);
        expect(result.endsWith('>')).toBe(true);
        // Hex chars only between < and >
        const hex = result.slice(1, -1);
        expect(hex).toMatch(/^[0-9A-F]+$/);
    });

    it('should produce different outputs for different objects', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const r1 = encryptString('Same', state, 5, 0);
        const r2 = encryptString('Same', state, 6, 0);
        expect(r1).not.toBe(r2);
    });
});

// ── Encrypt Dict ─────────────────────────────────────────────────────

describe('buildEncryptDict', () => {
    it('should build R4 dict for AES-128', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes128' });
        const dict = buildEncryptDict(state);
        expect(dict).toContain('/Type /Encrypt');
        expect(dict).toContain('/Filter /Standard');
        expect(dict).toContain('/V 4');
        expect(dict).toContain('/R 4');
        expect(dict).toContain('/CFM /AESV2');
        expect(dict).toContain('/StmF /StdCF');
        expect(dict).toContain('/StrF /StdCF');
        expect(dict).toContain('/O <');
        expect(dict).toContain('/U <');
        expect(dict).toContain('/P ');
    });

    it('should build R6 dict for AES-256', () => {
        const state = initEncryption({ ownerPassword: 'test', algorithm: 'aes256' });
        const dict = buildEncryptDict(state);
        expect(dict).toContain('/V 5');
        expect(dict).toContain('/R 6');
        expect(dict).toContain('/CFM /AESV3');
        expect(dict).toContain('/OE <');
        expect(dict).toContain('/UE <');
        expect(dict).toContain('/Perms <');
    });
});

// ── ID Array ─────────────────────────────────────────────────────────

describe('buildIdArray', () => {
    it('should produce valid ID array syntax', () => {
        const id = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF,
            0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10]);
        const result = buildIdArray(id);
        expect(result).toBe('[<0123456789ABCDEFFEDCBA9876543210> <0123456789ABCDEFFEDCBA9876543210>]');
        expect(result.startsWith('[<')).toBe(true);
        expect(result.endsWith('>]')).toBe(true);
    });
});

// ── PDF/A + Encryption Mutual Exclusivity ────────────────────────────

describe('PDF/A + encryption mutual exclusivity', () => {
    const encOpts: EncryptionOptions = { ownerPassword: 'test', algorithm: 'aes128' };

    it('should throw when tagged=true and encryption is set (buildPDF)', () => {
        expect(() => {
            buildPDF(makeTableParams(), { tagged: true, encryption: encOpts });
        }).toThrow('PDF/A and encryption are mutually exclusive');
    });

    it('should throw when tagged="pdfa2b" and encryption is set', () => {
        expect(() => {
            buildPDF(makeTableParams(), { tagged: 'pdfa2b', encryption: encOpts });
        }).toThrow('mutually exclusive');
    });

    it('should throw when tagged=true and encryption is set (buildDocumentPDF)', () => {
        expect(() => {
            buildDocumentPDF(makeDocParams(), { tagged: true, encryption: encOpts });
        }).toThrow('mutually exclusive');
    });

    it('should not throw when tagged=false and encryption is set', () => {
        expect(() => {
            buildPDF(makeTableParams(), { tagged: false, encryption: encOpts });
        }).not.toThrow();
    });

    it('should not throw when encryption is omitted and tagged=true', () => {
        expect(() => {
            buildPDF(makeTableParams(), { tagged: true });
        }).not.toThrow();
    });
});

// ── Encrypted PDF Integration ────────────────────────────────────────

describe('Encrypted PDF integration (buildPDF)', () => {
    it('should produce valid PDF with encryption (AES-128)', () => {
        const pdf = buildPDF(makeTableParams(), {
            encryption: { ownerPassword: 'owner', algorithm: 'aes128' },
        });
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
        expect(pdf).toContain('/Type /Encrypt');
        expect(pdf).toContain('/Filter /Standard');
        expect(pdf).toContain('/V 4');
        expect(pdf).toContain('/ID [<');
        expect(pdf).toContain('%%EOF');
    });

    it('should produce valid PDF with encryption (AES-256)', () => {
        const pdf = buildPDF(makeTableParams(), {
            encryption: { ownerPassword: 'owner', algorithm: 'aes256' },
        });
        expect(pdf).toContain('/V 5');
        expect(pdf).toContain('/R 6');
        expect(pdf).toContain('/ID [<');
    });

    it('should include /Encrypt reference in trailer', () => {
        const pdf = buildPDF(makeTableParams(), {
            encryption: { ownerPassword: 'secure' },
        });
        expect(pdf).toMatch(/\/Encrypt \d+ 0 R/);
    });

    it('should produce valid Uint8Array', () => {
        const bytes = buildPDFBytes(makeTableParams(), {
            encryption: { ownerPassword: 'secure' },
        });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
    });

    it('should have permissions in encrypt dict', () => {
        const pdf = buildPDF(makeTableParams(), {
            encryption: {
                ownerPassword: 'owner',
                permissions: { print: true, copy: false },
            },
        });
        expect(pdf).toContain('/P ');
    });
});

describe('Encrypted PDF integration (buildDocumentPDF)', () => {
    it('should produce valid encrypted document PDF', () => {
        const pdf = buildDocumentPDF(makeDocParams(), {
            encryption: { ownerPassword: 'docowner', algorithm: 'aes128' },
        });
        expect(pdf.startsWith('%PDF-1.4')).toBe(true);
        expect(pdf).toContain('/Type /Encrypt');
        expect(pdf).toContain('/ID [<');
        expect(pdf).toContain('%%EOF');
    });

    it('should produce valid bytes', () => {
        const bytes = buildDocumentPDFBytes(makeDocParams(), {
            encryption: { ownerPassword: 'docowner' },
        });
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBeGreaterThan(100);
    });

    it('should work with AES-256', () => {
        const pdf = buildDocumentPDF(makeDocParams(), {
            encryption: { ownerPassword: 'doc256', algorithm: 'aes256' },
        });
        expect(pdf).toContain('/V 5');
        expect(pdf).toContain('/R 6');
    });
});
