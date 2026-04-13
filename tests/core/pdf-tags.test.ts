import { describe, it, expect } from 'vitest';
import {
    escapePdfUtf16,
    wrapSpan,
    wrapMarkedContent,
    createMCIDAllocator,
    buildStructureTree,
    buildXMPMetadata,
    buildOutputIntentDict,
    buildMinimalSRGBProfile,
    resolvePdfAConfig,
    buildEmbeddedFiles,
    validateAttachments,
} from '../../src/core/pdf-tags.js';
import type { StructElement, MCRef } from '../../src/core/pdf-tags.js';
import type { PdfAttachment } from '../../src/types/pdf-types.js';

// ── escapePdfUtf16 ──────────────────────────────────────────────────

describe('escapePdfUtf16', () => {
    it('should produce BOM-only for empty string', () => {
        expect(escapePdfUtf16('')).toBe('<FEFF>');
    });

    it('should encode ASCII characters as UTF-16BE hex', () => {
        const result = escapePdfUtf16('AB');
        expect(result).toBe('<FEFF00410042>');
    });

    it('should encode Thai characters', () => {
        const result = escapePdfUtf16('\u0E2A'); // ส
        expect(result).toBe('<FEFF0E2A>');
    });

    it('should encode supplementary plane characters with surrogates', () => {
        // U+1F600 (😀) = D83D DE00 in UTF-16
        const result = escapePdfUtf16('\u{1F600}');
        expect(result).toBe('<FEFFD83DDE00>');
    });

    it('should encode mixed BMP and supplementary', () => {
        const result = escapePdfUtf16('A\u{1F600}');
        expect(result).toBe('<FEFF0041D83DDE00>');
    });
});

// ── wrapSpan ─────────────────────────────────────────────────────────

describe('wrapSpan', () => {
    it('should wrap content in /Span BDC...EMC with MCID and ActualText', () => {
        const result = wrapSpan('BT /F1 12 Tf 100 200 Td (Hello) Tj ET', 'Hello', 0);
        expect(result).toContain('/Span');
        expect(result).toContain('/MCID 0');
        expect(result).toContain('/ActualText <FEFF00480065006C006C006F>');
        expect(result).toContain('BDC');
        expect(result).toContain('EMC');
        expect(result).toContain('BT /F1 12 Tf 100 200 Td (Hello) Tj ET');
    });

    it('should embed ActualText with Thai characters', () => {
        const result = wrapSpan('BT ...', 'สวัสดี', 5);
        expect(result).toContain('/MCID 5');
        expect(result).toContain('/ActualText <FEFF');
        expect(result).toContain('0E2A'); // ส
    });
});

// ── wrapMarkedContent ────────────────────────────────────────────────

describe('wrapMarkedContent', () => {
    it('should wrap content with custom tag', () => {
        const result = wrapMarkedContent('content', 'TD', 3);
        expect(result).toBe('/TD << /MCID 3 >> BDC\ncontent\nEMC');
    });
});

// ── createMCIDAllocator ──────────────────────────────────────────────

describe('createMCIDAllocator', () => {
    it('should allocate sequential MCIDs starting at 0', () => {
        const alloc = createMCIDAllocator();
        expect(alloc.next(10)).toBe(0);
        expect(alloc.next(10)).toBe(1);
        expect(alloc.next(12)).toBe(0); // per-page: resets for new page
    });

    it('should track MCIDs per page', () => {
        const alloc = createMCIDAllocator();
        alloc.next(10);
        alloc.next(10);
        alloc.next(12);
        const pageMCIDs = alloc.getPageMCIDs();
        expect(pageMCIDs.get(10)).toEqual([0, 1]);
        expect(pageMCIDs.get(12)).toEqual([0]); // per-page: starts at 0
    });
});

// ── buildStructureTree ───────────────────────────────────────────────

