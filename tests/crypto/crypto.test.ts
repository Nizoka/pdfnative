/**
 * pdfnative — Crypto Module Tests
 * =================================
 * Tests for SHA-384/512, HMAC-SHA256, ASN.1 DER, RSA, ECDSA, X.509, CMS.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    sha256, sha384, sha512, hmacSha256,
} from '../../src/crypto/sha.js';
import {
    derDecode, derDecodeAll, derSequence, derSet, derInteger,
    derOid, derNull, derOctetString, derBitString, derUtf8String,
    derPrintableString, derUtcTime, derContextExplicit,
    derContextImplicit, derEncodeLength,
    asn1Integer, asn1OidBytes, asn1String, oidEquals,
    concatUint8Arrays,
    ASN1_INTEGER, ASN1_BIT_STRING, ASN1_OCTET_STRING,
    ASN1_NULL, ASN1_OID, ASN1_UTF8_STRING, ASN1_PRINTABLE_STRING,
    ASN1_UTC_TIME, ASN1_SEQUENCE, ASN1_SET,

} from '../../src/crypto/asn1.js';
import {
    modPow, modInverse, bytesToBigInt, bigIntToBytes,
    rsaSign, rsaSignHash, rsaVerify, rsaVerifyHash,
    initRsaAsn1,
    type RsaPublicKey, type RsaPrivateKey,
} from '../../src/crypto/rsa.js';
import {
    ecPublicKeyFromPrivate, ecdsaSign, ecdsaSignHash,
    ecdsaVerify, ecdsaVerifyHash,
    encodeEcPublicKey, decodeEcPublicKey,
    initEcdsaAsn1,
    type EcPrivateKey,
} from '../../src/crypto/ecdsa.js';
import * as asn1Module from '../../src/crypto/asn1.js';

// ── Initialize cross-module dependencies ─────────────────────────────

beforeAll(() => {
    initRsaAsn1(asn1Module);
    initEcdsaAsn1(asn1Module);
});

// ════════════════════════════════════════════════════════════════════
// SHA-2 Hash Functions
// ════════════════════════════════════════════════════════════════════

describe('sha256', () => {
    it('hashes empty input', () => {
        const hash = sha256(new Uint8Array(0));
        expect(hash.length).toBe(32);
        expect(toHex(hash)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('hashes "abc"', () => {
        const hash = sha256(new TextEncoder().encode('abc'));
        expect(toHex(hash)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('hashes 56-byte block boundary', () => {
        // Exactly 56 bytes — padding adds another block
        const data = new TextEncoder().encode('a'.repeat(56));
        const hash = sha256(data);
        expect(hash.length).toBe(32);
    });

    it('hashes 64-byte block boundary', () => {
        const data = new TextEncoder().encode('a'.repeat(64));
        const hash = sha256(data);
        expect(hash.length).toBe(32);
    });

    it('hashes long input', () => {
        const data = new TextEncoder().encode('a'.repeat(1000));
        const hash = sha256(data);
        expect(hash.length).toBe(32);
    });
});

describe('sha384', () => {
    it('hashes empty input', () => {
        const hash = sha384(new Uint8Array(0));
        expect(hash.length).toBe(48);
        expect(toHex(hash)).toBe(
            '38b060a751ac96384cd9327eb1b1e36a21fdb71114be07434c0cc7bf63f6e1da' +
            '274edebfe76f65fbd51ad2f14898b95b'
        );
    });

    it('hashes "abc"', () => {
        const hash = sha384(new TextEncoder().encode('abc'));
        expect(hash.length).toBe(48);
        expect(toHex(hash)).toBe(
            'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed' +
            '8086072ba1e7cc2358baeca134c825a7'
        );
    });

    it('hashes two-block message', () => {
        const data = new TextEncoder().encode('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno');
        const hash = sha384(data);
        expect(hash.length).toBe(48);
    });
});

describe('sha512', () => {
    it('hashes empty input', () => {
        const hash = sha512(new Uint8Array(0));
        expect(hash.length).toBe(64);
        expect(toHex(hash)).toBe(
            'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce' +
            '47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e'
        );
    });

    it('hashes "abc"', () => {
        const hash = sha512(new TextEncoder().encode('abc'));
        expect(hash.length).toBe(64);
        expect(toHex(hash)).toBe(
            'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
            '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'
        );
    });

    it('hashes long input consistently', () => {
        const data = new TextEncoder().encode('a'.repeat(1000));
        const hash1 = sha512(data);
        const hash2 = sha512(data);
        expect(toHex(hash1)).toBe(toHex(hash2));
    });
});

describe('hmacSha256', () => {
    it('computes HMAC with short key', () => {
        const key = new TextEncoder().encode('key');
        const msg = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
        const mac = hmacSha256(key, msg);
        expect(mac.length).toBe(32);
        expect(toHex(mac)).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
    });

    it('computes HMAC with empty message', () => {
        const key = new TextEncoder().encode('secret');
        const mac = hmacSha256(key, new Uint8Array(0));
        expect(mac.length).toBe(32);
    });

    it('computes HMAC with long key (>64 bytes)', () => {
        const key = new TextEncoder().encode('a'.repeat(100));
        const msg = new TextEncoder().encode('test');
        const mac = hmacSha256(key, msg);
        expect(mac.length).toBe(32);
    });

    it('produces different MACs for different messages', () => {
        const key = new TextEncoder().encode('key');
        const mac1 = hmacSha256(key, new TextEncoder().encode('msg1'));
        const mac2 = hmacSha256(key, new TextEncoder().encode('msg2'));
        expect(toHex(mac1)).not.toBe(toHex(mac2));
    });
});

// ════════════════════════════════════════════════════════════════════
// ASN.1 DER Encoder / Decoder
// ════════════════════════════════════════════════════════════════════

describe('ASN.1 DER Encoder', () => {
    it('encodes NULL', () => {
        const result = derNull();
        expect(Array.from(result)).toEqual([0x05, 0x00]);
    });

    it('encodes small INTEGER', () => {
        const result = derInteger(42n);
        expect(result[0]).toBe(ASN1_INTEGER);
        const decoded = derDecode(result);
        expect(asn1Integer(decoded)).toBe(42n);
    });

    it('encodes zero INTEGER', () => {
        const result = derInteger(0n);
        expect(result[0]).toBe(ASN1_INTEGER);
        expect(asn1Integer(derDecode(result))).toBe(0n);
    });

    it('encodes large INTEGER', () => {
        const big = BigInt('0x' + 'ff'.repeat(128));
        const result = derInteger(big);
        expect(asn1Integer(derDecode(result))).toBe(big);
    });

    it('encodes large INTEGER with leading zero for positive high bit', () => {
        const result = derInteger(255n);
        const decoded = derDecode(result);
        expect(asn1Integer(decoded)).toBe(255n);
        // 255 = 0xFF, needs leading 0x00 to stay positive
        expect(decoded.value[0]).toBe(0x00);
    });

    it('encodes OID', () => {
        const oidBytes = new Uint8Array([0x55, 0x04, 0x03]); // CN
        const result = derOid(oidBytes);
        expect(result[0]).toBe(ASN1_OID);
        const decoded = derDecode(result);
        expect(oidEquals(asn1OidBytes(decoded), oidBytes)).toBe(true);
    });

    it('encodes OCTET STRING', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const result = derOctetString(data);
        expect(result[0]).toBe(ASN1_OCTET_STRING);
        const decoded = derDecode(result);
        expect(Array.from(decoded.value)).toEqual([1, 2, 3, 4, 5]);
    });

    it('encodes BIT STRING with zero unused bits', () => {
        const data = new Uint8Array([0xff, 0x00]);
        const result = derBitString(data);
        expect(result[0]).toBe(ASN1_BIT_STRING);
        const decoded = derDecode(result);
        expect(decoded.value[0]).toBe(0x00); // unused bits
        expect(decoded.value[1]).toBe(0xff);
    });

    it('encodes UTF8String', () => {
        const result = derUtf8String('Hello');
        expect(result[0]).toBe(ASN1_UTF8_STRING);
        expect(asn1String(derDecode(result))).toBe('Hello');
    });

    it('encodes PrintableString', () => {
        const result = derPrintableString('Test');
        expect(result[0]).toBe(ASN1_PRINTABLE_STRING);
        expect(asn1String(derDecode(result))).toBe('Test');
    });

    it('encodes UTCTime', () => {
        const d = new Date(Date.UTC(2025, 0, 15, 12, 30, 0));
        const result = derUtcTime(d);
        expect(result[0]).toBe(ASN1_UTC_TIME);
        const str = asn1String(derDecode(result));
        expect(str).toContain('250115123000Z');
    });

    it('encodes SEQUENCE', () => {
        const seq = derSequence(derNull(), derInteger(1n));
        expect(seq[0]).toBe(ASN1_SEQUENCE);
        const decoded = derDecode(seq);
        expect(decoded.children.length).toBe(2);
        expect(decoded.children[0].tag).toBe(ASN1_NULL);
        expect(decoded.children[1].tag).toBe(ASN1_INTEGER);
    });

    it('encodes SET', () => {
        const set = derSet(derInteger(1n), derInteger(2n));
        expect(set[0]).toBe(ASN1_SET);
        const decoded = derDecode(set);
        expect(decoded.children.length).toBe(2);
    });

    it('encodes context-specific explicit', () => {
        const inner = derInteger(42n);
        const result = derContextExplicit(0, inner);
        expect(result[0]).toBe(0xa0);
        const decoded = derDecode(result);
        expect(decoded.children.length).toBe(1);
    });

    it('encodes context-specific implicit', () => {
        const value = new Uint8Array([1, 2, 3]);
        const result = derContextImplicit(0, value);
        expect(result[0]).toBe(0x80);
    });
});

describe('ASN.1 DER Decoder', () => {
    it('decodes nested SEQUENCE', () => {
        const inner = derSequence(derInteger(1n), derInteger(2n));
        const outer = derSequence(inner, derNull());
        const decoded = derDecode(outer);
        expect(decoded.children.length).toBe(2);
        expect(decoded.children[0].tag).toBe(ASN1_SEQUENCE);
        expect(decoded.children[0].children.length).toBe(2);
    });

    it('decodes all top-level TLVs', () => {
        const a = derInteger(1n);
        const b = derNull();
        const buf = concatUint8Arrays(a, b);
        const nodes = derDecodeAll(buf);
        expect(nodes.length).toBe(2);
    });

    it('throws on truncated input', () => {
        expect(() => derDecode(new Uint8Array([0x30, 0x05, 0x01]))).toThrow();
    });

    it('roundtrips complex structure', () => {
        const original = derSequence(
            derInteger(12345n),
            derOid(new Uint8Array([0x55, 0x04, 0x03])),
            derOctetString(new Uint8Array([0xab, 0xcd])),
            derSet(derNull()),
        );
        const decoded = derDecode(original);
        expect(decoded.children.length).toBe(4);
        expect(asn1Integer(decoded.children[0])).toBe(12345n);
    });

    it('tracks offset and totalLength', () => {
        const seq = derSequence(derInteger(1n));
        const decoded = derDecode(seq);
        expect(decoded.offset).toBe(0);
        expect(decoded.totalLength).toBe(seq.length);
    });
});

describe('DER length encoding', () => {
    it('encodes short form (<128)', () => {
        const len = derEncodeLength(10);
        expect(Array.from(len)).toEqual([10]);
    });

    it('encodes long form (128-255)', () => {
        const len = derEncodeLength(200);
        expect(Array.from(len)).toEqual([0x81, 200]);
    });

    it('encodes long form (256-65535)', () => {
        const len = derEncodeLength(1000);
        expect(len[0]).toBe(0x82);
        expect((len[1] << 8) | len[2]).toBe(1000);
    });
});

describe('oidEquals', () => {
    it('matches identical OIDs', () => {
        const a = new Uint8Array([0x55, 0x04, 0x03]);
        const b = new Uint8Array([0x55, 0x04, 0x03]);
        expect(oidEquals(a, b)).toBe(true);
    });

    it('rejects different OIDs', () => {
        const a = new Uint8Array([0x55, 0x04, 0x03]);
        const b = new Uint8Array([0x55, 0x04, 0x06]);
        expect(oidEquals(a, b)).toBe(false);
    });

    it('rejects different lengths', () => {
        const a = new Uint8Array([0x55, 0x04]);
        const b = new Uint8Array([0x55, 0x04, 0x03]);
        expect(oidEquals(a, b)).toBe(false);
    });
});

describe('concatUint8Arrays', () => {
    it('concatenates arrays', () => {
        const a = new Uint8Array([1, 2]);
        const b = new Uint8Array([3, 4]);
        const c = concatUint8Arrays(a, b);
        expect(Array.from(c)).toEqual([1, 2, 3, 4]);
    });

    it('handles empty arrays', () => {
        const result = concatUint8Arrays(new Uint8Array(0), new Uint8Array([1]));
        expect(Array.from(result)).toEqual([1]);
    });
});

// ════════════════════════════════════════════════════════════════════
// RSA Modular Arithmetic
// ════════════════════════════════════════════════════════════════════

describe('modPow', () => {
    it('computes 2^10 mod 1000', () => {
        expect(modPow(2n, 10n, 1000n)).toBe(24n);
    });

    it('computes 3^13 mod 7', () => {
        expect(modPow(3n, 13n, 7n)).toBe(3n);
    });

    it('handles mod 1', () => {
        expect(modPow(5n, 3n, 1n)).toBe(0n);
    });

    it('handles exponent 0', () => {
        expect(modPow(7n, 0n, 10n)).toBe(1n);
    });

    it('computes large modular exponentiation', () => {
        const base = BigInt('0x' + 'ab'.repeat(32));
        const exp = 65537n;
        const mod = BigInt('0x' + 'cd'.repeat(32));
        const result = modPow(base, exp, mod);
        expect(result >= 0n).toBe(true);
        expect(result < mod).toBe(true);
    });
});

describe('modInverse', () => {
    it('computes 3^(-1) mod 7 = 5', () => {
        expect(modInverse(3n, 7n)).toBe(5n);
    });

    it('verifies a * a^(-1) ≡ 1 mod m', () => {
        const a = 17n;
        const m = 43n;
        const inv = modInverse(a, m);
        expect((a * inv) % m).toBe(1n);
    });

    it('throws for non-invertible', () => {
        expect(() => modInverse(4n, 8n)).toThrow();
    });
});

describe('bytesToBigInt / bigIntToBytes', () => {
    it('roundtrips small value', () => {
        const original = 12345n;
        const bytes = bigIntToBytes(original, 4);
        expect(bytesToBigInt(bytes)).toBe(original);
    });

    it('roundtrips 256-bit value', () => {
        const original = BigInt('0x' + '0123456789abcdef'.repeat(4));
        const bytes = bigIntToBytes(original, 32);
        expect(bytesToBigInt(bytes)).toBe(original);
    });

    it('handles zero', () => {
        const bytes = bigIntToBytes(0n, 1);
        expect(bytes[0]).toBe(0);
        expect(bytesToBigInt(bytes)).toBe(0n);
    });
});

// ════════════════════════════════════════════════════════════════════
// RSA Sign / Verify
// ════════════════════════════════════════════════════════════════════

describe('RSA sign/verify', () => {
    // Small 512-bit test key (insecure — for testing only)
    const testKey = makeTestRsaKey();

    it('signs and verifies a message', () => {
        const msg = new TextEncoder().encode('Hello, World!');
        const sig = rsaSign(msg, testKey.priv);
        expect(sig.length).toBeGreaterThan(0);
        expect(rsaVerify(msg, sig, testKey.pub)).toBe(true);
    });

    it('rejects tampered message', () => {
        const msg = new TextEncoder().encode('Hello, World!');
        const sig = rsaSign(msg, testKey.priv);
        const tampered = new TextEncoder().encode('Hello, World?');
        expect(rsaVerify(tampered, sig, testKey.pub)).toBe(false);
    });

    it('signs and verifies a pre-computed hash', () => {
        const msg = new TextEncoder().encode('test data');
        const hash = sha256(msg);
        const sig = rsaSignHash(hash, testKey.priv);
        expect(rsaVerifyHash(hash, sig, testKey.pub)).toBe(true);
    });

    it('rejects wrong hash length', () => {
        expect(() => rsaSignHash(new Uint8Array(16), testKey.priv)).toThrow('Expected 32-byte');
    });

    it('rsaVerifyHash rejects wrong hash length', () => {
        expect(rsaVerifyHash(new Uint8Array(16), new Uint8Array(64), testKey.pub)).toBe(false);
    });

    it('signs empty message', () => {
        const msg = new Uint8Array(0);
        const sig = rsaSign(msg, testKey.priv);
        expect(rsaVerify(msg, sig, testKey.pub)).toBe(true);
    });

    it('produces different signatures for different messages', () => {
        const sig1 = rsaSign(new TextEncoder().encode('A'), testKey.priv);
        const sig2 = rsaSign(new TextEncoder().encode('B'), testKey.priv);
        expect(toHex(sig1)).not.toBe(toHex(sig2));
    });
});

// ════════════════════════════════════════════════════════════════════
// ECDSA P-256 Sign / Verify
// ════════════════════════════════════════════════════════════════════

describe('ECDSA P-256', () => {
    // Test private key (deterministic for reproducible tests)
    const testPrivKey: EcPrivateKey = {
        d: BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'),
    };
    const testPubKey = ecPublicKeyFromPrivate(testPrivKey);

    it('derives public key from private key', () => {
        expect(testPubKey.x).toBeGreaterThan(0n);
        expect(testPubKey.y).toBeGreaterThan(0n);
    });

    it('signs and verifies a message', () => {
        const msg = new TextEncoder().encode('Hello ECDSA');
        const { r, s } = ecdsaSign(msg, testPrivKey);
        expect(r).toBeGreaterThan(0n);
        expect(s).toBeGreaterThan(0n);
        expect(ecdsaVerify(msg, r, s, testPubKey)).toBe(true);
    });

    it('rejects tampered message', () => {
        const msg = new TextEncoder().encode('Hello ECDSA');
        const { r, s } = ecdsaSign(msg, testPrivKey);
        const tampered = new TextEncoder().encode('Hello ECDSB');
        expect(ecdsaVerify(tampered, r, s, testPubKey)).toBe(false);
    });

    it('produces deterministic signatures (RFC 6979)', () => {
        const msg = new TextEncoder().encode('deterministic');
        const sig1 = ecdsaSign(msg, testPrivKey);
        const sig2 = ecdsaSign(msg, testPrivKey);
        expect(sig1.r).toBe(sig2.r);
        expect(sig1.s).toBe(sig2.s);
    });

    it('signs and verifies pre-computed hash', () => {
        const hash = sha256(new TextEncoder().encode('test'));
        const { r, s } = ecdsaSignHash(hash, testPrivKey);
        expect(ecdsaVerifyHash(hash, r, s, testPubKey)).toBe(true);
    });

    it('rejects wrong hash length for signHash', () => {
        expect(() => ecdsaSignHash(new Uint8Array(16), testPrivKey)).toThrow('Expected 32-byte');
    });

    it('rejects r=0 in verification', () => {
        const hash = sha256(new TextEncoder().encode('test'));
        expect(ecdsaVerifyHash(hash, 0n, 1n, testPubKey)).toBe(false);
    });

    it('rejects s=0 in verification', () => {
        const hash = sha256(new TextEncoder().encode('test'));
        expect(ecdsaVerifyHash(hash, 1n, 0n, testPubKey)).toBe(false);
    });

    it('signs empty message', () => {
        const msg = new Uint8Array(0);
        const { r, s } = ecdsaSign(msg, testPrivKey);
        expect(ecdsaVerify(msg, r, s, testPubKey)).toBe(true);
    });
});

describe('EC Public Key Encoding', () => {
    const testPrivKey: EcPrivateKey = {
        d: BigInt('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    };

    it('encodes uncompressed public key (65 bytes)', () => {
        const pub = ecPublicKeyFromPrivate(testPrivKey);
        const bytes = encodeEcPublicKey(pub);
        expect(bytes.length).toBe(65);
        expect(bytes[0]).toBe(0x04);
    });

    it('roundtrips encode/decode', () => {
        const pub = ecPublicKeyFromPrivate(testPrivKey);
        const encoded = encodeEcPublicKey(pub);
        const decoded = decodeEcPublicKey(encoded);
        expect(decoded.x).toBe(pub.x);
        expect(decoded.y).toBe(pub.y);
    });

    it('rejects non-0x04 prefix', () => {
        const bad = new Uint8Array(65);
        bad[0] = 0x02;
        expect(() => decodeEcPublicKey(bad)).toThrow('0x04 prefix');
    });

    it('rejects wrong length', () => {
        expect(() => decodeEcPublicKey(new Uint8Array(33))).toThrow();
    });
});

// ════════════════════════════════════════════════════════════════════
// PDF Signature Module
// ════════════════════════════════════════════════════════════════════

describe('PDF Signature', () => {
    // Lazy imports to avoid circular import issues
    let buildSigDict: typeof import('../../src/core/pdf-signature.js').buildSigDict;
    let estimateContentsSize: typeof import('../../src/core/pdf-signature.js').estimateContentsSize;

    beforeAll(async () => {
        const mod = await import('../../src/core/pdf-signature.js');
        buildSigDict = mod.buildSigDict;
        estimateContentsSize = mod.estimateContentsSize;
    });

    it('builds a /Sig dictionary with placeholders', () => {
        const dict = buildSigDict({
            signerCert: null as never, // not used for dict building
            algorithm: 'rsa-sha256',
            name: 'Test Signer',
            reason: 'Testing',
            location: 'Test Lab',
            signingTime: new Date(Date.UTC(2025, 0, 15, 12, 0, 0)),
        });
        expect(dict).toContain('/Type /Sig');
        expect(dict).toContain('/Filter /Adobe.PPKLite');
        expect(dict).toContain('/SubFilter /adbe.pkcs7.detached');
        expect(dict).toContain('/Contents <');
        expect(dict).toContain('/ByteRange [0 ');
        expect(dict).toContain('/Name (Test Signer)');
        expect(dict).toContain('/Reason (Testing)');
        expect(dict).toContain('/Location (Test Lab)');
        expect(dict).toContain('D:20250115120000Z');
    });

    it('escapes PDF string special characters', () => {
        const dict = buildSigDict({
            signerCert: null as never,
            algorithm: 'rsa-sha256',
            name: 'John (Doe)',
            reason: 'Back\\slash',
        });
        expect(dict).toContain('John \\(Doe\\)');
        expect(dict).toContain('Back\\\\slash');
    });

    it('estimates contents size', () => {
        const size = estimateContentsSize([1000, 500], 'rsa-sha256');
        expect(size).toBeGreaterThanOrEqual(16384);
    });

    it('estimates smaller size for ECDSA', () => {
        const rsaSize = estimateContentsSize([1000], 'rsa-sha256');
        const ecSize = estimateContentsSize([1000], 'ecdsa-sha256');
        // ECDSA signatures are much smaller
        expect(ecSize).toBeLessThanOrEqual(rsaSize);
    });
});

// ════════════════════════════════════════════════════════════════════
// Integration: RSA sign + CMS + PDF
// ════════════════════════════════════════════════════════════════════

describe('CMS SignedData', () => {
    let buildCmsSignedData: typeof import('../../src/crypto/cms.js').buildCmsSignedData;

    beforeAll(async () => {
        const mod = await import('../../src/crypto/cms.js');
        buildCmsSignedData = mod.buildCmsSignedData;
    });

    it('builds CMS with RSA key', () => {
        const key = makeTestRsaKey();
        const hash = sha256(new TextEncoder().encode('test document'));
        const fakeCert = makeFakeCert();

        const cms = buildCmsSignedData({
            dataHash: hash,
            signerCert: fakeCert,
            algorithm: 'rsa-sha256',
            rsaKey: key.priv,
            signingTime: new Date(Date.UTC(2025, 0, 15)),
        });

        expect(cms.length).toBeGreaterThan(100);
        // Should be a valid DER SEQUENCE
        expect(cms[0]).toBe(ASN1_SEQUENCE);
        // Parse it — should have ContentInfo structure
        const root = derDecode(cms);
        expect(root.children.length).toBe(2);
        // First child = OID (signedData)
        expect(root.children[0].tag).toBe(ASN1_OID);
    });

    it('rejects wrong hash length', () => {
        const fakeCert = makeFakeCert();
        expect(() => buildCmsSignedData({
            dataHash: new Uint8Array(16),
            signerCert: fakeCert,
            algorithm: 'rsa-sha256',
            rsaKey: makeTestRsaKey().priv,
        })).toThrow('32-byte');
    });
});

// ════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a minimal RSA key pair for testing.
 * Pre-computed 1024-bit key — NOT SECURE, testing only.
 * Parsed from a DER-encoded PKCS#1 private key.
 */
