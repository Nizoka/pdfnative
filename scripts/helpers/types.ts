/**
 * Shared sample data types for generators.
 */

import type { DocumentParams, PdfLayoutOptions } from '../../src/index.js';

export interface LangSample {
    lang: string;
    filename?: string;
    title: string;
    infoItems: { label: string; value: string }[];
    balanceText: string;
    countText: string;
    headers: string[];
    rows: { cells: string[]; type: string; pointed: boolean }[];
    footerText: string;
}

export interface PdfASample {
    filename: string;
    tagged: boolean | 'pdfa1b' | 'pdfa2b' | 'pdfa2u' | 'pdfa3b';
    description: string;
}

export interface EncryptSample {
    filename: string;
    algorithm: 'aes128' | 'aes256';
    ownerPassword: string;
    userPassword?: string;
    permissions?: { print?: boolean; copy?: boolean; modify?: boolean; extractText?: boolean };
    description: string;
}

export interface DocSample {
    filename: string;
    params: DocumentParams;
    options?: Partial<PdfLayoutOptions>;
    description: string;
}
