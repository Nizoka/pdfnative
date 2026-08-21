/**
 * Print production (v1.7.0): page boxes, printer's marks, /UserUnit,
 * /Trapped, print viewer preferences, custom OutputIntent — validation,
 * exact fragments, per-page marks, byte-identity when unused, and
 * merge/split box preservation.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { validatePrintOptions, resolvePrintBoxes, buildPrinterMarksOps } from '../../src/core/pdf-print.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import { mergePdfs } from '../../src/parser/pdf-pagetree.js';
import { isRef, isArray } from '../../src/parser/pdf-object-parser.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { PdfParams } from '../../src/types/pdf-types.js';

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

const docParams: DocumentParams = {
    title: 'Print',
    blocks: [
        { type: 'paragraph', text: 'page one' },
        { type: 'pageBreak' },
        { type: 'paragraph', text: 'page two' },
    ],
};

const tableParams: PdfParams = {
    title: 'Print',
    infoItems: [],
    headers: ['A', 'B', 'C', 'D', 'E'],
    rows: [{ cells: ['a', 'b', 'c', 'd', 'e'], type: '', pointed: false }],
    balanceText: '',
    countText: '',
    footerText: '',
};

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

// ── Validation ───────────────────────────────────────────────────────

describe('validatePrintOptions', () => {
    const W = 595.28, H = 841.89;

    it('rejects non-positive or oversized bleed', () => {
        expect(() => validatePrintOptions({ bleed: 0 }, W, H, false)).toThrow(/positive/);
        expect(() => validatePrintOptions({ bleed: -3 }, W, H, false)).toThrow(/positive/);
        expect(() => validatePrintOptions({ bleed: 300 }, W, H, false)).toThrow(/trim area/);
    });

    it('rejects bleed combined with an explicit trimBox', () => {
        expect(() => validatePrintOptions({ bleed: 8.5, trimBox: [10, 10, 500, 800] }, W, H, false))
            .toThrow(/mutually exclusive/);
    });

    it('rejects boxes outside the MediaBox or malformed', () => {
        expect(() => validatePrintOptions({ trimBox: [-1, 0, 100, 100] }, W, H, false)).toThrow(/MediaBox/);
        expect(() => validatePrintOptions({ artBox: [0, 0, W + 1, 100] }, W, H, false)).toThrow(/MediaBox/);
        expect(() => validatePrintOptions({ cropBox: [100, 100, 50, 200] }, W, H, false)).toThrow(/x1 > x0/);
    });

    it('rejects a trimBox outside the bleedBox', () => {
        expect(() => validatePrintOptions(
            { trimBox: [5, 5, 500, 800], bleedBox: [10, 10, 490, 790] }, W, H, false,
        )).toThrow(/within the BleedBox/);
    });

    it('rejects marks without a TrimBox', () => {
        expect(() => validatePrintOptions({ marks: true }, W, H, false)).toThrow(/TrimBox/);
    });

    it('rejects out-of-range userUnit and pdfa1b', () => {
        expect(() => validatePrintOptions({ userUnit: 0 }, W, H, false)).toThrow(/between 1 and/);
        expect(() => validatePrintOptions({ userUnit: 80_000 }, W, H, false)).toThrow(/between 1 and/);
        expect(() => validatePrintOptions({ userUnit: 10 }, W, H, 'pdfa1b')).toThrow(/PDF\/A-1/);
    });

    it('accepts a coherent bleed + marks configuration', () => {
        expect(() => validatePrintOptions({ bleed: 8.5, marks: true }, W, H, false)).not.toThrow();
    });
});

// ── Fragments ────────────────────────────────────────────────────────

describe('resolvePrintBoxes', () => {
    it('derives TrimBox and BleedBox from the bleed shorthand', () => {
        const r = resolvePrintBoxes({ bleed: 8.5 }, 600, 800);
        expect(r.trim).toEqual([8.5, 8.5, 591.5, 791.5]);
        expect(r.boxesStr).toBe(' /BleedBox [0.00 0.00 600.00 800.00] /TrimBox [8.50 8.50 591.50 791.50]');
    });

    it('emits only the boxes that are set, in stable order', () => {
        const r = resolvePrintBoxes({
            cropBox: [1, 2, 599, 798], trimBox: [10, 10, 590, 790], artBox: [20, 20, 580, 780],
        }, 600, 800);
        expect(r.boxesStr).toBe(
            ' /CropBox [1.00 2.00 599.00 798.00] /TrimBox [10.00 10.00 590.00 790.00] /ArtBox [20.00 20.00 580.00 780.00]',
        );
    });

    it('emits /UserUnit unless it is the default 1', () => {
        expect(resolvePrintBoxes({ userUnit: 10 }, 600, 800).boxesStr).toBe(' /UserUnit 10.00');
        expect(resolvePrintBoxes({ userUnit: 1 }, 600, 800).boxesStr).toBe('');
    });
});

describe('buildPrinterMarksOps', () => {
    const trim = [20, 20, 580, 780] as const;

    it('draws 8 crop strokes and 4 registration targets, all outside the trim', () => {
        const ops = buildPrinterMarksOps(trim, 600, 800, true);
        const lines = [...ops.matchAll(/([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g)];
        // 8 crop strokes + 8 registration cross strokes.
        expect(lines.length).toBe(16);
        const circles = (ops.match(/ c /g) ?? []).length;
        expect(circles).toBeGreaterThanOrEqual(4 * 4 - 4); // 4 Béziers per circle × 4 targets
        // No stroke endpoint strictly inside the trim rectangle.
        for (const m of lines) {
            const pts = [[+m[1], +m[2]], [+m[3], +m[4]]];
            for (const [x, y] of pts) {
                const strictlyInside = x > trim[0] + 1e-6 && x < trim[2] - 1e-6
                    && y > trim[1] + 1e-6 && y < trim[3] - 1e-6;
                expect(strictlyInside, `stroke point ${x},${y} is inside the TrimBox`).toBe(false);
            }
        }
        expect(ops.startsWith('q')).toBe(true);
        expect(ops.endsWith('Q')).toBe(true);
    });

    it('honours crop/registration toggles and custom geometry', () => {
        const cropOnly = buildPrinterMarksOps(trim, 600, 800, { registration: false });
        expect((cropOnly.match(/ l S/g) ?? []).length).toBe(8);
        expect(cropOnly).not.toContain(' c ');
        const regOnly = buildPrinterMarksOps(trim, 600, 800, { crop: false });
        expect(regOnly).toContain(' c ');
        const heavy = buildPrinterMarksOps(trim, 600, 800, { weight: 1 });
        expect(heavy).toContain('1.00 w');
    });
});

// ── Integration ──────────────────────────────────────────────────────

describe('print options in generated documents', () => {
    it('writes TrimBox/BleedBox into every page dictionary (both builders)', () => {
        const doc = latin1(buildDocumentPDFBytes(docParams, { print: { bleed: 8.5 }, creationDate: FIXED_DATE }));
        expect((doc.match(/\/TrimBox \[8\.50 8\.50/g) ?? []).length).toBe(2); // 2 pages
        expect(doc).toContain('/BleedBox [0.00 0.00');
        const table = latin1(buildPDFBytes(tableParams, { print: { trimBox: [10, 10, 590, 780] } }));
        expect(table).toContain('/TrimBox [10.00 10.00 590.00 780.00]');
    });

    it('appends printer marks to every page content stream', () => {
        const bytes = buildDocumentPDFBytes(docParams, { print: { bleed: 12, marks: true } });
        const reader = openPdf(bytes);
        expect(reader.pageCount).toBe(2);
        for (let p = 0; p < 2; p++) {
            const page = reader.getPage(p);
            const data = reader.decodeStream(reader.resolveValue(page.get('Contents') ?? null) as never);
            let s = ''; for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
            expect(s).toContain('0 0 0 RG 0.25 w');
        }
    });

    it('is byte-identical when the print option is absent (both builders)', () => {
        const layout = { creationDate: FIXED_DATE } as const;
        const a = buildDocumentPDFBytes(docParams, layout);
        const b = buildDocumentPDFBytes(docParams, { ...layout, print: undefined });
        expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
        const ta = buildPDFBytes(tableParams, layout);
        const tb = buildPDFBytes(tableParams, { ...layout, print: undefined });
        expect(Buffer.compare(Buffer.from(ta), Buffer.from(tb))).toBe(0);
        expect(latin1(a)).not.toContain('/TrimBox');
    });

    it('raises the header to %PDF-1.7 only when userUnit is set', () => {
        const plain = latin1(buildDocumentPDFBytes(docParams));
        expect(plain.startsWith('%PDF-1.4')).toBe(true);
        const big = latin1(buildDocumentPDFBytes(docParams, { print: { userUnit: 10 } }));
        expect(big.startsWith('%PDF-1.7')).toBe(true);
        expect(big).toContain('/UserUnit 10.00');
    });
});

describe('/Trapped and XMP parity', () => {
    it('writes /Trapped to /Info in both builders', () => {
        const doc = latin1(buildDocumentPDFBytes({ ...docParams, metadata: { trapped: 'True' } }));
        expect(doc).toContain('/Trapped /True');
        const table = latin1(buildPDFBytes({ ...tableParams, metadata: { trapped: 'False' } }));
        expect(table).toContain('/Trapped /False');
    });

    it('mirrors pdf:Trapped into the tagged XMP packet', () => {
        const doc = latin1(buildDocumentPDFBytes(
            { ...docParams, metadata: { trapped: 'True' } },
            { tagged: 'pdfa2b', onDiagnostic: () => {} },
        ));
        expect(doc).toContain('<pdf:Trapped>True</pdf:Trapped>');
    });
});

describe('print viewer preferences', () => {
    it('emits Duplex, PickTrayByPDFSize, PrintPageRange (0-based) and NumCopies', () => {
        const doc = latin1(buildDocumentPDFBytes(docParams, {
            viewerPreferences: {
                duplex: 'duplexFlipLongEdge',
                pickTrayByPDFSize: true,
                printPageRange: [[1, 2]],
                numCopies: 3,
            },
        }));
        expect(doc).toContain('/Duplex /DuplexFlipLongEdge');
        expect(doc).toContain('/PickTrayByPDFSize true');
        expect(doc).toContain('/PrintPageRange [0 1]'); // 1-based API → 0-based PDF
        expect(doc).toContain('/NumCopies 3');
    });

    it('rejects invalid ranges and copies', () => {
        expect(() => buildDocumentPDFBytes(docParams, {
            viewerPreferences: { printPageRange: [[0, 2]] },
        })).toThrow(/1-based/);
        expect(() => buildDocumentPDFBytes(docParams, {
            viewerPreferences: { numCopies: 0 },
        })).toThrow(/positive integer/);
    });
});

describe('custom OutputIntent', () => {
    /** Minimal fake ICC: 128-byte header with a colour space at bytes 16–19. */
    const fakeIcc = (space: string): Uint8Array => {
        const icc = new Uint8Array(200);
        for (let i = 0; i < 4; i++) icc[16 + i] = space.charCodeAt(i);
        icc[40] = 0x61; // arbitrary non-zero content
        return icc;
    };

    it('embeds the caller profile and condition strings under tagged mode', () => {
        const doc = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: () => {},
            outputIntent: {
                iccProfile: fakeIcc('RGB '),
                outputConditionIdentifier: 'Custom RGB Press',
                outputCondition: 'Custom condition',
                info: 'Press profile',
            },
        }));
        expect(doc).toContain('/OutputConditionIdentifier (Custom RGB Press)');
        expect(doc).toContain('/OutputCondition (Custom condition)');
        expect(doc).toContain('/Info (Press profile)');
        expect(doc).toContain('/N 3 /Length 200');
    });

    it('rejects non-RGB profiles with an actionable message', () => {
        expect(() => buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: () => {},
            outputIntent: { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'x' },
        })).toThrow(/only RGB profiles/);
    });

    it('keeps the built-in sRGB profile byte-identical when omitted', () => {
        const layout = { tagged: 'pdfa2b' as const, onDiagnostic: () => {}, creationDate: FIXED_DATE };
        const a = buildDocumentPDFBytes(docParams, layout);
        const b = buildDocumentPDFBytes(docParams, { ...layout, outputIntent: undefined });
        expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
        expect(latin1(a)).toContain('(sRGB IEC61966-2.1)');
    });
});

describe('merge preserves print boxes', () => {
    it('keeps TrimBox/BleedBox through mergePdfs', () => {
        const src = buildDocumentPDFBytes(docParams, { print: { bleed: 8.5 } });
        const merged = mergePdfs([src]);
        const reader = openPdf(merged);
        const page = reader.getPage(0);
        const trim = page.get('TrimBox');
        const resolved = isRef(trim) ? reader.getObject(trim.num) : trim;
        expect(resolved !== undefined && isArray(resolved as never)).toBe(true);
        expect(latin1(merged)).toContain('/TrimBox');
        expect(latin1(merged)).toContain('/BleedBox');
    });
});
