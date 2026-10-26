/**
 * The lean CIDFontType2 embed (v1.9.0): `subsetTTF(ttf, gids, { lean })`
 * rebuilds `cmap` over the kept glyphs, writes a format-3 `post` and drops
 * `gasp`; the two-argument call stays byte-identical; both builders embed
 * the lean subset and the text still extracts.
 */

import { describe, it, expect } from 'vitest';
import * as notoSans from '../../fonts/noto-sans-data.js';
import * as notoEmoji from '../../fonts/noto-emoji-data.js';
import { subsetTTF } from '../../src/fonts/font-subsetter.js';
import { subsetTag } from '../../src/fonts/font-embedder.js';
import { getDecodedFontBytes } from '../../src/fonts/font-loader.js';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { extractText } from '../../src/parser/pdf-text-extract.js';
import type { FontData, FontEntry, PdfParams } from '../../src/types/pdf-types.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

const sans = notoSans as unknown as FontData;
const emoji = notoEmoji as unknown as FontData;
const latin: FontEntry = { fontData: sans, fontRef: '/F3', lang: 'latin' };
const PINNED = new Date('2026-01-01T00:00:00Z');

function toU8(binary: string): Uint8Array {
    const u8 = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i) & 0xFF;
    return u8;
}

interface Dir { readonly tags: string[]; readonly table: (tag: string) => Uint8Array | null }
function directory(u8: Uint8Array): Dir {
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = view.getUint16(4);
    const entries = new Map<string, [number, number]>();
    for (let i = 0; i < n; i++) {
        const off = 12 + i * 16;
        entries.set(String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]), [view.getUint32(off + 8), view.getUint32(off + 12)]);
    }
    return { tags: [...entries.keys()], table: tag => { const e = entries.get(tag); return e ? u8.subarray(e[0], e[0] + e[1]) : null; } };
}

/** Every mapping a `cmap` table yields: (3,1) format 4 and (3,10) format 12 subtables. */
function readCmap(cmap: Uint8Array): Map<number, number> {
    const view = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
    const out = new Map<number, number>();
    const records = view.getUint16(2);
    for (let i = 0; i < records; i++) {
        const platform = view.getUint16(4 + i * 8), encoding = view.getUint16(6 + i * 8), offset = view.getUint32(8 + i * 8);
        const format = view.getUint16(offset);
        if (platform === 3 && encoding === 1 && format === 4) {
            const segCount = view.getUint16(offset + 6) / 2;
            const endAt = offset + 14, startAt = endAt + segCount * 2 + 2, deltaAt = startAt + segCount * 2, rangeAt = deltaAt + segCount * 2;
            for (let s = 0; s < segCount; s++) {
                const end = view.getUint16(endAt + s * 2), start = view.getUint16(startAt + s * 2);
                const delta = view.getInt16(deltaAt + s * 2), range = view.getUint16(rangeAt + s * 2);
                if (start === 0xFFFF) continue;
                for (let c = start; c <= end; c++) {
                    const gid = range === 0 ? (c + delta) & 0xFFFF : view.getUint16(rangeAt + s * 2 + range + (c - start) * 2);
                    if (gid !== 0) out.set(c, gid);
                }
            }
        } else if (platform === 3 && encoding === 10 && format === 12) {
            const groups = view.getUint32(offset + 12);
            for (let g = 0; g < groups; g++) {
                const start = view.getUint32(offset + 16 + g * 12), end = view.getUint32(offset + 20 + g * 12), gid = view.getUint32(offset + 24 + g * 12);
                for (let c = start; c <= end; c++) out.set(c, gid + (c - start));
            }
        }
    }
    return out;
}

const gidOf = (fd: FontData, ch: string): number => fd.cmap[ch.codePointAt(0) ?? 0] ?? 0;

