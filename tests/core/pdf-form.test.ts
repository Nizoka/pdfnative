import { describe, it, expect } from 'vitest';
import {
    buildFormWidget,
    buildAcroFormDict,
    buildAppearanceStreamDict,
    buildRadioGroupParent,
    defaultFieldHeight,
} from '../../src/core/pdf-form.js';
import type { FormField, RadioGroupContext } from '../../src/core/pdf-form.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeField(overrides: Partial<FormField> & { fieldType: FormField['fieldType'] }): FormField {
    return {
        name: 'testField',
        value: '',
        rect: [72, 700, 300, 722] as const,
        fontSize: 10,
        options: [],
        readOnly: false,
        required: false,
        maxLength: null,
        page: 0,
        checked: false,
        ...overrides,
    };
}

// ── defaultFieldHeight ───────────────────────────────────────────────

describe('defaultFieldHeight', () => {
    it('should return 22 for text', () => {
        expect(defaultFieldHeight('text')).toBe(22);
    });

    it('should return 60 for multilineText', () => {
        expect(defaultFieldHeight('multilineText')).toBe(60);
    });

    it('should return 14 for checkbox', () => {
        expect(defaultFieldHeight('checkbox')).toBe(14);
    });

    it('should return 14 for radio', () => {
        expect(defaultFieldHeight('radio')).toBe(14);
    });

    it('should return 22 for dropdown', () => {
        expect(defaultFieldHeight('dropdown')).toBe(22);
    });

    it('should return 60 for listbox', () => {
        expect(defaultFieldHeight('listbox')).toBe(60);
    });
});

// ── buildFormWidget — Text Fields ────────────────────────────────────

