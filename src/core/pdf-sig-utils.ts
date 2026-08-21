/**
 * pdfnative — Signature Enumeration Utilities (v1.7.0)
 * =====================================================
 * Read-only inspection of the signature fields in a PDF: which signatures
 * exist, their `/SubFilter`, their `/ByteRange`, the raw `/Contents` value
 * (zero padding included — exactly the bytes the /VRI key hashes), and
 * whether each entry is a document timestamp or a still-unsigned
 * placeholder. Foundation for the LTV pipeline (`addValidationInfo`,
 * `addDocumentTimestamp`) and useful public API on its own.
 *
 * This module never verifies signatures — see docs/guides/signatures.md
 * for the verification story.
 */

import { openPdf, type PdfReader } from '../parser/pdf-reader.js';
import {
    isDict, isArray, isRef, isName,
    type PdfDict, type PdfValue,
} from '../parser/pdf-object-parser.js';

/** One signature field entry, in AcroForm /Fields order. */
export interface PdfSignatureInfo {
    /** The widget's `/T` field name, when present. */
    readonly fieldName?: string;
    /** `/SubFilter` — e.g. `'adbe.pkcs7.detached'`, `'ETSI.CAdES.detached'`, `'ETSI.RFC3161'`. */
    readonly subFilter: string;
    /** `/ByteRange` offsets (empty for a placeholder that was never signed). */
    readonly byteRange: readonly number[];
    /**
     * The full decoded `/Contents` value INCLUDING trailing zero padding —
     * the exact byte string whose SHA-1 (uppercase hex) keys the /VRI
     * dictionary (Adobe convention).
     */
    readonly contents: Uint8Array;
    /** True for `/Type /DocTimeStamp` entries (ISO 32000-2 §12.8.5). */
    readonly isDocTimestamp: boolean;
    /** True when the entry is an UNSIGNED placeholder (all-zero /Contents + zero ByteRange). */
    readonly isPlaceholder: boolean;
    /** Object number of the /Sig dictionary. */
    readonly sigObjNum: number;
}

/** @internal — an unsigned signature field with its /Sig object's byte offset. */
export interface UnsignedSigField {
    readonly fieldName: string;
    readonly objOffset: number;
}

function resolve(reader: PdfReader, val: PdfValue | undefined): PdfValue | undefined {
    if (val === undefined) return undefined;
    if (isRef(val)) return reader.getObject(val.num) ?? undefined;
    return val;
}

interface SigFieldEntry {
    readonly fieldName?: string;
    readonly sigDict: PdfDict;
    readonly sigObjNum: number;
}

/** Walk the AcroForm field tree and yield every /FT /Sig field with a /V. */
function collectSigFields(reader: PdfReader): SigFieldEntry[] {
    const out: SigFieldEntry[] = [];
    const catalog = reader.getCatalog();
    const acroForm = resolve(reader, catalog.get('AcroForm'));
    if (!acroForm || !isDict(acroForm)) return out;
    const fields = resolve(reader, acroForm.get('Fields'));
    if (!fields || !isArray(fields)) return out;

    const visit = (fieldVal: PdfValue): void => {
        const field = resolve(reader, fieldVal);
        if (!field || !isDict(field)) return;
        const ft = field.get('FT');
        if (isName(ft) && ft.value === 'Sig') {
            const vRef = field.get('V');
            if (isRef(vRef)) {
                const sig = reader.getObject(vRef.num);
                if (sig && isDict(sig)) {
                    const t = field.get('T');
                    out.push({
                        fieldName: typeof t === 'string' ? t : undefined,
                        sigDict: sig,
                        sigObjNum: vRef.num,
                    });
                }
            }
        }
        const kids = field.get('Kids');
        if (isArray(kids)) for (const kid of kids) visit(kid);
    };
    for (const f of fields) visit(f);
    return out;
}

/**
 * List every signature field in the document, in AcroForm order —
 * signed signatures, document timestamps, and unsigned placeholders.
 *
 * @since 1.7.0
 */
export function listSignatures(pdfBytes: Uint8Array): readonly PdfSignatureInfo[] {
    const reader = openPdf(pdfBytes);
    return collectSigFields(reader).map(({ fieldName, sigDict, sigObjNum }) => {
        const subFilterVal = sigDict.get('SubFilter');
        const subFilter = isName(subFilterVal) ? subFilterVal.value : '';
        const typeVal = sigDict.get('Type');
        const isDocTimestamp = isName(typeVal) && typeVal.value === 'DocTimeStamp';

        const brVal = sigDict.get('ByteRange');
        const byteRange: number[] = [];
        if (isArray(brVal)) {
            for (const v of brVal) if (typeof v === 'number') byteRange.push(v);
        }

        const contentsVal = sigDict.get('Contents');
        let contents = new Uint8Array(0);
        if (typeof contentsVal === 'string') {
            contents = new Uint8Array(contentsVal.length);
            for (let i = 0; i < contentsVal.length; i++) contents[i] = contentsVal.charCodeAt(i) & 0xFF;
        }

        // An unsigned placeholder still carries the all-zero ByteRange
        // literal (parsed as [0, 0, 0, 0]) and an all-zero /Contents.
        const isPlaceholder = byteRange.length === 4 && byteRange[1] === 0 && byteRange[2] === 0
            && byteRange[3] === 0;

        const info: PdfSignatureInfo = fieldName !== undefined
            ? { fieldName, subFilter, byteRange, contents, isDocTimestamp, isPlaceholder, sigObjNum }
            : { subFilter, byteRange, contents, isDocTimestamp, isPlaceholder, sigObjNum };
        return info;
    });
}

/**
 * Unsigned signature fields with their /Sig object byte offsets — used by
 * `signPdfBytes` to map a `fieldName` selector onto the matching byte-level
 * placeholder. @internal
 */
export function listUnsignedSigFields(pdfBytes: Uint8Array): UnsignedSigField[] {
    const reader = openPdf(pdfBytes);
    const out: UnsignedSigField[] = [];
    for (const { fieldName, sigDict, sigObjNum } of collectSigFields(reader)) {
        const brVal = sigDict.get('ByteRange');
        const unsigned = isArray(brVal)
            && brVal.length === 4
            && brVal.every(v => typeof v === 'number')
            && (brVal as number[])[1] === 0 && (brVal as number[])[2] === 0 && (brVal as number[])[3] === 0;
        if (!unsigned) continue;
        const entry = reader.xref.entries.get(sigObjNum);
        if (!entry || entry.type !== 1) continue;
        out.push({ fieldName: fieldName ?? `(object ${sigObjNum})`, objOffset: entry.offset });
    }
    return out;
}
