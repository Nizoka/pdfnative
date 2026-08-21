/**
 * OCSP (RFC 6960) and CRL (RFC 5280) tests — golden request bytes, mock
 * responder round-trips (good / revoked / stale), CRL parsing and
 * isSerialRevoked.
 */

import { describe, it, expect } from 'vitest';
import { buildOcspRequest, parseOcspResponse } from '../../src/crypto/ocsp.js';
import { parseCrl, isSerialRevoked } from '../../src/crypto/crl.js';
import { sha1, sha256 } from '../../src/crypto/sha.js';
import { rsaVerifyHash } from '../../src/crypto/rsa.js';
import { derDecode, derRawBytes } from '../../src/crypto/asn1.js';
import { parseCertificate } from '../../src/crypto/x509.js';
import {
    createMockPki, createMockRevocationProvider, MOCK_OCSP_URL, MOCK_CRL_URL,
} from '../../scripts/helpers/mock-pki.js';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const pki = createMockPki();

describe('buildOcspRequest', () => {
    it('produces the golden CertID structure (SHA-1 hashes per RFC 6960 §4.1.1)', () => {
        const req = buildOcspRequest(pki.signerCert, pki.rootCert);
        // OCSPRequest → tbsRequest → requestList → Request → CertID
        const root = derDecode(req);
        const certId = root.children[0].children[0].children[0].children[0];
        expect(certId.tag).toBe(0x30);
        const [algId, nameHash, keyHash, serial] = certId.children;

        // hashAlgorithm = SHA-1 (1.3.14.3.2.26) + NULL — identification only.
        expect(toHex(derRawBytes(req, algId))).toBe('300906052b0e03021a0500');
        // issuerNameHash = SHA-1 of the issuer Name DER from the checked cert.
        expect(toHex(nameHash.value)).toBe(toHex(sha1(pki.signerCert.issuer.raw)));
        // issuerKeyHash = SHA-1 of the issuer SPKI BIT STRING contents.
        expect(toHex(keyHash.value)).toBe(toHex(sha1(pki.rootCert.publicKeyBytes)));
        expect(serial.value[serial.value.length - 1]).toBe(2); // serial 2
    });

    it('golden bytes: header + CertID layout is stable', () => {
        const req = buildOcspRequest(pki.signerCert, pki.rootCert);
        const expected =
            '3042' +                       // OCSPRequest (66 content bytes)
            '3040' +                       // tbsRequest
            '303e' +                       // requestList
            '303c' +                       // Request
            '303a' +                       // CertID
            '300906052b0e03021a0500' +     // AlgorithmIdentifier SHA-1 + NULL
            '0414' + toHex(sha1(pki.signerCert.issuer.raw)) +
            '0414' + toHex(sha1(pki.rootCert.publicKeyBytes)) +
            '020102';                      // serialNumber 2
        expect(toHex(req)).toBe(expected);
    });

    it('appends the nonce as a [2] EXPLICIT requestExtensions block', () => {
        const nonce = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
        const req = buildOcspRequest(pki.signerCert, pki.rootCert, { nonce });
        const tbs = derDecode(req).children[0];
        const exts = tbs.children[1];
        expect(exts.tag).toBe(0xa2);
        // Extension { OID nonce, OCTET STRING { OCTET STRING nonce } }
        const ext = exts.children[0].children[0];
        expect(toHex(ext.children[0].value)).toBe('2b0601050507300102');
        expect(toHex(ext.children[1].value)).toBe('0404aabbccdd');
    });
});

