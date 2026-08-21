/**
 * CMS profile & digest-agility tests (1.7.0):
 *  - pkcs7 profile keeps the classic attribute membership (content-type,
 *    message-digest, signing-time) but now emits them in canonical X.690
 *    §11.6 SET OF order (DER-validity fix — the pre-1.7.0 declaration
 *    order content-type → message-digest → signing-time was invalid DER).
 *  - pades profile (ETSI EN 319 142-1 B-B) adds ESS signing-certificate-v2
 *    (RFC 5035) and omits signing-time.
 *  - digestAlgorithm sha256/384/512 tracks through every OID slot.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initCrypto } from '../../src/crypto/index.js';
import { buildCmsSignedData, type CmsDigestAlgorithm } from '../../src/crypto/cms.js';
import { parseCmsSignedData } from '../../src/crypto/cms-utils.js';
import { derDecode, derRawBytes, oidEquals, asn1OidBytes, type Asn1Node } from '../../src/crypto/asn1.js';
import { sha256, sha384, sha512 } from '../../src/crypto/sha.js';
import { rsaVerifyHash, type RsaDigest } from '../../src/crypto/rsa.js';
import { ecdsaVerifyHash, ecPublicKeyFromPrivate, decodeDerSignature, type EcPrivateKey } from '../../src/crypto/ecdsa.js';
import { createMockPki } from '../../scripts/helpers/mock-pki.js';

// ── OID fixtures ─────────────────────────────────────────────────────

const OID_CONTENT_TYPE = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03]);
const OID_MESSAGE_DIGEST = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
const OID_SIGNING_TIME = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x05]);
const OID_SIGNING_CERT_V2 = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x02, 0x2f]);
const OID_SHA256 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const OID_SHA384 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02]);
const OID_SHA512 = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x03]);

const HASHES: Record<CmsDigestAlgorithm, { fn: (b: Uint8Array) => Uint8Array; oid: Uint8Array }> = {
    sha256: { fn: sha256, oid: OID_SHA256 },
    sha384: { fn: sha384, oid: OID_SHA384 },
    sha512: { fn: sha512, oid: OID_SHA512 },
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Retag the stored [0] IMPLICIT signed attrs to the SET the signature covers. */
function signedAttrsSet(signedAttrsRaw: Uint8Array): Uint8Array {
    const set = new Uint8Array(signedAttrsRaw);
    set[0] = 0x31;
    return set;
}

/** Parse the attributes of a signed-attrs TLV into {oid, node, raw} tuples. */
function parseAttributes(signedAttrsRaw: Uint8Array): { oid: Uint8Array; node: Asn1Node; raw: Uint8Array }[] {
    const set = signedAttrsSet(signedAttrsRaw);
    const decoded = derDecode(set);
    return decoded.children.map((attr) => ({
        oid: asn1OidBytes(attr.children[0]),
        node: attr,
        raw: derRawBytes(set, attr),
    }));
}

function findAttr(attrs: { oid: Uint8Array; node: Asn1Node; raw: Uint8Array }[], oid: Uint8Array) {
    return attrs.find((a) => oidEquals(a.oid, oid));
}

const pki = createMockPki();
const signingTime = new Date(Date.UTC(2026, 1, 1, 12, 0, 0));

beforeAll(async () => {
    // encodeDerSignature (ECDSA path) needs the ASN.1 cross-module init.
    await initCrypto();
});

// ── pkcs7 profile ────────────────────────────────────────────────────

