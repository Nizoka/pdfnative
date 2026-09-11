import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildDocumentPDFBytes } from '../../src/index.js';
import { selectFormFont, buildFormFontObjects, FORM_FONT_OBJ_COUNT } from '../../src/core/pdf-form-font.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import type { DocumentParams, FormFieldBlock } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, PdfDiagnostic } from '../../src/types/pdf-types.js';

// v1.8.0 — issue #74: the AcroForm /DR font must be embedded under a PDF/A
// claim, or veraPDF rejects every form-bearing archival document.

const FONT_MODULE = join(process.cwd(), 'fonts', 'noto-sans-data.js');

async function latinFont(): Promise<FontData> {
    const url = pathToFileURL(FONT_MODULE).href;
    return await import(/* @vite-ignore */ url) as unknown as FontData;
}

function formDoc(fontEntries?: readonly FontEntry[]): DocumentParams {
    const field: FormFieldBlock = {
        type: 'formField',
        fieldType: 'text',
        name: 'fullName',
        label: 'Full name',
        value: 'Benjamin',
    };
    return {
        title: 'Archival form',
        blocks: [
            { type: 'heading', level: 1, text: 'Application' },
            field,
        ],
        fontEntries: fontEntries as FontEntry[] | undefined,
    };
}

function latin1(bytes: Uint8Array): string {
    return new TextDecoder('latin1').decode(bytes);
}

describe('selectFormFont', () => {
    it('returns null when nothing is registered', () => {
        expect(selectFormFont([])).toBeNull();
    });

    it('prefers an explicitly registered latin font', async () => {
        const fd = await latinFont();
        const entries: FontEntry[] = [
            { fontData: fd, fontRef: '/F4', lang: 'th' },
            { fontData: fd, fontRef: '/F3', lang: 'latin' },
        ];
        expect(selectFormFont(entries)).toBe(fd);
    });

    it('rejects a font that cannot render basic Latin', () => {
        const empty = {
            metrics: { unitsPerEm: 1000, numGlyphs: 1, defaultWidth: 500, ascent: 800, descent: -200, capHeight: 700, bbox: [0, 0, 1, 1], stemV: 80 },
            fontName: 'Empty',
            cmap: {},
            defaultWidth: 500,
            widths: {},
            gsub: {},
            markAnchors: null,
            mark2mark: null,
            pdfWidthArray: '',
            ttfBase64: '',
        } as unknown as FontData;
        expect(selectFormFont([{ fontData: empty, fontRef: '/F9', lang: 'x' }])).toBeNull();
    });
});

describe('buildFormFontObjects', () => {
    it('emits a nonsymbolic WinAnsi simple TrueType font', async () => {
        const fd = await latinFont();
        const { fontDict, descriptorDict, fontFile } = buildFormFontObjects(fd, 40, 99);

        expect(fontDict).toContain('/Subtype /TrueType');
        expect(fontDict).toContain('/Encoding /WinAnsiEncoding');
        expect(fontDict).toContain('/FirstChar 32');
        expect(fontDict).toContain('/LastChar 255');
        expect(fontDict).toContain('/FontDescriptor 41 0 R');
        expect(fontDict).toContain('/ToUnicode 99 0 R');

        // A font used with a standard encoding must not be flagged symbolic.
        expect(descriptorDict).toContain('/Flags 32');
        expect(descriptorDict).toContain('/FontFile2 42 0 R');
        expect(fontFile.length).toBeGreaterThan(0);
    });

    it('carries a subset tag shared by the dictionary and the descriptor', async () => {
        const fd = await latinFont();
        const { fontDict, descriptorDict } = buildFormFontObjects(fd, 10);
        const tag = /\/BaseFont \/([A-Z]{6})\+/.exec(fontDict)?.[1];
        expect(tag).toMatch(/^[A-Z]{6}$/);
        expect(descriptorDict).toContain(`/FontName /${tag}+`);
    });

    it('is deterministic across builds', async () => {
        const fd = await latinFont();
        const a = buildFormFontObjects(fd, 10);
        const b = buildFormFontObjects(fd, 10);
        expect(b.fontDict).toBe(a.fontDict);
        expect(b.fontFile).toBe(a.fontFile);
    });

    it('emits exactly 256 - 32 widths, scaled to 1000 units per em', async () => {
        const fd = await latinFont();
        const { fontDict } = buildFormFontObjects(fd, 10);
        const widths = /\/Widths \[([^\]]+)\]/.exec(fontDict)![1].trim().split(/\s+/);
        expect(widths.length).toBe(224);
        // The space glyph must have a sane advance in text space.
        expect(Number(widths[0])).toBeGreaterThan(100);
        expect(Number(widths[0])).toBeLessThan(600);
    });

    it('reserves three consecutive objects', () => {
        expect(FORM_FONT_OBJ_COUNT).toBe(3);
    });
});

