/**
 * RSA digest-agility tests (1.7.0) — SHA-384/512 DigestInfo prefixes in
 * sign/verify (RFC 8017 §9.2) and the previously-stubbed SHA-384/512 RSA
 * branches of x509 verifyCertSignature().
 */

import { describe, it, expect } from 'vitest';
import { sha256, sha384, sha512 } from '../../src/crypto/sha.js';
import {
    rsaSign, rsaSignHash, rsaVerify, rsaVerifyHash,
    type RsaDigest, type RsaPublicKey,
} from '../../src/crypto/rsa.js';
import { parseCertificate, verifyCertSignature } from '../../src/crypto/x509.js';
import {
    createMockPki, buildMockCertificate,
} from '../../scripts/helpers/mock-pki.js';

const RSA_E = 65537n;

describe('RSA digest agility (RFC 8017 §9.2)', () => {
    const pki = createMockPki();
    const priv = pki.signerKey;
    const pub: RsaPublicKey = { n: priv.n, e: RSA_E };
    const message = new TextEncoder().encode('digest agility round-trip');

    it.each<[RsaDigest, (input: Uint8Array) => Uint8Array, number]>([
        ['sha256', sha256, 32],
        ['sha384', sha384, 48],
        ['sha512', sha512, 64],
    ])('signs and verifies with %s (message and pre-hashed paths)', (digest, hashFn, hashLen) => {
        const sig = rsaSign(message, priv, digest);
        expect(rsaVerify(message, sig, pub, digest)).toBe(true);

        const hash = hashFn(message);
        expect(hash.length).toBe(hashLen);
        const sigFromHash = rsaSignHash(hash, priv, digest);
        expect(Array.from(sigFromHash)).toEqual(Array.from(sig)); // deterministic PKCS#1 v1.5
        expect(rsaVerifyHash(hash, sigFromHash, pub, digest)).toBe(true);
    });

    it('defaults to sha256 (source-compatible with pre-1.7.0 call sites)', () => {
        const sig = rsaSign(message, priv);
        expect(rsaVerify(message, sig, pub)).toBe(true);
        expect(Array.from(sig)).toEqual(Array.from(rsaSign(message, priv, 'sha256')));
    });

    it('a signature made with one digest does not verify under another', () => {
        const sig = rsaSign(message, priv, 'sha384');
        expect(rsaVerify(message, sig, pub, 'sha256')).toBe(false);
        expect(rsaVerify(message, sig, pub, 'sha512')).toBe(false);
    });

    it('enforces per-digest hash lengths in rsaSignHash', () => {
        expect(() => rsaSignHash(new Uint8Array(32), priv, 'sha384')).toThrow('Expected 48-byte SHA-384 hash');
        expect(() => rsaSignHash(new Uint8Array(48), priv, 'sha512')).toThrow('Expected 64-byte SHA-512 hash');
        expect(() => rsaSignHash(new Uint8Array(48), priv)).toThrow('Expected 32-byte SHA-256 hash');
    });

    it('rsaVerifyHash rejects wrong hash lengths per digest', () => {
        const sig = rsaSign(message, priv, 'sha384');
        expect(rsaVerifyHash(sha256(message), sig, pub, 'sha384')).toBe(false);
        expect(rsaVerifyHash(sha384(message), sig, pub, 'sha384')).toBe(true);
    });
});

describe('x509 verifyCertSignature — SHA-384/512 RSA branches', () => {
    it.each<RsaDigest>(['sha384', 'sha512'])('verifies a self-signed %sWithRSA certificate', (digest) => {
        const cert = buildMockCertificate({ subjectCn: `pdfnative ${digest} test`, digest });
        expect(verifyCertSignature(cert, cert)).toBe(true);
    });

    it.each<RsaDigest>(['sha384', 'sha512'])('rejects a %sWithRSA certificate against the wrong issuer', (digest) => {
        const pki = createMockPki();
        const cert = buildMockCertificate({ subjectCn: `pdfnative ${digest} bad-issuer`, digest });
        // rootCert has a different public key than the (self-signed) cert.
        expect(verifyCertSignature(cert, pki.rootCert)).toBe(false);
    });

    it.each<RsaDigest>(['sha384', 'sha512'])('rejects a tampered %sWithRSA certificate', (digest) => {
        const cert = buildMockCertificate({ subjectCn: `pdfnative ${digest} tamper`, digest });
        const tampered = new Uint8Array(cert.raw);
        // Flip one bit in the signature BIT STRING (last byte of the DER).
        tampered[tampered.length - 1] ^= 0x01;
        const reparsed = parseCertificate(tampered);
        expect(verifyCertSignature(reparsed, cert)).toBe(false);
    });

    it('still verifies the sha256WithRSA chain (regression)', () => {
        const pki = createMockPki();
        expect(verifyCertSignature(pki.signerCert, pki.rootCert)).toBe(true);
        expect(verifyCertSignature(pki.rootCert, pki.rootCert)).toBe(true);
    });
});
