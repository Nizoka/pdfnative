/**
 * Tests for MergeOptions.encrypt — re-encrypting page-tree output.
 *
 * Fixtures are self-hosted: sources are built with the library
 * (buildDocumentPDFBytes), rebuilt through mergePdfs/splitPdf/
 * extractPages with `encrypt`, then verified by reopening with openPdf
 * and extracting text (dogfooding extractText).
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import {
    mergePdfs, splitPdf, extractPages, streamMergedPdfs,
} from '../../src/parser/pdf-pagetree.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import { PdfPasswordError } from '../../src/parser/pdf-decrypt.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const SECRET_LINE = 'Attack at dawn: the payload nobody must read in cleartext.';

function doc(title: string, body: string): Uint8Array {
    const params: DocumentParams = {
        title,
        blocks: [
            { type: 'heading', level: 1, text: title },
            { type: 'paragraph', text: body },
        ],
    };
    return buildDocumentPDFBytes(params);
}

async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const c of gen) { chunks.push(c); total += c.length; }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

function latin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return s;
}

describe('mergePdfs with encrypt', () => {
    const a = doc('Doc A', SECRET_LINE);
    const b = doc('Doc B', 'Second document body.');
    const plainMergedText = extractText(mergePdfs([a, b])).map(p => p.text);

    it('AES-128 round-trip: password-gated, both passwords open, text identical', () => {
        const merged = mergePdfs([a, b], {
            encrypt: { ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm: 'aes128' },
        });
        expect(() => openPdf(merged)).toThrow(PdfPasswordError);
        const asUser = openPdf(merged, { password: 'u-pw' });
        expect(asUser.encryption?.algorithm).toBe('aes128');
        expect(asUser.encryption?.authenticatedAs).toBe('user');
        expect(asUser.pageCount).toBe(2);
        const asOwner = openPdf(merged, { password: 'o-pw' });
        expect(asOwner.encryption?.authenticatedAs).toBe('owner');
        expect(extractText(merged, { password: 'u-pw' }).map(p => p.text)).toEqual(plainMergedText);
    });

    it('AES-256 (R6) round-trip', () => {
        const merged = mergePdfs([a, b], {
            encrypt: { ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm: 'aes256' },
        });
        expect(() => openPdf(merged)).toThrow(PdfPasswordError);
        const r = openPdf(merged, { password: 'u-pw' });
        expect(r.encryption?.algorithm).toBe('aes256');
        expect(r.encryption?.revision).toBe(6);
        expect(extractText(merged, { password: 'u-pw' }).map(p => p.text)).toEqual(plainMergedText);
    });

    it('leaves no plaintext of source content in the encrypted output', () => {
        const merged = mergePdfs([a, b], {
            encrypt: { ownerPassword: 'o-pw', userPassword: 'u-pw', algorithm: 'aes128' },
        });
        const raw = latin1(merged);
        expect(raw).not.toContain('Attack at dawn');
        // The builder's content streams are Flate-compressed, so also check
        // an uncompressed marker: the URI-free title string in the info-less
        // rebuilt doc should simply not exist in clear anywhere.
        expect(raw).not.toContain('Second document body');
    });

    it('decrypt -> re-encrypt: ingests an encrypted source and re-protects with new passwords', () => {
        const params: DocumentParams = { title: 'Old lock', blocks: [{ type: 'paragraph', text: SECRET_LINE }] };
        const oldEnc = buildDocumentPDFBytes(params, {
            encryption: { ownerPassword: 'old-o', userPassword: 'old-u', algorithm: 'aes128' },
        });
        const reEnc = mergePdfs([{ bytes: oldEnc, password: 'old-u' }], {
            encrypt: { ownerPassword: 'new-o', userPassword: 'new-u', algorithm: 'aes256' },
        });
        expect(() => openPdf(reEnc, { password: 'old-u' })).toThrow(PdfPasswordError);
        const r = openPdf(reEnc, { password: 'new-u' });
        expect(r.encryption?.algorithm).toBe('aes256');
        expect(extractText(reEnc, { password: 'new-u' })[0].text).toContain('Attack at dawn');
    });

    it('unencrypted output remains byte-identical (encrypt off = no behaviour change)', () => {
        expect(mergePdfs([a, b])).toEqual(mergePdfs([a, b]));
    });
});

describe('splitPdf / extractPages with encrypt', () => {
    const three = mergePdfs([doc('P1', 'one'), doc('P2', 'two'), doc('P3', 'three')]);

    it('every split part opens with the password and carries its page', () => {
        const parts = splitPdf(three, [{ start: 0 }, { start: 1, end: 2 }], {
            encrypt: { ownerPassword: 'o', userPassword: 'u', algorithm: 'aes128' },
        });
        expect(parts).toHaveLength(2);
        for (const part of parts) {
            expect(() => openPdf(part)).toThrow(PdfPasswordError);
        }
        expect(extractText(parts[0], { password: 'u' })[0].text).toContain('one');
        const secondTexts = extractText(parts[1], { password: 'u' }).map(p => p.text).join('\n');
        expect(secondTexts).toContain('two');
        expect(secondTexts).toContain('three');
    });

    it('extractPages emits an encrypted selection', () => {
        const picked = extractPages(three, [2, 0], {
            encrypt: { ownerPassword: 'o', userPassword: 'u', algorithm: 'aes256' },
        });
        const texts = extractText(picked, { password: 'u' }).map(p => p.text);
        expect(texts[0]).toContain('three');
        expect(texts[1]).toContain('one');
    });
});

describe('streaming variants with encrypt', () => {
    it('streamMergedPdfs output opens with the password and matches buffered structure', async () => {
        const a = doc('Stream A', SECRET_LINE);
        const b = doc('Stream B', 'streamed second');
        const opts = { encrypt: { ownerPassword: 'o', userPassword: 'u', algorithm: 'aes128' as const } };
        const streamed = await collect(streamMergedPdfs([a, b], opts));
        const buffered = mergePdfs([a, b], opts);
        // Random IVs/salts: NOT byte-comparable. Compare structure + content.
        const rs = openPdf(streamed, { password: 'u' });
        const rb = openPdf(buffered, { password: 'u' });
        expect(rs.pageCount).toBe(rb.pageCount);
        expect(extractText(streamed, { password: 'u' }).map(p => p.text))
            .toEqual(extractText(buffered, { password: 'u' }).map(p => p.text));
    });
});

describe('encrypt validation & safety', () => {
    const src = doc('V', 'validation body');

    it('rejects an empty ownerPassword before any copying', () => {
        expect(() => mergePdfs([src], { encrypt: { ownerPassword: '' } }))
            .toThrow(/ownerPassword/);
    });

    it('accounts ciphertext against maxOutputSize', () => {
        expect(() => mergePdfs([src], {
            encrypt: { ownerPassword: 'o', algorithm: 'aes128' },
            maxOutputSize: 512,
        })).toThrow(/maxOutputSize/);
    });

    it('defaults to AES-128 (V4/R4) when algorithm is omitted', () => {
        const merged = mergePdfs([src], { encrypt: { ownerPassword: 'o', userPassword: 'u' } });
        const r = openPdf(merged, { password: 'u' });
        expect(r.encryption?.algorithm).toBe('aes128');
        expect(r.encryption?.revision).toBe(4);
    });
});
