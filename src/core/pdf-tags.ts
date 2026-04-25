/**
 * pdfnative — Tagged PDF & PDF/A Support
 * ========================================
 * Structure tree, marked content operators, XMP metadata, and OutputIntent
 * for PDF/UA accessibility and PDF/A archival compliance.
 *
 * ISO 14289-1 (PDF/UA-1): logical reading order via structure tree
 * ISO 19005-1 (PDF/A-1b): archival with mandatory embedded fonts + XMP
 * ISO 32000-1 §14.7: structure tree and marked content
 * ISO 32000-1 §14.8: tagged PDF conventions
 */

import type { PdfAttachment } from '../types/pdf-types.js';

// ── Marked Content Operators ─────────────────────────────────────────

/**
 * Wrap content stream operators in a /Span marked content sequence
 * with /ActualText for text extraction fidelity.
 *
 * @param content - PDF content stream operators to wrap
 * @param actualText - Original Unicode text for extraction
 * @param mcid - Marked content identifier (links to structure tree)
 * @returns Wrapped content stream with BMC...EMC
 */
export function wrapSpan(content: string, actualText: string, mcid: number): string {
    const escaped = escapePdfUtf16(actualText);
    return `/Span << /MCID ${mcid} /ActualText ${escaped} >> BDC\n${content}\nEMC`;
}

/**
 * Wrap content in a generic marked content sequence (no ActualText).
 *
 * @param content - PDF content stream operators to wrap
 * @param tag - Structure tag name (e.g. 'P', 'Table')
 * @param mcid - Marked content identifier
 * @returns Wrapped content stream with BDC/EMC
 */
export function wrapMarkedContent(content: string, tag: string, mcid: number): string {
    return `/${tag} << /MCID ${mcid} >> BDC\n${content}\nEMC`;
}

/**
 * Escape a Unicode string as a PDF UTF-16BE hex string with BOM.
 * ISO 32000-1 §7.9.2.2: text strings may use UTF-16BE with 0xFEFF BOM.
 *
 * @param str - Input Unicode string
 * @returns PDF hex string with FEFF BOM prefix, e.g. '<FEFF0048006F>'
 */
export function escapePdfUtf16(str: string): string {
    if (!str) return '<FEFF>';
    let hex = 'FEFF'; // BOM
    for (let i = 0; i < str.length; i++) {
        const cp = str.codePointAt(i) ?? 0;
        if (cp > 0xFFFF) {
            // Surrogate pair for supplementary planes
            const hi = 0xD800 + ((cp - 0x10000) >> 10);
            const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
            hex += hi.toString(16).padStart(4, '0').toUpperCase();
            hex += lo.toString(16).padStart(4, '0').toUpperCase();
            i++; // skip low surrogate in JS string
        } else {
            hex += cp.toString(16).padStart(4, '0').toUpperCase();
        }
    }
    return `<${hex}>`;
}

// ── Structure Tree ───────────────────────────────────────────────────

/**
 * A structure element node in the tagged PDF structure tree.
 */
export interface StructElement {
    readonly type: string;  // /Document, /Table, /TR, /TH, /TD, /P, /Span, /Figure
    readonly children: (StructElement | MCRef)[];
    objNum?: number;
}

/**
 * A marked content reference — links a structure element to a
 * marked content sequence in a page's content stream.
 */
export interface MCRef {
    readonly mcid: number;
    readonly pageObjNum: number;
}

/**
 * MCID allocator — assigns sequential IDs per page for marked content.
 * MCIDs restart at 0 for each page (ISO 32000-1 §14.7.4.4).
 *
 * @returns Allocator with next(pageObjNum) and getPageMCIDs() methods
 */
export function createMCIDAllocator(): {
    next(pageObjNum: number): number;
    getPageMCIDs(): Map<number, number[]>;
} {
    const pageCounters = new Map<number, number>();
    const pageMCIDs = new Map<number, number[]>();

    return {
        next(pageObjNum: number): number {
            const counter = pageCounters.get(pageObjNum) ?? 0;
            pageCounters.set(pageObjNum, counter + 1);
            const list = pageMCIDs.get(pageObjNum);
            if (list) list.push(counter);
            else pageMCIDs.set(pageObjNum, [counter]);
            return counter;
        },
        getPageMCIDs() { return pageMCIDs; },
    };
}

