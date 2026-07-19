/**
 * pdfnative — AcroForm fill & flatten (ISO 32000-1 §12.7)
 * ==========================================================
 * Read, fill, and flatten the interactive form fields of an **existing** PDF
 * (whether authored by pdfnative or a third party), via non-destructive
 * incremental update. Complements the form *builder* (`pdf-form.ts`), which
 * creates fields from scratch.
 *
 * - `readFormFields(bytes)` — enumerate the AcroForm field tree.
 * - `fillForm(bytes, values)` — set `/V`, regenerate `/AP` appearances.
 * - `flattenForm(bytes)` — stamp appearances into page content, drop fields.
 *
 * Appearance streams are Helvetica/WinAnsi and self-contained (own `/Resources`
 * `/Helv`), so filling never depends on the document's `/DR`.
 *
 * @since 1.6.0
 */

import { openPdf } from '../parser/pdf-reader.js';
import type { PdfReader } from '../parser/pdf-reader.js';
import { createModifier } from '../parser/pdf-modifier.js';
import {
    isRef, isName, isDict, isArray, isStream, dictGetName,
} from '../parser/pdf-object-parser.js';
import type { PdfValue, PdfDict, PdfRef, PdfArray } from '../parser/pdf-object-parser.js';
import { buildTextAppearance, buildDropdownAppearance, buildListboxAppearance } from './pdf-form.js';

// ── Errors ───────────────────────────────────────────────────────────

/** A named field was not found in the document. */
export class FormFieldNotFoundError extends Error {
    readonly code = 'FORM_FIELD_NOT_FOUND';
    constructor(name: string) {
        super(`pdfnative: form field "${name}" not found`);
        this.name = 'FormFieldNotFoundError';
    }
}

/** A supplied value has the wrong type for its field, or is not a valid option. */
export class FormValueTypeError extends Error {
    readonly code = 'FORM_VALUE_TYPE';
    constructor(message: string) {
        super(`pdfnative: ${message}`);
        this.name = 'FormValueTypeError';
    }
}

/** The field or document uses a feature fill/flatten does not support. */
export class FormUnsupportedError extends Error {
    readonly code = 'FORM_UNSUPPORTED';
    constructor(message: string) {
        super(`pdfnative: ${message}`);
        this.name = 'FormUnsupportedError';
    }
}

// ── Types ────────────────────────────────────────────────────────────

export type ParsedFieldType =
    | 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox'
    | 'button' | 'signature' | 'unknown';

/** A form field parsed from an existing document by {@link readFormFields}. */
export interface ParsedFormField {
    /** Fully-qualified field name (`/T` chain joined with `.`). */
    readonly name: string;
    /** Classified field type. */
    readonly type: ParsedFieldType;
    /** Current value (`/V`): text/choice string(s), checkbox/radio state, or null. */
    readonly value: string | readonly string[] | boolean | null;
    /** Whether the field is read-only (`/Ff` bit 1). */
    readonly readOnly: boolean;
    /** Whether the field is required (`/Ff` bit 2). */
    readonly required: boolean;
    /** Multiline text field (`/Ff` bit 13). */
    readonly multiline: boolean;
    /** Choice options (`/Opt`), as `{ export, label }`. */
    readonly options?: readonly { export: string; label: string }[];
    /** Maximum text length (`/MaxLen`). */
    readonly maxLen?: number;
    /** On-state name for a checkbox/radio widget, discovered from `/AP /N`. */
    readonly onState?: string;
    /** Widget placements. */
    readonly widgets: readonly { pageIndex: number; rect: readonly [number, number, number, number] }[];
    /** Object number of the terminal field dictionary. */
    readonly ref: number;
}

export type FormFillValue = string | boolean | readonly string[];

