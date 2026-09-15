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

/** Every (x, y) pair of the m / l / c operators in a marks block. */
const points = (ops: string): Array<readonly [number, number]> => {
    const out: Array<readonly [number, number]> = [];
    for (const line of ops.split('\n')) {
        if (!/ (m|l|c) /.test(line)) continue;
        const nums = line.match(/-?[\d.]+/g) ?? [];
        for (let i = 0; i + 1 < nums.length; i += 2) out.push([+nums[i], +nums[i + 1]]);
    }
    return out;
};
/** Straight strokes of a marks block as [x1, y1, x2, y2]. */
const strokes = (ops: string): Array<readonly [number, number, number, number]> =>
    [...ops.matchAll(/([\d.-]+) ([\d.-]+) m ([\d.-]+) ([\d.-]+) l S/g)].map(m => [+m[1], +m[2], +m[3], +m[4]]);
/** DeviceCMYK fills of a marks block (the colour-bar patches). */
const patches = (ops: string): Array<{ ink: number[]; x: number; y: number; w: number; h: number }> =>
    [...ops.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) k ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re f/g)]
        .map(m => ({ ink: m.slice(1, 5).map(Number), x: +m[5], y: +m[6], w: +m[7], h: +m[8] }));

/** The default marks at a 3 mm bleed on a 600 × 841.89 pt sheet (pinned). */
const TIGHT_TRIM = [8.5, 8.5, 591.5, 833.39] as const;
const TIGHT_DEFAULT_MARKS = [
    'q',
    '0 0 0 RG 0.25 w',
    '3.50 8.50 m 0.50 8.50 l S',
    '8.50 3.50 m 8.50 0.50 l S',
    '596.50 8.50 m 599.50 8.50 l S',
    '591.50 3.50 m 591.50 0.50 l S',
    '3.50 833.39 m 0.50 833.39 l S',
    '8.50 838.39 m 8.50 841.39 l S',
    '596.50 833.39 m 599.50 833.39 l S',
    '591.50 838.39 m 591.50 841.39 l S',
    '302.68 4.25 m 302.68 5.73 301.48 6.93 300.00 6.93 c 298.52 6.93 297.32 5.73 297.32 4.25 c 297.32 2.77 298.52 1.57 300.00 1.57 c 301.48 1.57 302.68 2.77 302.68 4.25 c S',
    '296.25 4.25 m 303.75 4.25 l S',
    '300.00 0.50 m 300.00 8.00 l S',
    '302.68 837.64 m 302.68 839.12 301.48 840.32 300.00 840.32 c 298.52 840.32 297.32 839.12 297.32 837.64 c 297.32 836.16 298.52 834.96 300.00 834.96 c 301.48 834.96 302.68 836.16 302.68 837.64 c S',
    '296.25 837.64 m 303.75 837.64 l S',
    '300.00 833.89 m 300.00 841.39 l S',
    '6.93 420.94 m 6.93 422.42 5.73 423.62 4.25 423.62 c 2.77 423.62 1.57 422.42 1.57 420.94 c 1.57 419.47 2.77 418.27 4.25 418.27 c 5.73 418.27 6.93 419.47 6.93 420.94 c S',
    '0.50 420.94 m 8.00 420.94 l S',
    '4.25 417.19 m 4.25 424.69 l S',
    '598.43 420.94 m 598.43 422.42 597.23 423.62 595.75 423.62 c 594.27 423.62 593.07 422.42 593.07 420.94 c 593.07 419.47 594.27 418.27 595.75 418.27 c 597.23 418.27 598.43 419.47 598.43 420.94 c S',
    '592.00 420.94 m 599.50 420.94 l S',
    '595.75 417.19 m 595.75 424.69 l S',
    'Q',
].join('\n');

