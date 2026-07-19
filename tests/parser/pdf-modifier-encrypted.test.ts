/**
 * Tests for encrypted incremental update at the modifier level —
 * addAnnotation on AES-128 / AES-256 / legacy RC4 documents, the
 * addRawObject guard, /Encrypt trailer carry-over, and the signature
 * /Contents exemption (v1.6.0).
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildAnnotationBody } from '../../src/core/pdf-annot-markup.js';
import { md5, padPassword, rc4 } from '../../src/core/pdf-encrypt.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { createModifier } from '../../src/parser/pdf-modifier.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { PdfDict, PdfValue } from '../../src/parser/pdf-object-parser.js';

const NOTE = 'Secret note: encrypted annotation payload.';

function docBytes(encryption?: { ownerPassword: string; userPassword?: string; algorithm: 'aes128' | 'aes256' }): Uint8Array {
    const params: DocumentParams = {
        title: 'Annotation host',
        blocks: [{ type: 'paragraph', text: 'A page to annotate.' }],
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
    describe(`addAnnotation on an ${algorithm}-encrypted document`, () => {
        const src = docBytes({ ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm });

        it('appends an encrypted annotation that reads back through getAnnotations', () => {
            const reader = openPdf(src, { password: 'u-pw' });
            const modifier = createModifier(reader);
            modifier.addAnnotation(0, buildAnnotationBody({
                type: 'text', rect: [50, 700, 70, 720], contents: NOTE,
            }));
            const out = modifier.save();

            const appended = latin1(out.subarray(src.length));
            expect(appended).not.toContain(NOTE);
            expect(appended).toContain('/Encrypt');

            const back = openPdf(out, { password: 'u-pw' });
            expect(back.encryption?.algorithm).toBe(algorithm);
            const annots = back.getAnnotations(0);
            expect(annots.some(a => a.contents?.includes('Secret note'))).toBe(true);
        });

        it('rejects addRawObject with a clear error', () => {
            const modifier = createModifier(openPdf(src, { password: 'u-pw' }));
            expect(() => modifier.addRawObject('<< /Type /Whatever >>')).toThrow(/addRawObject/);
        });
    });
}

describe('signature /Contents exemption under encryption', () => {
    it('keeps a ByteRange dict Contents string outside encryption', () => {
        const src = docBytes({ ownerPassword: 'o', userPassword: 'u', algorithm: 'aes128' });
        const reader = openPdf(src, { password: 'u' });
        const modifier = createModifier(reader);

        const cms = '\x30\x82\x01\x00CMS-PLACEHOLDER-BYTES';
        const sig: PdfDict = new Map<string, PdfValue>([
            ['Type', { type: 'name', value: 'Sig' }],
            ['Filter', { type: 'name', value: 'Adobe.PPKLite' }],
            ['ByteRange', [0, 0, 0, 0]],
            ['Contents', cms],
            ['Reason', 'Approval'],
        ]);
        const num = modifier.addObject(sig);
        const out = modifier.save();

        const back = openPdf(out, { password: 'u' });
        const readBack = back.getObject(num);
        expect(readBack).toBeInstanceOf(Map);
        const dict = readBack as PdfDict;
        // /Contents survives verbatim (exempt), /Reason round-trips through
        // encryption+decryption transparently.
        expect(dict.get('Contents')).toBe(cms);
        expect(dict.get('Reason')).toBe('Approval');
    });
});

// ── Legacy RC4 (V2/R3) source ────────────────────────────────────────

function hex(b: Uint8Array): string {
    let s = '';
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s.toUpperCase();
}

function bytes(s: string): Uint8Array {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
}

/**
 * Minimal RC4/R3 (V2, 128-bit) encrypted PDF with an empty user password
 * (same construction as tests/parser/pdf-decrypt.test.ts).
 */
function buildRC4Pdf(docId: Uint8Array): Uint8Array {
    const keyLen = 16;
    const p = -44;
    const userPadded = padPassword('');
    const ownerPadded = padPassword('ownerpw');

    let oHash = md5(ownerPadded);
    for (let i = 0; i < 50; i++) oHash = md5(oHash.subarray(0, keyLen));
    const oKey = oHash.subarray(0, keyLen);
    let o = rc4(userPadded, oKey);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = oKey[j] ^ i;
        o = rc4(o, mut);
    }

    // File key (Algorithm 2) for the empty user password.
    const keyBuf = new Uint8Array(userPadded.length + o.length + 4 + docId.length);
    let off = 0;
    keyBuf.set(userPadded, off); off += userPadded.length;
    keyBuf.set(o.subarray(0, 32), off); off += 32;
    keyBuf[off++] = p & 0xFF; keyBuf[off++] = (p >> 8) & 0xFF;
    keyBuf[off++] = (p >> 16) & 0xFF; keyBuf[off++] = (p >> 24) & 0xFF;
    keyBuf.set(docId, off);
    let key = md5(keyBuf).subarray(0, keyLen);
    for (let i = 0; i < 50; i++) key = md5(key.subarray(0, keyLen)).subarray(0, keyLen);

    // /U (Algorithm 5).
    const PAD = padPassword('');
    const uBuf = new Uint8Array(PAD.length + docId.length);
    uBuf.set(PAD); uBuf.set(docId, PAD.length);
    let u = rc4(md5(uBuf), key);
    for (let i = 1; i <= 19; i++) {
        const mut = new Uint8Array(keyLen);
        for (let j = 0; j < keyLen; j++) mut[j] = key[j] ^ i;
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
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${idHex}> <${idHex}>] >>\n`;
    body += `startxref\n${xrefOff}\n%%EOF\n`;
    return bytes(body);
}

describe('addAnnotation on a legacy RC4 (V2/R3) document', () => {
    const docId = new Uint8Array(16).map((_, i) => (i * 37 + 11) & 0xFF);
    const src = buildRC4Pdf(docId);

    it('appends an RC4-encrypted annotation that reads back', () => {
        const reader = openPdf(src);
        expect(reader.encryption?.algorithm).toBe('rc4-128');
        const modifier = createModifier(reader);
        modifier.addAnnotation(0, buildAnnotationBody({
            type: 'text', rect: [10, 10, 30, 30], contents: NOTE,
        }));
        const out = modifier.save();

        expect(latin1(out.subarray(src.length))).not.toContain(NOTE);
        const back = openPdf(out);
        const annots = back.getAnnotations(0);
        expect(annots.some(a => a.contents?.includes('Secret note'))).toBe(true);
    });
});

describe('unencrypted regression', () => {
    it('unencrypted addAnnotation output is byte-stable (raw path unchanged)', () => {
        const src = docBytes();
        const run = (): Uint8Array => {
            const m = createModifier(openPdf(src));
            m.addAnnotation(0, buildAnnotationBody({ type: 'text', rect: [50, 700, 70, 720], contents: 'plain note' }));
            return m.save();
        };
        expect(run()).toEqual(run());
        expect(latin1(run())).toContain('plain note');
    });
});
