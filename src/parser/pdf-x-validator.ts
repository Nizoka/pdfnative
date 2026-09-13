/**
 * pdfnative — PDF/X-4 structural validator (ISO 15930-7)
 * =======================================================
 * A read-only conformance checker for the PDF/X-4 requirements that can be
 * verified from a file's structure. It parses the document with the native
 * reader; it does not render.
 *
 * Checked:
 *   - Header at PDF 1.6 or lower; no encryption; trailer `/ID`
 *   - XMP: `pdfxid:GTS_PDFXVersion` of PDF/X-4, `xmpMM:DocumentID`,
 *     `xmpMM:VersionID`, `xmpMM:RenditionClass`, `dc:title`, and
 *     `pdf:Trapped` of True or False, consistent with `/Info /Trapped`
 *   - A `/GTS_PDFX` OutputIntent with `/OutputConditionIdentifier` and an
 *     embedded output (`prtr`) ICC profile whose `/N` matches its header
 *   - Every page: a TrimBox or an ArtBox, not both, nested in the BleedBox
 *     and the MediaBox
 *   - Every font in page resources embedded
 *   - No annotations inside the BleedBox other than PrinterMark / TrapNet
 *   - Device colour in page content matching the OutputIntent, or covered
 *     by a `/DefaultRGB` / `/DefaultCMYK` colour space in page resources
 *
 * Not checked: colour inside Form XObjects and images, transparency blend
 * spaces, optional content, and anything that needs rendering. veraPDF does
 * not cover PDF/X; before sending a file to press, confirm it with a
 * certified preflight tool (callas pdfToolbox, Acrobat Preflight). A `valid`
 * result means the structural prerequisites hold.
 *
 * @since 1.8.0
 */

import { openPdf } from './pdf-reader.js';
import { isDict, isStream, isArray, dictGetName } from './pdf-object-parser.js';
import type { PdfDict, PdfStream, PdfValue } from './pdf-object-parser.js';
import { scanDeviceColour } from '../core/pdf-content-colour.js';

/** Result of a PDF/X structural validation. */
export interface PdfXValidationResult {
    /** True when no blocking errors were found. */
    readonly valid: boolean;
    /** Blocking conformance violations. */
    readonly errors: readonly string[];
    /** Non-blocking observations. */
    readonly warnings: readonly string[];
}

type Box = readonly [number, number, number, number];
type Reader = ReturnType<typeof openPdf>;

const STANDARD = 'ISO 15930-7';
const latin1 = (data: Uint8Array): string => new TextDecoder('latin1').decode(data);