/**
 * Build the PDF objects for a structure tree.
 * Returns an array of [objNum, content] pairs to emit.
 *
 * Structure (ISO 32000-1 §14.7.2):
 *   StructTreeRoot → Document → [Table → TR → [TH|TD] ...] + [P] ...
 *
 * ParentTree (ISO 32000-1 §14.7.4.4):
 *   NumberTree keyed by /StructParents value → array of struct element refs
 *   indexed by MCID within that page.
 *
 * @param root - Root structure element (/Document)
 * @param startObjNum - First available object number
 * @param pageObjToStructParents - Map from page object number to /StructParents value
 * @returns { objects, structTreeRootObjNum, parentTreeObjNum }
 */
export function buildStructureTree(
    root: StructElement,
    startObjNum: number,
    pageObjToStructParents?: ReadonlyMap<number, number>,
): { objects: [number, string][]; structTreeRootObjNum: number; parentTreeObjNum: number; totalObjects: number } {
    const objects: [number, string][] = [];
    let nextObj = startObjNum;

    // StructTreeRoot
    const structTreeRootObjNum = nextObj++;
    const parentTreeObjNum = nextObj++;

    // Assign object numbers recursively
    root.objNum = nextObj++;
    assignObjNums(root);

    function assignObjNums(el: StructElement): void {
        for (const child of el.children) {
            if ('type' in child) {
                (child as StructElement).objNum = nextObj++;
                assignObjNums(child as StructElement);
            }
        }
    }

    // Build ParentTree number tree (ISO 32000-1 §14.7.4.4)
    // Collect MCRef→parent struct element mapping, grouped by page
    const pageParentMap = new Map<number, Map<number, number>>(); // pageObjNum → (mcid → structElemObjNum)
    collectPageParents(root, pageParentMap);

    function collectPageParents(el: StructElement, map: Map<number, Map<number, number>>): void {
        for (const child of el.children) {
            if ('type' in child) {
                collectPageParents(child as StructElement, map);
            } else {
                const ref = child as MCRef;
                let pageMap = map.get(ref.pageObjNum);
                if (!pageMap) {
                    pageMap = new Map();
                    map.set(ref.pageObjNum, pageMap);
                }
                pageMap.set(ref.mcid, el.objNum ?? 0);
            }
        }
    }

    if (pageObjToStructParents && pageObjToStructParents.size > 0) {
        // Per-page arrays: /Nums [structParents0 [ref ref ...] structParents1 [ref ref ...] ...]
        const numsParts: string[] = [];
        const sorted = [...pageObjToStructParents.entries()].sort((a, b) => a[1] - b[1]);
        for (const [pageObjNum, structParents] of sorted) {
            const pageMap = pageParentMap.get(pageObjNum);
            if (pageMap) {
                const maxMcid = Math.max(...pageMap.keys());
                const refs: string[] = [];
                for (let i = 0; i <= maxMcid; i++) {
                    refs.push(`${pageMap.get(i) ?? 0} 0 R`);
                }
                numsParts.push(`${structParents} [${refs.join(' ')}]`);
            }
        }
        objects.push([parentTreeObjNum,
            `<< /Type /NumberTree /Nums [${numsParts.join(' ')}] >>`]);
    } else {
        // Flat fallback for backward compatibility
        const parentEntries: [number, number][] = [];
        for (const [, pageMap] of pageParentMap) {
            for (const [mcid, objNum] of pageMap) {
                parentEntries.push([mcid, objNum]);
            }
        }
        parentEntries.sort((a, b) => a[0] - b[0]);
        const numsArray = parentEntries.map(([mcid, objNum]) => `${mcid} ${objNum} 0 R`).join(' ');
        objects.push([parentTreeObjNum,
            `<< /Type /NumberTree /Nums [${numsArray}] >>`]);
    }

    // StructTreeRoot object
    objects.push([structTreeRootObjNum,
        `<< /Type /StructTreeRoot /K ${root.objNum} 0 R /ParentTree ${parentTreeObjNum} 0 R >>`]);

    // Emit all structure elements
    emitElement(root, structTreeRootObjNum);

    function emitElement(el: StructElement, parentObjNum: number): void {
        const kids: string[] = [];
        for (const child of el.children) {
            if ('type' in child) {
                kids.push(`${(child as StructElement).objNum} 0 R`);
            } else {
                const ref = child as MCRef;
                kids.push(`<< /Type /MCR /MCID ${ref.mcid} /Pg ${ref.pageObjNum} 0 R >>`);
            }
        }
        const kArray = kids.length === 1 ? kids[0] : `[${kids.join(' ')}]`;
        const elObj = el.objNum ?? 0;
        objects.push([elObj,
            `<< /Type /StructElem /S /${el.type} /P ${parentObjNum} 0 R /K ${kArray} >>`]);

        for (const child of el.children) {
            if ('type' in child) {
                emitElement(child as StructElement, elObj);
            }
        }
    }

    return {
        objects,
        structTreeRootObjNum,
        parentTreeObjNum,
        totalObjects: nextObj - startObjNum,
    };
}

