/**
 * Signature enumeration + multi-signature placeholders (v1.7.0).
 * Key-material-free coverage: placeholder creation with allowMultiple,
 * listSignatures inspection, and the fieldName selector's error paths.
 * End-to-end multi-signature signing lives in the LTV integration suite.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { addSignaturePlaceholder } from '../../src/core/pdf-sig-placeholder.js';
import { listSignatures } from '../../src/core/pdf-sig-utils.js';
import { buildSigDict, signPdfBytes, findUnsignedPlaceholders } from '../../src/core/pdf-signature.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { X509Certificate } from '../../src/crypto/x509.js';

const baseDoc: DocumentParams = {
    title: 'Sig utils',
    blocks: [{ type: 'paragraph', text: 'sign me' }],
};

const fakeCert = { raw: new Uint8Array([0x30, 0x00]) } as unknown as X509Certificate;

function makeWithPlaceholder(fieldName = 'Signature1'): Uint8Array {
    return addSignaturePlaceholder(buildDocumentPDFBytes(baseDoc), { fieldName });
}

describe('buildSigDict subFilter (v1.7.0)', () => {
    it('defaults to adbe.pkcs7.detached', () => {
        expect(buildSigDict({})).toContain('/SubFilter /adbe.pkcs7.detached');
    });

    it('accepts ETSI.CAdES.detached for PAdES signatures', () => {
        expect(buildSigDict({ subFilter: 'ETSI.CAdES.detached' }))
            .toContain('/SubFilter /ETSI.CAdES.detached');
    });
});

describe('listSignatures', () => {
    it('returns an empty list for a document without signature fields', () => {
        expect(listSignatures(buildDocumentPDFBytes(baseDoc))).toEqual([]);
    });

    it('describes an unsigned placeholder', () => {
        const sigs = listSignatures(makeWithPlaceholder('Author'));
        expect(sigs.length).toBe(1);
        expect(sigs[0].fieldName).toBe('Author');
        expect(sigs[0].subFilter).toBe('adbe.pkcs7.detached');
        expect(sigs[0].isPlaceholder).toBe(true);
        expect(sigs[0].isDocTimestamp).toBe(false);
        expect(sigs[0].byteRange).toEqual([0, 0, 0, 0]);
        // The decoded /Contents is the full zero-padded reservation.
        expect(sigs[0].contents.length).toBe(16384);
        expect(sigs[0].contents.every(b => b === 0)).toBe(true);
    });
});

describe('addSignaturePlaceholder allowMultiple (v1.7.0)', () => {
    it('default false: any existing signature field short-circuits (1.x behaviour)', () => {
        const first = makeWithPlaceholder('A');
        const second = addSignaturePlaceholder(first, { fieldName: 'B' });
        expect(second).toBe(first);
    });

    it('true: appends a second placeholder with a fresh fieldName', () => {
        const first = makeWithPlaceholder('A');
        const second = addSignaturePlaceholder(first, { fieldName: 'B', allowMultiple: true });
        const sigs = listSignatures(second);
        expect(sigs.map(s => s.fieldName)).toEqual(['A', 'B']);
        expect(sigs.every(s => s.isPlaceholder)).toBe(true);
        // Incremental update: the first revision is preserved byte-exact.
        expect(second.subarray(0, first.length)).toEqual(first);
    });

    it('true: same unsigned fieldName is idempotent', () => {
        const first = makeWithPlaceholder('A');
        const again = addSignaturePlaceholder(first, { fieldName: 'A', allowMultiple: true });
        expect(again).toBe(first);
    });
});

describe('signPdfBytes placeholder selection (v1.7.0)', () => {
    it('finds every unsigned placeholder', () => {
        const two = addSignaturePlaceholder(makeWithPlaceholder('A'), { fieldName: 'B', allowMultiple: true });
        let s = '';
        for (let i = 0; i < two.length; i++) s += String.fromCharCode(two[i]);
        expect(findUnsignedPlaceholders(s).length).toBe(2);
    });

    it('requires fieldName when several placeholders are unsigned', () => {
        const two = addSignaturePlaceholder(makeWithPlaceholder('A'), { fieldName: 'B', allowMultiple: true });
        expect(() => signPdfBytes(two, { signerCert: fakeCert }))
            .toThrow(/fieldName.*"A".*"B"|"A", "B"/);
    });

    it('rejects an unknown fieldName selector', () => {
        const two = addSignaturePlaceholder(makeWithPlaceholder('A'), { fieldName: 'B', allowMultiple: true });
        expect(() => signPdfBytes(two, { signerCert: fakeCert, fieldName: 'Nope' }))
            .toThrow(/no unsigned signature field named "Nope"/);
    });
});