describe('buildStructureTree', () => {
    it('should build a minimal structure tree', () => {
        const doc: StructElement = {
            type: 'Document',
            children: [
                { type: 'P', children: [{ mcid: 0, pageObjNum: 5 } as MCRef] },
            ],
        };
        const result = buildStructureTree(doc, 100);
        expect(result.structTreeRootObjNum).toBe(100);
        expect(result.parentTreeObjNum).toBe(101);
        expect(result.totalObjects).toBeGreaterThanOrEqual(3);
        // StructTreeRoot should reference the document element
        const stRoot = result.objects.find(([n]) => n === 100);
        expect(stRoot).toBeDefined();
        expect(stRoot![1]).toContain('/Type /StructTreeRoot');
        expect(stRoot![1]).toContain('/ParentTree 101 0 R');
    });

    it('should produce StructElem objects for Document, P', () => {
        const doc: StructElement = {
            type: 'Document',
            children: [
                { type: 'P', children: [{ mcid: 0, pageObjNum: 5 } as MCRef] },
            ],
        };
        const result = buildStructureTree(doc, 100);
        const elObjs = result.objects.filter(([_, c]) => c.includes('/Type /StructElem'));
        expect(elObjs.length).toBe(2); // Document + P
        const docEl = elObjs.find(([_, c]) => c.includes('/S /Document'));
        expect(docEl).toBeDefined();
        const pEl = elObjs.find(([_, c]) => c.includes('/S /P'));
        expect(pEl).toBeDefined();
    });

    it('should build ParentTree with MCID → StructElem mapping', () => {
        const doc: StructElement = {
            type: 'Document',
            children: [
                { type: 'P', children: [{ mcid: 0, pageObjNum: 5 } as MCRef] },
                { type: 'P', children: [{ mcid: 1, pageObjNum: 5 } as MCRef] },
            ],
        };
        const result = buildStructureTree(doc, 100);
        const parentTree = result.objects.find(([n]) => n === result.parentTreeObjNum);
        expect(parentTree).toBeDefined();
        expect(parentTree![1]).toContain('/Type /NumberTree');
        expect(parentTree![1]).toContain('/Nums');
    });

    it('should handle Table → TR → TH/TD hierarchy', () => {
        const doc: StructElement = {
            type: 'Document',
            children: [{
                type: 'Table',
                children: [{
                    type: 'TR',
                    children: [
                        { type: 'TH', children: [{ mcid: 0, pageObjNum: 5 } as MCRef] },
                        { type: 'TD', children: [{ mcid: 1, pageObjNum: 5 } as MCRef] },
                    ],
                }],
            }],
        };
        const result = buildStructureTree(doc, 50);
        const structs = result.objects.filter(([_, c]) => c.includes('/Type /StructElem'));
        expect(structs.some(([_, c]) => c.includes('/S /Table'))).toBe(true);
        expect(structs.some(([_, c]) => c.includes('/S /TR'))).toBe(true);
        expect(structs.some(([_, c]) => c.includes('/S /TH'))).toBe(true);
        expect(structs.some(([_, c]) => c.includes('/S /TD'))).toBe(true);
    });
});

// ── buildXMPMetadata ─────────────────────────────────────────────────

describe('buildXMPMetadata', () => {
    it('should produce valid XMP XML with xpacket markers', () => {
        const xmp = buildXMPMetadata('Test Report', '2026-01-15T10:30:00');
        expect(xmp).toContain('<?xpacket begin=');
        expect(xmp).toContain('<?xpacket end="w"?>');
    });

    it('should include PDF/A-2b identification by default', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-15T10:30:00');
        expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>');
        expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    });

    it('should include title and producer', () => {
        const xmp = buildXMPMetadata('My Report', '2026-01-15T10:30:00');
        expect(xmp).toContain('My Report');
        expect(xmp).toContain('pdfnative');
    });

    it('should include creation date', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-15T10:30:00');
        expect(xmp).toContain('2026-01-15T10:30:00');
    });

    it('should escape XML special characters in title', () => {
        const xmp = buildXMPMetadata('A & B <C>', '2026-01-15T10:30:00');
        expect(xmp).toContain('A &amp; B &lt;C&gt;');
        expect(xmp).not.toContain('A & B <C>');
    });

    it('should use UTF-8 BOM (EF BB BF) in xpacket begin', () => {
        const xmp = buildXMPMetadata('Test', '2026-01-15T10:30:00');
        // UTF-8 BOM as 3 Latin-1 characters
        expect(xmp).toContain('<?xpacket begin="\xEF\xBB\xBF"');
    });
});

// ── buildOutputIntentDict ────────────────────────────────────────────

describe('buildOutputIntentDict', () => {
    it('should produce OutputIntent dict with sRGB identifier', () => {
        const dict = buildOutputIntentDict(42);
        expect(dict).toContain('/Type /OutputIntent');
        expect(dict).toContain('/S /GTS_PDFA1');
        expect(dict).toContain('/OutputConditionIdentifier (sRGB IEC61966-2.1)');
        expect(dict).toContain('/DestOutputProfile 42 0 R');
    });
});

