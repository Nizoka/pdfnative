/**
 * Tagged table header semantics (1.9.0): every `/TH` carries
 * `/A << /O /Table /Scope /Column >>` and an `/ID`, every `/TD` names its
 * header through `/Headers`, and the `/StructTreeRoot` registers the ids in
 * an `/IDTree` (ISO 32000-1 §14.8.4.3.4, Table 349; ISO 14289-1 §7.5). Both
 * builders, sliced tables included; `validatePdfUA` checks the same.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { validatePdfUA } from '../../src/parser/pdf-ua-validator.js';
import type { DocumentParams, TableBlock } from '../../src/types/pdf-document-types.js';
import type { PdfParams } from '../../src/types/pdf-types.js';

const latin1 = (b: Uint8Array): string => new TextDecoder('latin1').decode(b);

const table: TableBlock = {
    type: 'table',
    headers: ['Item', 'Qty'],
    rows: [{ cells: ['Pen', '2'], type: '', pointed: false }, { cells: ['Ink', '1'], type: '', pointed: false }],
};
const doc: DocumentParams = { title: 'Headers', blocks: [table] };

describe('tagged table header semantics (1.9.0)', () => {
    it('document builder: TH carries /Scope and /ID, TD names its header, the root has an /IDTree', () => {
        const s = latin1(buildDocumentPDFBytes(doc, { tagged: true, onDiagnostic: () => {} }));
        expect(s.match(/\/S \/TH \/P \d+ 0 R \/ID \(T0H0C[01]\) \/A << \/O \/Table \/Scope \/Column >>/g)?.length).toBe(2);
        expect(s.match(/\/S \/TD \/P \d+ 0 R \/A << \/O \/Table \/Headers \[\(T0H0C0\)\] >>/g)?.length).toBe(2);
        expect(s.match(/\/S \/TD \/P \d+ 0 R \/A << \/O \/Table \/Headers \[\(T0H0C1\)\] >>/g)?.length).toBe(2);
        expect(s).toMatch(/\/StructTreeRoot \/K \d+ 0 R \/ParentTree \d+ 0 R \/IDTree << \/Names \[\(T0H0C0\) \d+ 0 R \(T0H0C1\) \d+ 0 R\] >>/);
    });

    it('numbers tables in document order and header rows per slice', () => {
        const long: TableBlock = { ...table, rows: Array.from({ length: 90 }, (_, i) => ({ cells: [`row ${i}`, String(i)], type: '', pointed: false })) };
        const s = latin1(buildDocumentPDFBytes({ title: 'Two', blocks: [table, long] }, { tagged: true, onDiagnostic: () => {} }));
        // Second table, first slice header: T1H0C*; a repeated header on the
        // continuation slice gets its own ids (T1H<fromRow>C*) and its rows
        // reference those.
        expect(s).toContain('/ID (T1H0C0)');
        const repeated = s.match(/\/ID \(T1H(\d+)C0\)/g) ?? [];
        expect(repeated.length).toBeGreaterThanOrEqual(2);
        const fromRow = repeated[1].match(/H(\d+)/)![1];
        expect(fromRow).not.toBe('0');
        expect(s).toContain(`/Headers [(T1H${fromRow}C0)]`);
    });

    it('table builder: the same attributes, one table', () => {
        const params: PdfParams = {
            title: 'Statement',
            infoItems: [{ label: 'Period', value: '2026' }],
            balanceText: '',
            countText: '',
            footerText: '',
            headers: ['Date', 'Ref', 'Description', 'Amount'],
            rows: [{ cells: ['2026-01-02', 'A1', 'Opening', '100.00'], type: 'credit', pointed: false }],
        };
        const s = latin1(buildPDFBytes(params, { tagged: true, onDiagnostic: () => {} }));
        expect(s.match(/\/Scope \/Column/g)?.length).toBe(4);
        expect(s.match(/\/Headers \[\(T0H0C3\)\]/g)?.length).toBe(1);
        expect(s).toContain('/IDTree << /Names [(T0H0C0)');
    });

    it('validatePdfUA accepts the output and would flag a TH without /Scope', () => {
        const res = validatePdfUA(buildDocumentPDFBytes(doc, { tagged: true, onDiagnostic: () => {} }));
        expect(res.errors).toEqual([]);
        expect(res.warnings.some(w => w.includes('/Headers'))).toBe(false);
        // Strip the attributes to simulate a 1.8.0 document.
        const bytes = buildDocumentPDFBytes(doc, { tagged: true, onDiagnostic: () => {} });
        const needle = ' /A << /O /Table /Scope /Column >>';
        const text = latin1(bytes).split(needle).join(' '.repeat(needle.length));
        const stripped = Uint8Array.from(text, c => c.charCodeAt(0));
        const old = validatePdfUA(stripped);
        expect(old.errors.some(e => e.includes('/TH') && e.includes('/Scope'))).toBe(true);
    });

    it('untagged tables carry no attributes and no /IDTree', () => {
        const s = latin1(buildDocumentPDFBytes(doc));
        expect(s).not.toContain('/Scope');
        expect(s).not.toContain('/IDTree');
    });
});
