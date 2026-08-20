/**
 * Tests for cms-utils.ts — parseCmsSignedData over real buildCmsSignedData
 * output, buildAttribute, and the addUnsignedAttribute DER surgery
 * (signed bytes untouched, enclosing lengths re-encoded), including a
 * deterministic fuzz across the 127/255 length-encoding boundaries.
 */

import { describe, it, expect } from 'vitest';
import { buildCmsSignedData } from '../../src/crypto/cms.js';
import { parseCmsSignedData, buildAttribute, addUnsignedAttribute } from '../../src/crypto/cms-utils.js';
import { derDecode, derOctetString, derSequence, derOid, oidEquals, asn1OidBytes } from '../../src/crypto/asn1.js';
import { sha256 } from '../../src/crypto/sha.js';
import { rsaVerifyHash } from '../../src/crypto/rsa.js';
import { createMockPki } from '../../scripts/helpers/mock-pki.js';

const pki = createMockPki();
// id-aa-signatureTimeStampToken — 1.2.840.113549.1.9.16.2.14
const OID_TIMESTAMP_TOKEN = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x10, 0x02, 0x0e]);
const OID_SHA256_ALG = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

function makeCms(): Uint8Array {
    return buildCmsSignedData({
        dataHash: sha256(new TextEncoder().encode('cms-utils fixture')),
        signerCert: pki.signerCert,
        certChain: [pki.rootCert],
        algorithm: 'rsa-sha256',
        rsaKey: pki.signerKey,
        signingTime: new Date(Date.UTC(2026, 0, 15)),
    });
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Deterministic PRNG (mulberry32) so the fuzz is reproducible. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe('parseCmsSignedData', () => {
    const cms = makeCms();
    const parsed = parseCmsSignedData(cms);

    it('extracts both certificates byte-exactly', () => {
        expect(parsed.certificates).toHaveLength(2);
        expect(toHex(parsed.certificates[0])).toBe(toHex(pki.signerCert.raw));
        expect(toHex(parsed.certificates[1])).toBe(toHex(pki.rootCert.raw));
    });

    it('surfaces signerInfo, signedAttrs, signature and digest OID', () => {
        expect(parsed.signerInfoRaw[0]).toBe(0x30);
        expect(parsed.signedAttrsRaw).toBeDefined();
        expect(parsed.signedAttrsRaw![0]).toBe(0xa0);
        expect(parsed.signatureValue.length).toBe(256); // RSA-2048
        expect(oidEquals(parsed.digestAlgorithmOid, OID_SHA256_ALG)).toBe(true);
    });

    it('reports no unsigned attributes and a detached eContent', () => {
        expect(parsed.unsignedAttrs).toHaveLength(0);
        expect(parsed.eContent).toBeUndefined();
    });

    it('rejects a non-SignedData ContentInfo', () => {
        expect(() => parseCmsSignedData(derSequence(derOid(OID_SHA256_ALG)))).toThrow('CMS:');
    });
});

describe('buildAttribute', () => {
    it('wraps oid + values into SEQUENCE { OID, SET OF }', () => {
        const attr = buildAttribute(OID_TIMESTAMP_TOKEN, derOctetString(new Uint8Array([1, 2, 3])));
        const decoded = derDecode(attr);
        expect(decoded.tag).toBe(0x30);
        expect(oidEquals(asn1OidBytes(decoded.children[0]), OID_TIMESTAMP_TOKEN)).toBe(true);
        expect(decoded.children[1].tag).toBe(0x31);
        expect(decoded.children[1].children).toHaveLength(1);
    });

    it('sorts multiple values canonically (X.690 §11.6)', () => {
        const big = derOctetString(new Uint8Array(40));
        const small = derOctetString(new Uint8Array(2));
        const attr = buildAttribute(OID_TIMESTAMP_TOKEN, big, small);
        const set = derDecode(attr).children[1];
        expect(set.children[0].totalLength).toBeLessThan(set.children[1].totalLength);
    });

    it('requires at least one value', () => {
        expect(() => buildAttribute(OID_TIMESTAMP_TOKEN)).toThrow('at least one value');
    });
});

describe('addUnsignedAttribute', () => {
    function verifyStillValid(before: Uint8Array, after: Uint8Array, expectedAttrCount: number): void {
        const parsedBefore = parseCmsSignedData(before);
        const parsedAfter = parseCmsSignedData(after);

        // The signed attributes are byte-identical …
        expect(toHex(parsedAfter.signedAttrsRaw!)).toBe(toHex(parsedBefore.signedAttrsRaw!));
        // … the certificates too …
        expect(parsedAfter.certificates.map(toHex)).toEqual(parsedBefore.certificates.map(toHex));
        // … and the signature still verifies over the canonical SET.
        const tbs = new Uint8Array(parsedAfter.signedAttrsRaw!);
        tbs[0] = 0x31;
        expect(rsaVerifyHash(sha256(tbs), parsedAfter.signatureValue, { n: pki.signerKey.n, e: 65537n })).toBe(true);

        expect(parsedAfter.unsignedAttrs).toHaveLength(expectedAttrCount);
    }

    it('creates the [1] IMPLICIT slot when absent', () => {
        const cms = makeCms();
        const attr = buildAttribute(OID_TIMESTAMP_TOKEN, derOctetString(new Uint8Array(64).fill(0xab)));
        const withAttr = addUnsignedAttribute(cms, attr);

        verifyStillValid(cms, withAttr, 1);
        const parsed = parseCmsSignedData(withAttr);
        expect(toHex(parsed.unsignedAttrs[0])).toBe(toHex(attr));
        // The whole structure re-decodes as a single well-formed TLV.
        expect(derDecode(withAttr).totalLength).toBe(withAttr.length);
    });

    it('appends to an existing unsignedAttrs slot', () => {
        const cms = makeCms();
        const first = buildAttribute(OID_TIMESTAMP_TOKEN, derOctetString(new Uint8Array(16).fill(1)));
        const second = buildAttribute(OID_TIMESTAMP_TOKEN, derOctetString(new Uint8Array(300).fill(2)));
        const once = addUnsignedAttribute(cms, first);
        const twice = addUnsignedAttribute(once, second);

        verifyStillValid(cms, twice, 2);
        const parsed = parseCmsSignedData(twice);
        expect(toHex(parsed.unsignedAttrs[0])).toBe(toHex(first));
        expect(toHex(parsed.unsignedAttrs[1])).toBe(toHex(second));
    });

    it('rejects a non-SEQUENCE attribute TLV', () => {
        expect(() => addUnsignedAttribute(makeCms(), derOctetString(new Uint8Array(4)))).toThrow('SEQUENCE');
    });

    it('fuzz: survives attribute sizes crossing the 127/255 length boundaries', () => {
        const cms = makeCms();
        const rand = mulberry32(0x1ec2b7d);
        // Deterministic targeted sizes around the DER length-encoding
        // boundaries (0x7f→0x81 xx and 0xff→0x82 xx xx), plus random fill.
        const sizes: number[] = [];
        for (let s = 110; s <= 135; s++) sizes.push(s);
        for (let s = 245; s <= 265; s++) sizes.push(s);
        for (let i = 0; i < 15; i++) sizes.push(20 + Math.floor(rand() * 1200));

        for (const size of sizes) {
            const payload = new Uint8Array(size);
            for (let i = 0; i < size; i++) payload[i] = Math.floor(rand() * 256);
            const attr = buildAttribute(OID_TIMESTAMP_TOKEN, derOctetString(payload));
            const withAttr = addUnsignedAttribute(cms, attr);

            const parsed = parseCmsSignedData(withAttr);
            expect(parsed.unsignedAttrs).toHaveLength(1);
            expect(toHex(parsed.unsignedAttrs[0])).toBe(toHex(attr));
            expect(toHex(parsed.signedAttrsRaw!)).toBe(toHex(parseCmsSignedData(cms).signedAttrsRaw!));
            expect(derDecode(withAttr).totalLength).toBe(withAttr.length);
        }
    });
});
