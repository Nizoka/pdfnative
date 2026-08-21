/**
 * LTV pipeline integration (v1.7.0): PAdES B-B → B-T → B-LT → B-LTA with
 * the offline mock PKI — real CMS, real RFC 3161 tokens, real OCSP/CRL
 * structures, zero network. Every intermediate revision must stay a valid
 * PDF and every earlier revision must remain byte-identical.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { addSignaturePlaceholder } from '../../src/core/pdf-sig-placeholder.js';
import { signPdfBytes, estimateContentsSize } from '../../src/core/pdf-signature.js';
import { signPdfBytesWithTimestamp } from '../../src/core/pdf-sign-timestamp.js';
import { addValidationInfo, collectValidationInfo, embedValidationInfo, vriKeyForContents } from '../../src/core/pdf-dss.js';
import { addDocumentTimestamp } from '../../src/core/pdf-doc-timestamp.js';
import { listSignatures } from '../../src/core/pdf-sig-utils.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { isDict, isRef, isArray, isStream, type PdfValue } from '../../src/parser/pdf-object-parser.js';
import { parseCmsSignedData } from '../../src/crypto/cms-utils.js';
import { parseTimestampToken, verifyTimestampImprint } from '../../src/crypto/rfc3161.js';
import { sha256 } from '../../src/crypto/sha.js';
import { createMockPki, createMockTimestampProvider, createMockRevocationProvider } from '../../scripts/helpers/mock-pki.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const pki = createMockPki();
const tsa = createMockTimestampProvider(pki);
const revocation = createMockRevocationProvider(pki);

const doc: DocumentParams = {
    title: 'LTV pipeline',
    blocks: [{ type: 'paragraph', text: 'long-term validation' }],
};

function makeUnsigned(placeholderBytes?: number): Uint8Array {
    return addSignaturePlaceholder(buildDocumentPDFBytes(doc), {
        ...(placeholderBytes !== undefined ? { placeholderBytes } : {}),
        metadata: { subFilter: 'ETSI.CAdES.detached', reason: 'integration' },
    });
}

function signBb(bytes: Uint8Array): Uint8Array {
    return signPdfBytes(bytes, {
        signerCert: pki.signerCert,
        certChain: [pki.rootCert],
        rsaKey: pki.signerKey,
        algorithm: 'rsa-sha256',
        profile: 'pades',
    });
}

describe('PAdES B-B (pades profile + CAdES subFilter)', () => {
    it('signs with ETSI.CAdES.detached and a parseable CMS', () => {
        const signed = signBb(makeUnsigned());
        const sigs = listSignatures(signed);
        expect(sigs.length).toBe(1);
        expect(sigs[0].subFilter).toBe('ETSI.CAdES.detached');
        expect(sigs[0].isPlaceholder).toBe(false);
        const cms = parseCmsSignedData(sigs[0].contents);
        expect(cms.certificates.length).toBe(2); // signer + root
        expect(cms.unsignedAttrs.length).toBe(0);
        expect(openPdf(signed).pageCount).toBe(1);
    });

    it('bakes placeholder metadata into the /Sig dictionary', () => {
        const signed = signBb(makeUnsigned());
        const pdf = Buffer.from(signed).toString('latin1');
        expect(pdf).toContain('/Reason (integration)');
    });
});

describe('PAdES B-T (signature timestamp)', () => {
    it('embeds a verified RFC 3161 token as an unsigned attribute', async () => {
        const unsigned = makeUnsigned(estimateContentsSize([2048, 2048], 'rsa-sha256', { timestamp: true }));
        const signed = await signPdfBytesWithTimestamp(unsigned, {
            signerCert: pki.signerCert,
            certChain: [pki.rootCert],
            rsaKey: pki.signerKey,
            profile: 'pades',
            timestampProvider: tsa,
            timestampNonce: 42n,
        });
        const sigs = listSignatures(signed);
        expect(sigs.length).toBe(1);
        const cms = parseCmsSignedData(sigs[0].contents);
        expect(cms.unsignedAttrs.length).toBe(1);
        // Extract the embedded TimeStampToken from the unsigned attribute
        // (SEQUENCE { OID, SET { token } }) and verify its imprint really
        // covers this signature's CMS signature value, and that the
        // requested nonce echoed back.
        const attr = cms.unsignedAttrs[0];
        const setIdx = attr.indexOf(0x31, 13); // after SEQ hdr + 11-byte OID TLV
        expect(setIdx).toBeGreaterThan(0);
        const lenByte = attr[setIdx + 1];
        const tokenStart = lenByte & 0x80 ? setIdx + 2 + (lenByte & 0x7f) : setIdx + 2;
        const info = parseTimestampToken(attr.subarray(tokenStart));
        expect(verifyTimestampImprint(info, sha256(cms.signatureValue))).toBe(true);
        expect(info.nonce).toBe(42n);
        expect(openPdf(signed).pageCount).toBe(1);
    });

    it('throws without a provider and never embeds a rejected token', async () => {
        const unsigned = makeUnsigned();
        await expect(signPdfBytesWithTimestamp(unsigned, {
            signerCert: pki.signerCert, rsaKey: pki.signerKey,
        })).rejects.toThrow(/TimestampProvider/);

        const rejecting = createMockTimestampProvider(pki, { status: 2 });
        await expect(signPdfBytesWithTimestamp(unsigned, {
            signerCert: pki.signerCert, rsaKey: pki.signerKey,
            timestampProvider: rejecting,
        })).rejects.toThrow(/status 2/);
    });
});

describe('PAdES B-LT (/DSS + /VRI)', () => {
    async function makeBlt(): Promise<{ signed: Uint8Array; withDss: Uint8Array }> {
        const signed = signBb(makeUnsigned());
        const withDss = await addValidationInfo(signed, { revocationProvider: revocation });
        return { signed, withDss };
    }

    it('embeds /DSS with certs, OCSP responses and a matching /VRI key', async () => {
        const { signed, withDss } = await makeBlt();
        // Earlier revision byte-identical.
        expect(withDss.subarray(0, signed.length)).toEqual(signed);

        const reader = openPdf(withDss);
        const catalog = reader.getCatalog();
        const dssVal = catalog.get('DSS');
        const dss = isRef(dssVal) ? reader.getObject(dssVal.num) : dssVal;
        expect(dss && isDict(dss)).toBe(true);
        if (!dss || !isDict(dss)) return;

        const certs = dss.get('Certs');
        expect(isArray(certs)).toBe(true);
        expect((certs as PdfValue[]).length).toBe(2); // signer + root deduped

        const ocsps = dss.get('OCSPs');
        expect(isArray(ocsps)).toBe(true);
        expect((ocsps as PdfValue[]).length).toBeGreaterThanOrEqual(1);

        // The /VRI key equals SHA-1 (uppercase hex) of the full /Contents.
        const sigs = listSignatures(withDss);
        const expectedKey = vriKeyForContents(sigs[0].contents);
        const vri = dss.get('VRI');
        expect(vri && isDict(vri)).toBe(true);
        if (vri && isDict(vri)) {
            expect([...vri.keys()]).toContain(expectedKey);
        }

        // Cert streams round-trip byte-exact.
        const firstCertRef = (certs as PdfValue[])[0];
        expect(isRef(firstCertRef)).toBe(true);
        if (isRef(firstCertRef)) {
            const stream = reader.getObject(firstCertRef.num);
            expect(stream && isStream(stream)).toBe(true);
            if (stream && isStream(stream)) {
                const der = stream.data;
                const matches = [pki.signerCert.raw, pki.rootCert.raw]
                    .some(raw => der.length === raw.length && der.every((b, i) => b === raw[i]));
                expect(matches).toBe(true);
            }
        }
    });

    it('collect/embed split is deterministic and replayable', async () => {
        const { signed } = await makeBlt();
        const data = await collectValidationInfo(signed, { revocationProvider: revocation });
        expect(data.certificates.length).toBe(2);
        expect(data.vri.length).toBe(1);
        const a = embedValidationInfo(signed, data);
        const b = embedValidationInfo(signed, data);
        expect(a).toEqual(b);
    });

    it('merges an existing /DSS instead of replacing it', async () => {
        const { withDss } = await makeBlt();
        const again = await addValidationInfo(withDss, { revocationProvider: revocation });
        const reader = openPdf(again);
        const catalog = reader.getCatalog();
        const dssVal = catalog.get('DSS');
        const dss = isRef(dssVal) ? reader.getObject(dssVal.num) : dssVal;
        expect(dss && isDict(dss)).toBe(true);
        if (dss && isDict(dss)) {
            // First pass's 2 cert streams preserved + second pass's appended.
            expect((dss.get('Certs') as PdfValue[]).length).toBeGreaterThanOrEqual(2);
        }
    });

    it('refuses documents without a signed signature', async () => {
        await expect(addValidationInfo(makeUnsigned(), { revocationProvider: revocation }))
            .rejects.toThrow(/no signed signature/);
    });
});

describe('PAdES B-LTA (document timestamp)', () => {
    it('appends a DocTimeStamp revision with a bare verified token', async () => {
        const signed = signBb(makeUnsigned());
        const withDss = await addValidationInfo(signed, { revocationProvider: revocation });
        const lta = await addDocumentTimestamp(withDss, { timestampProvider: tsa });

        // Earlier revisions byte-identical.
        expect(lta.subarray(0, withDss.length)).toEqual(withDss);

        const sigs = listSignatures(lta);
        expect(sigs.length).toBe(2);
        const dts = sigs.find(s => s.isDocTimestamp);
        expect(dts).toBeDefined();
        if (!dts) return;
        expect(dts.subFilter).toBe('ETSI.RFC3161');
        expect(dts.fieldName).toBe('DocTimeStamp1');
        expect(dts.isPlaceholder).toBe(false);

        // The bare token parses and its imprint matches the ByteRange digest.
        const tokenEnd = findDerLength(dts.contents);
        const token = dts.contents.subarray(0, tokenEnd);
        const info = parseTimestampToken(token);
        const [a, b, c, d] = dts.byteRange;
        const input = new Uint8Array(b + d);
        input.set(lta.subarray(a, a + b), 0);
        input.set(lta.subarray(c, c + d), b);
        expect(verifyTimestampImprint(info, sha256(input))).toBe(true);
    });

    it('auto-suffixes repeated timestamp field names', async () => {
        const signed = signBb(makeUnsigned());
        const once = await addDocumentTimestamp(signed, { timestampProvider: tsa });
        const twice = await addDocumentTimestamp(once, { timestampProvider: tsa });
        const names = listSignatures(twice).filter(s => s.isDocTimestamp).map(s => s.fieldName);
        expect(names).toEqual(['DocTimeStamp1', 'DocTimeStamp2']);
    });
});

describe('multi-signature end-to-end', () => {
    it('signs two fields sequentially without disturbing the first CMS', () => {
        const one = addSignaturePlaceholder(buildDocumentPDFBytes(doc), { fieldName: 'Author' });
        const signedOne = signPdfBytes(one, {
            signerCert: pki.signerCert, certChain: [pki.rootCert], rsaKey: pki.signerKey,
        });
        const contentsA = listSignatures(signedOne)[0].contents;

        const two = addSignaturePlaceholder(signedOne, { fieldName: 'Reviewer', allowMultiple: true });
        const signedTwo = signPdfBytes(two, {
            signerCert: pki.signerCert, certChain: [pki.rootCert], rsaKey: pki.signerKey,
            fieldName: 'Reviewer',
        });

        const sigs = listSignatures(signedTwo);
        expect(sigs.map(s => s.fieldName).sort()).toEqual(['Author', 'Reviewer']);
        expect(sigs.every(s => !s.isPlaceholder)).toBe(true);
        // Signature A's CMS bytes are untouched by signature B's pass.
        const after = sigs.find(s => s.fieldName === 'Author');
        expect(after?.contents).toEqual(contentsA);
        // Both parse as CMS.
        for (const s of sigs) expect(() => parseCmsSignedData(s.contents)).not.toThrow();
    });
});

describe('full B-LTA pipeline', () => {
    it('build → placeholder → B-T sign → /DSS → DocTimeStamp, all revisions valid', async () => {
        const unsigned = makeUnsigned(estimateContentsSize([2048, 2048], 'rsa-sha256', { timestamp: true }));
        const signed = await signPdfBytesWithTimestamp(unsigned, {
            signerCert: pki.signerCert, certChain: [pki.rootCert], rsaKey: pki.signerKey,
            profile: 'pades', timestampProvider: tsa,
        });
        const withDss = await addValidationInfo(signed, { revocationProvider: revocation });
        const lta = await addDocumentTimestamp(withDss, { timestampProvider: tsa });

        for (const bytes of [unsigned, signed, withDss, lta]) {
            expect(openPdf(bytes).pageCount).toBe(1);
        }
        const sigs = listSignatures(lta);
        expect(sigs.length).toBe(2);
        expect(sigs.some(s => s.isDocTimestamp)).toBe(true);
        // The DSS covers the TSA certificate too (from the embedded token).
        const data = await collectValidationInfo(signed, { revocationProvider: revocation });
        expect(data.certificates.length).toBeGreaterThanOrEqual(3); // signer + root + TSA
    });
});

/** Length of the leading DER TLV (token) inside a zero-padded buffer. */
function findDerLength(bytes: Uint8Array): number {
    let len = bytes[1];
    let headerLen = 2;
    if (len & 0x80) {
        const n = len & 0x7f;
        len = 0;
        for (let i = 0; i < n; i++) len = (len << 8) | bytes[2 + i];
        headerLen = 2 + n;
    }
    return headerLen + len;
}