describe('CMS pkcs7 profile (default)', () => {
    const cms = buildCmsSignedData({
        dataHash: sha256(new TextEncoder().encode('byte-range data')),
        signerCert: pki.signerCert,
        algorithm: 'rsa-sha256',
        rsaKey: pki.signerKey,
        signingTime,
    });
    const parsed = parseCmsSignedData(cms);

    it('keeps exactly the three classic attributes', () => {
        const attrs = parseAttributes(parsed.signedAttrsRaw!);
        expect(attrs).toHaveLength(3);
        expect(findAttr(attrs, OID_CONTENT_TYPE)).toBeDefined();
        expect(findAttr(attrs, OID_MESSAGE_DIGEST)).toBeDefined();
        expect(findAttr(attrs, OID_SIGNING_TIME)).toBeDefined();
        expect(findAttr(attrs, OID_SIGNING_CERT_V2)).toBeUndefined();
    });

    it('emits the attributes in canonical X.690 §11.6 order', () => {
        const attrs = parseAttributes(parsed.signedAttrsRaw!);
        // Canonical byte order sorts by the SEQUENCE length byte:
        // content-type (0x18) < signing-time (0x1c) < message-digest (0x2f).
        expect(oidEquals(attrs[0].oid, OID_CONTENT_TYPE)).toBe(true);
        expect(oidEquals(attrs[1].oid, OID_SIGNING_TIME)).toBe(true);
        expect(oidEquals(attrs[2].oid, OID_MESSAGE_DIGEST)).toBe(true);
        // And the raw encodings really are ascending as octet strings.
        for (let i = 1; i < attrs.length; i++) {
            expect(compareBytes(attrs[i - 1].raw, attrs[i].raw)).toBeLessThan(0);
        }
    });

    it('the RSA signature verifies over the canonical SET bytes', () => {
        const tbs = signedAttrsSet(parsed.signedAttrsRaw!);
        expect(rsaVerifyHash(sha256(tbs), parsed.signatureValue, { n: pki.signerKey.n, e: 65537n })).toBe(true);
    });

    it('declares sha256 in the SignerInfo digestAlgorithm', () => {
        expect(oidEquals(parsed.digestAlgorithmOid, OID_SHA256)).toBe(true);
    });
});

// ── pades profile ────────────────────────────────────────────────────

describe('CMS pades profile (ETSI EN 319 142-1 B-B)', () => {
    const cms = buildCmsSignedData({
        dataHash: sha256(new TextEncoder().encode('byte-range data')),
        signerCert: pki.signerCert,
        algorithm: 'rsa-sha256',
        rsaKey: pki.signerKey,
        signingTime,
        profile: 'pades',
    });
    const parsed = parseCmsSignedData(cms);
    const attrs = parseAttributes(parsed.signedAttrsRaw!);

    it('adds signing-certificate-v2 and omits signing-time', () => {
        expect(attrs).toHaveLength(3);
        expect(findAttr(attrs, OID_CONTENT_TYPE)).toBeDefined();
        expect(findAttr(attrs, OID_MESSAGE_DIGEST)).toBeDefined();
        expect(findAttr(attrs, OID_SIGNING_CERT_V2)).toBeDefined();
        expect(findAttr(attrs, OID_SIGNING_TIME)).toBeUndefined();
    });

    it('certHash is the digest of the signer certificate DER', () => {
        const attr = findAttr(attrs, OID_SIGNING_CERT_V2)!;
        // Attribute → SET → SigningCertificateV2 → certs SEQ → ESSCertIDv2.
        const essCertId = attr.node.children[1].children[0].children[0].children[0];
        // Default hashAlgorithm (sha256) is omitted per DER → first child is
        // the certHash OCTET STRING.
        const certHash = essCertId.children[0];
        expect(certHash.tag).toBe(0x04);
        expect(Array.from(certHash.value)).toEqual(Array.from(sha256(pki.signerCert.raw)));
        // IssuerSerial follows: SEQUENCE { GeneralNames, INTEGER serial }.
        const issuerSerial = essCertId.children[1];
        expect(issuerSerial.tag).toBe(0x30);
    });

    it('emits attributes in canonical order and the signature verifies', () => {
        for (let i = 1; i < attrs.length; i++) {
            expect(compareBytes(attrs[i - 1].raw, attrs[i].raw)).toBeLessThan(0);
        }
        const tbs = signedAttrsSet(parsed.signedAttrsRaw!);
        expect(rsaVerifyHash(sha256(tbs), parsed.signatureValue, { n: pki.signerKey.n, e: 65537n })).toBe(true);
    });

    it('includes the ESSCertIDv2 hashAlgorithm only for non-default digests', () => {
        const cms384 = buildCmsSignedData({
            dataHash: sha384(new TextEncoder().encode('byte-range data')),
            signerCert: pki.signerCert,
            algorithm: 'rsa-sha384',
            rsaKey: pki.signerKey,
            profile: 'pades',
        });
        const attrs384 = parseAttributes(parseCmsSignedData(cms384).signedAttrsRaw!);
        const attr = findAttr(attrs384, OID_SIGNING_CERT_V2)!;
        const essCertId = attr.node.children[1].children[0].children[0].children[0];
        // hashAlgorithm present (SEQUENCE { OID sha384 }) before certHash.
        expect(essCertId.children[0].tag).toBe(0x30);
        expect(oidEquals(asn1OidBytes(essCertId.children[0].children[0]), OID_SHA384)).toBe(true);
        expect(Array.from(essCertId.children[1].value)).toEqual(Array.from(sha384(pki.signerCert.raw)));
    });

    it('works with ecdsa-sha256 (P-256 stays sha256-only)', () => {
        const ecKey: EcPrivateKey = { d: BigInt('0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721') };
        const cmsEc = buildCmsSignedData({
            dataHash: sha256(new TextEncoder().encode('ecdsa data')),
            signerCert: pki.signerCert,
            algorithm: 'ecdsa-sha256',
            ecKey,
            profile: 'pades',
        });
        const parsedEc = parseCmsSignedData(cmsEc);
        const tbs = signedAttrsSet(parsedEc.signedAttrsRaw!);
        const { r, s } = decodeDerSignature(parsedEc.signatureValue);
        expect(ecdsaVerifyHash(sha256(tbs), r, s, ecPublicKeyFromPrivate(ecKey))).toBe(true);
    });
});