/** Options for {@link fillForm}. */
export interface FillFormOptions {
    /** Password for an encrypted source (rejected — see below). */
    readonly password?: string;
    /** Also flatten after filling. */
    readonly flatten?: boolean;
    /** Behaviour for value keys that match no field. Default `'throw'`. */
    readonly onUnknownField?: 'throw' | 'ignore';
    /**
     * Behaviour when a value contains characters outside WinAnsi (the
     * appearance font is Helvetica/WinAnsi). `'throw'` (default) rejects it;
     * `'needAppearances'` writes the value and sets `/NeedAppearances true` so
     * the viewer regenerates the appearance.
     */
    readonly nonWinAnsi?: 'throw' | 'needAppearances';
}

const FF_READONLY = 1 << 0;
const FF_REQUIRED = 1 << 1;
const FF_MULTILINE = 1 << 12;
const FF_PUSHBUTTON = 1 << 16;
const FF_RADIO = 1 << 15;
const FF_COMBO = 1 << 17;

// ── Field-tree parsing ───────────────────────────────────────────────

interface FieldNode {
    readonly ref: number;
    readonly gen: number;
    readonly dict: PdfDict;
    readonly name: string;
    readonly ft: string | undefined;
    readonly ff: number;
    readonly v: PdfValue;
    readonly opt: PdfValue;
    readonly maxLen: number | undefined;
    /** Widget dicts (may be the field itself, or its /Kids). */
    readonly widgets: { ref: number; gen: number; dict: PdfDict }[];
}

/** Map a widget object number → page index (0-based). */
function buildWidgetPageMap(reader: PdfReader): Map<number, number> {
    const map = new Map<number, number>();
    const pages = reader.getPages();
    for (let p = 0; p < pages.length; p++) {
        const annots = reader.resolveValue(pages[p].get('Annots') ?? null);
        if (!isArray(annots)) continue;
        for (const a of annots) {
            if (isRef(a)) map.set(a.num, p);
        }
    }
    return map;
}

function inherited(reader: PdfReader, dict: PdfDict, key: string, depth = 0): PdfValue | undefined {
    if (depth > 50) return undefined;
    const v = dict.get(key);
    if (v !== undefined) return v;
    const parent = reader.resolveValue(dict.get('Parent') ?? null);
    return isDict(parent) ? inherited(reader, parent, key, depth + 1) : undefined;
}

function collectFields(reader: PdfReader): FieldNode[] {
    const catalog = reader.getCatalog();
    const acro = reader.resolveValue(catalog.get('AcroForm') ?? null);
    if (!isDict(acro)) return [];
    const fields = reader.resolveValue(acro.get('Fields') ?? null);
    if (!isArray(fields)) return [];

    const out: FieldNode[] = [];
    const seen = new Set<number>();
    const walk = (ref: PdfValue, prefix: string, depth: number): void => {
        if (depth > 50 || !isRef(ref)) return;
        if (seen.has(ref.num)) return;
        seen.add(ref.num);
        const dict = reader.resolveValue(ref);
        if (!isDict(dict)) return;

        const localName = decodeText(dict.get('T'));
        const qname = localName !== undefined ? (prefix ? `${prefix}.${localName}` : localName) : prefix;

        const kids = reader.resolveValue(dict.get('Kids') ?? null);
        const kidRefs = isArray(kids) ? kids.filter(isRef) : [];
        // A node with kids that are themselves fields (have /T) is an
        // intermediate node; kids that are pure widgets (no /T) belong to
        // this terminal field.
        const kidDicts = kidRefs.map(k => ({ ref: k as PdfRef, dict: reader.resolveValue(k) }));
        const childFields = kidDicts.filter(k => isDict(k.dict) && k.dict.get('T') !== undefined);
        const widgetKids = kidDicts.filter(k => isDict(k.dict) && k.dict.get('T') === undefined);

        if (childFields.length > 0) {
            for (const c of childFields) walk(c.ref, qname, depth + 1);
            return;
        }

        // Terminal field. Widgets are either its /Kids or the field dict itself.
        const widgets = widgetKids.length > 0
            ? widgetKids.map(k => ({ ref: (k.ref as PdfRef).num, gen: (k.ref as PdfRef).gen, dict: k.dict as PdfDict }))
            : [{ ref: ref.num, gen: ref.gen, dict }];

        const ftVal = inherited(reader, dict, 'FT');
        const ffVal = inherited(reader, dict, 'Ff');
        out.push({
            ref: ref.num,
            gen: ref.gen,
            dict,
            name: qname,
            ft: isName(ftVal) ? ftVal.value : (typeof ftVal === 'string' ? ftVal : undefined),
            ff: typeof ffVal === 'number' ? ffVal : 0,
            v: inherited(reader, dict, 'V') ?? null,
            opt: inherited(reader, dict, 'Opt') ?? null,
            maxLen: typeof inherited(reader, dict, 'MaxLen') === 'number' ? inherited(reader, dict, 'MaxLen') as number : undefined,
            widgets,
        });
    };

    for (const f of fields) walk(f, '', 0);
    return out;
}

