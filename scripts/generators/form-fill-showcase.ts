/**
 * AcroForm fill & flatten showcase (v1.6.0).
 *
 * Demonstrates:
 *   - readFormFields() — enumerate an existing form.
 *   - fillForm()       — set values + regenerate appearances.
 *   - flattenForm()    — stamp appearances, drop the interactive layer.
 */

import { resolve } from 'path';
import {
    buildDocumentPDFBytes, readFormFields, fillForm, flattenForm,
} from '../../src/index.js';
import type { DocumentParams, DocumentBlock } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function blankForm(): Uint8Array {
    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Membership application', level: 1 },
        { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name' },
        { type: 'formField', fieldType: 'text', name: 'email', label: 'Email' },
        { type: 'formField', fieldType: 'multilineText', name: 'address', label: 'Address', height: 60 },
        { type: 'formField', fieldType: 'dropdown', name: 'plan', label: 'Plan', options: ['Basic', 'Pro', 'Enterprise'] },
        { type: 'formField', fieldType: 'checkbox', name: 'newsletter', label: 'Subscribe to the newsletter' },
    ];
    const params: DocumentParams = { title: 'Membership application', blocks };
    return buildDocumentPDFBytes(params);
}

export async function generate(ctx: GenerateContext): Promise<void> {
    const blank = blankForm();
    ctx.writeSafe(resolve(ctx.outputDir, 'forms', 'fill-blank.pdf'), 'forms/fill-blank.pdf', blank);

    // Sanity: the form is discoverable.
    const names = readFormFields(blank).map(f => f.name).join(', ');
    void names;

    const filled = fillForm(blank, {
        fullName: 'Ada Lovelace',
        email: 'ada@analytical.engine',
        address: '12 Baggage Lane\nLondon',
        plan: 'Pro',
        newsletter: true,
    });
    ctx.writeSafe(resolve(ctx.outputDir, 'forms', 'fill-filled.pdf'), 'forms/fill-filled.pdf', filled);

    const flat = flattenForm(filled);
    ctx.writeSafe(resolve(ctx.outputDir, 'forms', 'fill-flattened.pdf'), 'forms/fill-flattened.pdf', flat);
}