describe('buildPrinterMarksOps', () => {
    const trim = [20, 20, 580, 780] as const;

    it('draws 8 crop strokes and 4 registration targets, all outside the trim', () => {
        const ops = buildPrinterMarksOps(trim, 600, 800, true);
        const lines = strokes(ops);
        // 8 crop strokes + 8 registration cross strokes.
        expect(lines.length).toBe(16);
        const circles = (ops.match(/ c /g) ?? []).length;
        expect(circles).toBeGreaterThanOrEqual(4 * 4 - 4); // 4 Béziers per circle × 4 targets
        // No stroke endpoint strictly inside the trim rectangle.
        for (const [x1, y1, x2, y2] of lines) {
            for (const [x, y] of [[x1, y1], [x2, y2]]) {
                const strictlyInside = x > trim[0] + 1e-6 && x < trim[2] - 1e-6
                    && y > trim[1] + 1e-6 && y < trim[3] - 1e-6;
                expect(strictlyInside, `stroke point ${x},${y} is inside the TrimBox`).toBe(false);
            }
        }
        expect(ops.startsWith('q')).toBe(true);
        expect(ops.endsWith('Q')).toBe(true);
        // Tight strip (8.5pt bleed): the whole circle + cross must stay on
        // the sheet — no negative coordinates (nothing past the media edge).
        const tight = buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, { crop: false });
        expect(tight).toContain(' c ');
        expect(tight).not.toContain('-');
    });

    it('keeps crop marks and registration targets ≥ 0.5 pt clear of the trim line and the sheet edge', () => {
        const W = 600, H = 800, EPS = 1e-6;
        for (const strip of [6.6, 8.5, 14, 20]) {
            const t = [strip, strip, W - strip, H - strip] as const;
            const ops = buildPrinterMarksOps(t, W, H, true);
            expect(strokes(ops).length, `strip ${strip}: 8 crop + 8 cross strokes`).toBe(16);
            expect((ops.match(/ c S/g) ?? []).length, `strip ${strip}: four circles`).toBe(4);
            for (const [x, y] of points(ops)) {
                // On the sheet, 0.5 pt in from every media edge…
                expect(x, `strip ${strip}: x=${x}`).toBeGreaterThanOrEqual(0.5 - EPS);
                expect(x, `strip ${strip}: x=${x}`).toBeLessThanOrEqual(W - 0.5 + EPS);
                expect(y, `strip ${strip}: y=${y}`).toBeGreaterThanOrEqual(0.5 - EPS);
                expect(y, `strip ${strip}: y=${y}`).toBeLessThanOrEqual(H - 0.5 + EPS);
                // …and never within 0.5 pt of the trim rectangle.
                const nearTrim = x > t[0] - 0.5 + EPS && x < t[2] + 0.5 - EPS
                    && y > t[1] - 0.5 + EPS && y < t[3] + 0.5 - EPS;
                expect(nearTrim, `strip ${strip}: point ${x},${y} is within 0.5 pt of the trim line`).toBe(false);
            }
        }
        // 3 mm bleed: radius ≈ 2.68, cross spanning [0.5, 8.0] on the bottom edge.
        const tight = buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, { crop: false });
        expect(tight).toContain('300.00 0.50 m 300.00 8.00 l S');
        // The clearance follows a heavier stroke.
        const heavy = buildPrinterMarksOps([8.5, 8.5, 591.5, 791.5], 600, 800, { crop: false, weight: 1 });
        expect(heavy).toContain('300.00 1.00 m 300.00 7.50 l S');
    });

    it('drops a registration target whose strip is narrower than 6.6 pt', () => {
        expect(buildPrinterMarksOps([6.6, 6.6, 593.4, 793.4], 600, 800, { crop: false })).toContain(' c S');
        expect(buildPrinterMarksOps([6.5, 6.5, 593.5, 793.5], 600, 800, { crop: false })).toBe('');
        // Crop marks in a 3 pt strip (1 pt offset): clamped to [0.5, 2.0], still drawn.
        const narrow = buildPrinterMarksOps([3, 3, 597, 797], 600, 800, { offset: 1 });
        expect(narrow).toContain('2.00 3.00 m 0.50 3.00 l S');
        expect(narrow).not.toContain(' c S');
        // With the default 5 pt offset nothing fits in a 3 pt strip at all.
        expect(buildPrinterMarksOps([3, 3, 597, 797], 600, 800, true)).toBe('');
    });

    it('pins the default marks; colourBars off leaves them byte-identical', () => {
        expect(buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, true)).toBe(TIGHT_DEFAULT_MARKS);
        expect(buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, {})).toBe(TIGHT_DEFAULT_MARKS);
        expect(buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, { colourBars: false })).toBe(TIGHT_DEFAULT_MARKS);
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

    it('strokes in the registration colour when asked (v1.8.0)', () => {
        const reg = buildPrinterMarksOps(trim, 600, 800, true, true);
        expect(reg).toContain('/CSReg CS 1 SCN 0.25 w');
        expect(reg).not.toMatch(/ RG\b/);
        expect(buildPrinterMarksOps(trim, 600, 800, true)).toContain('0 0 0 RG 0.25 w');
    });

    it('wraps the block in a /Page artifact only when asked (v1.8.0)', () => {
        const plain = buildPrinterMarksOps(trim, 600, 800, true, false, false);
        expect(plain).not.toContain('/Artifact');
        const art = buildPrinterMarksOps(trim, 600, 800, true, false, true);
        expect(art).toBe(`/Artifact << /Type /Page >> BDC\n${plain}\nEMC`);
        // Nothing to wrap: no artifact either.
        expect(buildPrinterMarksOps(trim, 600, 800, { crop: false, registration: false }, false, true)).toBe('');
    });
});