function classify(node: FieldNode): ParsedFieldType {
    switch (node.ft) {
        case 'Tx': return 'text';
        case 'Ch': return (node.ff & FF_COMBO) !== 0 ? 'dropdown' : 'listbox';
        case 'Sig': return 'signature';
        case 'Btn':
            if ((node.ff & FF_PUSHBUTTON) !== 0) return 'button';
            return (node.ff & FF_RADIO) !== 0 ? 'radio' : 'checkbox';
        default: return 'unknown';
    }
}

/** Decode a PDF text string value (`/T`, `/V`), handling UTF-16BE. */
function decodeText(v: PdfValue | undefined): string | undefined {
    if (typeof v !== 'string') return undefined;
    if (v.length >= 2 && v.charCodeAt(0) === 0xFE && v.charCodeAt(1) === 0xFF) {
        let out = '';
        for (let i = 2; i + 1 < v.length; i += 2) out += String.fromCharCode((v.charCodeAt(i) << 8) | v.charCodeAt(i + 1));
        return out;
    }
    return v;
}

/** Parse /Opt into { export, label } pairs (ISO 32000-1 §12.7.4.4). */
function parseOptions(reader: PdfReader, opt: PdfValue): { export: string; label: string }[] | undefined {
    const arr = reader.resolveValue(opt);
    if (!isArray(arr)) return undefined;
    const out: { export: string; label: string }[] = [];
    for (const entry of arr) {
        const e = reader.resolveValue(entry);
        if (typeof e === 'string') {
            const s = decodeText(e) ?? '';
            out.push({ export: s, label: s });
        } else if (isArray(e) && e.length >= 2 && typeof e[0] === 'string' && typeof e[1] === 'string') {
            out.push({ export: decodeText(e[0]) ?? '', label: decodeText(e[1]) ?? '' });
        }
    }
    return out.length > 0 ? out : undefined;
}

/** Discover a button widget's on-state name from its `/AP /N` keys. */
function onStateOf(reader: PdfReader, widgetDict: PdfDict): string | undefined {
    const ap = reader.resolveValue(widgetDict.get('AP') ?? null);
    if (!isDict(ap)) return undefined;
    const n = reader.resolveValue(ap.get('N') ?? null);
    if (!isDict(n)) return undefined;
    for (const key of n.keys()) {
        if (key !== 'Off') return key;
    }
    return undefined;
}

function rectOf(reader: PdfReader, dict: PdfDict): readonly [number, number, number, number] {
    const r = reader.resolveValue(dict.get('Rect') ?? null);
    if (isArray(r) && r.length === 4 && r.every(n => typeof n === 'number')) {
        return [r[0] as number, r[1] as number, r[2] as number, r[3] as number];
    }
    return [0, 0, 0, 0];
}

// ── Public: read ─────────────────────────────────────────────────────

/**
 * Enumerate the interactive form fields of an existing PDF.
 *
 * @param pdfBytes - The source PDF.
 * @param opts - `{ password }` for encrypted sources.
 */
