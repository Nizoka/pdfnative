/**
 * Tests for the pluggable signature crypto provider (v1.4.0).
 *
 * Covers the global registry (`setCryptoProvider`/`getCryptoProvider`), the
 * per-call `CmsSignOptions.provider`, precedence rules, the "no private key
 * required when a provider is present" path, and that the provider's signature
 * value is what ends up embedded in the CMS SignedData.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    setCryptoProvider,
    getCryptoProvider,
    type CryptoProvider,
} from '../../src/crypto/crypto-provider.js';
import { buildCmsSignedData, type SignatureAlgorithm } from '../../src/crypto/cms.js';
import { sha256 } from '../../src/crypto/sha.js';
import { derSequence, derSet, derOid, derUtf8String } from '../../src/crypto/asn1.js';
import type { X509Certificate } from '../../src/crypto/x509.js';

// ── Fixtures ─────────────────────────────────────────────────────────

function makeFakeCert(): X509Certificate {
    const issuerDer = derSequence(
        derSet(derSequence(derOid(new Uint8Array([0x55, 0x04, 0x03])), derUtf8String('Test CA'))),
    );
    return {
        version: 3,
        serialNumber: 1n,
        signatureAlgorithm: new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]),
        issuer: { cn: 'Test CA', raw: issuerDer },
        subject: { cn: 'Test Subject', raw: issuerDer },
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

/** Build a provider that records its calls and returns a recognisable sig. */
function recordingProvider(sig: Uint8Array): {
    provider: CryptoProvider;
    calls: { tbs: Uint8Array; algorithm: SignatureAlgorithm }[];
} {
    const calls: { tbs: Uint8Array; algorithm: SignatureAlgorithm }[] = [];
    return {
        calls,
        provider: {
            sign(tbs, algorithm) {
                calls.push({ tbs, algorithm });
                return sig;
            },
        },
    };
}

/** Search `haystack` for the first index of the `needle` byte sequence. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

const HASH = sha256(new TextEncoder().encode('the document bytes'));

afterEach(() => {
    setCryptoProvider(null);
});

// ── Global registry ──────────────────────────────────────────────────

describe('setCryptoProvider / getCryptoProvider', () => {
    it('defaults to no provider', () => {
        expect(getCryptoProvider()).toBeNull();
    });

    it('installs and clears a global provider', () => {
        const { provider } = recordingProvider(new Uint8Array(8));
        setCryptoProvider(provider);
        expect(getCryptoProvider()).toBe(provider);
        setCryptoProvider(null);
        expect(getCryptoProvider()).toBeNull();
    });
});

// ── CMS dispatch ─────────────────────────────────────────────────────

describe('CMS signing via crypto provider', () => {
    it('uses a per-call provider and embeds its signature value', () => {
        const sig = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
        const { provider, calls } = recordingProvider(sig);

        const cms = buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'rsa-sha256',
            provider,
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].algorithm).toBe('rsa-sha256');
        // The provider receives the DER-encoded signed attributes (a SET, 0x31).
        expect(calls[0].tbs[0]).toBe(0x31);
        // The returned value is embedded verbatim in the CMS SignedData.
        expect(indexOfBytes(cms, sig)).toBeGreaterThan(0);
    });

    it('does NOT require an rsaKey when a provider is supplied', () => {
        const { provider } = recordingProvider(new Uint8Array(16));
        expect(() => buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'rsa-sha256',
            provider, // no rsaKey
        })).not.toThrow();
    });

    it('falls back to the global provider when no per-call provider is set', () => {
        const { provider, calls } = recordingProvider(new Uint8Array([0xaa, 0xbb, 0xcc]));
        setCryptoProvider(provider);
        buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'rsa-sha256',
        });
        expect(calls).toHaveLength(1);
    });

    it('per-call provider takes precedence over the global one', () => {
        const globalP = recordingProvider(new Uint8Array([1]));
        const callP = recordingProvider(new Uint8Array([2]));
        setCryptoProvider(globalP.provider);
        buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'rsa-sha256',
            provider: callP.provider,
        });
        expect(callP.calls).toHaveLength(1);
        expect(globalP.calls).toHaveLength(0);
    });

    it('passes the ecdsa-sha256 algorithm through to the provider', () => {
        const { provider, calls } = recordingProvider(new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]));
        buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'ecdsa-sha256',
            provider,
        });
        expect(calls[0].algorithm).toBe('ecdsa-sha256');
    });

    it('produces a valid DER SEQUENCE regardless of provider use', () => {
        const { provider } = recordingProvider(new Uint8Array(12));
        const cms = buildCmsSignedData({
            dataHash: HASH,
            signerCert: makeFakeCert(),
            algorithm: 'rsa-sha256',
            provider,
        });
        expect(cms[0]).toBe(0x30); // SEQUENCE
        expect(cms.length).toBeGreaterThan(100);
    });
});