describe('subsetTTF lean option', () => {
    const source = getDecodedFontBytes(sans);
    const used = new Set(Array.from('Hello', ch => gidOf(sans, ch)));

    it('drops gasp, rebuilds cmap over the kept glyphs and writes a format-3 post', () => {
        const plain = directory(toU8(subsetTTF(source, used)));
        const lean = directory(toU8(subsetTTF(source, used, { lean: { cmap: sans.cmap } })));
        expect(plain.tags).toContain('gasp');
        expect(lean.tags).not.toContain('gasp');
        expect(lean.tags).toEqual(plain.tags.filter(t => t !== 'gasp'));
        const post = lean.table('post')!;
        expect(post.length).toBe(32);
        expect(new DataView(post.buffer, post.byteOffset).getUint32(0)).toBe(0x00030000);
        // italicAngle, underline position and thickness, isFixedPitch survive.
        expect(Array.from(post.subarray(4, 16))).toEqual(Array.from(plain.table('post')!.subarray(4, 16)));
        const mapped = readCmap(lean.table('cmap')!);
        for (const ch of 'Helo') expect(mapped.get(ch.codePointAt(0)!)).toBe(gidOf(sans, ch));
        expect(mapped.has('z'.codePointAt(0)!)).toBe(false);
        expect(mapped.size).toBe(new Set(Array.from('Helo', ch => ch.codePointAt(0))).size + [...used].reduce((n, g) => n + (Object.values(sans.cmap).filter(x => x === g).length - 1), 0));
        expect(lean.table('cmap')!.length).toBeLessThan(plain.table('cmap')!.length / 10);
    });

    it('keeps outlines, metrics, names and hinting byte-identical to the plain subset', () => {
        const plain = directory(toU8(subsetTTF(source, used)));
        const lean = directory(toU8(subsetTTF(source, used, { lean: { cmap: sans.cmap } })));
        for (const tag of ['glyf', 'loca', 'hmtx', 'hhea', 'maxp', 'OS/2', 'name', 'prep']) {
            expect(Array.from(lean.table(tag)!), tag).toEqual(Array.from(plain.table(tag)!));
        }
        // head differs only by checkSumAdjustment.
        const h1 = plain.table('head')!, h2 = lean.table('head')!;
        expect(Array.from(h1.subarray(12))).toEqual(Array.from(h2.subarray(12)));
    });

    it('writes a format-12 subtable when a kept code point lies beyond the BMP', () => {
        const star = 0x1F31F; // glowing star, in Noto Emoji
        const gid = emoji.cmap[star];
        expect(gid).toBeGreaterThan(0);
        const lean = directory(toU8(subsetTTF(getDecodedFontBytes(emoji), new Set([gid]), { lean: { cmap: emoji.cmap } })));
        const cmap = lean.table('cmap')!;
        expect(new DataView(cmap.buffer, cmap.byteOffset).getUint16(2)).toBe(2);
        expect(readCmap(cmap).get(star)).toBe(gid);
    });

    it('leaves the two-argument call and the other options byte-identical', () => {
        const plain = subsetTTF(source, used);
        expect(subsetTTF(source, used, {})).toBe(plain);
        expect(subsetTTF(source, used, { keepLayoutTables: false })).toBe(plain);
    });

    it('is smaller: the saving on a Noto face is tens of kilobytes', () => {
        const plain = subsetTTF(source, used).length;
        const lean = subsetTTF(source, used, { lean: { cmap: sans.cmap } }).length;
        expect(plain - lean).toBeGreaterThan(20_000);
    });
});

describe('builders embed the lean subset', () => {
    const doc: DocumentParams = { title: 'Lean', blocks: [{ type: 'paragraph', text: 'Hello lean world' }], fontEntries: [latin] };

    function embeddedFont(pdf: Uint8Array): Uint8Array {
        const reader = openPdf(pdf);
        for (const num of reader.xref.entries.keys()) {
            let obj: unknown;
            try { obj = reader.getObject(num); } catch { continue; }
            const o = obj as { type?: string; dict?: Map<string, unknown> };
            if (o && o.type === 'stream' && o.dict?.has('Length1')) return reader.decodeStream(obj as never);
        }
        throw new Error('no FontFile2 stream');
    }

    it('writes a FontFile2 without gasp and with the cmap of the used glyphs, and the text still extracts', () => {
        const pdf = buildDocumentPDFBytes(doc, { creationDate: PINNED });
        const dir = directory(embeddedFont(pdf));
        expect(dir.tags).not.toContain('gasp');
        expect(dir.table('post')!.length).toBe(32);
        expect(readCmap(dir.table('cmap')!).get('H'.codePointAt(0)!)).toBe(gidOf(sans, 'H'));
        expect(extractText(pdf)[0].text).toContain('Hello lean world');
    });

    it('does the same in the table builder', () => {
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '1 row', footerText: 'f', headers: ['A'],
            rows: [{ cells: ['Hello'], type: 'credit', pointed: false }], fontEntries: [latin],
        };
        const dir = directory(embeddedFont(buildPDFBytes(params, { creationDate: PINNED })));
        expect(dir.tags).not.toContain('gasp');
        expect(readCmap(dir.table('cmap')!).get('H'.codePointAt(0)!)).toBe(gidOf(sans, 'H'));
    });
});

