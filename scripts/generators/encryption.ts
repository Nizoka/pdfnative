/**
 * Encryption variant samples — AES-128, AES-256, passwords, permissions.
 */

import { resolve } from 'path';
import { buildPDFBytes } from '../../src/index.js';
import type { PdfParams } from '../../src/index.js';
import type { GenerateContext } from '../helpers/io.js';
import type { EncryptSample } from '../helpers/types.js';

const ENCRYPT_SAMPLES: EncryptSample[] = [
    { filename: 'encrypted-aes128', algorithm: 'aes128', ownerPassword: 'owner123', description: 'AES-128 encrypted (owner-only password)' },
    { filename: 'encrypted-aes256', algorithm: 'aes256', ownerPassword: 'owner256', description: 'AES-256 encrypted (owner-only password)' },
    { filename: 'encrypted-aes128-user', algorithm: 'aes128', ownerPassword: 'owner123', userPassword: 'user456', description: 'AES-128 with user+owner passwords' },
    { filename: 'encrypted-aes256-user', algorithm: 'aes256', ownerPassword: 'owner256', userPassword: 'user789', description: 'AES-256 with user+owner passwords' },
    { filename: 'encrypted-readonly', algorithm: 'aes128', ownerPassword: 'owner-ro', permissions: { print: true, copy: false, modify: false, extractText: true }, description: 'AES-128 read-only (no copy, no modify)' },
    { filename: 'encrypted-noprint', algorithm: 'aes128', ownerPassword: 'owner-np', permissions: { print: false, copy: false, modify: false, extractText: false }, description: 'AES-128 fully restricted' },
];

export async function generate(ctx: GenerateContext): Promise<void> {
    for (const enc of ENCRYPT_SAMPLES) {
        const params: PdfParams = {
            title: `Encrypted PDF – ${enc.description}`,
            infoItems: [
                { label: 'Algorithm', value: enc.algorithm.toUpperCase() },
                { label: 'Owner Password', value: enc.ownerPassword },
                { label: 'User Password', value: enc.userPassword || '(none)' },
            ],
            balanceText: 'Encrypted Document',
            countText: '3 sample rows',
            headers: ['Feature', 'Setting', 'Value', 'Spec', 'Notes'],
            rows: [
                { cells: ['Encryption', enc.algorithm, enc.algorithm === 'aes128' ? 'V4/R4' : 'V5/R6', 'ISO 32000-1', `/CFM /${enc.algorithm === 'aes128' ? 'AESV2' : 'AESV3'}`], type: 'credit', pointed: false },
                { cells: ['Print', String(enc.permissions?.print ?? true), enc.permissions?.print === false ? 'Disabled' : 'Enabled', 'Table 22', 'Bit 3'], type: enc.permissions?.print === false ? 'debit' : 'credit', pointed: false },
                { cells: ['Copy', String(enc.permissions?.copy ?? false), enc.permissions?.copy ? 'Enabled' : 'Disabled', 'Table 22', 'Bit 5'], type: enc.permissions?.copy ? 'credit' : 'debit', pointed: true },
            ],
            footerText: `pdfnative – ${enc.description}`,
        };

        const bytes = buildPDFBytes(params, {
            encryption: {
                ownerPassword: enc.ownerPassword,
                userPassword: enc.userPassword,
                algorithm: enc.algorithm,
                permissions: enc.permissions,
            },
        });
        const filename = `${enc.filename}.pdf`;
        ctx.writeSafe(resolve(ctx.outputDir, 'encryption', filename), `encryption/${filename}`, bytes);
    }
}
