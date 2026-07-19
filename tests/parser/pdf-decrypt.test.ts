/**
 * Decryptor unit tests (v1.6.0) for the legacy RC4 path, which the AES-only
 * writer does not exercise. A minimal, spec-correct RC4 revision-3
 * (128-bit) encrypted PDF is hand-assembled with the exported primitives,
 * then opened through the public reader.
 */

import { describe, it, expect } from 'vitest';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { PdfPasswordError } from '../../src/parser/pdf-decrypt.js';
import { rc4, computeKeyR4, md5, padPassword, PDF_PADDING } from '../../src/core/pdf-encrypt.js';

function bytes(s: string): Uint8Array {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
}
function hex(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
}
function concat(...arrs: Uint8Array[]): Uint8Array {
    const total = arrs.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
}

/** Per-object RC4 key for R2–R4 (no AES salt): MD5(key + objLE3 + genLE2)[:len+5]. */
function objectKeyRC4(fileKey: Uint8Array, num: number, gen: number): Uint8Array {
    const buf = new Uint8Array(fileKey.length + 5);
    buf.set(fileKey);
    buf[fileKey.length] = num & 0xFF;
    buf[fileKey.length + 1] = (num >> 8) & 0xFF;
    buf[fileKey.length + 2] = (num >> 16) & 0xFF;
    buf[fileKey.length + 3] = gen & 0xFF;
    buf[fileKey.length + 4] = (gen >> 8) & 0xFF;
    return md5(buf).subarray(0, Math.min(fileKey.length + 5, 16));
}

/**
 * Build a minimal RC4/R3 (V2, 128-bit) encrypted PDF whose Info /Title is
 * the encrypted string `title`. User password is empty; `ownerPassword`
 * controls /O.
 */
function buildRC4Pdf(title: string, ownerPassword: string, docId: Uint8Array): Uint8Array {
    const keyLen = 16;
    const p = -44; // arbitrary permissions integer
    const userPadded = padPassword('');
    const ownerPadded = padPassword(ownerPassword);

    // /O (Algorithm 3, R3): 50-round MD5 of owner, RC4 chain over user padding.
    let oHash = md5(ownerPadded);
    for (let i = 0; i < 50; i++) oHash = md5(oHash.subarray(0, keyLen));
    const oKey = oHash.subarray(0, keyLen);
    let o = rc4(userPadded, oKey);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = oKey[j] ^ i;
        o = rc4(o, mut);
    }

    // File key (Algorithm 2) + /U (Algorithm 5, R3).
    const fileKey = computeKeyR4(userPadded, o, p, docId, keyLen, 3, true);
    let u = rc4(md5(concat(PDF_PADDING, docId)), fileKey);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = fileKey[j] ^ i;
        u = rc4(u, mut);
    }
    const u32 = new Uint8Array(32);
    u32.set(u.subarray(0, 16));

    // Encrypt the Info /Title (object 4) with its per-object RC4 key.
    const titleCipher = rc4(bytes(title), objectKeyRC4(fileKey, 4, 0));

    const objects: string[] = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
        `<< /Title <${hex(titleCipher)}> >>`,
        `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${hex(o.subarray(0, 32))}> /U <${hex(u32)}> /P ${p} >>`,
    ];

    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((content, idx) => {
        offsets[idx] = body.length;
        body += `${idx + 1} 0 obj\n${content}\nendobj\n`;
    });

    const xrefOff = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 0; i < objects.length; i++) {
        body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    const idHex = hex(docId);
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R /Encrypt 5 0 R /ID [<${idHex}> <${idHex}>] >>\n`;
    body += `startxref\n${xrefOff}\n%%EOF\n`;
    return bytes(body);
}

describe('RC4/R3 legacy decryption', () => {
    const docId = new Uint8Array(16).map((_, i) => (i * 37 + 11) & 0xFF);
    const pdf = buildRC4Pdf('Legacy RC4 Secret', 'ownerpw', docId);

    it('opens with the empty user password and decrypts the Title', () => {
        const r = openPdf(pdf);
        expect(r.encryption).not.toBeNull();
        expect(r.encryption!.algorithm).toBe('rc4-128');
        expect(r.encryption!.authenticatedAs).toBe('user');
        expect(String(r.getInfo()!.get('Title'))).toBe('Legacy RC4 Secret');
    });

    it('opens with the owner password', () => {
        const r = openPdf(pdf, { password: 'ownerpw' });
        expect(r.encryption!.authenticatedAs).toBe('owner');
        expect(String(r.getInfo()!.get('Title'))).toBe('Legacy RC4 Secret');
    });

    it('rejects a wrong non-empty password when a user password is set', () => {
        const withUser = buildRC4PdfWithUserPw('x', docId);
        expect(() => openPdf(withUser, { password: 'wrong' })).toThrow(PdfPasswordError);
    });
});

/** Variant with a non-empty user password (so a wrong password is rejected). */
function buildRC4PdfWithUserPw(userPassword: string, docId: Uint8Array): Uint8Array {
    const keyLen = 16;
    const p = -44;
    const userPadded = padPassword(userPassword);
    const ownerPadded = padPassword('owner');
    let oHash = md5(ownerPadded);
    for (let i = 0; i < 50; i++) oHash = md5(oHash.subarray(0, keyLen));
    const oKey = oHash.subarray(0, keyLen);
    let o = rc4(userPadded, oKey);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = oKey[j] ^ i;
        o = rc4(o, mut);
    }
    const fileKey = computeKeyR4(userPadded, o, p, docId, keyLen, 3, true);
    let u = rc4(md5(concat(PDF_PADDING, docId)), fileKey);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = fileKey[j] ^ i;
        u = rc4(u, mut);
    }
    const u32 = new Uint8Array(32); u32.set(u.subarray(0, 16));
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>',
        `<< /Filter /Standard /V 2 /R 3 /Length 128 /O <${hex(o.subarray(0, 32))}> /U <${hex(u32)}> /P ${p} >>`,
    ];
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((content, idx) => { offsets[idx] = body.length; body += `${idx + 1} 0 obj\n${content}\nendobj\n`; });
    const xrefOff = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 0; i < objects.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    const idHex = hex(docId);
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${idHex}> <${idHex}>] >>\n`;
    body += `startxref\n${xrefOff}\n%%EOF\n`;
    return bytes(body);
}
