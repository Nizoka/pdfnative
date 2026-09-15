/**
 * pdfnative — Embedded AcroForm default-resource font (v1.8.0)
 * =============================================================
 * Builds a **simple TrueType** font (ISO 32000-1 §9.6.3) for an AcroForm's
 * `/DR` and for its widget appearance streams, so a document can carry
 * interactive fields *and* a PDF/A conformance claim at the same time.
 *
 * Why a simple font rather than the Type0/Identity-H one the page text
 * uses: widget appearance streams write byte strings (`(text) Tj`) against
 * the resource name `/Helv`. A Type0 font would read those bytes as 2-byte
 * CIDs and render garbage, so the `/DR` font has to be a byte-addressed
 * simple font with `/WinAnsiEncoding` — which is also what real-world
 * archival forms carry. The appearance-stream generator is untouched.
 *
 * Before this, `/DR` held an unembedded base-14 Helvetica, which ISO 19005
 * §6.2.11.4.1 forbids: veraPDF rejected every PDF/A document containing a
 * form, and the only workaround was to flatten the form, defeating the
 * point of an archival interactive document (issue #74).
 *
 * @module core/pdf-form-font
 */

import type { FontData, FontEntry } from '../types/pdf-types.js';
import { getDecodedFontBytes } from '../fonts/font-loader.js';
import { subsetTTF } from '../fonts/font-subsetter.js';

/** First code point addressable through `/WinAnsiEncoding` in a form field. */
const FIRST_CHAR = 32;
/** Last code point of the WinAnsi range. */
const LAST_CHAR = 255;

/** Number of PDF objects {@link buildFormFontObjects} emits. */
export const FORM_FONT_OBJ_COUNT = 3;

/**
 * Code points a font must cover to be usable as a form's default resource.
 * Deliberately minimal — a field value is arbitrary user text, but a font
 * that cannot render basic Latin is not a credible default.
 */
const REQUIRED_COVERAGE = [0x20, 0x30, 0x41, 0x61] as const;

/**
 * Pick the registered font to embed in an AcroForm's `/DR`, or `null` when
 * none is suitable.
 *
 * Prefers an explicitly registered `latin` font, then any entry whose cmap
 * covers basic Latin. Returning `null` keeps the historical unembedded
 * base-14 behaviour, which is correct for non-PDF/A documents.
 */
export function selectFormFont(fontEntries: readonly FontEntry[]): FontData | null {
    const covers = (fd: FontData): boolean => REQUIRED_COVERAGE.every(cp => (fd.cmap[cp] ?? 0) > 0);
    const latin = fontEntries.find(fe => fe.lang === 'latin' && covers(fe.fontData));
    if (latin) return latin.fontData;
    const any = fontEntries.find(fe => covers(fe.fontData));
    return any ? any.fontData : null;
}

/**
 * A deterministic 6-uppercase-letter subset tag (ISO 32000-1 §9.6.4).
 *
 * Required because the embedded program is a subset: a conforming reader
 * must be able to tell two different subsets of the same face apart. Derived
 * from the glyph set so repeated builds of the same document keep producing
 * identical bytes.
 */
function subsetTag(gids: readonly number[], fontName: string): string {
    // FNV-1a over the glyph set plus the face name.
    let h = 0x811c9dc5;
    const mix = (n: number): void => {
        h ^= n & 0xff;
        h = Math.imul(h, 0x01000193) >>> 0;
    };
    for (const gid of gids) { mix(gid); mix(gid >> 8); }
    for (let i = 0; i < fontName.length; i++) mix(fontName.charCodeAt(i));

    let tag = '';
    let v = h >>> 0;
    for (let i = 0; i < 6; i++) {
        tag += String.fromCharCode(65 + (v % 26));
        v = Math.floor(v / 26) + 7;
    }
    return tag;
}

/** The three object bodies making up an embedded simple TrueType font. */
export interface FormFontObjects {
    /** `/Type /Font /Subtype /TrueType …` — referenced from `/DR` and each `/Resources`. */
    readonly fontDict: string;
    /** `/Type /FontDescriptor …`, emitted at `fontObjNum + 1`. */
    readonly descriptorDict: string;
    /** Raw TTF program for the `/FontFile2` stream, emitted at `fontObjNum + 2`. */
    readonly fontFile: string;
}

/**
 * Build the embedded `/DR` font for an AcroForm.
 *
 * Emits three consecutive objects starting at `fontObjNum`: the font
 * dictionary, its descriptor, and the subsetted TrueType program.
 *
 * @param fd - Registered font to embed, from {@link selectFormFont}.
 * @param fontObjNum - Object number of the font dictionary itself.
 * @param toUnicodeObjNum - Object number of a `/ToUnicode` CMap to reference,
 *   or `undefined`. WinAnsi is a standard encoding so extraction works
 *   without it, but PDF/A-2u and -3u want the mapping stated explicitly.
 */
export function buildFormFontObjects(
    fd: FontData,
    fontObjNum: number,
    toUnicodeObjNum?: number,
): FormFontObjects {
    const upem = fd.metrics.unitsPerEm || 1000;
    const scale = 1000 / upem;

    // Glyphs for the WinAnsi range the appearance streams can address.
    const gids: number[] = [];
    const widths: number[] = [];
    for (let cp = FIRST_CHAR; cp <= LAST_CHAR; cp++) {
        const gid = fd.cmap[cp] ?? 0;
        if (gid > 0) gids.push(gid);
        const advance = gid > 0 ? (fd.widths[gid] ?? fd.defaultWidth) : 0;
        widths.push(Math.round(advance * scale));
    }
    // Glyph 0 (.notdef) must survive subsetting.
    const usedGids = new Set<number>([0, ...gids]);

    const fontFile = subsetTTF(getDecodedFontBytes(fd), usedGids);

    const cleanName = fd.fontName.replace(/[^A-Za-z0-9-]/g, '');
    const baseFont = `/${subsetTag(gids, cleanName)}+${cleanName}`;
    const fm = fd.metrics;
    const toUni = toUnicodeObjNum !== undefined ? ` /ToUnicode ${toUnicodeObjNum} 0 R` : '';

    const fontDict =
        `<< /Type /Font /Subtype /TrueType /BaseFont ${baseFont} `
        + `/FirstChar ${FIRST_CHAR} /LastChar ${LAST_CHAR} `
        + `/Widths [${widths.join(' ')}] `
        + `/FontDescriptor ${fontObjNum + 1} 0 R `
        + `/Encoding /WinAnsiEncoding${toUni} >>`;

    // Flags bit 6 (value 32) — nonsymbolic. A font used with a standard
    // encoding must NOT be flagged symbolic (ISO 32000-1 Table 123), which
    // is the mistake that makes readers ignore /WinAnsiEncoding.
    const descriptorDict =
        `<< /Type /FontDescriptor /FontName ${baseFont} `
        + `/Flags 32 `
        + `/FontBBox [${fm.bbox.join(' ')}] `
        + `/ItalicAngle 0 `
        + `/Ascent ${fm.ascent} `
        + `/Descent ${fm.descent} `
        + `/CapHeight ${fm.capHeight} `
        + `/StemV ${fm.stemV} `
        + `/MissingWidth 0 `
        + `/FontFile2 ${fontObjNum + 2} 0 R >>`;

    return { fontDict, descriptorDict, fontFile };
}