// ── XMP Metadata ─────────────────────────────────────────────────────

/**
 * Synchronized PDF + XMP metadata payload.
 *
 * Both `pdfDate` and `xmpDate` represent the same instant with the same
 * timezone offset. PDF/A validators (e.g. veraPDF rule 6.7.3 t1) require
 * `/Info CreationDate` and `xmp:CreateDate` to be byte-equivalent after
 * format-specific parsing — this helper guarantees that.
 */
export interface PdfMetadata {
    /** PDF date string per ISO 32000-1 §7.9.4: `D:YYYYMMDDHHmmSS+HH'mm'`. */
    readonly pdfDate: string;
    /** ISO 8601 date string: `YYYY-MM-DDTHH:mm:ss±HH:MM`. */
    readonly xmpDate: string;
}

/**
 * Build synchronized PDF + XMP date strings for a single instant.
 *
 * ISO 32000-1 §7.9.4 (PDF date format) and ISO 19005-1 §6.7.3 (PDF/A metadata
 * equivalence) require both formats to encode the same timezone offset.
 *
 * @param now - Date to format. Defaults to the current instant.
 * @returns `{ pdfDate, xmpDate }` representing the same moment.
 */
export function buildPdfMetadata(now: Date = new Date()): PdfMetadata {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad2(now.getMonth() + 1);
    const dd = pad2(now.getDate());
    const hh = pad2(now.getHours());
    const mi = pad2(now.getMinutes());
    const ss = pad2(now.getSeconds());

    // Timezone offset in minutes, west of UTC is positive in JS — invert sign for output.
    const tzMinutes = -now.getTimezoneOffset();
    const tzSign = tzMinutes >= 0 ? '+' : '-';
    const tzAbs = Math.abs(tzMinutes);
    const tzH = pad2(Math.floor(tzAbs / 60));
    const tzM = pad2(tzAbs % 60);

    const pdfDate = `D:${yyyy}${mm}${dd}${hh}${mi}${ss}${tzSign}${tzH}'${tzM}'`;
    const xmpDate = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${tzSign}${tzH}:${tzM}`;

    return { pdfDate, xmpDate };
}

/**
 * Build an XMP metadata packet for PDF/A compliance.
 * ISO 19005-1 (PDF/A-1b): pdfaid:part=1, conformance=B
 * ISO 19005-2 (PDF/A-2b): pdfaid:part=2, conformance=B
 * ISO 19005-2 (PDF/A-2u): pdfaid:part=2, conformance=U
 * ISO 19005-3 (PDF/A-3b): pdfaid:part=3, conformance=B
 *
 * @param title - Document title (must equal /Info /Title source string verbatim)
 * @param createDate - ISO 8601 formatted creation date (must equal /Info /CreationDate same instant)
 * @param pdfaPart - PDF/A part number (1, 2, or 3). Default: 2
 * @param pdfaConformance - PDF/A conformance level ('B' or 'U'). Default: 'B'
 * @param author - Optional document author (matches /Info /Author).
 * @returns XMP metadata XML string
 */
export function buildXMPMetadata(
    title: string,
    createDate: string,
    pdfaPart: number = 2,
    pdfaConformance: string = 'B',
    author?: string,
): string {
    const escapedTitle = escapeXml(title);
    // dc:creator describes the document author (per Dublin Core),
    // independent of pdf:Producer (the software). When no author is given,
    // omit dc:creator entirely so the validator does not try to compare it
    // against a missing /Info /Author entry.
    const lines: string[] = [
        '<?xpacket begin="\xEF\xBB\xBF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
        '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '  <rdf:Description rdf:about=""',
        '    xmlns:dc="http://purl.org/dc/elements/1.1/"',
        '    xmlns:pdf="http://ns.adobe.com/pdf/1.3/"',
        '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
        '    xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
        `   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapedTitle}</rdf:li></rdf:Alt></dc:title>`,
    ];
    if (author !== undefined && author !== '') {
        lines.push(`   <dc:creator><rdf:Seq><rdf:li>${escapeXml(author)}</rdf:li></rdf:Seq></dc:creator>`);
    }
    lines.push(
        '   <pdf:Producer>pdfnative</pdf:Producer>',
        `   <xmp:CreateDate>${createDate}</xmp:CreateDate>`,
        `   <xmp:ModifyDate>${createDate}</xmp:ModifyDate>`,
        `   <xmp:MetadataDate>${createDate}</xmp:MetadataDate>`,
        `   <pdfaid:part>${pdfaPart}</pdfaid:part>`,
        `   <pdfaid:conformance>${pdfaConformance}</pdfaid:conformance>`,
        '  </rdf:Description>',
        ' </rdf:RDF>',
        '</x:xmpmeta>',
        '<?xpacket end="w"?>',
    );
    return lines.join('\n');
}

/**
 * Build the sRGB OutputIntent dictionary content for PDF/A.
 * ISO 19005-1 §6.2.2: at least one OutputIntent required.
 *
 * @param iccStreamObjNum - Object number of the ICC profile stream
 * @param subtype - OutputIntent subtype (default: 'GTS_PDFA1')
 * @returns OutputIntent dictionary string
 */
export function buildOutputIntentDict(iccStreamObjNum: number, subtype: string = 'GTS_PDFA1'): string {
    return `<< /Type /OutputIntent /S /${subtype} ` +
        `/OutputConditionIdentifier (sRGB IEC61966-2.1) ` +
        `/RegistryName (http://www.color.org) ` +
        `/DestOutputProfile ${iccStreamObjNum} 0 R >>`;
}