describe('buildFormWidget — text', () => {
    it('should produce /FT /Tx widget dict', () => {
        const field = makeField({ fieldType: 'text', name: 'firstName' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Tx');
        expect(result.widgetDict).toContain('/Subtype /Widget');
    });

    it('should include field name as /T', () => {
        const field = makeField({ fieldType: 'text', name: 'email' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/T (email)');
    });

    it('should include /Rect coordinates', () => {
        const field = makeField({ fieldType: 'text', rect: [72, 700, 300, 722] });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Rect [72 700 300 722]');
    });

    it('should include /V for non-empty value', () => {
        const field = makeField({ fieldType: 'text', value: 'Hello' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V (Hello)');
    });

    it('should NOT include /V when value is empty', () => {
        const field = makeField({ fieldType: 'text', value: '' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).not.toContain('/V ');
    });

    it('should include /DA with Helvetica font', () => {
        const field = makeField({ fieldType: 'text', fontSize: 12 });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/DA (/Helv 12 Tf 0 0 0 rg)');
    });

    it('should include /MaxLen when specified', () => {
        const field = makeField({ fieldType: 'text', maxLength: 50 });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/MaxLen 50');
    });

    it('should NOT include /MaxLen when null', () => {
        const field = makeField({ fieldType: 'text', maxLength: null });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).not.toContain('/MaxLen');
    });

    it('should reference appearance stream XObject', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 42);
        expect(result.widgetDict).toContain('/AP << /N 42 0 R >>');
    });

    it('should produce appearance stream with background rect', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).toContain('re f');
    });

    it('should produce appearance stream with border rect', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).toContain('re S');
    });

    it('should include text value in appearance stream', () => {
        const field = makeField({ fieldType: 'text', value: 'Test Value' });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).toContain('BT');
        expect(result.appearanceStream).toContain('(Test Value) Tj');
        expect(result.appearanceStream).toContain('ET');
    });

    it('should escape special characters in field name', () => {
        const field = makeField({ fieldType: 'text', name: 'field(1)' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/T (field\\(1\\))');
    });

    it('should escape special characters in value', () => {
        const field = makeField({ fieldType: 'text', value: 'a\\b(c)' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V (a\\\\b\\(c\\))');
    });
});

// ── buildFormWidget — Multiline Text ─────────────────────────────────

describe('buildFormWidget — multilineText', () => {
    it('should set /FT /Tx with multiline flag', () => {
        const field = makeField({ fieldType: 'multilineText' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Tx');
        // 1 << 12 = 4096
        expect(result.widgetDict).toContain('/Ff 4096');
    });

    it('should combine multiline flag with readOnly', () => {
        const field = makeField({ fieldType: 'multilineText', readOnly: true });
        const result = buildFormWidget(field, 99);
        // 4096 | 1 = 4097
        expect(result.widgetDict).toContain('/Ff 4097');
    });

    it('should combine multiline flag with required', () => {
        const field = makeField({ fieldType: 'multilineText', required: true });
        const result = buildFormWidget(field, 99);
        // 4096 | 2 = 4098
        expect(result.widgetDict).toContain('/Ff 4098');
    });

    it('should produce multiline appearance with wrapped text', () => {
        const longText = 'This is a longer piece of text that should be wrapped across multiple lines in the field';
        const field = makeField({ fieldType: 'multilineText', value: longText, rect: [72, 600, 300, 660] });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).toContain('BT');
        expect(result.appearanceStream).toContain('ET');
    });
});

// ── buildFormWidget — Checkbox ───────────────────────────────────────

describe('buildFormWidget — checkbox', () => {
    it('should set /FT /Btn', () => {
        const field = makeField({ fieldType: 'checkbox' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Btn');
    });

    it('should set /V /Yes /AS /Yes when checked via value', () => {
        const field = makeField({ fieldType: 'checkbox', value: 'Yes' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Yes /AS /Yes');
    });

    it('should set /V /Yes /AS /Yes when checked via checked property', () => {
        const field = makeField({ fieldType: 'checkbox', checked: true });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Yes /AS /Yes');
    });

    it('should set /V /Off /AS /Off when unchecked', () => {
        const field = makeField({ fieldType: 'checkbox', value: '' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Off /AS /Off');
    });

    it('should set /V /Off for any non-Yes value', () => {
        const field = makeField({ fieldType: 'checkbox', value: 'true' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Off /AS /Off');
    });

    it('should NOT have /Ff when not readOnly and not required', () => {
        const field = makeField({ fieldType: 'checkbox' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).not.toContain('/Ff');
    });

    it('should produce Yes appearance with checkmark', () => {
        const field = makeField({ fieldType: 'checkbox', value: 'Yes', rect: [72, 700, 86, 714] });
        const result = buildFormWidget(field, 99);
        // Yes appearance: checkmark (m, l, l, S)
        expect(result.apYesStream).toContain('m');
        expect(result.apYesStream).toContain('l');
        expect(result.apYesStream).toContain('S');
    });

    it('should produce Off appearance without checkmark', () => {
        const field = makeField({ fieldType: 'checkbox', value: '', rect: [72, 700, 86, 714] });
        const result = buildFormWidget(field, 99);
        // Off appearance: background but no checkmark
        expect(result.apOffStream).toContain('re f');
        expect(result.apOffStream).not.toContain('1.5 w');
    });

    it('should use AP state dict with /Yes and /Off entries', () => {
        const field = makeField({ fieldType: 'checkbox' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/AP << /N << /Yes 99 0 R /Off 100 0 R >> >>');
    });
});

// ── buildFormWidget — Radio ──────────────────────────────────────────

describe('buildFormWidget — radio', () => {
    it('should set /FT /Btn with radio flags', () => {
        const field = makeField({ fieldType: 'radio' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Btn');
        // Radio flag = 1<<15 = 32768, NoToggleToOff = 1<<14 = 16384
        // 32768 | 16384 = 49152
        expect(result.widgetDict).toContain('/Ff 49152');
    });

    it('should combine radio flags with readOnly', () => {
        const field = makeField({ fieldType: 'radio', readOnly: true });
        const result = buildFormWidget(field, 99);
        // 49152 | 1 = 49153
        expect(result.widgetDict).toContain('/Ff 49153');
    });

    it('should set /V /Yes when selected', () => {
        const field = makeField({ fieldType: 'radio', checked: true });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Yes /AS /Yes');
    });

    it('should set /V /Off when not selected', () => {
        const field = makeField({ fieldType: 'radio', value: '' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V /Off /AS /Off');
    });

    it('should draw circle in Yes appearance (Bézier curves)', () => {
        const field = makeField({ fieldType: 'radio', rect: [72, 700, 86, 714] });
        const result = buildFormWidget(field, 99);
        // Circle uses cubic Bézier curves
        expect(result.apYesStream).toContain(' c');
        expect(result.apYesStream).toContain(' m');
    });

    it('should draw filled inner circle when selected (Yes appearance)', () => {
        const field = makeField({ fieldType: 'radio', checked: true, rect: [72, 700, 86, 714] });
        const result = buildFormWidget(field, 99);
        // Yes appearance inner circle uses 'f' fill
        const lines = result.apYesStream!.split('\n');
        const fills = lines.filter(l => l.trim() === 'f');
        expect(fills.length).toBeGreaterThanOrEqual(1);
    });

    it('should use AP state dict with /Yes and /Off entries', () => {
        const field = makeField({ fieldType: 'radio' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/AP << /N << /Yes 99 0 R /Off 100 0 R >> >>');
    });
});

// ── buildFormWidget — Dropdown ───────────────────────────────────────

describe('buildFormWidget — dropdown', () => {
    it('should set /FT /Ch with combo flag', () => {
        const field = makeField({ fieldType: 'dropdown' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Ch');
        // Combo flag = 1 << 17 = 131072
        expect(result.widgetDict).toContain('/Ff 131072');
    });

    it('should include /Opt array with options', () => {
        const field = makeField({ fieldType: 'dropdown', options: ['Red', 'Green', 'Blue'] });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Opt [(Red) (Green) (Blue)]');
    });

    it('should NOT include /Opt when options is empty', () => {
        const field = makeField({ fieldType: 'dropdown', options: [] });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).not.toContain('/Opt');
    });

    it('should include /V for selected value', () => {
        const field = makeField({ fieldType: 'dropdown', value: 'Green' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V (Green)');
    });

    it('should include /DA with font specification', () => {
        const field = makeField({ fieldType: 'dropdown', fontSize: 10 });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/DA (/Helv 10 Tf 0 0 0 rg)');
    });

    it('should escape special characters in options', () => {
        const field = makeField({ fieldType: 'dropdown', options: ['Option (A)', 'Option\\B'] });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('(Option \\(A\\))');
        expect(result.widgetDict).toContain('(Option\\\\B)');
    });

    it('should draw dropdown arrow in appearance', () => {
        const field = makeField({ fieldType: 'dropdown', rect: [72, 700, 300, 722] });
        const result = buildFormWidget(field, 99);
        // Arrow triangle: m, l, l, f
        const lines = result.appearanceStream.split('\n');
        expect(lines.some(l => l.includes('m') && !l.includes('rg'))).toBe(true);
    });
});

// ── buildFormWidget — Listbox ────────────────────────────────────────

describe('buildFormWidget — listbox', () => {
    it('should set /FT /Ch without combo flag', () => {
        const field = makeField({ fieldType: 'listbox' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/FT /Ch');
        // No combo flag, no other flags
        expect(result.widgetDict).not.toContain('/Ff');
    });

    it('should include /Opt array', () => {
        const field = makeField({ fieldType: 'listbox', options: ['Apple', 'Banana', 'Cherry'] });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Opt [(Apple) (Banana) (Cherry)]');
    });

    it('should include /V for selected value', () => {
        const field = makeField({ fieldType: 'listbox', value: 'Banana' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/V (Banana)');
    });

    it('should highlight selected item in appearance stream', () => {
        const field = makeField({
            fieldType: 'listbox',
            value: 'Banana',
            options: ['Apple', 'Banana', 'Cherry'],
            rect: [72, 640, 300, 700],
        });
        const result = buildFormWidget(field, 99);
        // Selected item highlight uses a colored rect
        expect(result.appearanceStream).toContain('0.8 0.85 1 rg');
    });

    it('should render option text in appearance', () => {
        const field = makeField({
            fieldType: 'listbox',
            value: '',
            options: ['Apple', 'Banana'],
            rect: [72, 640, 300, 700],
        });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).toContain('(Apple) Tj');
        expect(result.appearanceStream).toContain('(Banana) Tj');
    });

    it('should NOT highlight when no value matches', () => {
        const field = makeField({
            fieldType: 'listbox',
            value: '',
            options: ['Apple', 'Banana'],
            rect: [72, 640, 300, 700],
        });
        const result = buildFormWidget(field, 99);
        expect(result.appearanceStream).not.toContain('0.8 0.85 1 rg');
    });
});

// ── buildFormWidget — Field Flags ────────────────────────────────────

describe('buildFormWidget — field flags', () => {
    it('should set readOnly flag (Ff 1)', () => {
        const field = makeField({ fieldType: 'text', readOnly: true });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Ff 1');
    });

    it('should set required flag (Ff 2)', () => {
        const field = makeField({ fieldType: 'text', required: true });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Ff 2');
    });

    it('should combine readOnly + required (Ff 3)', () => {
        const field = makeField({ fieldType: 'text', readOnly: true, required: true });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Ff 3');
    });

    it('should NOT include /Ff when no flags set for text', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).not.toContain('/Ff');
    });
});

// ── buildFormWidget — Common Structure ───────────────────────────────

describe('buildFormWidget — structure', () => {
    it('should start with << and end with >>', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict.startsWith('<<')).toBe(true);
        expect(result.widgetDict.endsWith('>>')).toBe(true);
    });

    it('should include /Type /Annot', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Type /Annot');
    });

    it('should include /Border', () => {
        const field = makeField({ fieldType: 'text' });
        const result = buildFormWidget(field, 99);
        expect(result.widgetDict).toContain('/Border [0 0 0.5]');
    });

    it('should have non-empty appearance stream for all field types', () => {
        const types: FormField['fieldType'][] = ['text', 'multilineText', 'checkbox', 'radio', 'dropdown', 'listbox'];
        for (const fieldType of types) {
            const field = makeField({ fieldType, options: fieldType === 'listbox' ? ['A'] : [] });
            const result = buildFormWidget(field, 99);
            if (fieldType === 'checkbox' || fieldType === 'radio') {
                expect(result.apYesStream!.length).toBeGreaterThan(0);
                expect(result.apOffStream!.length).toBeGreaterThan(0);
            } else {
                expect(result.appearanceStream.length).toBeGreaterThan(0);
            }
        }
    });
});

// ── buildAcroFormDict ────────────────────────────────────────────────

describe('buildAcroFormDict', () => {
    it('should produce /AcroForm dict with field references', () => {
        const result = buildAcroFormDict([10, 12, 14]);
        expect(result).toContain('/AcroForm');
        expect(result).toContain('/Fields [10 0 R 12 0 R 14 0 R]');
    });

    it('should include default resources with Helvetica', () => {
        const result = buildAcroFormDict([10]);
        expect(result).toContain('/DR');
        expect(result).toContain('/Helv');
        expect(result).toContain('/BaseFont /Helvetica');
    });

    it('should include /NeedAppearances false', () => {
        const result = buildAcroFormDict([10]);
        expect(result).toContain('/NeedAppearances false');
    });

    it('should handle single field', () => {
        const result = buildAcroFormDict([5]);
        expect(result).toContain('/Fields [5 0 R]');
    });

    it('should handle many fields', () => {
        const nums = Array.from({ length: 20 }, (_, i) => i + 10);
        const result = buildAcroFormDict(nums);
        expect(result).toContain('10 0 R');
        expect(result).toContain('29 0 R');
    });
});

// ── buildAppearanceStreamDict ────────────────────────────────────────

describe('buildAppearanceStreamDict', () => {
    it('should produce Form XObject dictionary', () => {
        const result = buildAppearanceStreamDict(200, 22, 150);
        expect(result).toContain('/Type /XObject');
        expect(result).toContain('/Subtype /Form');
    });

    it('should include BBox with dimensions', () => {
        const result = buildAppearanceStreamDict(200, 30, 100);
        expect(result).toContain('/BBox [0 0 200 30]');
    });

    it('should include font resources', () => {
        const result = buildAppearanceStreamDict(100, 20, 50);
        expect(result).toContain('/Helv');
        expect(result).toContain('/BaseFont /Helvetica');
    });

    it('should include stream length', () => {
        const result = buildAppearanceStreamDict(100, 20, 42);
        expect(result).toContain('/Length 42');
    });

    it('should handle fractional dimensions', () => {
        const result = buildAppearanceStreamDict(200.5, 22.75, 100);
        expect(result).toContain('/BBox [0 0 200.5 22.75]');
    });
});

// ── Document Builder Integration ─────────────────────────────────────

describe('FormFieldBlock in buildDocumentPDF', () => {
    let buildDocumentPDF: typeof import('../../src/core/pdf-document.js').buildDocumentPDF;

    const setup = async () => {
        const mod = await import('../../src/core/pdf-document.js');
        buildDocumentPDF = mod.buildDocumentPDF;
    };

    it('should produce valid PDF with a text field', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'name', label: 'Full Name' },
            ],
        });
        expect(text).toContain('%PDF-');
        expect(text).toContain('%%EOF');
        expect(text).toContain('/Subtype /Widget');
        expect(text).toContain('/FT /Tx');
        expect(text).toContain('/AcroForm');
    });

    it('should produce valid PDF with a checkbox', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'checkbox', name: 'agree', label: 'I Agree', value: 'Yes' },
            ],
        });
        expect(text).toContain('/FT /Btn');
        expect(text).toContain('/V /Yes /AS /Yes');
        expect(text).toContain('/AcroForm');
    });

    it('should produce valid PDF with a dropdown', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                {
                    type: 'formField',
                    fieldType: 'dropdown',
                    name: 'color',
                    label: 'Favorite Color',
                    options: ['Red', 'Green', 'Blue'],
                    value: 'Green',
                },
            ],
        });
        expect(text).toContain('/FT /Ch');
        expect(text).toContain('/Opt [(Red) (Green) (Blue)]');
        expect(text).toContain('/V (Green)');
        expect(text).toContain('/AcroForm');
    });

    it('should produce valid PDF with multiple form fields', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'firstName', label: 'First Name' },
                { type: 'formField', fieldType: 'text', name: 'lastName', label: 'Last Name' },
                { type: 'formField', fieldType: 'checkbox', name: 'terms', label: 'Accept Terms' },
            ],
        });
        expect(text).toContain('%PDF-');
        expect(text).toContain('/AcroForm');
        // Should have 3 widget annotations
        const widgetMatches = text.match(/\/Subtype \/Widget/g);
        expect(widgetMatches?.length).toBe(3);
    });

    it('should produce valid PDF with a standalone radio button', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'radio', name: 'option', label: 'Option A', checked: true },
            ],
        });
        expect(text).toContain('/FT /Btn');
        // Radio flag + NoToggleToOff flag
        expect(text).toContain('/Ff 49152');
        expect(text).toContain('/AcroForm');
    });

    it('should produce valid PDF with a listbox', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                {
                    type: 'formField',
                    fieldType: 'listbox',
                    name: 'items',
                    label: 'Select Items',
                    options: ['Item 1', 'Item 2', 'Item 3'],
                },
            ],
        });
        expect(text).toContain('/FT /Ch');
        expect(text).toContain('/Opt');
        expect(text).toContain('/AcroForm');
    });

    it('should NOT include /AcroForm when no form fields present', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'paragraph', text: 'Hello World' },
            ],
        });
        expect(text).toContain('%PDF-');
        expect(text).not.toContain('/AcroForm');
    });

    it('should produce valid PDF with form fields and other blocks mixed', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'heading', text: 'Registration Form', level: 1 },
                { type: 'paragraph', text: 'Please fill in the details below.' },
                { type: 'formField', fieldType: 'text', name: 'name', label: 'Name' },
                { type: 'formField', fieldType: 'text', name: 'email', label: 'Email' },
                { type: 'paragraph', text: 'Thank you!' },
            ],
        });
        expect(text).toContain('%PDF-');
        expect(text).toContain('%%EOF');
        expect(text).toContain('/AcroForm');
        const widgetMatches = text.match(/\/Subtype \/Widget/g);
        expect(widgetMatches?.length).toBe(2);
    });

    it('should produce valid PDF with readOnly field', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'id', value: 'AUTO-001', readOnly: true },
            ],
        });
        expect(text).toContain('/Ff 1');
    });

    it('should produce valid PDF with required field', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'required_field', required: true },
            ],
        });
        expect(text).toContain('/Ff 2');
    });

    it('should produce valid PDF with multiline text field', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'multilineText', name: 'comments', label: 'Comments', height: 80 },
            ],
        });
        expect(text).toContain('/FT /Tx');
        // Multiline flag: 1<<12 = 4096
        expect(text).toContain('/Ff 4096');
    });

    it('should include /NeedAppearances in AcroForm dict', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'test' },
            ],
        });
        expect(text).toContain('/NeedAppearances false');
    });

    it('should include appearance stream XObjects in PDF', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'test', value: 'hello' },
            ],
        });
        // Appearance XObject should be a Form XObject
        expect(text).toContain('/Type /XObject');
        expect(text).toContain('/Subtype /Form');
    });

    it('should have valid xref structure with form fields', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'text', name: 'a' },
                { type: 'formField', fieldType: 'checkbox', name: 'b' },
            ],
        });
        // Check xref header
        expect(text).toContain('xref\n');
        // Verify %%EOF present
        expect(text).toContain('%%EOF');
    });

    it('should produce valid PDF with radio group (shared name)', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Basic', value: 'basic', checked: true },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Pro', value: 'pro' },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Enterprise', value: 'enterprise' },
            ],
        });
        expect(text).toContain('%PDF-');
        expect(text).toContain('/AcroForm');
        // Radio group parent field
        expect(text).toContain('/FT /Btn');
        expect(text).toContain('/Kids [');
        expect(text).toContain('/V /basic');
        // Child widgets should have /Parent
        expect(text).toContain('/Parent');
        // 3 widget annotations
        const widgetMatches = text.match(/\/Subtype \/Widget/g);
        expect(widgetMatches?.length).toBe(3);
    });

    it('should produce radio group with no selection when none checked', async () => {
        await setup();
        const text = buildDocumentPDF({
            blocks: [
                { type: 'formField', fieldType: 'radio', name: 'choice', label: 'A', value: 'a' },
                { type: 'formField', fieldType: 'radio', name: 'choice', label: 'B', value: 'b' },
            ],
        });
        // Parent should have /V /Off when nothing checked
        expect(text).toContain('/V /Off');
        expect(text).toContain('/Kids [');
    });
});

