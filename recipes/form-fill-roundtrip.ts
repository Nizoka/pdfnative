/**
 * AcroForm round trip: author a form, enumerate its fields, fill a value,
 * and read it back. A second fill with `flatten: true` stamps the
 * appearance into the page content, where plain text extraction finds it.
 *
 * @task Author an AcroForm, fill it, and read the value back
 * @surface library
 * @since 1.6.0
 * @expect field 'fullName' value === 'Ada Lovelace'
 * @expect text of page 0 of the flattened document contains 'Ada Lovelace'
 */
import { buildDocumentPDFBytes, readFormFields, fillForm, extractText } from 'pdfnative';
import type { DocumentParams, ParsedFormField } from 'pdfnative';

const params: DocumentParams = {
    title: 'Application',
    blocks: [
        { type: 'heading', text: 'Application form', level: 1 },
        { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name' },
        { type: 'formField', fieldType: 'checkbox', name: 'agree', label: 'I agree to the terms' },
        { type: 'formField', fieldType: 'dropdown', name: 'country', label: 'Country', options: ['France', 'Germany', 'Spain'] },
    ],
    footerText: 'Application',
};

export async function run(): Promise<{
    bytes: Uint8Array;
    fields: readonly ParsedFormField[];
    filledValue: string | readonly string[] | boolean | null;
    flattenedText: string;
}> {
    const blank = buildDocumentPDFBytes(params, { creationDate: new Date('2026-08-25T00:00:00Z') });

    // Enumerate the authored fields, then fill by fully-qualified name.
    const values = { fullName: 'Ada Lovelace', agree: true, country: 'Germany' } as const;
    const filled = fillForm(blank, values);
    const fields = readFormFields(filled);
    const filledValue = fields.find(f => f.name === 'fullName')?.value ?? null;

    // Flattening replaces the widgets with static page content.
    const flattened = fillForm(blank, values, { flatten: true });
    const flattenedText = extractText(flattened, { pages: [0] })[0].text;

    return { bytes: filled, fields, filledValue, flattenedText };
}
