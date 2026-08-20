/**
 * X.509 LTV extension parsing tests (1.7.0) — SKI/AKI, EKU (+certHasEku),
 * AIA OCSP/caIssuers URLs, CRL Distribution Points, id-pkix-ocsp-nocheck —
 * exercised through the mock-PKI certificates, which are built as real DER
 * and parsed back by parseCertificate().
 */

import { describe, it, expect } from 'vitest';
import { certHasEku } from '../../src/crypto/x509.js';
import {
    createMockPki, OID_KP_TIME_STAMPING, OID_KP_OCSP_SIGNING,
    MOCK_OCSP_URL, MOCK_CA_ISSUERS_URL, MOCK_CRL_URL,
} from '../../scripts/helpers/mock-pki.js';

const pki = createMockPki();

function toHex(bytes: Uint8Array | undefined): string {
    return bytes ? Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('') : '';
}

describe('X.509 LTV extensions — mock PKI', () => {
    it('root CA: CA flag, SKI, no AIA/CRLDP/EKU', () => {
        expect(pki.rootCert.isCA).toBe(true);
        expect(pki.rootCert.subjectKeyId).toBeDefined();
        expect(pki.rootCert.subjectKeyId!.length).toBe(20);   // SHA-1 key id
        expect(pki.rootCert.extKeyUsage).toEqual([]);
        expect(pki.rootCert.ocspUrls).toEqual([]);
        expect(pki.rootCert.caIssuersUrls).toEqual([]);
        expect(pki.rootCert.crlUrls).toEqual([]);
        expect(pki.rootCert.hasOcspNoCheck).toBe(false);
    });

    it('signer: AKI chains to the root SKI', () => {
        expect(pki.signerCert.authorityKeyId).toBeDefined();
        expect(toHex(pki.signerCert.authorityKeyId)).toBe(toHex(pki.rootCert.subjectKeyId));
        // Root and leaves use different keys → different key ids.
        expect(toHex(pki.signerCert.subjectKeyId)).not.toBe(toHex(pki.rootCert.subjectKeyId));
    });

    it('signer: AIA exposes OCSP and caIssuers URLs', () => {
        expect(pki.signerCert.ocspUrls).toEqual([MOCK_OCSP_URL]);
        expect(pki.signerCert.caIssuersUrls).toEqual([MOCK_CA_ISSUERS_URL]);
    });

    it('signer: CRL Distribution Points expose the CRL URL', () => {
        expect(pki.signerCert.crlUrls).toEqual([MOCK_CRL_URL]);
    });

    it('TSA: critical EKU id-kp-timeStamping', () => {
        expect(pki.tsaCert.extKeyUsage).toHaveLength(1);
        expect(certHasEku(pki.tsaCert, OID_KP_TIME_STAMPING)).toBe(true);
        expect(certHasEku(pki.tsaCert, OID_KP_OCSP_SIGNING)).toBe(false);
    });

    it('OCSP responder: EKU id-kp-OCSPSigning + id-pkix-ocsp-nocheck', () => {
        expect(certHasEku(pki.ocspCert, OID_KP_OCSP_SIGNING)).toBe(true);
        expect(certHasEku(pki.ocspCert, OID_KP_TIME_STAMPING)).toBe(false);
        expect(pki.ocspCert.hasOcspNoCheck).toBe(true);
        // The others do not carry ocsp-nocheck.
        expect(pki.signerCert.hasOcspNoCheck).toBe(false);
        expect(pki.tsaCert.hasOcspNoCheck).toBe(false);
    });

    it('certHasEku tolerates certificates without the extension field', () => {
        // Hand-built literals (pre-1.7.0 style) leave extKeyUsage undefined.
        const bare = { ...pki.signerCert, extKeyUsage: undefined };
        expect(certHasEku(bare, OID_KP_TIME_STAMPING)).toBe(false);
    });

    it('exposes the raw pieces the OCSP CertID builder needs', () => {
        // issuer Name DER as present in the checked certificate …
        expect(pki.signerCert.issuer.raw[0]).toBe(0x30);
        expect(toHex(pki.signerCert.issuer.raw)).toBe(toHex(pki.rootCert.subject.raw));
        // … and the issuer SPKI BIT STRING contents (unused-bits byte stripped).
        expect(pki.rootCert.publicKeyBytes[0]).toBe(0x30); // RSAPublicKey SEQUENCE
    });
});