// ── buildFormWidget — Radio Group Context ────────────────────────────

describe('buildFormWidget — radio group context', () => {
    it('should include /Parent reference when radioCtx provided', () => {
        const field = makeField({ fieldType: 'radio', checked: true });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).toContain('/Parent 50 0 R');
    });

    it('should NOT include /FT for radio group child', () => {
        const field = makeField({ fieldType: 'radio' });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).not.toContain('/FT');
    });

    it('should NOT include /T for radio group child', () => {
        const field = makeField({ fieldType: 'radio', name: 'plan' });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).not.toContain('/T ');
    });

    it('should NOT include /Ff for radio group child', () => {
        const field = makeField({ fieldType: 'radio' });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).not.toContain('/Ff');
    });

    it('should use export value as AP state name', () => {
        const field = makeField({ fieldType: 'radio' });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'pro' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).toContain('/AP << /N << /pro 99 0 R /Off 100 0 R >> >>');
    });

    it('should set /AS to export value when checked', () => {
        const field = makeField({ fieldType: 'radio', checked: true });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).toContain('/AS /basic');
    });

    it('should set /AS /Off when not checked', () => {
        const field = makeField({ fieldType: 'radio', checked: false });
        const radioCtx: RadioGroupContext = { parentObjNum: 50, exportValue: 'basic' };
        const result = buildFormWidget(field, 99, radioCtx);
        expect(result.widgetDict).toContain('/AS /Off');
    });
});

