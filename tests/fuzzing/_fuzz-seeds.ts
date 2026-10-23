/**
 * Seeds for the ClusterFuzzLite targets in `fuzz/`, one list per target.
 *
 * A coverage-guided fuzzer started from random bytes spends its first days
 * rediscovering `%PDF`, `obj` and `stream`; started from a file that parses,
 * it is inside the grammar on its first mutation. Every seed here is BUILT by
 * the library itself (or hand-assembled from constants, like the xref-stream
 * file), never committed: a document in each shape the writer emits, PDF
 * syntax snippets, zlib streams, the four image formats and one bundled
 * TrueType face.
 *
 * Two consumers, one list:
 *   - `tests/fuzzing/targets.test.ts` feeds every seed, truncated and
 *     mutated, to its target on every gate run;
 *   - `.clusterfuzzlite/build.sh` runs this file as a script
 *     (`npx tsx tests/fuzzing/_fuzz-seeds.ts <dir>`), which writes
 *     `<dir>/<target>/<n>.bin` for the build step to zip into each target's
 *     seed corpus.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDocumentPDFBytes } from '../../src/core/pdf-document.js';
import { buildPDFBytes } from '../../src/core/pdf-builder.js';
import { mergePdfs } from '../../src/parser/pdf-pagetree.js';
import { deflateStored, deflateSync } from '../../src/core/pdf-compress.js';
import { getDecodedFontBytes } from '../../src/fonts/font-loader.js';
import * as notoHebrew from '../../fonts/noto-hebrew-data.js';
import { makeMinimalJPEG, makeSyntheticPNG, makeMinimalJ2K, makeMinimalJP2 } from '../../scripts/helpers/images.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';
import type { FontData, FontEntry, PdfLayoutOptions, PdfParams } from '../../src/types/pdf-types.js';

/** The target names, as `fuzz/<name>.js`. */
export type FuzzTarget = 'document' | 'font-data' | 'image' | 'inflate' | 'object-parser' | 'tokenizer' | 'xref';

export const FUZZ_TARGETS: readonly FuzzTarget[] = ['document', 'font-data', 'image', 'inflate', 'object-parser', 'tokenizer', 'xref'];

const PINNED: Partial<PdfLayoutOptions> = { creationDate: new Date('2026-01-01T00:00:00Z') };
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

/** The documents, in every shape the two builders emit. */
function documents(): Uint8Array[] {
    const hebrew = notoHebrew as unknown as FontData;
    const cid: FontEntry = { fontData: hebrew, fontRef: '/F3', lang: 'hebrew' };
    const rich: DocumentParams = {
        title: 'Fuzz seed',
        blocks: [
            { type: 'heading', text: 'Heading one', level: 1 },
            { type: 'paragraph', text: 'A paragraph with (parentheses), a back\\slash and <angle brackets>.' },
            { type: 'list', style: 'bullet', items: ['first', 'second'] },
            { type: 'table', headers: ['Item', 'Amount'], rows: [{ cells: ['Fee', '12.00'], type: 'credit', pointed: false }] },
            { type: 'image', data: makeSyntheticPNG(), width: 40, height: 40, alt: 'a square' },
            { type: 'image', data: makeMinimalJPEG(), width: 40, height: 40 },
            { type: 'link', text: 'pdfnative.dev', url: 'https://pdfnative.dev' },
            { type: 'formField', fieldType: 'text', name: 'who', label: 'Name', value: 'seed' },
            { type: 'barcode', format: 'qr', data: 'pdfnative' },
        ],
        footerText: 'seed',
    };
    const plain = buildDocumentPDFBytes({ title: 'Plain', blocks: [{ type: 'paragraph', text: 'Hello seed' }] }, PINNED);
    const full = buildDocumentPDFBytes(rich, PINNED);
    const uncompressed = buildDocumentPDFBytes(rich, { ...PINNED, compress: false });
    const tagged = buildDocumentPDFBytes({ ...rich, blocks: rich.blocks.filter(b => b.type !== 'formField') }, { ...PINNED, tagged: true, onDiagnostic: () => undefined });
    const unicode = buildDocumentPDFBytes({ title: 'CID', blocks: [{ type: 'paragraph', text: 'שלום עולם 123' }], fontEntries: [cid] }, PINNED);
    const aes128 = buildDocumentPDFBytes(rich, { ...PINNED, encryption: { ownerPassword: 'owner', algorithm: 'aes128' } });
    const aes256 = buildDocumentPDFBytes(rich, { ...PINNED, encryption: { ownerPassword: 'owner', algorithm: 'aes256' } });
    const table: PdfParams = {
        title: 'Table', infoItems: [], balanceText: '12.00', countText: '1 row', footerText: 'f',
        headers: ['A', 'B', 'C'], rows: [{ cells: ['x', 'y', '1.00'], type: 'credit', pointed: true }],
    };
    const legacy = buildPDFBytes(table, PINNED);
    const merged = mergePdfs([plain, unicode]);
    return [plain, full, uncompressed, tagged, unicode, aes128, aes256, legacy, merged, xrefStreamPdf(12), xrefStreamPdf()];
}

/**
 * A tiny cross-reference-STREAM file (ISO 32000-1 §7.5.8): three objects and
 * the /XRef stream as object 4, optionally PNG-Up pre-filtered (predictor 12)
 * the way mainstream producers emit it.
 */