export function readFormFields(pdfBytes: Uint8Array, opts?: { password?: string }): ParsedFormField[] {
    const reader = openPdf(pdfBytes, opts?.password !== undefined ? { password: opts.password } : undefined);
    const pageMap = buildWidgetPageMap(reader);
    const nodes = collectFields(reader);

    return nodes.map(node => {
        const type = classify(node);
        const options = parseOptions(reader, node.opt);
        const onState = (type === 'checkbox' || type === 'radio')
            ? onStateOf(reader, node.widgets[0].dict)
            : undefined;

        let value: ParsedFormField['value'] = null;
        const raw = reader.resolveValue(node.v);
        if (type === 'checkbox' || type === 'radio') {
            const state = isName(raw) ? raw.value : (typeof raw === 'string' ? raw : 'Off');
            value = state !== 'Off';
        } else if (type === 'listbox' && isArray(raw)) {
            value = raw.map(x => decodeText(x) ?? '').filter(Boolean);
        } else if (typeof raw === 'string') {
            value = decodeText(raw) ?? '';
        } else if (isName(raw)) {
            value = raw.value;
        }

        const widgets = node.widgets.map(w => ({
            pageIndex: pageMap.get(w.ref) ?? -1,
            rect: rectOf(reader, w.dict),
        }));

        return {
            name: node.name,
            type,
            value,
            readOnly: (node.ff & FF_READONLY) !== 0,
            required: (node.ff & FF_REQUIRED) !== 0,
            multiline: (node.ff & FF_MULTILINE) !== 0,
            options,
            maxLen: node.maxLen,
            onState,
            widgets,
            ref: node.ref,
        };
    });
}

// ── Appearance helpers ───────────────────────────────────────────────

const HELV = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

/** Build a self-contained Form XObject body for an appearance stream. */
function appearanceBody(w: number, h: number, content: string): string {
    const bytes = latin1Len(content);
    return `<< /Type /XObject /Subtype /Form /BBox [0 0 ${num(w)} ${num(h)}] ` +
        `/Resources << /Font << /Helv ${HELV} >> >> /Length ${bytes} >>\nstream\n${content}\nendstream`;
}

function latin1Len(s: string): number { return s.length; }
function num(n: number): string {
    return Math.round(n * 100) / 100 === Math.round(n) ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
}

/** Parse the font size from a `/DA` string (`… <size> Tf …`), default 12. */
function daFontSize(reader: PdfReader, node: FieldNode): number {
    const da = inherited(reader, node.dict, 'DA');
    if (typeof da === 'string') {
        const m = da.match(/([\d.]+)\s+Tf/);
        if (m) { const n = parseFloat(m[1]); if (Number.isFinite(n) && n > 0) return n; }
    }
    return 12;
}

function isWinAnsi(s: string): boolean {
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xFF) return false;
    return true;
}

// ── Public: fill ─────────────────────────────────────────────────────

/**
 * Fill the form fields of an existing PDF and return a new PDF (incremental
 * update — original bytes are preserved, so any existing signature stays valid
 * for its revision).
 *
 * @param pdfBytes - The source PDF.
 * @param values - Map of fully-qualified field name → value. Text/choice take a
 *                 string (list for multi-select listboxes); checkbox/radio take
 *                 a boolean or the export-state string.
 * @param opts - See {@link FillFormOptions}.
 * @throws {FormUnsupportedError} for encrypted/ signature fields.
 * @throws {FormFieldNotFoundError} for unknown names (unless `onUnknownField:'ignore'`).
 * @throws {FormValueTypeError} for type/option mismatches.
 */