// ── Digest agility ───────────────────────────────────────────────────

describe('CMS digest agility', () => {
    it.each<[CmsDigestAlgorithm, 'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512']>([
        ['sha256', 'rsa-sha256'],
        ['sha384', 'rsa-sha384'],
        ['sha512', 'rsa-sha512'],
    ])('tracks %s through digestAlgorithms, SignerInfo and the signature', (digest, algorithm) => {
        const { fn, oid } = HASHES[digest];
        const cms = buildCmsSignedData({
            dataHash: fn(new TextEncoder().encode('agility')),
            signerCert: pki.signerCert,
            algorithm,
            rsaKey: pki.signerKey,
            signingTime,
            digestAlgorithm: digest,
        });
        const parsed = parseCmsSignedData(cms);
        expect(oidEquals(parsed.digestAlgorithmOid, oid)).toBe(true);

        // digestAlgorithms set of the SignedData tracks the digest too.
        const root = derDecode(cms);
        const signedData = root.children[1].children[0];
        const digestAlgSet = signedData.children[1];
        expect(oidEquals(asn1OidBytes(digestAlgSet.children[0].children[0]), oid)).toBe(true);

        // Signature verifies under the matching RSA digest.
        const tbs = signedAttrsSet(parsed.signedAttrsRaw!);
        const rsaDigest: RsaDigest = digest;
        expect(rsaVerifyHash(fn(tbs), parsed.signatureValue, { n: pki.signerKey.n, e: 65537n }, rsaDigest)).toBe(true);
    });

    it('enforces the per-digest dataHash length', () => {
        expect(() => buildCmsSignedData({
            dataHash: new Uint8Array(32),
            signerCert: pki.signerCert,
            algorithm: 'rsa-sha384',
            rsaKey: pki.signerKey,
        })).toThrow('Expected 48-byte SHA-384 hash');
        expect(() => buildCmsSignedData({
            dataHash: new Uint8Array(48),
            signerCert: pki.signerCert,
            algorithm: 'rsa-sha512',
            rsaKey: pki.signerKey,
        })).toThrow('Expected 64-byte SHA-512 hash');
    });

    it('rejects a digestAlgorithm conflicting with the algorithm suffix', () => {
        expect(() => buildCmsSignedData({
            dataHash: new Uint8Array(48),
            signerCert: pki.signerCert,
            algorithm: 'rsa-sha256',
            rsaKey: pki.signerKey,
            digestAlgorithm: 'sha384',
        })).toThrow("digestAlgorithm 'sha384' conflicts with algorithm 'rsa-sha256'");
    });
});

// ── Helpers ──────────────────────────────────────────────────────────

function compareBytes(a: Uint8Array, b: Uint8Array): number {
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
}
