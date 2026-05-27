/**
 * pdfnative — Signature Placeholder Injector
 * ============================================
 * Inject an AcroForm + invisible signature widget placeholder into an
 * existing PDF via incremental update (ISO 32000-1 §7.5.6, §12.7.4.5,
 * §12.8). The resulting PDF can be fed straight to
 * {@link signPdfBytes} without any further preparation.
 *
 * Closes issue [#45](https://github.com/Nizoka/pdfnative/issues/45) —
 * removes the need for downstream tooling (pdfnative-cli) to ship a
 * local placeholder injector that duplicates the byte layout dictated
 * by `BYTERANGE_PLACEHOLDER` and `buildSigDict()` in
 * [pdf-signature.ts](./pdf-signature.ts).
 */

import { openPdf, type PdfReader } from '../parser/pdf-reader.js';
import { createModifier } from '../parser/pdf-modifier.js';
import {
    isDict, isArray, isRef, isName, dictGetDict, dictGetArray, dictGetRef,
    type PdfDict, type PdfValue, type PdfRef,
} from '../parser/pdf-object-parser.js';
import { buildSigDict } from './pdf-signature.js';

/**
 * Options for {@link addSignaturePlaceholder}.
 */
export interface AddSignaturePlaceholderOptions {
    /**
     * Reserved bytes for the future CMS blob. The on-disk
     * `/Contents` hex string will be twice this size.
     *
     * @default 16384
     */
    readonly placeholderBytes?: number;

    /**
     * `/T` field name on the signature widget. Must be unique across
     * the AcroForm `/Fields` array — throws on collision with an
     * existing non-signature field.
     *
     * @default 'Signature1'
     */
    readonly fieldName?: string;

    /**
     * Page index (0-based) to attach the (invisible) widget to.
     *
     * @default 0
     */
    readonly pageIndex?: number;

    /**
     * `/Rect` for the widget annotation. `[0, 0, 0, 0]` makes the
     * signature invisible — the default. Pass explicit coordinates if
     * you want a visible signature appearance.
     *
     * @default [0, 0, 0, 0]
     */
    readonly rect?: readonly [number, number, number, number];
}

/**
 * Inject an AcroForm + signature widget placeholder into an existing
 * PDF via incremental update. Returns a NEW byte array. Idempotent:
 * if the PDF already carries a `/FT /Sig` widget, the input is
 * returned unchanged.
 *
 * @example
 * ```ts
 * import { buildDocumentPDFBytes, addSignaturePlaceholder, signPdfBytes } from 'pdfnative';
 *
 * const unsigned   = buildDocumentPDFBytes(params);
 * const placeheld  = addSignaturePlaceholder(unsigned, { fieldName: 'Author' });
 * const signed     = await signPdfBytes(placeheld, { privateKey, certificate });
 * ```
 */