export function fillForm(
    pdfBytes: Uint8Array,
    values: Record<string, FormFillValue>,
    opts?: FillFormOptions,
): Uint8Array {
    const reader = openPdf(pdfBytes, opts?.password !== undefined ? { password: opts.password } : undefined);
    if (reader.encryption) {
        throw new FormUnsupportedError(
            'filling encrypted PDFs is not supported — an incremental update would append plaintext objects to an encrypted file',
        );
    }

    const nodes = collectFields(reader);
    const byName = new Map(nodes.map(n => [n.name, n]));
    const modifier = createModifier(reader);
    let needAppearances = false;

    for (const [name, value] of Object.entries(values)) {
        const node = byName.get(name);
        if (!node) {
            if (opts?.onUnknownField === 'ignore') continue;
            throw new FormFieldNotFoundError(name);
        }
        const type = classify(node);
        if (type === 'signature') throw new FormUnsupportedError(`cannot fill signature field "${name}"`);
        if (type === 'button') throw new FormUnsupportedError(`cannot fill push-button field "${name}"`);

        switch (type) {
            case 'text': fillText(reader, modifier, node, value, opts, () => { needAppearances = true; }); break;
            case 'dropdown':
            case 'listbox': fillChoice(reader, modifier, node, type, value, () => { needAppearances = true; }); break;
            case 'checkbox':
            case 'radio': fillButton(reader, modifier, node, value); break;
            default: throw new FormUnsupportedError(`field "${name}" has an unsupported type`);
        }
    }

    if (needAppearances) setNeedAppearances(reader, modifier, true);

    const out = modifier.save();
    return opts?.flatten ? flattenForm(out) : out;
}

function fillText(
    reader: PdfReader, modifier: ReturnType<typeof createModifier>, node: FieldNode,
    value: FormFillValue, opts: FillFormOptions | undefined, markNeedAppearances: () => void,
): void {
    if (typeof value !== 'string') throw new FormValueTypeError(`text field "${node.name}" expects a string value`);
    const winAnsi = isWinAnsi(value);
    if (!winAnsi && opts?.nonWinAnsi !== 'needAppearances') {
        throw new FormValueTypeError(
            `value for "${node.name}" contains non-WinAnsi characters; pass { nonWinAnsi: 'needAppearances' } to defer appearance generation to the viewer`,
        );
    }

    const multiline = (node.ff & FF_MULTILINE) !== 0;
    // Set /V on the terminal field.
    const clone: PdfDict = new Map(node.dict);
    clone.set('V', value);

    if (winAnsi) {
        // Regenerate each widget's appearance.
        const apRefs: number[] = [];
        for (const w of node.widgets) {
            const rect = rectOf(reader, w.dict);
            const fontSize = daFontSize(reader, node);
            const content = buildTextAppearance(value, rect, fontSize, multiline);
            apRefs.push(modifier.addRawObject(appearanceBody(rect[2] - rect[0], rect[3] - rect[1], content)));
        }
        applyAppearance(reader, modifier, node, clone, apRefs);
    } else {
        markNeedAppearances();
        modifier.setObject(node.ref, clone);
    }
}

function fillChoice(
    reader: PdfReader, modifier: ReturnType<typeof createModifier>, node: FieldNode,
    type: ParsedFieldType, value: FormFillValue, markNeedAppearances: () => void,
): void {
    const options = parseOptions(reader, node.opt) ?? [];
    const selected: string[] = Array.isArray(value) ? [...value] : [String(value)];
    if (type === 'dropdown' && selected.length > 1) {
        throw new FormValueTypeError(`dropdown "${node.name}" accepts a single value`);
    }
    // Validate against options when present.
    const indices: number[] = [];
    for (const sel of selected) {
        const idx = options.findIndex(o => o.export === sel || o.label === sel);
        if (options.length > 0 && idx === -1) {
            throw new FormValueTypeError(`"${sel}" is not an option of "${node.name}"`);
        }
        if (idx >= 0) indices.push(idx);
    }

    const clone: PdfDict = new Map(node.dict);
    clone.set('V', selected.length === 1 ? selected[0] : selected);
    if (indices.length > 0) clone.set('I', indices.map(i => i));

    const display = selected[0] ?? '';
    if (isWinAnsi(display)) {
        const apRefs: number[] = [];
        for (const w of node.widgets) {
            const rect = rectOf(reader, w.dict);
            const fontSize = daFontSize(reader, node);
            const content = type === 'dropdown'
                ? buildDropdownAppearance(display, rect, fontSize)
                : buildListboxAppearance(display, options.map(o => o.label), rect, fontSize);
            apRefs.push(modifier.addRawObject(appearanceBody(rect[2] - rect[0], rect[3] - rect[1], content)));
        }
        applyAppearance(reader, modifier, node, clone, apRefs);
    } else {
        markNeedAppearances();
        modifier.setObject(node.ref, clone);
    }
}