function makeTestRsaKey(): { pub: RsaPublicKey; priv: RsaPrivateKey } {
    // PKCS#1 DER-encoded 1024-bit RSA private key (generated via Node crypto)
    const der = new Uint8Array([48,130,2,92,2,1,0,2,129,129,0,149,167,161,235,84,86,60,133,158,79,17,97,238,155,111,200,72,143,148,171,188,25,156,32,226,155,7,67,77,113,151,120,99,215,115,190,63,155,45,211,193,33,114,183,74,224,115,55,62,174,52,99,128,241,158,68,69,65,108,203,202,100,238,118,165,63,95,143,49,179,65,52,164,234,225,248,10,10,80,180,140,153,200,91,91,46,83,100,233,228,69,14,195,125,80,211,58,6,180,221,220,133,179,221,8,245,194,209,10,228,163,19,121,247,21,172,63,90,218,237,179,156,85,101,31,213,25,105,2,3,1,0,1,2,129,129,0,138,220,82,103,211,135,120,252,218,153,175,29,89,147,44,179,128,112,137,152,152,30,131,58,24,73,149,1,163,248,68,125,214,214,113,117,19,251,223,23,222,218,52,97,82,190,212,233,107,229,164,130,183,128,122,68,10,166,220,86,115,228,23,70,224,108,74,163,26,18,127,15,35,152,248,198,130,176,37,188,226,32,8,132,208,254,175,146,61,100,100,122,115,211,158,166,3,247,243,62,47,119,198,69,110,17,204,126,80,117,175,59,144,139,156,64,149,189,33,73,183,117,33,181,160,53,54,1,2,65,0,196,145,72,48,40,112,0,193,243,87,102,57,239,45,75,189,166,25,141,28,92,43,176,179,82,99,252,66,115,145,67,22,255,166,238,141,214,72,127,154,9,36,86,141,149,98,175,110,164,55,210,122,137,37,69,7,229,179,8,199,148,66,157,225,2,65,0,194,231,54,218,220,122,237,30,191,46,139,252,127,54,240,141,3,230,5,194,193,239,165,147,232,141,249,172,199,125,78,201,130,252,72,99,49,102,1,199,222,94,182,2,202,189,107,208,3,14,140,16,202,119,222,135,212,76,92,52,152,42,28,137,2,64,95,46,82,28,47,152,124,101,109,229,102,52,171,97,237,136,249,130,233,215,79,178,64,47,180,183,129,144,211,209,5,1,127,237,95,26,3,38,187,210,228,150,89,234,216,233,30,53,159,3,0,194,32,226,145,24,143,219,47,103,36,157,85,65,2,64,12,228,92,101,135,181,253,223,77,200,23,108,97,65,210,17,145,211,114,72,26,169,238,106,229,52,22,242,205,211,69,21,225,59,44,210,154,222,227,121,68,5,65,198,215,128,70,20,97,79,98,6,110,78,21,131,40,144,208,124,142,32,34,249,2,64,127,79,23,141,9,57,102,72,151,185,43,151,38,151,18,155,43,206,236,170,31,35,148,230,39,206,147,166,73,216,31,100,91,156,59,175,60,121,246,221,57,106,96,79,249,239,96,196,107,28,4,64,238,214,172,90,173,66,221,141,57,84,160,129]);

    // Parse PKCS#1 RSAPrivateKey: SEQUENCE { version, n, e, d, p, q, dp, dq, qi }
    const root = derDecode(der);
    const n = asn1Integer(root.children[1]);
    const e = asn1Integer(root.children[2]);
    const d = asn1Integer(root.children[3]);
    const p = asn1Integer(root.children[4]);
    const q = asn1Integer(root.children[5]);
    const dp = asn1Integer(root.children[6]);
    const dq = asn1Integer(root.children[7]);
    const qi = asn1Integer(root.children[8]);

    return {
        pub: { n, e },
        priv: { n, d, p, q, dp, dq, qi },
    };
}

/**
 * Create a fake X509Certificate object for CMS testing.
 * Not a real certificate — just enough structure to pass through CMS builder.
 */
function makeFakeCert(): import('../../src/crypto/x509.js').X509Certificate {
    // Build a minimal issuer Name DER
    const issuerDer = derSequence(
        derSet(
            derSequence(
                derOid(new Uint8Array([0x55, 0x04, 0x03])), // CN
                derUtf8String('Test CA'),
            ),
        ),
    );

    return {
        version: 3,
        serialNumber: 1n,
        signatureAlgorithm: new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
        issuer: {
            cn: 'Test CA',
            raw: issuerDer,
        },
        subject: {
            cn: 'Test Subject',
            raw: issuerDer,
        },
        notBefore: new Date('2020-01-01'),
        notAfter: new Date('2030-01-01'),
        publicKeyAlgorithm: new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]),
        publicKeyBytes: new Uint8Array(64),
        isCA: false,
        keyUsage: 0,
        tbsCertificateBytes: new Uint8Array(100),
        signatureBytes: new Uint8Array(64),
        raw: derSequence(new Uint8Array(100)),
    };
}