export function addSignaturePlaceholder(
    pdfBytes: Uint8Array,
    options: AddSignaturePlaceholderOptions = {},
): Uint8Array {
    const placeholderBytes = options.placeholderBytes ?? 16384;
    const fieldName = options.fieldName ?? 'Signature1';
    const pageIndex = options.pageIndex ?? 0;
    const rect = options.rect ?? [0, 0, 0, 0] as const;

    if (placeholderBytes <= 0 || placeholderBytes > 1_048_576) {
        throw new Error(
            `addSignaturePlaceholder: placeholderBytes must be in (0, 1048576], got ${placeholderBytes}`,
        );
    }
    if (!/^[A-Za-z0-9_.\- ]{1,127}$/.test(fieldName)) {
        throw new Error(
            `addSignaturePlaceholder: fieldName must match [A-Za-z0-9_.\\- ]{1,127}, got ${JSON.stringify(fieldName)}`,
        );
    }

    const reader = openPdf(pdfBytes);

    if (reader.trailer.has('Encrypt')) {
        throw new Error(
            'addSignaturePlaceholder: encrypted PDFs are not supported in v1.2. ' +
            'Decrypt the document first, or build it without encryption.',
        );
    }

    // Idempotency + name-collision detection.
    const catalog = reader.getCatalog();
    const existingAcroForm = resolveDict(reader, catalog, 'AcroForm');
    if (existingAcroForm) {
        const fields = resolveArray(reader, existingAcroForm, 'Fields');
        if (fields) {
            for (const fieldRef of fields) {
                const field = resolveValue(reader, fieldRef);
                if (!field || !isDict(field)) continue;
                const ft = field.get('FT');
                if (isName(ft) && ft.value === 'Sig') {
                    return pdfBytes;
                }
                const t = field.get('T');
                if (typeof t === 'string' && t === fieldName) {
                    throw new Error(
                        `addSignaturePlaceholder: fieldName "${fieldName}" collides with an existing ` +
                        'non-signature AcroForm field. Pass a different fieldName option.',
                    );
                }
            }
        }
    }

    const pages = reader.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
        throw new Error(
            `addSignaturePlaceholder: pageIndex ${pageIndex} out of range [0, ${pages.length}).`,
        );
    }
    const pageDict = pages[pageIndex];
    const pageRef = findPageRef(reader, pageIndex);
    if (!pageRef) {
        throw new Error(`addSignaturePlaceholder: cannot resolve indirect ref for page ${pageIndex}.`);
    }

    const modifier = createModifier(reader);

    // 1) Sig dictionary — emitted verbatim so the /Contents <00…> and
    //    /ByteRange [0 …] placeholders are byte-identical to what
    //    signPdfBytes() expects to patch.
    const sigBody = buildSigDict({}, placeholderBytes);
    const sigObjNum = modifier.addRawObject(sigBody);
    const sigRef: PdfRef = { type: 'ref', num: sigObjNum, gen: 0 };

    // 2) Widget annotation. /F 132 = Print(4) | Locked(128).
    const widgetDict: PdfDict = new Map<string, PdfValue>([
        ['Type', mkName('Annot')],
        ['Subtype', mkName('Widget')],
        ['FT', mkName('Sig')],
        ['T', fieldName],
        ['Rect', [rect[0], rect[1], rect[2], rect[3]]],
        ['F', 132],
        ['P', pageRef],
        ['V', sigRef],
    ]);
    const widgetObjNum = modifier.addObject(widgetDict);
    const widgetRef: PdfRef = { type: 'ref', num: widgetObjNum, gen: 0 };

    // 3) AcroForm dict — merge with existing or create fresh.
    let acroFormFields: PdfValue[] = [widgetRef];
    let acroFormSigFlags = 3;
    let acroFormDA: string | undefined;
    let acroFormDR: PdfValue | undefined;
    if (existingAcroForm) {
        const fields = resolveArray(reader, existingAcroForm, 'Fields') ?? [];
        acroFormFields = [...fields, widgetRef];
        const sf = existingAcroForm.get('SigFlags');
        if (typeof sf === 'number') acroFormSigFlags = sf | 3;
        const da = existingAcroForm.get('DA');
        if (typeof da === 'string') acroFormDA = da;
        const dr = existingAcroForm.get('DR');
        if (dr !== undefined) acroFormDR = dr;
    }
    const acroForm: PdfDict = new Map<string, PdfValue>([
        ['Fields', acroFormFields],
        ['SigFlags', acroFormSigFlags],
    ]);
    if (acroFormDA !== undefined) acroForm.set('DA', acroFormDA);
    if (acroFormDR !== undefined) acroForm.set('DR', acroFormDR);
    const acroFormObjNum = modifier.addObject(acroForm);
    const acroFormRef: PdfRef = { type: 'ref', num: acroFormObjNum, gen: 0 };

    // 4) Re-issue the page with /Annots including the widget ref.
    const newPage: PdfDict = new Map(pageDict);
    const existingAnnots = resolveArray(reader, pageDict, 'Annots') ?? [];
    newPage.set('Annots', [...existingAnnots, widgetRef]);
    modifier.setObject(pageRef.num, newPage);

    // 5) Re-issue the catalog with /AcroForm pointing at the new ref.
    const newCatalog: PdfDict = new Map(catalog);
    newCatalog.set('AcroForm', acroFormRef);
    const rootRef = reader.trailer.get('Root');
    if (!isRef(rootRef)) {
        throw new Error('addSignaturePlaceholder: trailer /Root is not an indirect reference.');
    }
    modifier.setObject(rootRef.num, newCatalog);

    return modifier.save();
}

// ── Helpers ──────────────────────────────────────────────────────────

function mkName(value: string): PdfValue {
    return { type: 'name', value };
}

function resolveValue(reader: PdfReader, val: PdfValue | undefined): PdfValue | undefined {
    if (val === undefined) return undefined;
    if (isRef(val)) {
        const obj = reader.getObject(val.num);
        return obj ?? undefined;
    }
    return val;
}

function resolveDict(reader: PdfReader, dict: PdfDict, key: string): PdfDict | undefined {
    const direct = dictGetDict(dict, key);
    if (direct) return direct;
    const ref = dictGetRef(dict, key);
    if (!ref) return undefined;
    const resolved = reader.getObject(ref.num);
    return resolved && isDict(resolved) ? resolved : undefined;
}

function resolveArray(reader: PdfReader, dict: PdfDict, key: string): PdfValue[] | undefined {
    const direct = dictGetArray(dict, key);
    if (direct) return direct;
    const ref = dictGetRef(dict, key);
    if (!ref) return undefined;
    const resolved = reader.getObject(ref.num);
    return resolved !== null && resolved !== undefined && isArray(resolved) ? resolved : undefined;
}

function findPageRef(reader: PdfReader, pageIndex: number): PdfRef | null {
    const catalog = reader.getCatalog();
    const pagesRef = catalog.get('Pages');
    if (!isRef(pagesRef)) return null;
    const state = { idx: 0, ref: null as PdfRef | null, target: pageIndex };
    walkPageTree(reader, pagesRef, state);
    return state.ref;
}

function walkPageTree(
    reader: PdfReader,
    nodeRef: PdfRef,
    state: { idx: number; ref: PdfRef | null; target: number },
): void {
    if (state.ref) return;
    const node = reader.getObject(nodeRef.num);
    if (!node || !isDict(node)) return;
    const typeName = node.get('Type');
    const isLeaf = isName(typeName) && typeName.value === 'Page';
    if (isLeaf) {
        if (state.idx === state.target) state.ref = nodeRef;
        state.idx++;
        return;
    }
    const kids = node.get('Kids');
    if (!isArray(kids)) return;
    for (const kid of kids) {
        if (!isRef(kid)) continue;
        walkPageTree(reader, kid, state);
        if (state.ref) return;
    }
}