function fillButton(
    reader: PdfReader, modifier: ReturnType<typeof createModifier>, node: FieldNode,
    value: FormFillValue,
): void {
    const type = classify(node);
    // Resolve the desired on-state name.
    let onName = 'Yes';
    const firstState = onStateOf(reader, node.widgets[0].dict);
    if (firstState) onName = firstState;
    let turnOn: boolean;
    let targetState = onName;
    if (typeof value === 'boolean') {
        turnOn = value;
    } else if (typeof value === 'string') {
        turnOn = value !== 'Off' && value !== '';
        targetState = value;
    } else {
        throw new FormValueTypeError(`${type} "${node.name}" expects a boolean or state string`);
    }

    // Field /V.
    const clone: PdfDict = new Map(node.dict);
    clone.set('V', { type: 'name', value: turnOn ? targetState : 'Off' });

    // Widget /AS — match the state per widget from its own /AP /N keys.
    if (node.widgets.length === 1 && node.widgets[0].ref === node.ref) {
        clone.set('AS', { type: 'name', value: turnOn ? targetState : 'Off' });
        modifier.setObject(node.ref, clone);
        return;
    }
    // Separate parent + kid widgets (radio group).
    modifier.setObject(node.ref, clone);
    for (const w of node.widgets) {
        const wState = onStateOf(reader, w.dict);
        const wClone: PdfDict = new Map(w.dict);
        const on = turnOn && wState === targetState;
        wClone.set('AS', { type: 'name', value: on ? (wState as string) : 'Off' });
        modifier.setObject(w.ref, wClone);
    }
}

/** Wire a regenerated appearance ref into the field/widget and persist. */
function applyAppearance(
    _reader: PdfReader, modifier: ReturnType<typeof createModifier>, node: FieldNode,
    clone: PdfDict, apRefs: number[],
): void {
    if (node.widgets.length === 1 && node.widgets[0].ref === node.ref) {
        const ap: PdfDict = new Map();
        ap.set('N', { type: 'ref', num: apRefs[0], gen: 0 });
        clone.set('AP', ap);
        modifier.setObject(node.ref, clone);
        return;
    }
    // Field dict updated with /V; each widget gets its own /AP.
    modifier.setObject(node.ref, clone);
    node.widgets.forEach((w, i) => {
        const wClone: PdfDict = new Map(w.dict);
        const ap: PdfDict = new Map();
        ap.set('N', { type: 'ref', num: apRefs[i], gen: 0 });
        wClone.set('AP', ap);
        modifier.setObject(w.ref, wClone);
    });
}

function setNeedAppearances(reader: PdfReader, modifier: ReturnType<typeof createModifier>, on: boolean): void {
    const catalog = reader.getCatalog();
    const acroVal = catalog.get('AcroForm');
    if (isRef(acroVal)) {
        // Indirect AcroForm: rewrite that object.
        const acro = reader.resolveValue(acroVal);
        if (!isDict(acro)) return;
        const clone: PdfDict = new Map(acro);
        clone.set('NeedAppearances', on);
        modifier.setObject(acroVal.num, clone);
        return;
    }
    if (acroVal !== undefined && isDict(acroVal)) {
        // Inline AcroForm (pdfnative default): rewrite the catalog.
        const catalogRef = reader.trailer.get('Root');
        if (!isRef(catalogRef)) return;
        const acroClone: PdfDict = new Map(acroVal);
        acroClone.set('NeedAppearances', on);
        const catClone: PdfDict = new Map(catalog);
        catClone.set('AcroForm', acroClone);
        modifier.setObject(catalogRef.num, catClone);
    }
}

// ── Public: flatten ──────────────────────────────────────────────────

/** Options for {@link flattenForm}. */
export interface FlattenFormOptions {
    /** Password for an encrypted source (rejected). */
    readonly password?: string;
    /** Flatten even when a signed signature field is present. Default `false`. */
    readonly force?: boolean;
}