describe('subset font names carry the ISO 32000-1 §9.6.4 tag (C21)', () => {
    /** `/BaseFont` and `/FontName` values of every font object, in object order. */
    function namesOf(pdf: Uint8Array): { baseFonts: string[]; fontNames: string[] } {
        const reader = openPdf(pdf);
        const baseFonts: string[] = [], fontNames: string[] = [];
        for (const num of [...reader.xref.entries.keys()].sort((a, b) => a - b)) {
            let obj: unknown;
            try { obj = reader.getObject(num); } catch { continue; }
            if (!(obj instanceof Map)) continue;
            const bf = obj.get('BaseFont') as { value?: string } | undefined;
            const fn = obj.get('FontName') as { value?: string } | undefined;
            if (bf?.value) baseFonts.push(bf.value);
            if (fn?.value) fontNames.push(fn.value);
        }
        return { baseFonts, fontNames };
    }
    const docOf = (text: string): Uint8Array =>
        buildDocumentPDFBytes({ title: 'Tag', blocks: [{ type: 'paragraph', text }], fontEntries: [latin] }, { creationDate: PINNED });

    it('prefixes six uppercase letters and a plus sign to every subset name, on the Type0, the CIDFont and the descriptor', () => {
        const { baseFonts, fontNames } = namesOf(docOf('Hello lean world'));
        expect(baseFonts.length).toBeGreaterThanOrEqual(2);
        for (const n of [...baseFonts, ...fontNames]) {
            if (n.startsWith('Helvetica')) continue;
            expect(n).toMatch(/^[A-Z]{6}\+NotoSans/);
        }
        expect(new Set(fontNames)).toEqual(new Set(baseFonts.filter(n => !n.startsWith('Helvetica'))));
    });

    it('is deterministic: the same glyph set gives the same tag, a different set a different one', () => {
        const a = namesOf(docOf('Hello lean world')).fontNames[0];
        const b = namesOf(docOf('Hello lean world')).fontNames[0];
        const c = namesOf(docOf('Different glyphs here')).fontNames[0];
        expect(a).toBe(b);
        expect(c).not.toBe(a);
        expect(subsetTag('NotoSans', new Set([1, 2, 3]))).toBe(subsetTag('NotoSans', new Set([3, 2, 1])));
        expect(subsetTag('NotoSans', new Set([1, 2, 3]))).not.toBe(subsetTag('NotoSans', new Set([1, 2, 4])));
        expect(subsetTag('NotoSans', new Set([1, 2, 3]))).toMatch(/^[A-Z]{6}$/);
    });

    it('under PDF/A the /F1 and /F2 aliases carry the primary font\'s tagged name', () => {
        const { baseFonts } = namesOf(buildDocumentPDFBytes(
            { title: 'Tag', blocks: [{ type: 'paragraph', text: 'Hello lean world' }], fontEntries: [latin] },
            { tagged: true, creationDate: PINNED }));
        const tagged = baseFonts.filter(n => /^[A-Z]{6}\+NotoSans/.test(n));
        expect(tagged.length).toBe(baseFonts.length);
        expect(new Set(tagged).size).toBe(1);
    });

    it('keeps the bare name under PDF/A-1, where a tagged subset would need the CIDSet stream ISO 19005-1 §6.3.5 asks for', () => {
        const { baseFonts, fontNames } = namesOf(buildDocumentPDFBytes(
            { title: 'Tag', blocks: [{ type: 'paragraph', text: 'Hello lean world' }], fontEntries: [latin] },
            { tagged: 'pdfa1b', creationDate: PINNED }));
        for (const n of [...baseFonts, ...fontNames]) expect(n).toMatch(/^NotoSans/);
    });

    it('tags the table builder\'s fonts and the unused-font stub alike', () => {
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '1 row', footerText: 'f', headers: ['A'],
            rows: [{ cells: ['Hello'], type: 'credit', pointed: false }], fontEntries: [latin, { fontData: emoji, fontRef: '/F4', lang: 'emoji' }],
        };
        const { fontNames } = namesOf(buildPDFBytes(params, { creationDate: PINNED }));
        expect(fontNames).toHaveLength(2);
        expect(fontNames[0]).toMatch(/^[A-Z]{6}\+NotoSans/);
        expect(fontNames[1]).toMatch(/^[A-Z]{6}\+NotoEmoji/);
    });
});

