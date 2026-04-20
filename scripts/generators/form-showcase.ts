/**
 * AcroForm interactive fields showcase — text, multiline, checkbox, radio, dropdown, listbox.
 */

import { resolve } from 'path';
import { buildDocumentPDFBytes } from '../../src/index.js';
import type { DocumentParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

export async function generate(ctx: GenerateContext): Promise<void> {
    // ── Full form showcase ───────────────────────────────────────
    {
        const params: DocumentParams = {
            title: 'AcroForm Interactive Fields',
            blocks: [
                { type: 'heading', text: 'AcroForm Interactive Fields', level: 1 },
                { type: 'paragraph', text: 'pdfnative generates ISO 32000-1 §12.7 compliant AcroForm fields with native widget annotations and appearance streams.' },

                // ── Text fields ──────────────────────────────────
                { type: 'heading', text: 'Text Fields', level: 2 },
                { type: 'formField', fieldType: 'text', name: 'firstName', label: 'First Name', value: 'John' },
                { type: 'formField', fieldType: 'text', name: 'lastName', label: 'Last Name', value: 'Doe' },
                { type: 'formField', fieldType: 'text', name: 'email', label: 'Email Address', value: 'john.doe@example.com' },

                // ── Multiline text ───────────────────────────────
                { type: 'heading', text: 'Multiline Text', level: 2 },
                { type: 'formField', fieldType: 'multilineText', name: 'comments', label: 'Comments', value: 'This is a multiline text field.\nIt supports multiple lines of input for longer form entries.', height: 80 },

                // ── Checkbox ─────────────────────────────────────
                { type: 'heading', text: 'Checkboxes', level: 2 },
                { type: 'formField', fieldType: 'checkbox', name: 'agree', label: 'I agree to the terms and conditions', value: 'Yes' },
                { type: 'formField', fieldType: 'checkbox', name: 'newsletter', label: 'Subscribe to newsletter' },

                // ── Radio buttons ────────────────────────────────
                { type: 'heading', text: 'Radio Buttons', level: 2 },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Basic Plan', value: 'basic', checked: true },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Pro Plan', value: 'pro' },
                { type: 'formField', fieldType: 'radio', name: 'plan', label: 'Enterprise Plan', value: 'enterprise' },

                // ── Dropdown ─────────────────────────────────────
                { type: 'heading', text: 'Dropdown', level: 2 },
                { type: 'formField', fieldType: 'dropdown', name: 'country', label: 'Country', options: ['United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Japan'], value: 'United States' },

                // ── Listbox ──────────────────────────────────────
                { type: 'heading', text: 'Listbox', level: 2 },
                { type: 'formField', fieldType: 'listbox', name: 'interests', label: 'Interests (select one)', options: ['Programming', 'Design', 'Marketing', 'Finance', 'Engineering'], value: 'Programming', height: 80 },

                // ── Field attributes ─────────────────────────────
                { type: 'heading', text: 'Field Attributes', level: 2 },
                { type: 'formField', fieldType: 'text', name: 'readonlyField', label: 'Read-Only Field', value: 'Cannot be edited', readOnly: true },
                { type: 'formField', fieldType: 'text', name: 'requiredField', label: 'Required Field (marked)', required: true },
                { type: 'formField', fieldType: 'text', name: 'maxLenField', label: 'Max Length (10 chars)', maxLength: 10, value: 'Short' },
            ],
        };

        const bytes = buildDocumentPDFBytes(params);
        ctx.writeSafe(resolve(ctx.outputDir, 'form', 'form-fields.pdf'), 'form/form-fields.pdf', bytes);
    }

    // ── Minimal form ─────────────────────────────────────────────
    {
        const params: DocumentParams = {
            title: 'Simple Contact Form',
            blocks: [
                { type: 'heading', text: 'Contact Form', level: 1 },
                { type: 'paragraph', text: 'Please fill out the form below. All fields are required.' },
                { type: 'formField', fieldType: 'text', name: 'name', label: 'Full Name', value: 'Jane Smith' },
                { type: 'formField', fieldType: 'text', name: 'email', label: 'Email Address', value: 'jane@example.com' },
                { type: 'formField', fieldType: 'multilineText', name: 'message', label: 'Message', value: 'I would like to learn more about your services.', height: 100 },
                { type: 'formField', fieldType: 'checkbox', name: 'consent', label: 'I consent to data processing', value: 'Yes' },
            ],
        };

        const bytes = buildDocumentPDFBytes(params);
        ctx.writeSafe(resolve(ctx.outputDir, 'form', 'form-contact.pdf'), 'form/form-contact.pdf', bytes);
    }
}
