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
import type { DocumentParams, DocumentBlock, EncryptionOptions } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';

function blankForm(encryption?: EncryptionOptions): Uint8Array {
    const blocks: DocumentBlock[] = [
        { type: 'heading', text: 'Membership application', level: 1 },
        { type: 'formField', fieldType: 'text', name: 'fullName', label: 'Full name' },
        { type: 'formField', fieldType: 'text', name: 'email', label: 'Email' },
        { type: 'formField', fieldType: 'multilineText', name: 'address', label: 'Address', height: 60 },
        { type: 'formField', fieldType: 'dropdown', name: 'plan', label: 'Plan', options: ['Basic', 'Pro', 'Enterprise'] },
        { type: 'formField', fieldType: 'checkbox', name: 'newsletter', label: 'Subscribe to the newsletter' },
    ];
    const params: DocumentParams = { title: 'Membership application', blocks };
    return buildDocumentPDFBytes(params, encryption !== undefined ? { encryption } : undefined);
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

    // ── Encrypted incremental update (v1.6.0) ────────────────────────
    // The blank form is AES-256 protected; fillForm/flattenForm append
    // objects encrypted under the document's existing scheme.
    // Open with user password "pdfnative" (owner: "pdfnative-owner").
    const encBlank = blankForm({ ownerPassword: 'pdfnative-owner', userPassword: 'pdfnative', algorithm: 'aes256' });
    const encFilled = fillForm(encBlank, {
        fullName: 'Grace Hopper',
        email: 'grace@navy.mil',
        plan: 'Enterprise',
        newsletter: true,
    }, { password: 'pdfnative' });
    ctx.writeSafe(resolve(ctx.outputDir, 'forms', 'filled-encrypted.pdf'), 'forms/filled-encrypted.pdf', encFilled);

    const encFlat = flattenForm(encFilled, { password: 'pdfnative' });
    ctx.writeSafe(resolve(ctx.outputDir, 'forms', 'flattened-encrypted.pdf'), 'forms/flattened-encrypted.pdf', encFlat);
}
