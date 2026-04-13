# FAQ

## Can I modify existing PDFs?

Yes. pdfnative includes a PDF parser and incremental modifier:

```typescript
import { openPdf, createModifier } from 'pdfnative';

const bytes = fs.readFileSync('input.pdf');
const reader = openPdf(new Uint8Array(bytes));

console.log(`Pages: ${reader.pageCount}`);
console.log(`Title: ${reader.getInfo()?.get('Title')}`);

const mod = createModifier(reader);
mod.setMetadata('Title', 'Updated Title');
const updated = mod.save(); // Non-destructive incremental update
```

The modifier uses incremental saves — original data is preserved, changes are appended with a new xref/trailer.

## Does it work in the browser?

Yes. pdfnative is a dual ESM/CJS build with zero Node.js dependencies in the core. Use it directly in browsers:

```typescript
import { buildDocumentPDFBytes, downloadBlob } from 'pdfnative';

const pdf = buildDocumentPDFBytes({ title: 'Hello', blocks: [...] });
downloadBlob(pdf, 'output.pdf');
```

For compression in the browser, the stored-block fallback works automatically. For optimal compression ratios, the library uses native zlib on Node.js when `initNodeCompression()` is called.

## Does it work with Deno / Bun?

Yes. The library is standard ESM with no Node.js-specific APIs in the core. Both Deno and Bun can import it directly.

## Can I use custom fonts?

Yes. Build a font data module from any TTF file:

```bash
node tools/build-font-data.cjs path/to/MyFont.ttf my-font-data
```

Then register it:

```typescript
registerFonts({
  custom: () => import('./my-font-data.js'),
});
```

The font data module contains the TTF binary as base64 + extracted metrics (widths, cmap, glyph count). Font subsetting is automatic — only used glyphs are embedded.

## What PDF versions are generated?

| Mode | PDF Version | Standard |
|------|-------------|----------|
| Default | 1.4 | ISO 32000-1 |
| `tagged: true` | 1.7 | PDF/A-2b (ISO 19005-2) |
| `tagged: 'pdfa1b'` | 1.4 | PDF/A-1b (ISO 19005-1) |
| `tagged: 'pdfa2u'` | 1.7 | PDF/A-2u (ISO 19005-2) |
| `tagged: 'pdfa3b'` | 1.7 | PDF/A-3b (ISO 19005-3) |

## What's the maximum document size?

The table builder enforces a 100,000 row limit. The document builder has no hard limit — it paginates automatically. Practical limits depend on available memory (each page is ~1–5 KB of PDF content).

## Can I add digital signatures?

Yes. pdfnative includes zero-dependency RSA and ECDSA signature support:

```typescript
import { signPdfBytes } from 'pdfnative';

const signed = signPdfBytes(pdfBytes, {
  privateKey: keyBytes,    // DER-encoded private key
  certificate: certBytes,  // DER-encoded X.509 certificate
  reason: 'Approved',
  name: 'John Doe',
});
```

Signatures conform to ISO 32000-1 §12.8 using CMS/PKCS#7 SignedData.

## Can I generate PDFs in a Web Worker?

Yes. pdfnative includes built-in Web Worker support:

```typescript
import { generatePDFInWorker } from 'pdfnative';

const pdf = await generatePDFInWorker(params, options);
```

The worker threshold is configurable. For large datasets (500+ rows), automatic off-thread generation prevents UI blocking.

## How does it compare to jsPDF / pdfkit?

See the [feature comparison table](https://github.com/Nizoka/pdfnative#feature-comparison) in the README. Key differentiators: zero dependencies, 16 Unicode scripts with BiDi and OpenType shaping, PDF/A compliance, built-in encryption and digital signatures.
