/**
 * RFC 3161 tests — golden-byte TimeStampReq, TimeStampResp parsing, and a
 * full mock-TSA round-trip (request → token → parseTimestampToken →
 * verifyTimestampImprint) with nonce echo and rejection handling.
 */

import { describe, it, expect } from 'vitest';
import {
    buildTimestampRequest, parseTimestampResponse, parseTimestampToken,
    verifyTimestampImprint,
} from '../../src/crypto/rfc3161.js';
import { parseCmsSignedData } from '../../src/crypto/cms-utils.js';
import { sha256, sha384 } from '../../src/crypto/sha.js';
import { rsaVerifyHash } from '../../src/crypto/rsa.js';
import { derDecode, oidEquals } from '../../src/crypto/asn1.js';
import {
    createMockPki, createMockTimestampProvider, MOCK_TSA_POLICY_OID,
} from '../../scripts/helpers/mock-pki.js';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const pki = createMockPki();
const OID_SHA256_ALG = new Uint8Array([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

describe('buildTimestampRequest', () => {
    it('produces the golden DER for a sha256 imprint with nonce and certReq', () => {
        const imprint = sha256(new TextEncoder().encode('signature value'));
        const req = buildTimestampRequest(imprint, { nonce: 0x0102030405n });
        // TimeStampReq ::= SEQUENCE {
        //   version INTEGER 1,
        //   messageImprint SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING },
        //   nonce INTEGER, certReq BOOLEAN TRUE }
        const expected =
            '3040' +                                    // SEQUENCE, 64 content bytes
            '020101' +                                  // version 1
            '3031300d060960864801650304020105000420' +  // MessageImprint { algId sha256+NULL, OCTET STRING (32) }
            toHex(imprint) +
            '02050102030405' +                          // nonce
            '0101ff';                                   // certReq TRUE
        expect(toHex(req)).toBe(expected);
    });

    it('omits nonce and certReq FALSE per DER DEFAULT rules', () => {
        const imprint = sha256(new Uint8Array(1));
        const req = buildTimestampRequest(imprint, { certReq: false });
        const hex = toHex(req);
        expect(hex.endsWith(toHex(imprint))).toBe(true);   // imprint is the last field
        expect(hex).not.toContain('0101ff');               // no BOOLEAN TRUE
    });

    it('supports sha384 imprints and validates imprint length', () => {
        const imprint = sha384(new Uint8Array(3));
        const req = buildTimestampRequest(imprint, { digestAlgorithm: 'sha384' });
        expect(toHex(req)).toContain('0609608648016503040202'); // sha384 OID TLV
        expect(() => buildTimestampRequest(imprint)).toThrow('expected 32-byte SHA-256');
    });

    it('encodes an explicit reqPolicy OID', () => {
        const req = buildTimestampRequest(sha256(new Uint8Array(0)), { reqPolicy: MOCK_TSA_POLICY_OID });
        expect(toHex(req)).toContain('06' + '03' + toHex(MOCK_TSA_POLICY_OID));
    });
});

describe('mock TSA round-trip', () => {
    it('request → response → token → TSTInfo → imprint verifies', async () => {
        const provider = createMockTimestampProvider(pki);
        const imprint = sha256(new TextEncoder().encode('the CMS signature value'));
        const request = buildTimestampRequest(imprint, { nonce: 0xdeadbeefn });

        const responseDer = await provider.getTimestamp(request);
        const response = parseTimestampResponse(responseDer);
        expect(response.status).toBe(0);
        expect(response.token).toBeDefined();

        const info = parseTimestampToken(response.token!);
        expect(oidEquals(info.policyOid, MOCK_TSA_POLICY_OID)).toBe(true);
        expect(oidEquals(info.hashAlgorithmOid, OID_SHA256_ALG)).toBe(true);
        expect(info.serialNumber).toBe(0x1234n);
        expect(info.genTime.toISOString()).toBe('2026-02-01T12:00:00.000Z');
        expect(info.nonce).toBe(0xdeadbeefn);                 // nonce echoed
        expect(info.tsaCertificates).toHaveLength(1);
        expect(toHex(info.tsaCertificates[0])).toBe(toHex(pki.tsaCert.raw));

        expect(verifyTimestampImprint(info, imprint)).toBe(true);
        expect(verifyTimestampImprint(info, sha256(new Uint8Array(1)))).toBe(false);
        expect(verifyTimestampImprint(info, imprint.subarray(0, 16))).toBe(false);
    });

    it('the token is a real SignedData whose signature verifies', async () => {
        const provider = createMockTimestampProvider(pki);
        const request = buildTimestampRequest(sha256(new Uint8Array(7)));
        const response = parseTimestampResponse(await provider.getTimestamp(request));

        const cms = parseCmsSignedData(response.token!);
        expect(cms.eContent).toBeDefined();
        const tbs = new Uint8Array(cms.signedAttrsRaw!);
        tbs[0] = 0x31;
        expect(rsaVerifyHash(sha256(tbs), cms.signatureValue, { n: pki.tsaKey.n, e: 65537n })).toBe(true);

        // The message-digest signed attribute covers the TSTInfo eContent.
        const attrs = derDecode(tbs);
        const mdOid = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
        const mdAttr = attrs.children.find((a) => oidEquals(a.children[0].value, mdOid));
        expect(mdAttr).toBeDefined();
        expect(toHex(mdAttr!.children[1].children[0].value)).toBe(toHex(sha256(cms.eContent!)));
    });

    it('omits the nonce from TSTInfo when the request has none', async () => {
        const provider = createMockTimestampProvider(pki);
        const response = parseTimestampResponse(await provider.getTimestamp(
            buildTimestampRequest(sha256(new Uint8Array(2))),
        ));
        const info = parseTimestampToken(response.token!);
        expect(info.nonce).toBeUndefined();
    });

    it('a rejection status carries no token and callers must not embed', async () => {
        const provider = createMockTimestampProvider(pki, { status: 2 });
        const response = parseTimestampResponse(await provider.getTimestamp(
            buildTimestampRequest(sha256(new Uint8Array(2))),
        ));
        expect(response.status).toBe(2);
        expect(response.statusString).toBe('rejected by mock TSA');
        expect(response.token).toBeUndefined();
    });

    it('parseTimestampToken rejects a non-TSTInfo SignedData', () => {
        // A detached PDF CMS is a SignedData over id-data → must be refused.
        expect(() => parseTimestampToken(pki.signerCert.raw)).toThrow();
    });
});