// ── buildMinimalSRGBProfile ──────────────────────────────────────────

describe('buildMinimalSRGBProfile', () => {
    it('should produce a binary string with ICC header', () => {
        const profile = buildMinimalSRGBProfile();
        expect(profile.length).toBeGreaterThan(128); // at least header
    });

    it('should have mntr device class at offset 12', () => {
        const profile = buildMinimalSRGBProfile();
        const slice = profile.substring(12, 16);
        expect(slice).toBe('mntr');
    });

    it('should have RGB color space at offset 16', () => {
        const profile = buildMinimalSRGBProfile();
        const slice = profile.substring(16, 20);
        expect(slice).toBe('RGB ');
    });

    it('should have acsp signature at offset 36', () => {
        const profile = buildMinimalSRGBProfile();
        const slice = profile.substring(36, 40);
        expect(slice).toBe('acsp');
    });

    it('should have 9 tags for monitor RGB profile', () => {
        const profile = buildMinimalSRGBProfile();
        // Tag count at offset 128 (4 bytes big-endian)
        const tagCount = (profile.charCodeAt(128) << 24) | (profile.charCodeAt(129) << 16) |
                         (profile.charCodeAt(130) << 8) | profile.charCodeAt(131);
        expect(tagCount).toBe(9);
    });

    it('should include rXYZ, gXYZ, bXYZ colorant tags', () => {
        const profile = buildMinimalSRGBProfile();
        const tagTable = profile.substring(128);
        expect(tagTable).toContain('rXYZ');
        expect(tagTable).toContain('gXYZ');
        expect(tagTable).toContain('bXYZ');
    });

    it('should include TRC tags for tone curves', () => {
        const profile = buildMinimalSRGBProfile();
        const tagTable = profile.substring(128);
        expect(tagTable).toContain('rTRC');
        expect(tagTable).toContain('gTRC');
        expect(tagTable).toContain('bTRC');
    });

    it('should have profile size matching actual data length', () => {
        const profile = buildMinimalSRGBProfile();
        const size = (profile.charCodeAt(0) << 24) | (profile.charCodeAt(1) << 16) |
                     (profile.charCodeAt(2) << 8) | profile.charCodeAt(3);
        expect(size).toBe(profile.length);
    });
});
// ── resolvePdfAConfig ────────────────────────────────────────────────

describe('resolvePdfAConfig', () => {
    it('should return disabled for false', () => {
        const cfg = resolvePdfAConfig(false);
        expect(cfg.enabled).toBe(false);
    });

    it('should return disabled for undefined', () => {
        const cfg = resolvePdfAConfig(undefined);
        expect(cfg.enabled).toBe(false);
    });

    it('should return PDF/A-2b for true', () => {
        const cfg = resolvePdfAConfig(true);
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfaPart).toBe(2);
        expect(cfg.pdfaConformance).toBe('B');
        expect(cfg.pdfVersion).toBe('1.7');
    });

    it('should return PDF/A-1b for pdfa1b', () => {
        const cfg = resolvePdfAConfig('pdfa1b');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfaPart).toBe(1);
        expect(cfg.pdfaConformance).toBe('B');
        expect(cfg.pdfVersion).toBe('1.4');
    });

    it('should return PDF/A-2u for pdfa2u', () => {
        const cfg = resolvePdfAConfig('pdfa2u');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfaPart).toBe(2);
        expect(cfg.pdfaConformance).toBe('U');
    });

    it('should return PDF/A-3b for pdfa3b', () => {
        const cfg = resolvePdfAConfig('pdfa3b');
        expect(cfg.enabled).toBe(true);
        expect(cfg.pdfaPart).toBe(3);
        expect(cfg.pdfaConformance).toBe('B');
        expect(cfg.pdfVersion).toBe('1.7');
        expect(cfg.outputIntentSubtype).toBe('GTS_PDFA1');
    });
});

// ── buildEmbeddedFiles ──────────────────────────────────────────────