/**
 * Flatten an existing PDF's form: stamp each widget's normal appearance into
 * its page content and remove the interactive fields (`/AcroForm`, widget
 * `/Annots`). Incremental update.
 *
 * @throws {FormUnsupportedError} for encrypted PDFs, or (unless `force`) when a
 *         signed signature field is present.
 */
export function flattenForm(pdfBytes: Uint8Array, opts?: FlattenFormOptions): Uint8Array {
    const reader = openPdf(pdfBytes, opts?.password !== undefined ? { password: opts.password } : undefined);
    if (reader.encryption) {
        throw new FormUnsupportedError('flattening encrypted PDFs is not supported');
    }
    const nodes = collectFields(reader);
    if (!opts?.force) {
        for (const n of nodes) {
            if (classify(n) === 'signature' && reader.resolveValue(n.v) !== null) {
                throw new FormUnsupportedError(
                    'document has a signed signature field; flattening is destructive to what was signed — pass { force: true } to override',
                );
            }
        }
    }

    const modifier = createModifier(reader);
    const pages = reader.getPages();
    const pageRefs = pages.map((_, i) => reader.getPageRef(i));

    // Collect, per page, the overlay draw ops for each widget appearance.
    const overlays = new Map<number, string[]>(); // pageIndex → ops[]
    const widgetsToRemove = new Set<number>();

    for (const node of nodes) {
        for (const w of node.widgets) {
            const apRef = appearanceRefFor(reader, w.dict);
            if (apRef === null) { widgetsToRemove.add(w.ref); continue; }
            const pageIndex = pageIndexOfWidget(reader, w.ref);
            const pageRef = pageIndex >= 0 ? pageRefs[pageIndex] : null;
            if (!pageRef) { widgetsToRemove.add(w.ref); continue; }
            const rect = rectOf(reader, w.dict);
            const xobjName = `pnfl${apRef}`;
            registerPageXObject(reader, modifier, pageRef, xobjName, apRef, w.dict);
            const ops = overlays.get(pageIndex) ?? [];
            ops.push(drawXObjectAt(xobjName, rect, reader, apRef, w.dict));
            overlays.set(pageIndex, ops);
            widgetsToRemove.add(w.ref);
        }
    }

    // Append one overlay content stream per page and strip widget annots.
    overlays.forEach((ops, pageIndex) => {
        const pageRef = pageRefs[pageIndex];
        if (!pageRef) return;
        const content = `q\n${ops.join('\n')}\nQ\n`;
        const streamRef = modifier.addRawObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
        appendPageContents(modifier, pageRef, streamRef);
    });

    // Remove widgets from every page's /Annots.
    for (let p = 0; p < pages.length; p++) {
        const ref = pageRefs[p];
        if (!ref) continue;
        const page = modifier.getObject(ref.num);
        if (!isDict(page)) continue;
        const annots = reader.resolveValue(page.get('Annots') ?? null);
        if (!isArray(annots)) continue;
        const kept = annots.filter(a => !(isRef(a) && widgetsToRemove.has(a.num)));
        if (kept.length === annots.length) continue;
        const clone: PdfDict = new Map(page);
        if (kept.length > 0) clone.set('Annots', kept); else clone.delete('Annots');
        modifier.setObject(ref.num, clone);
    }

    // Drop /AcroForm from the catalog.
    const catalog = reader.getCatalog();
    const catalogRef = reader.trailer.get('Root');
    if (isRef(catalogRef) && catalog.has('AcroForm')) {
        const clone: PdfDict = new Map(catalog);
        clone.delete('AcroForm');
        modifier.setObject(catalogRef.num, clone);
    }

    return modifier.save();
}

function appearanceRefFor(reader: PdfReader, widgetDict: PdfDict): number | null {
    const ap = reader.resolveValue(widgetDict.get('AP') ?? null);
    if (!isDict(ap)) return null;
    let n = ap.get('N');
    // Button: /N is a subdictionary keyed by state; pick the /AS state.
    const nResolved = reader.resolveValue(n ?? null);
    if (isDict(nResolved) && !isStream(nResolved)) {
        const as = dictGetName(widgetDict, 'AS') ?? 'Off';
        n = nResolved.get(as) ?? nResolved.get('Off') ?? null;
    }
    return isRef(n) ? n.num : null;
}