describe('a registered font with no used glyph (C18)', () => {
    // Noto Emoji has no Latin letter: with `latin` first, every character of
    // the text resolves to Noto Sans and the emoji entry is never reached.
    const unused: FontEntry = { fontData: emoji, fontRef: '/F4', lang: 'emoji' };
    const text = 'Hello lean world';

    /** Every FontFile2 stream in object order, with the `/W` array length of its CIDFont. */
    function embeddedFonts(pdf: Uint8Array): { program: Uint8Array; wEntries: number }[] {
        const reader = openPdf(pdf);
        const out: { program: Uint8Array; wEntries: number }[] = [];
        let wEntries = -1;
        for (const num of [...reader.xref.entries.keys()].sort((a, b) => a - b)) {
            let obj: unknown;
            try { obj = reader.getObject(num); } catch { continue; }
            if (obj instanceof Map && obj.has('W')) {
                const w = obj.get('W');
                if (Array.isArray(w)) wEntries = w.length;
            }
            const o = obj as { type?: string; dict?: Map<string, unknown> };
            if (o && o.type === 'stream' && o.dict?.has('Length1')) { out.push({ program: reader.decodeStream(obj as never), wEntries }); wEntries = -1; }
        }
        return out;
    }

    function numGlyphs(u8: Uint8Array): number {
        const maxp = directory(u8).table('maxp')!;
        return new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
    }

    it('embeds a .notdef-only lean subset: glyph count kept, no cmap mapping, a few KB instead of the whole file', () => {
        const pdf = buildDocumentPDFBytes({ title: 'Lean', blocks: [{ type: 'paragraph', text }], fontEntries: [latin, unused] }, { creationDate: PINNED });
        const fonts = embeddedFonts(pdf);
        expect(fonts).toHaveLength(2);
        const stub = fonts[1].program;
        const whole = getDecodedFontBytes(emoji);
        expect(stub.length).toBeLessThan(64 * 1024);
        expect(stub.length).toBeLessThan(whole.length / 10);
        expect(numGlyphs(stub)).toBe(numGlyphs(whole));
        const dir = directory(stub);
        expect(readCmap(dir.table('cmap')!).size).toBe(0);
        expect(dir.table('glyf')!.length).toBeLessThanOrEqual(1024);
        expect(extractText(pdf)[0].text).toContain(text);
    });

    it('writes /W [] for the unused font and leaves the used font byte-identical to a build without it', () => {
        const alone = buildDocumentPDFBytes({ title: 'Lean', blocks: [{ type: 'paragraph', text }], fontEntries: [latin] }, { creationDate: PINNED });
        const paired = buildDocumentPDFBytes({ title: 'Lean', blocks: [{ type: 'paragraph', text }], fontEntries: [latin, unused] }, { creationDate: PINNED });
        const a = embeddedFonts(alone), p = embeddedFonts(paired);
        expect(Buffer.from(p[0].program).equals(Buffer.from(a[0].program))).toBe(true);
        expect(p[0].wEntries).toBe(a[0].wEntries);
        expect(p[0].wEntries).toBeGreaterThan(0);
        expect(p[1].wEntries).toBe(0);
        expect(paired.length).toBeLessThan(alone.length + 64 * 1024);
    });

    it('does the same in the table builder', () => {
        const params: PdfParams = {
            title: 'T', infoItems: [], balanceText: '', countText: '1 row', footerText: 'f', headers: ['A'],
            rows: [{ cells: ['Hello'], type: 'credit', pointed: false }], fontEntries: [latin, unused],
        };
        const fonts = embeddedFonts(buildPDFBytes(params, { creationDate: PINNED }));
        expect(fonts).toHaveLength(2);
        expect(fonts[1].program.length).toBeLessThan(64 * 1024);
        expect(fonts[1].wEntries).toBe(0);
        expect(readCmap(directory(fonts[1].program).table('cmap')!).size).toBe(0);
    });
});