describe('PDF/A form documents (issue #74)', () => {
    it('embeds the /DR font and raises no diagnostic', async () => {
        const fd = await latinFont();
        const entries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'latin' }];
        const seen: PdfDiagnostic[] = [];

        const bytes = buildDocumentPDFBytes(formDoc(entries), {
            tagged: 'pdfa2b',
            onDiagnostic: (d) => seen.push(d),
        });

        expect(seen.map(d => d.code)).not.toContain('PDFA_UNEMBEDDED_FORM_FONT');

        const text = latin1(bytes);
        expect(text).toContain('/Subtype /TrueType');
        expect(text).toContain('/Encoding /WinAnsiEncoding');
        // The form's default resources must not reference the base-14 face.
        const drBlock = /\/AcroForm <<[^>]*\/DR <<.*?>> >>/s.exec(text)?.[0] ?? '';
        expect(drBlock).not.toContain('/BaseFont /Helvetica');
    });

    it('still warns when no registered font can render Latin', () => {
        const seen: PdfDiagnostic[] = [];
        buildDocumentPDFBytes(formDoc(), {
            tagged: 'pdfa2b',
            onDiagnostic: (d) => seen.push(d),
        });
        expect(seen.map(d => d.code)).toContain('PDFA_UNEMBEDDED_FORM_FONT');
    });

    it('leaves non-PDF/A forms byte-identical', async () => {
        const fd = await latinFont();
        const entries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'latin' }];
        const pinned = new Date('2026-01-01T00:00:00Z');
        const a = buildDocumentPDFBytes(formDoc(entries), { creationDate: pinned });
        const b = buildDocumentPDFBytes(formDoc(entries), { creationDate: pinned });
        expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
        // No PDF/A claim: the historical unembedded base-14 path is kept.
        expect(latin1(a)).toContain('/BaseFont /Helvetica');
    });

    it('produces a document the parser can still open', async () => {
        const fd = await latinFont();
        const entries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'latin' }];
        const bytes = buildDocumentPDFBytes(formDoc(entries), { tagged: 'pdfa2b' });
        const reader = openPdf(bytes);
        expect(reader.pageCount).toBe(1);
    });

    it('keeps every object offset consistent after adding two objects', async () => {
        // The form font grows from one object to three; the xref must still
        // resolve every object the catalog points at.
        const fd = await latinFont();
        const entries: FontEntry[] = [{ fontData: fd, fontRef: '/F3', lang: 'latin' }];
        const bytes = buildDocumentPDFBytes(formDoc(entries), { tagged: 'pdfa2b' });
        const text = latin1(bytes);
        const size = Number(/\/Size (\d+)/.exec(text)![1]);
        const reader = openPdf(bytes);
        for (let n = 1; n < size; n++) {
            expect(() => reader.getObject(n)).not.toThrow();
        }
    });
});

describe('font module availability', () => {
    it('ships the bundled Latin font the suite relies on', () => {
        expect(() => readFileSync(FONT_MODULE)).not.toThrow();
    });
});