function pageIndexOfWidget(reader: PdfReader, widgetNum: number): number {
    const pages = reader.getPages();
    for (let p = 0; p < pages.length; p++) {
        const annots = reader.resolveValue(pages[p].get('Annots') ?? null);
        if (isArray(annots) && annots.some(a => isRef(a) && a.num === widgetNum)) return p;
    }
    return -1;
}

/** Add the appearance XObject to a page's /Resources /XObject under `name`. */
function registerPageXObject(
    reader: PdfReader, modifier: ReturnType<typeof createModifier>, pageRef: PdfRef,
    name: string, apRef: number, _widget: PdfDict,
): void {
    const page = modifier.getObject(pageRef.num);
    if (!isDict(page)) return;
    const clone: PdfDict = new Map(page);
    // Materialise inherited /Resources onto the page.
    const resources = reader.resolveValue(inheritedFromPage(reader, page, 'Resources') ?? null);
    const resClone: PdfDict = isDict(resources) ? new Map(resources) : new Map();
    const xobj = reader.resolveValue(resClone.get('XObject') ?? null);
    const xobjClone: PdfDict = isDict(xobj) ? new Map(xobj) : new Map();
    xobjClone.set(name, { type: 'ref', num: apRef, gen: 0 });
    resClone.set('XObject', xobjClone);
    clone.set('Resources', resClone);
    modifier.setObject(pageRef.num, clone);
}

function inheritedFromPage(reader: PdfReader, page: PdfDict, key: string, depth = 0): PdfValue | undefined {
    if (depth > 50) return undefined;
    const v = page.get(key);
    if (v !== undefined) return v;
    const parent = reader.resolveValue(page.get('Parent') ?? null);
    return isDict(parent) ? inheritedFromPage(reader, parent, key, depth + 1) : undefined;
}

/** Compute the `cm` matrix mapping the appearance /BBox onto /Rect and draw it. */
function drawXObjectAt(
    name: string, rect: readonly [number, number, number, number], reader: PdfReader,
    apRef: number, _widget: PdfDict,
): string {
    const [x1, y1, x2, y2] = rect;
    const rw = x2 - x1, rh = y2 - y1;
    // Read the appearance /BBox to scale correctly (default to rect size).
    const ap = reader.getObject(apRef);
    let bx = 0, by = 0, bw = rw, bh = rh;
    if (isStream(ap)) {
        const bbox = reader.resolveValue(ap.dict.get('BBox') ?? null);
        if (isArray(bbox) && bbox.length === 4 && bbox.every(n => typeof n === 'number')) {
            bx = bbox[0] as number; by = bbox[1] as number;
            bw = (bbox[2] as number) - bx; bh = (bbox[3] as number) - by;
        }
    }
    const sx = bw !== 0 ? rw / bw : 1;
    const sy = bh !== 0 ? rh / bh : 1;
    const tx = x1 - sx * bx;
    const ty = y1 - sy * by;
    return `q ${fmt(sx)} 0 0 ${fmt(sy)} ${fmt(tx)} ${fmt(ty)} cm /${name} Do Q`;
}

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
}

/** Append a content stream ref to a page's /Contents (normalised to an array). */
function appendPageContents(
    modifier: ReturnType<typeof createModifier>, pageRef: PdfRef, streamRef: number,
): void {
    const page = modifier.getObject(pageRef.num);
    if (!isDict(page)) return;
    const clone: PdfDict = new Map(page);
    const contents = clone.get('Contents');
    const arr: PdfArray = [];
    if (isArray(contents)) arr.push(...contents);
    else if (contents !== undefined) arr.push(contents);
    arr.push({ type: 'ref', num: streamRef, gen: 0 });
    clone.set('Contents', arr);
    modifier.setObject(pageRef.num, clone);
}
