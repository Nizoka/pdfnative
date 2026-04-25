# FAQ

> Frequently asked questions about pdfnative. Can't find your answer? Open a [discussion](https://github.com/Nizoka/pdfnative/discussions) or read the [Troubleshooting guide](troubleshooting.html).

## Getting started

### How do I generate my first PDF?

```typescript
import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';

const pdf = buildDocumentPDFBytes({
  title: 'Hello',
  blocks: [
    { type: 'heading',   text: 'Hello world', level: 1 },
    { type: 'paragraph', text: 'My first PDF.' },
  ],
});

downloadBlob(pdf, 'hello.pdf');     // browser
// or, in Node.js:
// fs.writeFileSync('hello.pdf', pdf);
```

See the [Quick Start guide](quickstart.html) for Node.js, browser, and Web Worker walkthroughs.

### Which builder should I pick: `buildPDFBytes` or `buildDocumentPDFBytes`?

| Builder | Best for | Key shape |
|---------|----------|-----------|
| `buildPDFBytes` | Tabular reports, bank statements, invoices with a single table | `{ title, headers, rows, infoItems, balanceText, ... }` |
| `buildDocumentPDFBytes` | Mixed-content documents (manuals, articles, multi-section reports) | `{ title, blocks: [...] }` with 12 block types |

Both return `Uint8Array` and accept the same layout / encryption / compression / tagged-PDF options.

### Does it work in the browser?

Yes — pdfnative is a dual ESM/CJS build with zero Node.js-specific APIs in the core:

```typescript
import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';

const pdf = buildDocumentPDFBytes({ title: 'Hello', blocks: [/* … */] });
downloadBlob(pdf, 'output.pdf');
```

For optimal compression in Node.js, call `initNodeCompression()` once at startup. In the browser, a stored-block fallback is used automatically.

### Does it work with Deno / Bun?

Yes. The library is standard ESM with no Node.js-specific imports in the core. Both Deno and Bun import it directly.

---

## Fonts and Unicode

### Can I use custom fonts?

Yes. Build a font data module from any TTF file:

```bash
node tools/build-font-data.cjs path/to/MyFont.ttf my-font-data
```

Then register it:

```typescript
import { registerFonts, loadFontData, buildDocumentPDFBytes } from 'pdfnative';

registerFonts({
  custom: () => import('./my-font-data.js'),
});

const myFont = await loadFontData('custom');
const pdf = buildDocumentPDFBytes({
  blocks: [{ type: 'paragraph', text: '…' }],
  fontEntries: [{ fontData: myFont!, fontRef: '/F3', lang: 'custom' }],
});
```

Font subsetting is automatic — only the glyphs you actually used are embedded.

### How do I render Arabic / Hebrew / Thai / Devanagari?

Register the matching pre-built font module and pass it as a `fontEntry`:

```typescript
registerFonts({
  ar: () => import('pdfnative/fonts/noto-arabic-data.js'),
  he: () => import('pdfnative/fonts/noto-hebrew-data.js'),
  th: () => import('pdfnative/fonts/noto-thai-data.js'),
  hi: () => import('pdfnative/fonts/noto-devanagari-data.js'),
});

const langs = ['ar', 'he', 'th', 'hi'];
const fontEntries = (await Promise.all(langs.map(loadFontData)))
  .map((fd, i) => fd ? { fontData: fd, fontRef: `/F${3 + i}`, lang: langs[i] } : null)
  .filter(Boolean);

const pdf = buildDocumentPDFBytes({
  blocks: [
    { type: 'paragraph', text: 'مرحبا — שלום — สวัสดี — नमस्ते' },
  ],
  fontEntries,
});
```

The `lang` property triggers BiDi resolution for RTL scripts and OpenType GSUB/GPOS shaping for Arabic, Devanagari, Bengali, Tamil, and Thai.

### Why does my Arabic text appear backwards?

The most common cause: missing `lang: 'ar'` on the font entry. Without it, BiDi resolution and Arabic positional shaping are skipped. See [Troubleshooting → RTL Text Backwards](troubleshooting.html).