describe('mock OCSP responder round-trip', () => {
    it('reports good with fresh validity window', async () => {
        const provider = createMockRevocationProvider(pki);
        const request = buildOcspRequest(pki.signerCert, pki.rootCert);
        const response = parseOcspResponse(await provider.fetchOcsp!(MOCK_OCSP_URL, request));

        expect(response.responseStatus).toBe(0);
        expect(response.certStatus).toBe('good');
        expect(response.producedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(response.thisUpdate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(response.nextUpdate?.toISOString()).toBe('2036-01-01T00:00:00.000Z');
        expect(response.revocationTime).toBeUndefined();
        expect(response.responderCertificates).toHaveLength(1);
        expect(toHex(response.responderCertificates[0])).toBe(toHex(pki.ocspCert.raw));
        expect(response.raw.length).toBeGreaterThan(0);
    });

    it('reports revoked with a revocationTime', async () => {
        const provider = createMockRevocationProvider(pki, { revoked: true });
        const request = buildOcspRequest(pki.signerCert, pki.rootCert);
        const response = parseOcspResponse(await provider.fetchOcsp!(MOCK_OCSP_URL, request));

        expect(response.certStatus).toBe('revoked');
        expect(response.revocationTime?.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    });

    it('serves a stale validity window when staleNextUpdate is set', async () => {
        const provider = createMockRevocationProvider(pki, { staleNextUpdate: true });
        const request = buildOcspRequest(pki.signerCert, pki.rootCert);
        const response = parseOcspResponse(await provider.fetchOcsp!(MOCK_OCSP_URL, request));

        expect(response.certStatus).toBe('good');
        expect(response.nextUpdate!.getTime()).toBeLessThan(Date.now());
    });

    it('the BasicOCSPResponse signature verifies with the responder key', async () => {
        const provider = createMockRevocationProvider(pki);
        const request = buildOcspRequest(pki.signerCert, pki.rootCert);
        const raw = await provider.fetchOcsp!(MOCK_OCSP_URL, request);

        // OCSPResponse → responseBytes [0] → SEQ { OID, OCTET STRING basic }
        const basicDer = derDecode(raw).children[1].children[0].children[1].value;
        const basic = derDecode(basicDer);
        const tbs = derRawBytes(basicDer, basic.children[0]);
        const sig = basic.children[2].value.subarray(1); // BIT STRING, skip unused-bits byte
        expect(rsaVerifyHash(sha256(tbs), sig, { n: pki.ocspKey.n, e: 65537n })).toBe(true);

        // The embedded responder cert parses and carries id-pkix-ocsp-nocheck.
        const response = parseOcspResponse(raw);
        const responderCert = parseCertificate(response.responderCertificates[0]);
        expect(responderCert.hasOcspNoCheck).toBe(true);
    });
});

describe('mock CRL round-trip', () => {
    it('parses issuer, validity window and an empty revocation list', async () => {
        const provider = createMockRevocationProvider(pki);
        const crl = parseCrl(await provider.fetchCrl!(MOCK_CRL_URL));

        expect(toHex(crl.issuerRaw)).toBe(toHex(pki.rootCert.subject.raw));
        expect(crl.thisUpdate.toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect(crl.nextUpdate?.toISOString()).toBe('2036-01-01T00:00:00.000Z');
        expect(crl.revoked).toHaveLength(0);
        expect(isSerialRevoked(crl, pki.signerCert.serialNumber)).toBe(false);
        expect(crl.raw.length).toBeGreaterThan(0);
    });

    it('lists the signer serial when revoked', async () => {
        const provider = createMockRevocationProvider(pki, { revoked: true });
        const crl = parseCrl(await provider.fetchCrl!(MOCK_CRL_URL));

        expect(crl.revoked).toHaveLength(1);
        expect(crl.revoked[0].serialNumber).toBe(pki.signerCert.serialNumber);
        expect(crl.revoked[0].revocationDate.toISOString()).toBe('2025-06-01T00:00:00.000Z');
        expect(isSerialRevoked(crl, pki.signerCert.serialNumber)).toBe(true);
        expect(isSerialRevoked(crl, 999n)).toBe(false);
    });

    it('serves a stale window when staleNextUpdate is set', async () => {
        const provider = createMockRevocationProvider(pki, { staleNextUpdate: true });
        const crl = parseCrl(await provider.fetchCrl!(MOCK_CRL_URL));
        expect(crl.nextUpdate!.getTime()).toBeLessThan(Date.now());
    });

    it('the CertificateList signature verifies with the root key', async () => {
        const provider = createMockRevocationProvider(pki);
        const raw = await provider.fetchCrl!(MOCK_CRL_URL);
        const root = derDecode(raw);
        const tbs = derRawBytes(raw, root.children[0]);
        const sig = root.children[2].value.subarray(1);
        expect(rsaVerifyHash(sha256(tbs), sig, { n: pki.rootKey.n, e: 65537n })).toBe(true);
    });

    it('parseCrl rejects non-CRL input', () => {
        expect(() => parseCrl(pki.rootCert.publicKeyBytes)).toThrow('CRL:');
    });
});