// ── buildRadioGroupParent ────────────────────────────────────────────

describe('buildRadioGroupParent', () => {
    it('should produce /FT /Btn with radio flags', () => {
        const result = buildRadioGroupParent('plan', 'basic', [10, 13, 16], false, false);
        expect(result).toContain('/FT /Btn');
        expect(result).toContain('/Ff 49152');
    });

    it('should include /T with group name', () => {
        const result = buildRadioGroupParent('plan', 'basic', [10], false, false);
        expect(result).toContain('/T (plan)');
    });

    it('should include /V with selected value', () => {
        const result = buildRadioGroupParent('plan', 'pro', [10, 13], false, false);
        expect(result).toContain('/V /pro');
    });

    it('should set /V /Off when no selection', () => {
        const result = buildRadioGroupParent('plan', '', [10, 13], false, false);
        expect(result).toContain('/V /Off');
    });

    it('should include /Kids array with child references', () => {
        const result = buildRadioGroupParent('plan', 'basic', [10, 13, 16], false, false);
        expect(result).toContain('/Kids [10 0 R 13 0 R 16 0 R]');
    });

    it('should add readOnly flag', () => {
        const result = buildRadioGroupParent('plan', '', [10], true, false);
        // 49152 | 1 = 49153
        expect(result).toContain('/Ff 49153');
    });

    it('should add required flag', () => {
        const result = buildRadioGroupParent('plan', '', [10], false, true);
        // 49152 | 2 = 49154
        expect(result).toContain('/Ff 49154');
    });

    it('should escape special characters in name', () => {
        const result = buildRadioGroupParent('field(1)', '', [10], false, false);
        expect(result).toContain('/T (field\\(1\\))');
    });
});
