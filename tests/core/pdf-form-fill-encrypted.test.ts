/**
 * Tests for encrypted incremental update — fillForm / flattenForm on
 * encrypted documents (v1.6.0).
 *
 * Fixtures are self-hosted: forms are built with the library's own
 * builder + `encryption`, then filled/flattened with the password and
 * verified by reopening (readFormFields / openPdf) and scanning the
 * appended revision for plaintext leaks.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { readFormFields, fillForm, flattenForm } from '../../src/core/pdf-form-fill.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { PdfPasswordError } from '../../src/parser/pdf-decrypt.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { EncryptionOptions } from '../../src/core/pdf-encrypt.js';

const FILL_NAME = 'Ada Lovelace';

function blankForm(encryption?: EncryptionOptions): Uint8Array {
    const params: DocumentParams = {
        title: 'Encrypted membership form',
        blocks: [
            { type: 'heading', text: 'Membership application', level: 1 },
            { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name' },
            { type: 'formField', fieldType: 'dropdown', name: 'plan', label: 'Plan', options: ['Basic', 'Pro'] },
            { type: 'formField', fieldType: 'checkbox', name: 'newsletter', label: 'Newsletter' },
        ],
    };
    return buildDocumentPDFBytes(params, encryption !== undefined ? { encryption } : undefined);
}

function latin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return s;
}

for (const algorithm of ['aes128', 'aes256'] as const) {
    describe(`fillForm on an ${algorithm}-encrypted document`, { timeout: 60_000 }, () => {
        const enc: EncryptionOptions = { ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm };
        const blank = blankForm(enc);

        it('rejects a missing/wrong password with PdfPasswordError', () => {
            expect(() => fillForm(blank, { fullName: FILL_NAME })).toThrow(PdfPasswordError);
            expect(() => fillForm(blank, { fullName: FILL_NAME }, { password: 'nope' })).toThrow(PdfPasswordError);
        });

        it('fills, re-reads the value, and keeps the appearance decryptable', () => {
            const filled = fillForm(blank, {
                fullName: FILL_NAME, plan: 'Pro', newsletter: true,
            }, { password: 'u-pw' });

            const fields = readFormFields(filled, { password: 'u-pw' });
            const byName = new Map(fields.map(f => [f.name, f]));
            expect(byName.get('fullName')?.value).toBe(FILL_NAME);
            expect(byName.get('plan')?.value).toBe('Pro');
            expect(byName.get('newsletter')?.value).toBe(true);

            // The regenerated appearance stream decrypts to Tj ops with the text.
            const reader = openPdf(filled, { password: 'u-pw' });
            let sawAppearance = false;
            for (let n = 1; n < 300; n++) {
                const obj = reader.getObject(n);
                if (obj !== null && typeof obj === 'object' && 'type' in obj && obj.type === 'stream') {
                    const text = latin1(reader.decodeStream(obj));
                    if (text.includes(`(${FILL_NAME}) Tj`)) { sawAppearance = true; break; }
                }
            }
            expect(sawAppearance).toBe(true);
        });

        it('does not leak the fill value in cleartext in the appended revision', () => {
            const filled = fillForm(blank, { fullName: FILL_NAME }, { password: 'u-pw' });
            const appended = latin1(filled.subarray(blank.length));
            expect(appended).not.toContain(FILL_NAME);
        });

        it('does not downgrade the encryption scheme', () => {
            const filled = fillForm(blank, { fullName: FILL_NAME }, { password: 'u-pw' });
            const r = openPdf(filled, { password: 'u-pw' });
            expect(r.encryption?.algorithm).toBe(algorithm);
            // The appended trailer must carry the original /Encrypt ref.
            const appended = latin1(filled.subarray(blank.length));
            expect(appended).toContain('/Encrypt');
        });
    });
}

describe('flattenForm on an encrypted document', { timeout: 60_000 }, () => {
    const enc: EncryptionOptions = { ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm: 'aes128' };

    it('flattens with the password: fields gone, overlay decrypts, no plaintext leak', () => {
        const filled = fillForm(blankForm(enc), { fullName: FILL_NAME }, { password: 'u-pw' });
        const flat = flattenForm(filled, { password: 'u-pw' });

        expect(readFormFields(flat, { password: 'u-pw' })).toHaveLength(0);
        const appended = latin1(flat.subarray(filled.length));
        expect(appended).not.toContain(FILL_NAME);

        const r = openPdf(flat, { password: 'u-pw' });
        expect(r.encryption?.algorithm).toBe('aes128');
    });

    it('still rejects a wrong password', () => {
        const filled = fillForm(blankForm(enc), { fullName: FILL_NAME }, { password: 'u-pw' });
        expect(() => flattenForm(filled)).toThrow(PdfPasswordError);
    });
});

describe('unencrypted regression', () => {
    it('unencrypted fill output is unchanged by the encryption plumbing', () => {
        const blank = blankForm();
        const a = fillForm(blank, { fullName: FILL_NAME });
        const b = fillForm(blank, { fullName: FILL_NAME });
        expect(a).toEqual(b);
        // Plaintext appearance persists for unencrypted docs (raw path).
        expect(latin1(a.subarray(blank.length))).toContain(FILL_NAME);
    });
});