describe('colour bars (v1.8.0)', () => {
    const trim = [20, 20, 580, 780] as const; // 20 pt strip
    const CROSS_HALF = 1.4 * 3.5; // the bottom target's cross half-width at r = 3.5

    it('paints C, M, Y, K at 100 % then 50 % in the bottom strip, clear of trim, sheet and target', () => {
        const ops = buildPrinterMarksOps(trim, 600, 800, { colourBars: true });
        const bars = patches(ops);
        expect(bars.map(p => p.ink)).toEqual([
            [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],
            [0.5, 0, 0, 0], [0, 0.5, 0, 0], [0, 0, 0.5, 0], [0, 0, 0, 0.5],
        ]);
        expect(ops).not.toMatch(/ K\b/); // fills only, never stroked
        const midX = (trim[0] + trim[2]) / 2;
        for (const p of bars) {
            expect(p.w).toBe(12);
            expect(p.h).toBe(12);
            expect(p.y).toBeGreaterThanOrEqual(0.5);
            expect(p.y + p.h).toBeLessThanOrEqual(trim[1] - 0.5); // never inside the TrimBox
            expect(p.x).toBeGreaterThanOrEqual(trim[0] + 0.5); // right of the crop mark's vertical
            expect(p.x + p.w + 0.5).toBeLessThanOrEqual(midX - CROSS_HALF); // clear of the target
        }
        expect(bars[0].x).toBe(21.5);
        expect(bars[1].x).toBe(34.5); // 12 pt patch + 1 pt gutter
        // The stroked marks are unchanged: the bar is appended inside q … Q.
        expect(ops.startsWith(buildPrinterMarksOps(trim, 600, 800, true).slice(0, -1))).toBe(true);
        expect(ops.endsWith('re f\nQ')).toBe(true);
    });

    it('draws the four solids only with tints: false', () => {
        const bars = patches(buildPrinterMarksOps(trim, 600, 800, { colourBars: { tints: false } }));
        expect(bars.map(p => p.ink)).toEqual([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]);
    });

    it('clamps the patch size to the strip minus the clearance', () => {
        const big = patches(buildPrinterMarksOps(trim, 600, 800, { colourBars: { size: 50 } }));
        expect(big.every(p => p.w === 19 && p.h === 19 && p.y === 0.5)).toBe(true);
        const small = patches(buildPrinterMarksOps(trim, 600, 800, { colourBars: { size: 6 } }));
        expect(small.every(p => p.w === 6 && p.h === 6)).toBe(true);
        // A 3 mm bleed leaves 7.5 pt patches.
        const tight = patches(buildPrinterMarksOps(TIGHT_TRIM, 600, 841.89, { colourBars: true }));
        expect(tight.length).toBe(8);
        expect(tight.every(p => p.w === 7.5 && p.h === 7.5)).toBe(true);
    });

    it('skips the bar silently when it would reach the bottom target or the strip is under 4 pt', () => {
        // 220 pt wide page: the target at x = 110 sits where the bar would run.
        const narrowPage = buildPrinterMarksOps([20, 20, 200, 780], 220, 800, { colourBars: true });
        expect(narrowPage).toContain(' c S');
        expect(narrowPage).not.toContain(' re f');
        // Without the bottom target the bar fits on the same page.
        const noReg = buildPrinterMarksOps([20, 20, 200, 780], 220, 800, { colourBars: true, registration: false });
        expect(patches(noReg).length).toBe(8);
        // A 3 pt strip carries no bar, even though its crop marks fit.
        const thin = buildPrinterMarksOps([3, 3, 597, 797], 600, 800, { colourBars: true, offset: 1 });
        expect(thin).not.toContain(' re f');
        expect(thin).toContain(' l S');
    });
});