/**
 * Build a minimal sRGB ICC profile stream for PDF/A compliance.
 * This is the smallest valid sRGB profile that satisfies PDF/A validators.
 * Per ISO 19005-1 §6.2.2, the ICC profile must be embedded.
 *
 * Returns a minimal sRGB ICC v2 profile with all 9 required tags for a
 * monitor class RGB profile:
 *   desc, wtpt, cprt, rXYZ, gXYZ, bXYZ, rTRC, gTRC, bTRC
 *
 * sRGB colorant values are D50-adapted per ICC PCS specification.
 *
 * @returns ICC profile as a binary string
 */
export function buildMinimalSRGBProfile(): string {
    // ── Tag layout ───────────────────────────────────────────────────
    // 9 tags, but rTRC/gTRC/bTRC share the same data → 7 unique data blocks
    const tagCount = 9;
    const tagTableSize = 4 + tagCount * 12; // 4 (count) + 9 × 12 = 112 bytes
    const dataStart = 128 + tagTableSize;   // 240

    const descSize = 36;     // 'desc' + reserved + len + "sRGB" + padding
    const wtptSize = 20;     // 'XYZ ' + reserved + X/Y/Z
    const cprtSize = 20;     // 'text' + reserved + "No CP" + 3 padding (4-byte aligned)
    const xyzSize = 20;      // 'XYZ ' + reserved + X/Y/Z (per colorant)
    const trcSize = 14;      // 'curv' + reserved + count(1) + gamma(u8.8) + 2 padding

    const descOffset = dataStart;              // 240
    const wtptOffset = descOffset + descSize;  // 276
    const cprtOffset = wtptOffset + wtptSize;  // 296
    const rXYZOffset = cprtOffset + cprtSize;  // 316
    const gXYZOffset = rXYZOffset + xyzSize;   // 336
    const bXYZOffset = gXYZOffset + xyzSize;   // 356
    const trcOffset  = bXYZOffset + xyzSize;   // 376
    const totalSize  = trcOffset + trcSize;    // 390

    // ── Header (128 bytes) ───────────────────────────────────────────
    const header = new Uint8Array(128);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, totalSize);                 // Profile size
    hv.setUint8(8, 2); hv.setUint8(9, 0x10);   // ICC version 2.1.0
    hv.setUint32(12, 0x6D6E7472);              // 'mntr' (monitor)
    hv.setUint32(16, 0x52474220);              // 'RGB '
    hv.setUint32(20, 0x58595A20);              // 'XYZ ' (PCS)
    hv.setUint16(24, 2025); hv.setUint16(26, 1); hv.setUint16(28, 1); // Date
    hv.setUint32(36, 0x61637370);              // 'acsp'
    hv.setUint32(40, 0x4D534654);              // 'MSFT' (primary platform)
    hv.setUint32(64, 0);                        // Rendering intent: perceptual
    // PCS illuminant D50: X=0.9505, Y=1.0000, Z=1.0890
    hv.setUint32(68, 0x0000F6D6);              // X
    hv.setUint32(72, 0x00010000);              // Y
    hv.setUint32(76, 0x0000D32D);              // Z

    // ── Tag table (112 bytes) ────────────────────────────────────────
    const tagTable = new Uint8Array(tagTableSize);
    const tv = new DataView(tagTable.buffer);
    tv.setUint32(0, tagCount);

    // Helper: write tag entry at index i
    const writeTag = (i: number, sig: number, off: number, sz: number) => {
        const base = 4 + i * 12;
        tv.setUint32(base, sig);
        tv.setUint32(base + 4, off);
        tv.setUint32(base + 8, sz);
    };

    writeTag(0, 0x64657363, descOffset, descSize);   // 'desc'
    writeTag(1, 0x77747074, wtptOffset, wtptSize);    // 'wtpt'
    writeTag(2, 0x63707274, cprtOffset, cprtSize);    // 'cprt'
    writeTag(3, 0x7258595A, rXYZOffset, xyzSize);     // 'rXYZ'
    writeTag(4, 0x6758595A, gXYZOffset, xyzSize);     // 'gXYZ'
    writeTag(5, 0x6258595A, bXYZOffset, xyzSize);     // 'bXYZ'
    writeTag(6, 0x72545243, trcOffset, trcSize);       // 'rTRC'
    writeTag(7, 0x67545243, trcOffset, trcSize);       // 'gTRC' (shared data)
    writeTag(8, 0x62545243, trcOffset, trcSize);       // 'bTRC' (shared data)

    // ── desc data ────────────────────────────────────────────────────
    const desc = new Uint8Array(descSize);
    const dv = new DataView(desc.buffer);
    dv.setUint32(0, 0x64657363);  // 'desc'
    dv.setUint32(8, 5);           // string length including null
    desc[12] = 0x73; desc[13] = 0x52; desc[14] = 0x47; desc[15] = 0x42; // "sRGB"

    // ── wtpt data: D50 white point ───────────────────────────────────
    const wtpt = new Uint8Array(wtptSize);
    const wv = new DataView(wtpt.buffer);
    wv.setUint32(0, 0x58595A20);  // 'XYZ '
    wv.setUint32(8, 0x0000F6D6);  // X (0.9505 in s15Fixed16)
    wv.setUint32(12, 0x00010000); // Y (1.0000)
    wv.setUint32(16, 0x0000D32D); // Z (1.0890)

    // ── cprt data ────────────────────────────────────────────────────
    const cprt = new Uint8Array(cprtSize);
    const cv = new DataView(cprt.buffer);
    cv.setUint32(0, 0x74657874);  // 'text'
    cprt[8] = 0x4E; cprt[9] = 0x6F; cprt[10] = 0x20; cprt[11] = 0x43; cprt[12] = 0x50; // "No CP"

    // ── rXYZ: Red colorant (D50-adapted sRGB) ───────────────────────
    // X=0.4361, Y=0.2225, Z=0.0139
    const rXYZ = new Uint8Array(xyzSize);
    const rv = new DataView(rXYZ.buffer);
    rv.setUint32(0, 0x58595A20);  // 'XYZ '
    rv.setUint32(8, 0x00006FA2);  // X (0.4361 → 28578)
    rv.setUint32(12, 0x000038F5); // Y (0.2225 → 14581)
    rv.setUint32(16, 0x00000391); // Z (0.0139 → 913)

    // ── gXYZ: Green colorant (D50-adapted sRGB) ─────────────────────
    // X=0.3851, Y=0.7169, Z=0.0971
    const gXYZ = new Uint8Array(xyzSize);
    const gv = new DataView(gXYZ.buffer);
    gv.setUint32(0, 0x58595A20);  // 'XYZ '
    gv.setUint32(8, 0x00006299);  // X (0.3851 → 25241)
    gv.setUint32(12, 0x0000B785); // Y (0.7169 → 46981)
    gv.setUint32(16, 0x000018DA); // Z (0.0971 → 6362)

    // ── bXYZ: Blue colorant (D50-adapted sRGB) ──────────────────────
    // X=0.1431, Y=0.0606, Z=0.7141
    const bXYZ = new Uint8Array(xyzSize);
    const bv = new DataView(bXYZ.buffer);
    bv.setUint32(0, 0x58595A20);  // 'XYZ '
    bv.setUint32(8, 0x000024A0);  // X (0.1431 → 9376)
    bv.setUint32(12, 0x00000F84); // Y (0.0606 → 3972)
    bv.setUint32(16, 0x0000B6CF); // Z (0.7141 → 46799)

    // ── TRC: sRGB gamma ≈2.2 (shared by r/g/b) ─────────────────────
    // curveType with count=1, gamma=2.2 as u8Fixed8 (0x0233)
    const trc = new Uint8Array(trcSize);
    const tcv = new DataView(trc.buffer);
    tcv.setUint32(0, 0x63757276);  // 'curv'
    tcv.setUint32(8, 1);           // count = 1 (gamma mode)
    tcv.setUint16(12, 0x0233);     // gamma 2.2 (u8Fixed8: 2 + 51/256)

    // ── Concatenate all parts ────────────────────────────────────────
    const parts = [header, tagTable, desc, wtpt, cprt, rXYZ, gXYZ, bXYZ, trc];
    let result = '';
    for (const part of parts) {
        for (let i = 0; i < part.length; i++) result += String.fromCharCode(part[i]);
    }
    return result;
}