function readBox(reader: Reader, page: PdfDict, key: string): Box | null {
    const v = reader.resolveValue(page.get(key) ?? null);
    if (!isArray(v) || v.length !== 4) return null;
    const n = v.map(x => reader.resolveValue(x as PdfValue));
    if (!n.every(x => typeof x === 'number')) return null;
    const [a, b, c, d] = n as number[];
    return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

const within = (inner: Box, outer: Box): boolean =>
    inner[0] >= outer[0] - 0.01 && inner[1] >= outer[1] - 0.01
    && inner[2] <= outer[2] + 0.01 && inner[3] <= outer[3] + 0.01;

const intersects = (a: Box, b: Box): boolean =>
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** An XMP property written as an element or as an attribute. */
function xmpProperty(xmp: string, name: string): string | undefined {
    const esc = name.replace(':', '\\:');
    const element = new RegExp(`<${esc}>\\s*([^<]*?)\\s*</${esc}>`).exec(xmp);
    if (element) return element[1];
    const attribute = new RegExp(`\\b${esc}="([^"]*)"`).exec(xmp);
    return attribute?.[1];
}

function streamText(reader: Reader, value: PdfValue | undefined): string | null {
    const s = reader.resolveValue(value ?? null);
    if (!isStream(s)) return null;
    try {
        return latin1(reader.decodeStream(s));
    } catch {
        return null;
    }
}

function pageContent(reader: Reader, page: PdfDict): string {
    const resolved = reader.resolveValue(page.get('Contents') ?? null);
    const streams: PdfStream[] = [];
    if (isStream(resolved)) streams.push(resolved);
    else if (isArray(resolved)) {
        for (const item of resolved) {
            const s = reader.resolveValue(item as PdfValue);
            if (isStream(s)) streams.push(s);
        }
    }
    let text = '';
    for (const s of streams) {
        try { text += latin1(reader.decodeStream(s)) + '\n'; } catch { /* reported by caller as unreadable */ }
    }
    return text;
}

function resolveDict(reader: Reader, value: PdfValue | undefined): PdfDict | null {
    const v = reader.resolveValue(value ?? null);
    return isDict(v) ? v : null;
}

/** Whether a font dictionary's glyph program is embedded. */
function fontEmbedded(reader: Reader, font: PdfDict): boolean {
    const subtype = dictGetName(font, 'Subtype');
    if (subtype === 'Type3') return true;
    let target = font;
    if (subtype === 'Type0') {
        const descendants = reader.resolveValue(font.get('DescendantFonts') ?? null);
        const first = isArray(descendants) ? resolveDict(reader, descendants[0] as PdfValue) : null;
        if (!first) return false;
        target = first;
    }
    const descriptor = resolveDict(reader, target.get('FontDescriptor'));
    if (!descriptor) return false;
    return descriptor.has('FontFile') || descriptor.has('FontFile2') || descriptor.has('FontFile3');
}

/**
 * Validate the PDF/X-4 (ISO 15930-7) structural prerequisites of a file.
 *
 * @param bytes - Complete PDF file bytes (e.g. from `buildDocumentPDFBytes`).
 * @returns A structured result with `valid`, `errors` and `warnings`.
 */
export function validatePdfX(bytes: Uint8Array): PdfXValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Header ──────────────────────────────────────────────────────
    const header = /^%PDF-(\d)\.(\d)/.exec(latin1(bytes.subarray(0, 16)));
    if (!header) {
        return { valid: false, errors: ['Missing %PDF- header.'], warnings };
    }
    if (Number(header[1]) > 1 || Number(header[2]) > 6) {
        errors.push(`Header declares PDF ${header[1]}.${header[2]}; PDF/X-4 is based on PDF 1.6 (${STANDARD}).`);
    }

    let reader: Reader;
    try {
        reader = openPdf(bytes);
    } catch (err) {
        return { valid: false, errors: [...errors, `Unparseable PDF: ${(err as Error).message}`], warnings };
    }

    // ── Trailer ─────────────────────────────────────────────────────
    if (reader.trailer.has('Encrypt')) {
        errors.push(`The file is encrypted; PDF/X forbids encryption (${STANDARD}).`);
    }
    if (!reader.trailer.has('ID')) {
        errors.push(`Trailer has no /ID (${STANDARD}).`);
    }

    let catalog: PdfDict;
    try {
        catalog = reader.getCatalog();
    } catch (err) {
        return { valid: false, errors: [...errors, `No document catalog: ${(err as Error).message}`], warnings };
    }

    // ── XMP metadata ────────────────────────────────────────────────
    const xmp = streamText(reader, catalog.get('Metadata'));
    let xmpTrapped: string | undefined;
    if (xmp === null) {
        errors.push(`Catalog has no readable /Metadata XMP stream; PDF/X-4 declares conformance in XMP (${STANDARD}).`);
    } else {
        const version = xmpProperty(xmp, 'pdfxid:GTS_PDFXVersion');
        if (version === undefined) {
            errors.push(`XMP has no pdfxid:GTS_PDFXVersion — the file does not claim PDF/X (${STANDARD}).`);
        } else if (!version.startsWith('PDF/X-4')) {
            errors.push(`XMP pdfxid:GTS_PDFXVersion is "${version}", not PDF/X-4.`);
        }
        for (const prop of ['xmpMM:DocumentID', 'xmpMM:VersionID', 'xmpMM:RenditionClass']) {
            if (!xmpProperty(xmp, prop)) errors.push(`XMP has no ${prop} (${STANDARD}).`);
        }
        if (!/<dc:title\b/.test(xmp)) errors.push(`XMP has no dc:title (${STANDARD}).`);
        xmpTrapped = xmpProperty(xmp, 'pdf:Trapped');
        if (xmpTrapped !== 'True' && xmpTrapped !== 'False') {
            errors.push(`XMP pdf:Trapped must be True or False, found ${xmpTrapped === undefined ? 'none' : `"${xmpTrapped}"`} (${STANDARD}).`);
        }
        if (/pdfaid:part/.test(xmp)) {
            warnings.push('XMP also claims PDF/A; validate that claim separately (e.g. with veraPDF).');
        }
    }

    const infoRef = reader.trailer.get('Info');
    const info = infoRef !== undefined ? resolveDict(reader, infoRef) : null;
    const infoTrapped = info ? dictGetName(info, 'Trapped') : undefined;
    if (infoTrapped !== undefined && xmpTrapped !== undefined && infoTrapped !== xmpTrapped) {
        errors.push(`/Info /Trapped is /${infoTrapped} but XMP pdf:Trapped is ${xmpTrapped}; they must agree (${STANDARD}).`);
    }

    // ── OutputIntent ────────────────────────────────────────────────
    let intentSpace: string | null = null;
    const intents = reader.resolveValue(catalog.get('OutputIntents') ?? null);
    const pdfxIntents = isArray(intents)
        ? intents.map(i => resolveDict(reader, i as PdfValue)).filter((d): d is PdfDict => d !== null && dictGetName(d, 'S') === 'GTS_PDFX')
        : [];
    if (pdfxIntents.length === 0) {
        errors.push(`Catalog has no /OutputIntents entry with /S /GTS_PDFX (${STANDARD}).`);
    } else {
        if (pdfxIntents.length > 1) errors.push(`More than one /GTS_PDFX OutputIntent (${STANDARD}).`);
        const intent = pdfxIntents[0];
        const identifier = reader.resolveValue(intent.get('OutputConditionIdentifier') ?? null);
        if (typeof identifier !== 'string' || identifier.length === 0) {
            errors.push(`The /GTS_PDFX OutputIntent has no /OutputConditionIdentifier (${STANDARD}).`);
        }
        const profile = reader.resolveValue(intent.get('DestOutputProfile') ?? null);
        if (!isStream(profile)) {
            errors.push(`The /GTS_PDFX OutputIntent embeds no /DestOutputProfile; PDF/X-4 requires the ICC profile in the file (${STANDARD}).`);
        } else {
            let icc: Uint8Array | null = null;
            try { icc = reader.decodeStream(profile); } catch { icc = null; }
            if (!icc || icc.length < 128) {
                errors.push('The OutputIntent ICC profile is unreadable or shorter than its 128-byte header.');
            } else {
                const deviceClass = latin1(icc.subarray(12, 16));
                const space = latin1(icc.subarray(16, 20));
                if (deviceClass !== 'prtr') {
                    errors.push(`The OutputIntent profile's class is '${deviceClass.trim()}'; PDF/X requires an output (prtr) profile (${STANDARD}).`);
                }
                const expectedN: Record<string, number> = { 'RGB ': 3, CMYK: 4, GRAY: 1 };
                const n = reader.resolveValue(profile.dict.get('N') ?? null);
                if (expectedN[space] === undefined) {
                    errors.push(`The OutputIntent profile describes '${space.trim()}', not RGB, CMYK or Gray.`);
                } else {
                    intentSpace = space;
                    if (n !== expectedN[space]) {
                        errors.push(`The OutputIntent profile stream declares /N ${String(n)} for a ${space.trim()} profile (expected ${expectedN[space]}).`);
                    }
                }
            }
        }
    }

    // ── Pages ───────────────────────────────────────────────────────
    let pages: PdfDict[] = [];
    try {
        pages = reader.getPages();
    } catch (err) {
        errors.push(`Unable to enumerate pages: ${(err as Error).message}`);
    }

    for (let p = 0; p < pages.length; p++) {
        const page = pages[p];
        const at = `Page ${p + 1}`;
        const media = readBox(reader, page, 'MediaBox');
        const trim = readBox(reader, page, 'TrimBox');
        const art = readBox(reader, page, 'ArtBox');
        const bleed = readBox(reader, page, 'BleedBox');

        if (!trim && !art) errors.push(`${at}: no TrimBox or ArtBox (${STANDARD}).`);
        if (trim && art) errors.push(`${at}: both TrimBox and ArtBox; PDF/X allows one (${STANDARD}).`);
        const finished = trim ?? art;
        if (media && bleed && !within(bleed, media)) errors.push(`${at}: BleedBox extends beyond the MediaBox (${STANDARD}).`);
        if (finished && bleed && !within(finished, bleed)) errors.push(`${at}: ${trim ? 'TrimBox' : 'ArtBox'} extends beyond the BleedBox (${STANDARD}).`);
        if (finished && media && !within(finished, media)) errors.push(`${at}: ${trim ? 'TrimBox' : 'ArtBox'} extends beyond the MediaBox (${STANDARD}).`);

        const resources = resolveDict(reader, page.get('Resources'));

        // Fonts.
        const fonts = resources ? resolveDict(reader, resources.get('Font')) : null;
        if (fonts) {
            for (const [name, value] of fonts) {
                const font = resolveDict(reader, value);
                if (font && !fontEmbedded(reader, font)) {
                    const base = dictGetName(font, 'BaseFont') ?? name;
                    errors.push(`${at}: font /${name} (${base}) is not embedded (${STANDARD}).`);
                }
            }
        }

        // Annotations.
        const annots = reader.resolveValue(page.get('Annots') ?? null);
        const printArea = bleed ?? finished ?? media;
        if (isArray(annots)) {
            for (const a of annots) {
                const annot = resolveDict(reader, a as PdfValue);
                if (!annot) continue;
                const subtype = dictGetName(annot, 'Subtype') ?? 'unknown';
                if (subtype === 'PrinterMark' || subtype === 'TrapNet') continue;
                const rect = readBox(reader, annot, 'Rect');
                if (!rect || !printArea || intersects(rect, printArea)) {
                    errors.push(`${at}: /${subtype} annotation inside the ${bleed ? 'BleedBox' : 'page area'}; PDF/X allows only PrinterMark and TrapNet there (${STANDARD}).`);
                }
            }
        }

        // Device colour against the OutputIntent.
        if (intentSpace !== null) {
            const use = scanDeviceColour(pageContent(reader, page));
            const colorSpaces = resources ? resolveDict(reader, resources.get('ColorSpace')) : null;
            const hasDefault = (key: string): boolean => colorSpaces?.has(key) ?? false;
            if (use.rgb && intentSpace !== 'RGB ' && !hasDefault('DefaultRGB')) {
                errors.push(`${at}: DeviceRGB colour under a ${intentSpace.trim()} OutputIntent without /DefaultRGB (${STANDARD}).`);
            }
            if (use.cmyk && intentSpace !== 'CMYK' && !hasDefault('DefaultCMYK')) {
                errors.push(`${at}: DeviceCMYK colour under a ${intentSpace.trim()} OutputIntent without /DefaultCMYK (${STANDARD}).`);
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}