describe('registration colour in documents (v1.8.0)', () => {
    const icc = (space: string): Uint8Array => {
        const bytes = new Uint8Array(200);
        bytes[3] = 200; // size field
        for (let i = 0; i < 4; i++) bytes[36 + i] = 'acsp'.charCodeAt(i);
        for (let i = 0; i < 4; i++) {
            bytes[12 + i] = 'prtr'.charCodeAt(i);
            bytes[16 + i] = space.charCodeAt(i);
        }
        return bytes;
    };
    const pageDicts = (pdf: string): string[] => pdf.match(/\/Type \/Page \/Parent[^\n]*/g) ?? [];

    it('declares /Separation /All beside /DefaultRGB, in a single /ColorSpace, under a CMYK intent', () => {
        const pdf = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: () => {}, print: { bleed: 18, marks: true },
            outputIntent: { iccProfile: icc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' },
        }));
        expect(pdf).toContain('/CSReg CS 1 SCN');
        const pages = pageDicts(pdf);
        expect(pages.length).toBeGreaterThan(0);
        for (const page of pages) {
            expect(page.match(/\/ColorSpace/g)?.length).toBe(1);
            expect(page).toContain('/DefaultRGB [/CalRGB');
            expect(page).toContain('/CSReg [/Separation /All /DeviceCMYK << /FunctionType 2');
        }
    });

    it('keeps black marks and no colour space without a CMYK intent', () => {
        const pdf = latin1(buildDocumentPDFBytes(docParams, { print: { bleed: 18, marks: true } }));
        expect(pdf).toContain('0 0 0 RG');
        expect(pdf).not.toContain('CSReg');
        const rgb = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: () => {}, print: { bleed: 18, marks: true },
            outputIntent: { iccProfile: icc('RGB '), outputConditionIdentifier: 'RGB press' },
        }));
        expect(rgb).not.toContain('CSReg');
    });

    it('adds no registration colour space when there are no marks', () => {
        const pdf = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: () => {}, print: { bleed: 18 },
            outputIntent: { iccProfile: icc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' },
        }));
        expect(pdf).not.toContain('CSReg');
        expect(pdf).toContain('/DefaultRGB');
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

    it('writes colour bars as DeviceCMYK fills and raises the existing diagnostic under a non-CMYK intent', () => {
        const plain = latin1(buildDocumentPDFBytes(docParams, { print: { bleed: 18, marks: { colourBars: true } } }));
        expect(plain).toContain('1 0 0 0 k ');
        expect(plain).toContain(' re f');
        const codes: string[] = [];
        buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: d => { codes.push(d.code); },
            print: { bleed: 18, marks: { colourBars: true } },
        });
        expect(codes).toContain('PDFA_DEVICE_CMYK_CONTENT');
        const none: string[] = [];
        buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: d => { none.push(d.code); },
            print: { bleed: 18, marks: true },
        });
        expect(none).not.toContain('PDFA_DEVICE_CMYK_CONTENT');
    });

    it('marks the printer marks as a /Page artifact in tagged documents only (both builders)', () => {
        const contentOf = (bytes: Uint8Array): string[] => {
            const reader = openPdf(bytes);
            const out: string[] = [];
            for (let p = 0; p < reader.pageCount; p++) {
                const page = reader.getPage(p);
                const data = reader.decodeStream(reader.resolveValue(page.get('Contents') ?? null) as never);
                let s = ''; for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
                out.push(s);
            }
            return out;
        };
        const tagged = contentOf(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b', onDiagnostic: () => {}, print: { bleed: 18, marks: true },
        }));
        expect(tagged.length).toBe(2);
        for (const s of tagged) {
            expect(s).toContain('/Artifact << /Type /Page >> BDC\nq\n0 0 0 RG 0.25 w');
            expect(s).toMatch(/ l S\nQ\nEMC/);
        }
        const untagged = contentOf(buildDocumentPDFBytes(docParams, { print: { bleed: 18, marks: true } }));
        for (const s of untagged) {
            expect(s).toContain('q\n0 0 0 RG 0.25 w');
            expect(s).not.toContain('/Artifact');
        }
        const table = contentOf(buildPDFBytes(tableParams, {
            tagged: 'pdfa2b', onDiagnostic: () => {}, print: { trimBox: [18, 18, 577.28, 823.89], marks: true },
        }));
        expect(table[0]).toContain('/Artifact << /Type /Page >> BDC\nq\n0 0 0 RG 0.25 w');
        const tableUntagged = contentOf(buildPDFBytes(tableParams, { print: { trimBox: [18, 18, 577.28, 823.89], marks: true } }));
        expect(tableUntagged[0]).not.toContain('/Artifact');
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
        // pdf:Trapped is not in the XMP-2005 Adobe PDF schema that PDF/A
        // pins, so its presence requires the PDF/A extension schema
        // declaration (ISO 19005-2 §6.6.2.3.2).
        expect(doc).toContain('<pdfaExtension:schemas>');
        expect(doc).toContain('<pdfaProperty:name>Trapped</pdfaProperty:name>');
        // ISO 32000-1 Table 317: /Trapped /Unknown maps to the ABSENCE of
        // pdf:Trapped in XMP — /Info carries it alone, no extension schema.
        const unknown = latin1(buildDocumentPDFBytes(
            { ...docParams, metadata: { trapped: 'Unknown' } },
            { tagged: 'pdfa2b', onDiagnostic: () => {} },
        ));
        expect(unknown).toContain('/Trapped /Unknown');
        expect(unknown).not.toContain('<pdf:Trapped>');
        expect(unknown).not.toContain('pdfaExtension');
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
        icc[3] = 200; // size field
        for (let i = 0; i < 4; i++) icc[36 + i] = 'acsp'.charCodeAt(i);
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

    it('takes /N from the profile: CMYK is 4 and Gray is 1 (v1.8.0)', () => {
        const cmyk = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: () => {},
            outputIntent: { iccProfile: fakeIcc('CMYK'), outputConditionIdentifier: 'CGATS TR 001' },
        }));
        expect(cmyk).toContain('/N 4 /Length 200');
        const gray = latin1(buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: () => {},
            outputIntent: { iccProfile: fakeIcc('GRAY'), outputConditionIdentifier: 'Dot Gain 20%' },
        }));
        expect(gray).toContain('/N 1 /Length 200');
    });

    it('rejects a profile that is not RGB, CMYK or Gray, before writing', () => {
        expect(() => buildDocumentPDFBytes(docParams, {
            tagged: 'pdfa2b',
            onDiagnostic: () => {},
            outputIntent: { iccProfile: fakeIcc('Lab '), outputConditionIdentifier: 'x' },
        })).toThrow(/must describe RGB, CMYK or Gray/);
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