// ── Helpers ──────────────────────────────────────────────────────────

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ── PDF/A Configuration ──────────────────────────────────────────────

/**
 * Resolved PDF/A configuration from the `tagged` layout option.
 */
export interface PdfAConfig {
    /** Whether tagged mode is enabled. */
    readonly enabled: boolean;
    /** PDF version string for header. */
    readonly pdfVersion: string;
    /** PDF/A part (1, 2, or 3). */
    readonly pdfaPart: number;
    /** PDF/A conformance ('B' or 'U'). */
    readonly pdfaConformance: string;
    /** OutputIntent /S name. */
    readonly outputIntentSubtype: string;
}

/**
 * Parse the `tagged` layout option into a resolved PDF/A configuration.
 *
 * @param tagged - The tagged option value (boolean, string, or undefined)
 * @returns Resolved configuration
 */
export function resolvePdfAConfig(tagged: boolean | string | undefined): PdfAConfig {
    if (!tagged) {
        return { enabled: false, pdfVersion: '1.4', pdfaPart: 1, pdfaConformance: 'B', outputIntentSubtype: 'GTS_PDFA1' };
    }
    if (tagged === 'pdfa1b') {
        return { enabled: true, pdfVersion: '1.4', pdfaPart: 1, pdfaConformance: 'B', outputIntentSubtype: 'GTS_PDFA1' };
    }
    if (tagged === 'pdfa2u') {
        return { enabled: true, pdfVersion: '1.7', pdfaPart: 2, pdfaConformance: 'U', outputIntentSubtype: 'GTS_PDFA1' };
    }
    if (tagged === 'pdfa3b') {
        return { enabled: true, pdfVersion: '1.7', pdfaPart: 3, pdfaConformance: 'B', outputIntentSubtype: 'GTS_PDFA1' };
    }
    // true or 'pdfa2b' → PDF/A-2b (default tagged mode)
    return { enabled: true, pdfVersion: '1.7', pdfaPart: 2, pdfaConformance: 'B', outputIntentSubtype: 'GTS_PDFA1' };
}

