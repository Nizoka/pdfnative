/**
 * Encrypted-PDF round-trip (v1.6.0).
 * Encrypt with the pdfnative writer → reopen with openPdf({ password }) →
 * the decrypted content must equal the unencrypted twin.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { PdfPasswordError, PdfEncryptionUnsupportedError, authenticate } from '../../src/parser/pdf-decrypt.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

function docParams(): DocumentParams {
    return {
        title: 'Confidential Report',
        blocks: [
            { type: 'heading', level: 1 as const, text: 'Quarterly Numbers' },
            { type: 'paragraph', text: 'Revenue grew to forty-two million euros this quarter.' },
            { type: 'paragraph', text: 'Second paragraph with unicode: café — résumé — €.' },
        ],
        footerText: 'Internal use only',
    };
}

function pageContent(pdf: Uint8Array, password?: string): string {
    const r = openPdf(pdf, password !== undefined ? { password } : undefined);
    const page = r.getPage(0);
    const data = r.decodeStream(r.resolveValue(page.get('Contents') ?? null) as never);
    let s = '';
    for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
    return s;
}

describe('encrypted PDF round-trip', { timeout: 60_000 }, () => {
    const plain = pageContent(buildDocumentPDFBytes(docParams()));

    it('AES-128 (R4) decrypts to the same content (owner password)', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', algorithm: 'aes128' },
        });
        const r = openPdf(enc, { password: 'ownerpw' });
        expect(r.encryption).not.toBeNull();
        expect(r.encryption!.algorithm).toBe('aes128');
        expect(pageContent(enc, 'ownerpw')).toBe(plain);
    });

    it('AES-256 (R6) decrypts to the same content (owner password)', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', algorithm: 'aes256' },
        });
        const r = openPdf(enc, { password: 'ownerpw' });
        expect(r.encryption!.algorithm).toBe('aes256');
        expect(r.encryption!.revision).toBe(6);
        expect(r.encryption!.authenticatedAs).toBe('owner');
        expect(pageContent(enc, 'ownerpw')).toBe(plain);
    });

    it('AES-256 (R6) opens with a non-empty user password', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', userPassword: 'userpw', algorithm: 'aes256' },
        });
        const r = openPdf(enc, { password: 'userpw' });
        expect(r.encryption!.authenticatedAs).toBe('user');
        expect(pageContent(enc, 'userpw')).toBe(plain);
    });

    it('AES-128 with an empty user password opens transparently (no password)', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'secretowner', userPassword: '', algorithm: 'aes128' },
        });
        expect(pageContent(enc)).toBe(plain);
    });

    it('decrypts the document Info strings (Title, Author) — AES-256', () => {
        const params: DocumentParams = { ...docParams(), metadata: { author: 'Jane Doe' } };
        const enc = buildDocumentPDFBytes(params, {
            encryption: { ownerPassword: 'ownerpw', algorithm: 'aes256' },
        });
        const info = openPdf(enc, { password: 'ownerpw' }).getInfo();
        expect(info).not.toBeNull();
        expect(String(info!.get('Title'))).toContain('Confidential Report');
        expect(String(info!.get('Author'))).toContain('Jane Doe');
    });

    it('decrypts the document Info Title — AES-128 (RC4-style per-object key)', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', algorithm: 'aes128' },
        });
        const info = openPdf(enc, { password: 'ownerpw' }).getInfo();
        expect(String(info!.get('Title'))).toContain('Confidential Report');
    });

    it('rejects a wrong password with PdfPasswordError', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', userPassword: 'userpw', algorithm: 'aes256' },
        });
        expect(() => openPdf(enc, { password: 'nope' })).toThrow(PdfPasswordError);
    });

    it('missing password on a user-password document throws with an actionable message', () => {
        const enc = buildDocumentPDFBytes(docParams(), {
            encryption: { ownerPassword: 'ownerpw', userPassword: 'userpw', algorithm: 'aes128' },
        });
        expect(() => openPdf(enc)).toThrow(/requires a password/);
    });
});

describe('authenticate error model', { timeout: 60_000 }, () => {
    it('throws PdfEncryptionUnsupportedError for a non-Standard filter', () => {
        const dict = new Map<string, unknown>([
            ['Filter', { type: 'name', value: 'Adobe.PPKLite' }],
            ['V', 5], ['R', 6],
            ['O', 'x'], ['U', 'y'],
        ]);
        expect(() => authenticate(dict as never, new Uint8Array(0), '')).toThrow(PdfEncryptionUnsupportedError);
    });

    it('throws PdfEncryptionUnsupportedError for the deprecated R5', () => {
        const dict = new Map<string, unknown>([
            ['Filter', { type: 'name', value: 'Standard' }],
            ['V', 5], ['R', 5],
            ['O', '0'.repeat(48)], ['U', '0'.repeat(48)],
        ]);
        expect(() => authenticate(dict as never, new Uint8Array(0), '')).toThrow(/revision 5/);
    });
});
