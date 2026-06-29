/**
 * Tests for nested (hierarchical) lists — v1.4.0.
 *
 * A `ListBlock.items` entry may be a plain string (leaf) or a `{ text, items }`
 * object carrying a nested sub-list. String-only lists stay byte-identical to
 * the pre-1.4.0 flat behaviour; nested lists indent deeper and, in tagged mode,
 * nest `/L → /LI → /L` structure elements.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import type { DocumentParams, ListBlock } from '../../src/types/pdf-document-types.js';

function bytesToLatin1(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
}

function doc(list: ListBlock, extra?: Partial<DocumentParams>): Uint8Array {
    return buildDocumentPDFBytes({
        title: 'Lists',
        blocks: [{ type: 'heading', text: 'H', level: 1 }, list],
        ...extra,
    });
}

describe('nested lists', () => {
    it('renders a string-only list byte-identically to a {text}-object list', () => {
        const strings: ListBlock = { type: 'list', style: 'bullet', items: ['Alpha', 'Beta', 'Gamma'] };
        const objects: ListBlock = {
            type: 'list',
            style: 'bullet',
            items: [{ text: 'Alpha' }, { text: 'Beta' }, { text: 'Gamma' }],
        };
        expect(bytesToLatin1(doc(strings))).toBe(bytesToLatin1(doc(objects)));
    });

    it('is deterministic for the same flat input', () => {
        const list: ListBlock = { type: 'list', style: 'numbered', items: ['a', 'b'] };
        expect(bytesToLatin1(doc(list))).toBe(bytesToLatin1(doc(list)));
    });

    it('produces more content when a sub-list is nested', () => {
        const flat: ListBlock = { type: 'list', style: 'bullet', items: ['Parent'] };
        const nested: ListBlock = {
            type: 'list',
            style: 'bullet',
            items: [{ text: 'Parent', items: ['Child 1', 'Child 2'] }],
        };
        const flatLen = doc(flat).length;
        const nestedLen = doc(nested).length;
        expect(nestedLen).toBeGreaterThan(flatLen);
    });

    it('nests /L → /LI → /L structure elements in tagged mode', () => {
        const nested: ListBlock = {
            type: 'list',
            style: 'bullet',
            items: [
                { text: 'Top', items: [{ text: 'Mid', items: ['Leaf'] }] },
            ],
        };
        const pdf = bytesToLatin1(doc(nested, { layout: { tagged: 'pdfa2b' } }));
        // One /L per nesting level → at least 3 list structure elements.
        const lCount = (pdf.match(/\/S \/L /g) ?? []).length;
        expect(lCount).toBeGreaterThanOrEqual(3);
        expect(pdf).toContain('/S /LI ');
    });

    it('keeps a flat tagged list at a single /L level', () => {
        const flat: ListBlock = { type: 'list', style: 'bullet', items: ['x', 'y'] };
        const pdf = bytesToLatin1(doc(flat, { layout: { tagged: 'pdfa2b' } }));
        const lCount = (pdf.match(/\/S \/L /g) ?? []).length;
        expect(lCount).toBe(1);
    });

    it('mixes plain strings and nested objects in one list', () => {
        const mixed: ListBlock = {
            type: 'list',
            style: 'bullet',
            items: ['Plain', { text: 'WithKids', items: ['Kid'] }, 'AnotherPlain'],
        };
        expect(() => doc(mixed)).not.toThrow();
        expect(doc(mixed).length).toBeGreaterThan(0);
    });
});