// ── PDF/A-3 Embedded Files (ISO 19005-3) ─────────────────────────────

/**
 * Result of building embedded file objects for PDF/A-3.
 */
export interface EmbeddedFilesResult {
    /** PDF objects as [objNum, content] pairs (EmbeddedFile streams + Filespec dicts). */
    readonly objects: ReadonlyArray<readonly [number, string]>;
    /** Binary stream data keyed by object number (for EmbeddedFile streams). */
    readonly streams: ReadonlyMap<number, string>;
    /** Filespec object numbers (for /AF array in catalog). */
    readonly filespecObjNums: readonly number[];
    /** Total number of objects created. */
    readonly totalObjects: number;
    /** /Names << /EmbeddedFiles << /Names [...] >> >> dictionary content for catalog. */
    readonly namesDict: string;
}

/**
 * Build PDF objects for embedded file attachments (PDF/A-3).
 *
 * For each attachment, creates:
 * 1. An /EmbeddedFile stream object (the file data)
 * 2. A /Filespec dictionary referencing the stream
 *
 * @param attachments - Array of file attachments
 * @param startObjNum - First available object number
 * @returns Objects, references, and catalog fragments
 */
export function buildEmbeddedFiles(attachments: readonly PdfAttachment[], startObjNum: number): EmbeddedFilesResult {
    const objects: Array<readonly [number, string]> = [];
    const streams = new Map<number, string>();
    const filespecObjNums: number[] = [];
    const namesEntries: string[] = [];
    let nextObj = startObjNum;

    for (const att of attachments) {
        const efObjNum = nextObj++;
        const fsObjNum = nextObj++;

        // Convert Uint8Array to binary string for stream
        let binaryStr = '';
        for (let i = 0; i < att.data.length; i++) binaryStr += String.fromCharCode(att.data[i]);

        // EmbeddedFile stream dictionary (content emitted via emitStreamObj)
        const efDict =
            `<< /Type /EmbeddedFile /Subtype /${escapePdfName(att.mimeType)} ` +
            `/Params << /Size ${att.data.length} >> ` +
            `/Length ${binaryStr.length}`;
        objects.push([efObjNum, efDict]);
        streams.set(efObjNum, binaryStr);

        // Filespec dictionary
        const relationship = att.relationship ?? 'Unspecified';
        const escapedFilename = escapePdfString(att.filename);
        const desc = att.description ? ` /Desc (${escapePdfString(att.description)})` : '';
        const fsDict =
            `<< /Type /Filespec /F (${escapedFilename}) /UF (${escapedFilename})` +
            ` /EF << /F ${efObjNum} 0 R /UF ${efObjNum} 0 R >>` +
            ` /AFRelationship /${relationship}${desc} >>`;
        objects.push([fsObjNum, fsDict]);
        filespecObjNums.push(fsObjNum);

        // Names dict entry: (filename) ref
        namesEntries.push(`(${escapedFilename}) ${fsObjNum} 0 R`);
    }

    const namesDict = `/Names << /EmbeddedFiles << /Names [${namesEntries.join(' ')}] >> >>`;

    return {
        objects,
        streams,
        filespecObjNums,
        totalObjects: nextObj - startObjNum,
        namesDict,
    };
}