describe('buildEmbeddedFiles', () => {
    const makeAttachment = (filename = 'test.xml', content = '<data/>'): PdfAttachment => ({
        filename,
        data: new TextEncoder().encode(content),
        mimeType: 'application/xml',
    });

    it('should create 2 objects per attachment (EF stream + Filespec)', () => {
        const result = buildEmbeddedFiles([makeAttachment()], 10);
        expect(result.totalObjects).toBe(2);
        expect(result.objects).toHaveLength(2);
        expect(result.filespecObjNums).toHaveLength(1);
    });

    it('should assign sequential object numbers', () => {
        const result = buildEmbeddedFiles([makeAttachment()], 10);
        const objNums = result.objects.map(([n]) => n);
        expect(objNums).toEqual([10, 11]);
    });

    it('should handle multiple attachments', () => {
        const atts = [makeAttachment('a.xml', '<a/>'), makeAttachment('b.csv', 'x,y')];
        const result = buildEmbeddedFiles(atts, 20);
        expect(result.totalObjects).toBe(4);
        expect(result.filespecObjNums).toEqual([21, 23]);
    });

    it('should include /AFRelationship in Filespec', () => {
        const att: PdfAttachment = {
            ...makeAttachment(),
            relationship: 'Data',
        };
        const result = buildEmbeddedFiles([att], 10);
        const fsContent = result.objects[1][1];
        expect(fsContent).toContain('/AFRelationship /Data');
    });

    it('should default AFRelationship to Unspecified', () => {
        const result = buildEmbeddedFiles([makeAttachment()], 10);
        const fsContent = result.objects[1][1];
        expect(fsContent).toContain('/AFRelationship /Unspecified');
    });

    it('should include description when provided', () => {
        const att: PdfAttachment = {
            ...makeAttachment(),
            description: 'Invoice XML data',
        };
        const result = buildEmbeddedFiles([att], 10);
        const fsContent = result.objects[1][1];
        expect(fsContent).toContain('/Desc (Invoice XML data)');
    });

    it('should escape MIME type slash in name', () => {
        const result = buildEmbeddedFiles([makeAttachment()], 10);
        const efContent = result.objects[0][1];
        expect(efContent).toContain('/Subtype /application#2Fxml');
    });

    it('should include /Params with /Size', () => {
        const att = makeAttachment('test.xml', '<data/>');
        const result = buildEmbeddedFiles([att], 10);
        const efContent = result.objects[0][1];
        expect(efContent).toContain(`/Params << /Size ${att.data.length} >>`);
    });

    it('should build correct names dict', () => {
        const result = buildEmbeddedFiles([makeAttachment('invoice.xml')], 10);
        expect(result.namesDict).toContain('/EmbeddedFiles');
        expect(result.namesDict).toContain('(invoice.xml)');
        expect(result.namesDict).toContain('11 0 R');
    });

    it('should store stream data for EF objects', () => {
        const result = buildEmbeddedFiles([makeAttachment()], 10);
        expect(result.streams.has(10)).toBe(true);
        expect(result.streams.has(11)).toBe(false);
    });

    it('should escape special chars in filename', () => {
        const att = makeAttachment('file (1).xml');
        const result = buildEmbeddedFiles([att], 10);
        const fsContent = result.objects[1][1];
        expect(fsContent).toContain('file \\(1\\).xml');
    });
});

// ── validateAttachments ─────────────────────────────────────────────

describe('validateAttachments', () => {
    const validAtt: PdfAttachment = {
        filename: 'test.xml',
        data: new TextEncoder().encode('<data/>'),
        mimeType: 'application/xml',
    };

    it('should not throw for undefined attachments', () => {
        expect(() => validateAttachments(undefined, 'pdfa3b')).not.toThrow();
    });

    it('should not throw for empty array', () => {
        expect(() => validateAttachments([], 'pdfa3b')).not.toThrow();
    });

    it('should not throw for valid pdfa3b attachment', () => {
        expect(() => validateAttachments([validAtt], 'pdfa3b')).not.toThrow();
    });

    it('should throw when tagged is not pdfa3b', () => {
        expect(() => validateAttachments([validAtt], true)).toThrow('pdfa3b');
        expect(() => validateAttachments([validAtt], 'pdfa2b')).toThrow('pdfa3b');
        expect(() => validateAttachments([validAtt], false)).toThrow('pdfa3b');
        expect(() => validateAttachments([validAtt], undefined)).toThrow('pdfa3b');
    });

    it('should throw for empty filename', () => {
        const bad = { ...validAtt, filename: '' };
        expect(() => validateAttachments([bad], 'pdfa3b')).toThrow('filename');
    });

    it('should throw for empty mimeType', () => {
        const bad = { ...validAtt, mimeType: '' };
        expect(() => validateAttachments([bad], 'pdfa3b')).toThrow('mimeType');
    });

    it('should throw for empty data', () => {
        const bad = { ...validAtt, data: new Uint8Array(0) };
        expect(() => validateAttachments([bad], 'pdfa3b')).toThrow('non-empty data');
    });
});