// pdfnative — runtime smoke checks
// ================================
// One document written and read back, one CIDFont document whose shaped
// Arabic text extracts through its ToUnicode CMap, one encrypted round trip,
// two files merged and a QR matrix — run against the BUILT package
// (dist/index.js) on a runtime other than Node: Deno, Bun and headless
// Chromium (.github/workflows/ci.yml, job `runtimes`). README.md and llms.txt
// say the same build runs there; this is what holds that sentence to a run
// instead of a belief.
//
// Plain ESM with no import of its own and no host API beyond `TextDecoder`,
// so the one file runs unchanged in all of them. The font module is handed
// in by the caller (run.mjs, browser.mjs, tests/tools/workflows.test.ts),
// because each host loads it from a different place.

/** @param {unknown} ok @param {string} what */
function check(ok, what) {
    if (ok !== true) throw new Error(`runtime smoke: ${what}`);
}

/** @param {Uint8Array} bytes @param {string} ascii @param {number} at */
function hasAscii(bytes, ascii, at) {
    for (let i = 0; i < ascii.length; i++) if (bytes[at + i] !== ascii.charCodeAt(i)) return false;
    return true;
}

const ARABIC = 'مرحبا بالعالم';
const PINNED = { creationDate: new Date('2026-01-01T00:00:00Z') };

/**
 * @param {typeof import('../../dist/index.js')} m The package under test.
 * @param {{ arabic: import('../../dist/index.js').FontData }} fonts The bundled Noto Sans Arabic module.
 * @returns {Promise<string[]>} One line per check that passed.
 */
export async function runChecks(m, fonts) {
    const passed = [];

    // A document with the block types that exercise text, tables, lists and
    // links, on the unembedded Helvetica — no font bytes involved.
    const latin = m.buildDocumentPDFBytes({
        title: 'Runtime smoke',
        blocks: [
            { type: 'heading', text: 'pdfnative runtime smoke', level: 1 },
            { type: 'paragraph', text: 'The same build runs on every runtime.' },
            { type: 'list', style: 'numbered', items: ['write', 'read back', 'extract'] },
            { type: 'table', headers: ['Check', 'State'], rows: [{ cells: ['header', 'ok'], type: 'credit', pointed: false }] },
            { type: 'link', text: 'pdfnative.dev', url: 'https://pdfnative.dev' },
        ],
    }, PINNED);
    check(hasAscii(latin, '%PDF-1.', 0), 'the document starts with a PDF header');
    check(hasAscii(latin, '%%EOF', latin.length - 5), 'the document ends with %%EOF');
    const reader = m.openPdf(latin);
    check(reader.pageCount === 1, `one page, not ${reader.pageCount}`);
    const text = m.extractText(latin)[0].text;
    check(text.includes('every runtime'), `the paragraph extracts (got ${JSON.stringify(text.slice(0, 80))})`);
    passed.push('write a document, open it, extract its text (Helvetica)');

    // A CIDFontType2 document: the Arabic shaper, the lean TrueType subset
    // and the ToUnicode CMap, proven by getting every letter back out.
    const arabic = m.buildDocumentPDFBytes({
        title: 'Runtime smoke (Arabic)',
        blocks: [{ type: 'paragraph', text: ARABIC }],
        fontEntries: [{ fontData: fonts.arabic, fontRef: '/F3', lang: 'arabic' }],
    }, PINNED);
    const extracted = m.extractText(arabic)[0].text;
    for (const letter of new Set(ARABIC.replace(/ /g, ''))) {
        check(extracted.includes(letter), `U+${letter.codePointAt(0).toString(16).toUpperCase()} extracts from the CIDFont document`);
    }
    check(hasAscii(arabic, '%PDF-1.', 0), 'the CIDFont document starts with a PDF header');
    passed.push('shape Arabic, embed the subset, extract every letter back through ToUnicode');

    // AES-256 in pure TypeScript: no Web Crypto, no host dependency.
    const encrypted = m.buildDocumentPDFBytes({
        title: 'Runtime smoke (encrypted)',
        blocks: [{ type: 'paragraph', text: 'Behind AES-256.' }],
    }, { ...PINNED, encryption: { ownerPassword: 'owner', algorithm: 'aes256' } });
    const opened = m.openPdf(encrypted);
    check(opened.encryption !== null, 'the encrypted document reports its encryption');
    check(m.extractText(encrypted)[0].text.includes('AES-256'), 'the encrypted document decrypts and extracts');
    passed.push('encrypt with AES-256, decrypt and extract');

    const merged = m.mergePdfs([latin, arabic]);
    check(m.openPdf(merged).pageCount === 2, 'the merged document has two pages');
    passed.push('merge two documents');

    const qr = m.generateQR('pdfnative');
    check(Array.isArray(qr) && qr.length >= 21 && Array.isArray(qr[0]) && qr[0].length === qr.length, 'a square QR matrix of at least version 1');
    passed.push('generate a QR matrix');

    return passed;
}