function xrefStreamPdf(predictor?: number): Uint8Array {
    const objs = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n',
    ];
    let body = '%PDF-1.5\n';
    const offsets: number[] = [0];
    for (const o of objs) { offsets.push(body.length); body += o; }
    const xrefPos = body.length;
    offsets.push(xrefPos);
    const rowBytes = 4;
    const rows: number[][] = [[0, 0, 0]];
    for (let n = 1; n <= 4; n++) rows.push([1, offsets[n], 0]);
    const raw = new Uint8Array(rows.length * rowBytes);
    rows.forEach((row, r) => { raw[r * rowBytes] = row[0]; raw[r * rowBytes + 1] = (row[1] >> 8) & 0xFF; raw[r * rowBytes + 2] = row[1] & 0xFF; raw[r * rowBytes + 3] = row[2]; });
    let payload = raw;
    let parms = '';
    if (predictor === 12) {
        const out = new Uint8Array(rows.length * (rowBytes + 1));
        const prev = new Uint8Array(rowBytes);
        for (let r = 0; r < rows.length; r++) {
            out[r * (rowBytes + 1)] = 2;
            for (let i = 0; i < rowBytes; i++) out[r * (rowBytes + 1) + 1 + i] = (raw[r * rowBytes + i] - prev[i]) & 0xFF;
            prev.set(raw.subarray(r * rowBytes, (r + 1) * rowBytes));
        }
        payload = out;
        parms = ' /DecodeParms << /Predictor 12 /Columns 4 >>';
    }
    const data = deflateSync(payload);
    body += `4 0 obj\n<< /Type /XRef /Size 5 /W [1 2 1] /Root 1 0 R /Filter /FlateDecode${parms} /Length ${data.length} >>\nstream\n`;
    for (let i = 0; i < data.length; i++) body += String.fromCharCode(data[i]);
    body += `\nendstream\nendobj\nstartxref\n${xrefPos}\n%%EOF`;
    const out = new Uint8Array(body.length);
    for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xFF;
    return out;
}

/** PDF syntax that parses: one object of each kind and the nested forms (§7.3). */
function syntax(): Uint8Array[] {
    return [
        '<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) /N#20ame#2Fx 1.5 /A -3 /B +7 /C .5 /D true /E false /F null >>',
        '[1 0 R 2 0 R (a string with \\(escapes\\) \\n \\101 and\nnewline) <414243 44> /Name [[[[1]]]] << /K [1 2] >>]',
        '<</A<</B<</C<</D<</E<</F<</G<</H 1>>>>>>>>>>>>>>>>',
        '1 0 R',
        '99999999999999999999',
        'true',
    ].map(text);
}

/** PDF syntax a tokenizer must survive and a parser may refuse: truncated, unbalanced, keywords out of place. */
function brokenSyntax(): Uint8Array[] {
    return [
        '% a comment\n1 0 obj\n<< /Length 5 >>\nstream\nhello\nendstream\nendobj\n',
        '(unbalanced (parenthesis',
        '<4142434',
        '/Name#',
        '1 0 R 0 0 R -1 0 R 99999999999999999999 0 R',
        'true false null obj endobj stream endstream xref trailer startxref',
        '} { ) >> ] >',
    ].map(text);
}

/** zlib streams: stored, dynamic-Huffman (the host's zlib), and an empty payload. */
async function zlibStreams(): Promise<Uint8Array[]> {
    const payload = text('BT /F1 12 Tf 72 720 Td (Hello) Tj ET\n'.repeat(40));
    const zlibName = 'node:zlib';
    const zlib = (await import(zlibName)) as { deflateSync(buf: Uint8Array): Uint8Array };
    return [deflateStored(payload), new Uint8Array(zlib.deflateSync(payload)), new Uint8Array(zlib.deflateSync(new Uint8Array(0)))];
}

/** The four image formats the builder embeds. */
function images(): Uint8Array[] {
    return [makeMinimalJPEG(), makeSyntheticPNG(), makeMinimalJ2K(1), makeMinimalJP2(3, { alpha: true })];
}

/** Every target's seeds. */
export async function fuzzSeeds(): Promise<Readonly<Record<FuzzTarget, readonly Uint8Array[]>>> {
    const docs = documents();
    return {
        document: docs,
        'font-data': [getDecodedFontBytes(notoHebrew as unknown as FontData)],
        image: images(),
        inflate: await zlibStreams(),
        'object-parser': [...syntax(), ...docs.slice(0, 2)],
        tokenizer: [...syntax(), ...brokenSyntax(), ...docs.slice(0, 2)],
        xref: [...docs, text('%PDF-1.4\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF')],
    };
}

// ── CLI: write the seeds for the ClusterFuzzLite build ───────────────

const invokedDirectly = typeof process !== 'undefined' && process.argv[1] !== undefined
    && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
    const dir = process.argv[2];
    if (!dir) {
        process.stderr.write('usage: npx tsx tests/fuzzing/_fuzz-seeds.ts <output-dir>\n');
        process.exit(2);
    }
    const seeds = await fuzzSeeds();
    let total = 0;
    for (const target of FUZZ_TARGETS) {
        mkdirSync(join(dir, target), { recursive: true });
        seeds[target].forEach((seed, i) => { writeFileSync(join(dir, target, `${i}.bin`), seed); total++; });
    }
    process.stdout.write(`fuzz seeds: ${total} files for ${FUZZ_TARGETS.length} targets in ${dir}\n`);
}