/**
 * Validate attachments against PDF/A configuration.
 * Attachments are only allowed with PDF/A-3 (pdfaPart === 3).
 *
 * @param attachments - Attachments to validate
 * @param tagged - The tagged option value
 */
export function validateAttachments(attachments: readonly PdfAttachment[] | undefined, tagged: boolean | string | undefined): void {
    if (!attachments || attachments.length === 0) return;
    if (tagged !== 'pdfa3b') {
        throw new Error('File attachments require tagged: \'pdfa3b\' (PDF/A-3, ISO 19005-3)');
    }
    for (const att of attachments) {
        if (!att.filename || att.filename.length === 0) {
            throw new Error('Attachment filename must not be empty');
        }
        if (!att.mimeType || att.mimeType.length === 0) {
            throw new Error(`Attachment '${att.filename}' must have a mimeType`);
        }
        if (!att.data || att.data.length === 0) {
            throw new Error(`Attachment '${att.filename}' must have non-empty data`);
        }
    }
}

// ── PDF Name/String Escaping ─────────────────────────────────────────

/**
 * Escape a MIME type for use as a PDF name (replace / with #2F).
 */
function escapePdfName(mimeType: string): string {
    return mimeType.replace(/\//g, '#2F');
}

/**
 * Escape a string for use in PDF literal strings.
 */
function escapePdfString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