### Which scripts are supported out of the box?

16 Noto Sans scripts ship as separate font modules: Arabic, Armenian, Bengali, Cyrillic, Devanagari, Georgian, Greek, Hebrew, Japanese, Korean, Polish, Simplified Chinese, Tamil, Thai, Turkish, Vietnamese.

---

## Standards and compliance

### What PDF versions can pdfnative produce?

| Mode | PDF version | Standard |
|------|-------------|----------|
| Default | 1.4 | ISO 32000-1 |
| `tagged: true` | 1.7 | PDF/A-2b (default tagged mode, ISO 19005-2) |
| `tagged: 'pdfa1b'` | 1.4 | PDF/A-1b (ISO 19005-1) |
| `tagged: 'pdfa2u'` | 1.7 | PDF/A-2u (ISO 19005-2 with unicode) |
| `tagged: 'pdfa3b'` | 1.7 | PDF/A-3b (ISO 19005-3, supports embedded files) |

### Which PDF/A variant should I pick?

- **PDF/A-1b** — strictest, oldest. Pick only if your validator requires PDF 1.4 and you don't need transparency, JPEG2000, or layers.
- **PDF/A-2b** *(recommended default)* — PDF 1.7, supports transparency, layers, OpenType. Most modern archive systems target 2b.
- **PDF/A-2u** — same as 2b plus mandatory Unicode mapping for all text. Pick if downstream consumers need text extraction.
- **PDF/A-3b** — PDF/A-2b + ability to embed arbitrary attachments (e.g. source XML for invoicing standards like ZUGFeRD/Factur-X). Note: not all archive policies allow A-3.

### Can I combine PDF/A and encryption?

No. ISO 19005-1 §6.3.2 forbids encryption inside PDF/A documents. pdfnative validates this at the `buildPDF()` boundary and throws an error if both are requested. Pick one or the other.

### Is the output tagged for accessibility (PDF/UA)?

Yes — when you set `tagged: true` (or any PDF/A mode), pdfnative emits a structure tree with `/Document → /Table → /TR → /TH|TD`, `/H1`–`/H3`, `/P`, `/L`/`/LI`, `/Figure`, `/Link`, `/Form`, `/TOC`/`/TOCI`, and uses `/ActualText` for shaped Unicode. See the [Accessibility guide](accessibility.html).

---

## Security

### How do I encrypt a PDF?

```typescript
const pdf = buildPDFBytes(params, {
  encryption: {
    algorithm: 'aes256',           // or 'aes128'
    userPassword: 'reader',
    ownerPassword: 'editor',
    permissions: {
      print: true,
      modify: false,
      copy: false,
      annotate: false,
    },
  },
});
```

`aes256` (V5/R6) is recommended for new documents. Use `aes128` (V4/R4) only when you need compatibility with very old viewers.

### How do I sign a PDF digitally?

```typescript
import { signPdfBytes } from 'pdfnative';

const signed = signPdfBytes(pdfBytes, {
  privateKey: keyDer,    // DER-encoded RSA or ECDSA private key
  certificate: certDer,  // DER-encoded X.509 certificate
  reason: 'Approved',
  name: 'Jane Doe',
});
```

pdfnative implements ISO 32000-1 §12.8 — CMS/PKCS#7 SignedData with RSA (PKCS#1 v1.5) or ECDSA (P-256), SHA-256/384/512. The crypto stack is implemented in pure TypeScript inside `src/crypto/` — no native modules, no `node:crypto`.

### Is the build supply-chain safe?

- **Zero runtime dependencies** — `npm install pdfnative` brings in nothing transitive at runtime.
- **NPM provenance** — every release is signed via GitHub Actions OIDC (SLSA L3-equivalent).
- **OpenSSF Scorecard** scanned weekly; CodeQL on every push.
- **Pinned dev dependencies** managed via Dependabot.

---

## Modifying existing PDFs

