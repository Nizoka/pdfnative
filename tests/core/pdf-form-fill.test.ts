/**
 * AcroForm fill & flatten (v1.6.0). A form authored by pdfnative is read
 * back, filled, and flattened — a perfect round-trip fixture — plus error
 * cases and an encrypted-input rejection.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { openPdf } from '../../src/parser/pdf-reader.js';
import {
    readFormFields, fillForm, flattenForm,
    FormFieldNotFoundError, FormValueTypeError, FormUnsupportedError,
} from '../../src/core/pdf-form-fill.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

function formDoc(): Uint8Array {
    const params: DocumentParams = {
        title: 'Application',
        blocks: [
            { type: 'heading', level: 1 as const, text: 'Application form' },
            { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name' },
            { type: 'formField', fieldType: 'multilineText', name: 'address', label: 'Address', height: 60 },
            { type: 'formField', fieldType: 'checkbox', name: 'agree', label: 'I agree' },
            { type: 'formField', fieldType: 'dropdown', name: 'country', label: 'Country', options: ['France', 'Germany', 'Spain'] },
        ] as never,
    };
    return buildDocumentPDFBytes(params);
}

describe('readFormFields', () => {
    it('enumerates fields with names, types, and options', () => {
        const fields = readFormFields(formDoc());
        const byName = new Map(fields.map(f => [f.name, f]));
        expect(byName.get('fullName')?.type).toBe('text');
        expect(byName.get('address')?.type).toBe('text');
        expect(byName.get('address')?.multiline).toBe(true);
        expect(byName.get('agree')?.type).toBe('checkbox');
        expect(byName.get('country')?.type).toBe('dropdown');
        expect(byName.get('country')?.options?.map(o => o.label)).toEqual(['France', 'Germany', 'Spain']);
        // Every field maps to a page.
        for (const f of fields) expect(f.widgets[0].pageIndex).toBeGreaterThanOrEqual(0);
    });
});

describe('fillForm', () => {
    it('sets /V and regenerates the appearance for text fields', () => {
        const filled = fillForm(formDoc(), { fullName: 'Ada Lovelace' });
        const field = readFormFields(filled).find(f => f.name === 'fullName')!;
        expect(field.value).toBe('Ada Lovelace');
        // The regenerated appearance stream draws the value.
        const r = openPdf(filled);
        const fieldObj = r.getObject(field.ref) as Map<string, unknown>;
        const ap = r.resolveValue(fieldObj.get('AP') as never) as Map<string, unknown>;
        const nRef = ap.get('N');
        const stream = r.resolveValue(nRef as never);
        const content = r.decodeStream(stream as never);
        let s = ''; for (let i = 0; i < content.length; i++) s += String.fromCharCode(content[i]);
        expect(s).toContain('Ada Lovelace');
    });

    it('checks a checkbox (boolean value)', () => {
        const filled = fillForm(formDoc(), { agree: true });
        const field = readFormFields(filled).find(f => f.name === 'agree')!;
        expect(field.value).toBe(true);
    });

    it('selects a dropdown option', () => {
        const filled = fillForm(formDoc(), { country: 'Germany' });
        const field = readFormFields(filled).find(f => f.name === 'country')!;
        expect(field.value).toBe('Germany');
    });

    it('fills multiple fields at once', () => {
        const filled = fillForm(formDoc(), { fullName: 'Grace Hopper', agree: true, country: 'Spain' });
        const byName = new Map(readFormFields(filled).map(f => [f.name, f]));
        expect(byName.get('fullName')?.value).toBe('Grace Hopper');
        expect(byName.get('agree')?.value).toBe(true);
        expect(byName.get('country')?.value).toBe('Spain');
    });

    it('throws on an unknown field by default', () => {
        expect(() => fillForm(formDoc(), { nope: 'x' })).toThrow(FormFieldNotFoundError);
    });

    it('ignores unknown fields with onUnknownField: ignore', () => {
        expect(() => fillForm(formDoc(), { nope: 'x' }, { onUnknownField: 'ignore' })).not.toThrow();
    });

    it('rejects an invalid dropdown option', () => {
        expect(() => fillForm(formDoc(), { country: 'Atlantis' })).toThrow(FormValueTypeError);
    });

    it('rejects a non-string value for a text field', () => {
        expect(() => fillForm(formDoc(), { fullName: true })).toThrow(FormValueTypeError);
    });

    it('rejects non-WinAnsi text unless nonWinAnsi: needAppearances', () => {
        expect(() => fillForm(formDoc(), { fullName: '日本語' })).toThrow(FormValueTypeError);
        const filled = fillForm(formDoc(), { fullName: '日本語' }, { nonWinAnsi: 'needAppearances' });
        // /NeedAppearances is set so the viewer regenerates the appearance.
        const r = openPdf(filled);
        const catalog = r.getCatalog();
        const acro = r.resolveValue(catalog.get('AcroForm') as never) as Map<string, unknown>;
        expect(acro.get('NeedAppearances')).toBe(true);
    });

    it('is a non-destructive incremental update (original bytes preserved)', () => {
        const original = formDoc();
        const filled = fillForm(original, { fullName: 'Katherine Johnson' });
        expect(filled.length).toBeGreaterThan(original.length);
        expect(filled.subarray(0, original.length)).toEqual(original);
    });

    it('rejects encrypted input', () => {
        const enc = buildDocumentPDFBytes(
            { title: 'X', blocks: [{ type: 'formField', fieldType: 'text', name: 'a' }] as never },
            { encryption: { ownerPassword: 'o' } },
        );
        expect(() => fillForm(enc, { a: 'b' }, { password: 'o' })).toThrow(FormUnsupportedError);
    });
});

describe('radio groups', () => {
    function radioDoc(): Uint8Array {
        return buildDocumentPDFBytes({
            title: 'Plan',
            blocks: [
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Basic', value: 'basic', checked: true },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Pro', value: 'pro' },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Enterprise', value: 'enterprise' },
            ] as never,
        });
    }

    it('reads a grouped radio field and selects an export state', () => {
        const doc = radioDoc();
        const plan = readFormFields(doc).find(f => f.name === 'plan');
        expect(plan?.type).toBe('radio');
        const filled = fillForm(doc, { plan: 'pro' });
        const r = openPdf(filled);
        const field = readFormFields(filled).find(f => f.name === 'plan')!;
        const obj = r.getObject(field.ref) as Map<string, unknown>;
        const v = obj.get('V');
        expect(v && typeof v === 'object' && 'value' in v ? (v as { value: string }).value : v).toBe('pro');
    });
});

describe('signed documents', () => {
    it('fillForm preserves the signed revision bytes (incremental update)', async () => {
        const { addSignaturePlaceholder } = await import('../../src/core/pdf-sig-placeholder.js');
        const base = formDoc();
        const withSig = addSignaturePlaceholder(base);
        const filled = fillForm(withSig, { fullName: 'Signed User' });
        // Everything up to the signed revision is byte-preserved.
        expect(filled.subarray(0, withSig.length)).toEqual(withSig);
    });
});

describe('flattenForm', () => {
    it('removes /AcroForm and widget annotations, stamping appearances', () => {
        const filled = fillForm(formDoc(), { fullName: 'Dorothy Vaughan', agree: true });
        const flat = flattenForm(filled);
        const r = openPdf(flat);
        // No interactive form left.
        expect(r.getCatalog().get('AcroForm')).toBeUndefined();
        expect(readFormFields(flat)).toHaveLength(0);
        // Page still renders (has content).
        const page = r.getPage(0);
        expect(page.get('Contents')).toBeDefined();
    });

    it('is idempotent-safe on a document with no form', () => {
        const plain = buildDocumentPDFBytes({ title: 'P', blocks: [{ type: 'paragraph', text: 'hi' }] as never });
        expect(() => flattenForm(plain)).not.toThrow();
    });

    it('fillForm({ flatten: true }) fills then flattens in one call', () => {
        const flat = fillForm(formDoc(), { fullName: 'Mary Jackson' }, { flatten: true });
        expect(openPdf(flat).getCatalog().get('AcroForm')).toBeUndefined();
    });
});