### Can I read or modify existing PDFs?

Yes. pdfnative includes a tokenizer, object parser, xref/stream parser, and a non-destructive incremental modifier:

```typescript
import { openPdf, createModifier } from 'pdfnative';

const reader = openPdf(new Uint8Array(fs.readFileSync('input.pdf')));

console.log(`Pages: ${reader.pageCount}`);
console.log(`Title: ${reader.getInfo()?.get('Title')}`);

const mod = createModifier(reader);
mod.setMetadata('Title', 'Updated Title');
const updated = mod.save();   // appends a new xref/trailer with /Prev chain
```

### What's the maximum document size?

`buildPDFBytes` enforces a 100 000 row limit on tables. `buildDocumentPDFBytes` paginates automatically and has no hard limit — the practical ceiling is your available memory. For very large documents, see the streaming question below.

### How do I avoid loading the whole PDF into memory?

Use the streaming API — it returns an `AsyncGenerator<Uint8Array>` that yields chunks as they're produced:

```typescript
import { streamDocumentPdf } from 'pdfnative';

for await (const chunk of streamDocumentPdf(params, { chunkSize: 65536 })) {
  await writeStream.write(chunk);
}
```

---

## Performance

### How can I make the PDF smaller?

1. **Enable compression**: `compress: true` (FlateDecode, 50–90 % size reduction).
2. **Initialize native zlib in Node.js**: `await initNodeCompression()` once at startup.
3. **Use JPEG for photos** — JPEG (DCTDecode) is already compressed; PNG is FlateDecode-compressed.
4. **Font subsetting is automatic** — but each script you embed adds one subset.

### Can I generate PDFs in a Web Worker?

Yes. For large datasets pdfnative ships a built-in worker pipeline:

```typescript
import { generatePDFInWorker } from 'pdfnative';

const pdf = await generatePDFInWorker(params, { workerThreshold: 500 });
```

Tables above the threshold automatically run off the main thread.

---

## Why pdfnative?

### How does it compare to jsPDF / pdfkit / pdf-lib / pdfmake?

See the [feature comparison table](https://github.com/Nizoka/pdfnative#why-pdfnative) in the README. Key differentiators:

- **Zero runtime dependencies** (others ship 3–6).
- **16 Unicode scripts** with built-in BiDi and OpenType GSUB/GPOS shaping.
- **PDF/A** (1b, 2b, 2u, 3b) — none of the others support this directly.
- **Built-in digital signatures** (RSA + ECDSA) without external crypto modules.
- **5 native barcode formats** (Code 128, EAN-13, QR, Data Matrix, PDF417) as PDF vector paths.

### Does it convert HTML to PDF?

No, and it never will. HTML→PDF is a different problem domain (browser engine, CSS, layout) better solved by tools like `puppeteer` or `weasyprint`. pdfnative is a **structured-data → PDF** library — you describe blocks, it emits ISO-compliant PDF.

### Why no classes / no inheritance?

pdfnative is built from pure functions. State is passed explicitly. This makes the library trivially tree-shakeable, easy to test, and easy to reason about. See the [Architecture guide](architecture.html).

---

## Common errors

| Error | Likely cause | Fix |
|-------|--------------|-----|
| `Font 'xx' not registered` | `fontEntries[].lang` references a script you didn't `registerFonts()` for | Register the loader and `await loadFontData('xx')` |
| `PDF/A and encryption are mutually exclusive` | `tagged: 'pdfa…'` combined with `encryption: …` | Pick one |
| `Invalid color: …` | Unrecognized hex/rgb string passed to a layout option | Use `#rrggbb`, `[r, g, b]` (0–1), or `'r g b'` |
| Boxes / blank glyphs | Font for that script is not loaded | See [Troubleshooting → Missing glyphs](troubleshooting.html) |
| Parser throws on external PDF | PDF is encrypted or non-standard | Decrypt first; the parser does not implement decryption |

For more cases, see the [Troubleshooting guide](troubleshooting.html).
