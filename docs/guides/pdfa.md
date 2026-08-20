# PDF/A conformance in pdfnative

PDF/A is the ISO archival profile for PDF (ISO 19005). pdfnative supports
PDF/A-1b, 2b, 2u, and 3b via the `tagged` build option. This guide
explains what works today, what's still in flight, and how to validate
your output against the official reference validator.

## TL;DR

```ts
import { buildPDFBytes } from 'pdfnative';

const pdf = buildPDFBytes(params, { tagged: true });        // PDF/A-2b (default)
const pdf1b = buildPDFBytes(params, { tagged: 'pdfa1b' });  // PDF/A-1b
const pdf2u = buildPDFBytes(params, { tagged: 'pdfa2u' });  // PDF/A-2u
const pdf3b = buildPDFBytes(params, { tagged: 'pdfa3b' });  // PDF/A-3b + attachments
```

> ### `tagged` alone is not enough: embed a font
>
> ISO 19005 requires **every** font in the file to be embedded. `tagged` writes the
> XMP conformance declaration, the structure tree and the output intent — but it does
> not embed a font for you. If your document uses only the viewer's built-in fonts
> (which is what happens when you pass no `fontEntries`), pdfnative writes a file that
> *claims* PDF/A while referencing non-embedded Helvetica, and veraPDF will reject it.
>
> Pass at least a Latin font whenever you set `tagged`:
>
> ```ts
> import { buildDocumentPDFBytes, registerFonts, loadFontData } from 'pdfnative';
>
> registerFonts({ latin: () => import('pdfnative/fonts/noto-sans-data.js') });
> const fontData = await loadFontData('latin');
>
> // fontRef becomes a PDF resource name, so it needs the leading slash.
> // /F1 and /F2 are reserved by the engine — start at /F3.
>
> const pdf = buildDocumentPDFBytes(
>   { title: 'Archival', blocks, fontEntries: [{ fontData, fontRef: '/F3', lang: 'latin' }] },
>   { tagged: 'pdfa2b' },
> );
> ```
>
> Since **v1.7.0** the builders guard this declaration themselves: requesting any
> `'pdfa*'` level (or `tagged: true`) with no `fontEntries` emits the
> `PDFA_NO_FONT_ENTRIES` diagnostic — a `console.warn` by default, or a thrown
> `Error` under `strict: true`, before any output bytes are produced. See
> *Conformance diagnostics* below.
>
> The sample generators in `scripts/generators/` all do this, which is why the veraPDF
> CI job passes. If you author through `pdfnative-react`, its `lintDocument()` rule
> `L_TAGGED_NO_FONTS` still catches the same trap earlier, at the document-model
> level — a complementary check to the core diagnostic.

Every output written with `tagged` set ships:

- A full structure tree (`/Document → /Table → /TR → /TH|/TD`, `/H1–H3`,
  `/P`, `/L → /LI`, `/Figure`, `/Link`).
- `/ActualText` UTF-16BE on every marked content `/Span`.
- An XMP metadata stream with `pdfaid:part` and `pdfaid:conformance`.
- An sRGB ICC `OutputIntent` (`GTS_PDFA1`).
- `/MarkInfo << /Marked true >>` on the catalog.
- A trailer `/ID` derived deterministically from the document title and
  creation timestamp.
- `/Info CreationDate` byte-equivalent to `xmp:CreateDate`, both with
  timezone offsets.

## Conformance diagnostics (v1.7.0)

Configurations that produce a PDF/A claim veraPDF would reject no longer fail
silently. Both builders (`buildPDFBytes` and `buildDocumentPDFBytes`) surface
them through a single diagnostics channel:

| Code | Trigger |
|------|---------|
| `PDFA_NO_FONT_ENTRIES` | A `'pdfa*'` level (or `tagged: true`) requested with no `fontEntries` — the file would claim PDF/A while referencing unembedded standard-14 Helvetica (ISO 19005 §6.2.11.4.1). |
| `PDFA_DEVICE_CMYK_IMAGE` | A DeviceCMYK image embedded under a PDF/A claim with an sRGB `OutputIntent` (ISO 19005-2 §6.2.4.3). |
| `PDFA_UNEMBEDDED_FORM_FONT` | AcroForm fields under a PDF/A claim — form appearances render through an unembedded base-14 `/Helv` font (same §6.2.11.4.1 rule). Flatten the form or drop the level. |

By default each diagnostic is a `console.warn`, deduplicated **once per code
per build**. Two layout options change that:

```ts
import { buildPDFBytes, type PdfDiagnostic } from 'pdfnative';

// CI / tests: escalate to a thrown Error, before any bytes are produced.
buildPDFBytes(params, { tagged: 'pdfa2b', strict: true });

// Custom sink — receives every diagnostic (no deduplication).
// Pass () => {} to silence entirely.
const diagnostics: PdfDiagnostic[] = [];
const pdf = buildPDFBytes(params, {
  tagged: 'pdfa2b',
  onDiagnostic: (d) => diagnostics.push(d),
});
```

Each `PdfDiagnostic` carries a machine-readable `code`, a `severity`
(`'warning'`), and an actionable `message` that includes the remedy.
`onDiagnostic` is ignored when `strict` is set — diagnostics throw instead.
The code list is a stable, additions-only union (`PdfDiagnosticCode`), so a
sink written today keeps compiling as future codes are added.

## v1.1.0 status — fully validated

v1.1.0 ships full PDF/A-1b / 2b / 2u / 3b conformance against the
official veraPDF reference validator. The validator runs as a
**blocking** check on every PR (see
[.github/workflows/verapdf.yml](https://github.com/Nizoka/pdfnative/blob/main/.github/workflows/verapdf.yml)).

| Rule | Status | Fixed in |
|------|--------|----------|
| ISO 19005-1 §6.1.3 — trailer `/ID` always present | ✅ | v1.0.4 |
| veraPDF 6.7.3 t1 — `CreationDate` ↔ `xmp:CreateDate` parity | ✅ | v1.0.4 |
| veraPDF 6.7.3 t1 — `dc:title` ↔ `/Info /Title` parity | ✅ | v1.1.0 |
| veraPDF 6.7.3 t4 — `dc:description` ↔ `/Info /Subject` parity | ✅ | v1.1.0 |
| veraPDF 6.7.3 t5 — `pdf:Keywords` ↔ `/Info /Keywords` parity | ✅ | v1.1.0 |
| veraPDF 6.7.3 — `dc:creator` ↔ `/Info /Author` parity | ✅ | v1.0.4 |
| ISO 19005-1 §6.3.4 — Latin font embedding | ✅ | v1.1.0 |
| ISO 19005-2 §6.2.11.4.1 — Type0 font references | ✅ | v1.1.0 |
| veraPDF 6.2.3.3 — DeviceRGB OutputIntent | ✅ | v1.0.4 |

To produce a strictly veraPDF-compliant PDF/A document, register the Latin
font module **and resolve it**. Registering alone is not enough: the builders
are synchronous and cannot await a loader, so the font never reaches the
document and you get an unembedded Helvetica reference — verified: 0 embedded
fonts.

```ts
import { registerFonts, loadFontData, buildPDFBytes } from 'pdfnative';

registerFonts({ latin: () => import('pdfnative/fonts/noto-sans-data.js') });
const fontData = await loadFontData('latin');

const pdf = buildPDFBytes(
  { ...params, fontEntries: [{ fontData, fontRef: '/F3', lang: 'latin' }] },
  { tagged: true },
);
```

Without the `'latin'` font registered, pdfnative falls back to the
unembedded Helvetica standard-14 references for byte-stable v1.0.x
output — convenient for non-archival rendering but invalid under
PDF/A.

## Validating your output

pdfnative ships a thin wrapper around the official veraPDF CLI:

```bash
# 1. Generate the sample suite (writes test-output/)
npm run test:generate

# 2. Run veraPDF against every PDF/A-claiming sample
npm run validate:pdfa
```

The script auto-detects veraPDF on `$PATH` or via the `VERAPDF_HOME`
env var. If veraPDF is not installed it exits 0 with install
instructions — local development never blocks. CI installs veraPDF
deterministically (pinned version) and runs the same script on every
PR — see [.github/workflows/verapdf.yml](https://github.com/Nizoka/pdfnative/blob/main/.github/workflows/verapdf.yml).

veraPDF is invoked as an **external** Java tool. pdfnative remains a
zero-runtime-dependency library; veraPDF is never bundled, linked, or
required by consumers of the npm package.

### Installing veraPDF locally

veraPDF is a Java application. Pick whichever path matches your OS.
After install, either expose `verapdf` on `$PATH` or set the
`VERAPDF_HOME` environment variable to the install directory.

**macOS** — Homebrew cask:

```bash
brew install --cask verapdf
verapdf --version
```

**Linux** — official installer (headless):

```bash
curl -fsSL -o verapdf-installer.zip https://software.verapdf.org/rel/verapdf-installer.zip
unzip verapdf-installer.zip
java -jar verapdf-izpack-installer-*.jar -console
# follow the prompts; defaults are sane
export VERAPDF_HOME="$HOME/verapdf"
export PATH="$VERAPDF_HOME:$PATH"
```

**Windows** — official installer from
<https://docs.verapdf.org/install/>. After install, either add the
install directory to `PATH` or:

```powershell
$env:VERAPDF_HOME = "C:\Program Files\verapdf"
$env:Path += ";$env:VERAPDF_HOME"
verapdf.bat --version
```

**No install at all?** Drop the file into the official online demo
at <https://demo.verapdf.org>. It validates against the same engine,
which is convenient for ad-hoc checks but does not scale to a CI
suite.

### Troubleshooting

**"My PDF fails veraPDF for missing XMP / DeviceRGB / unembedded
font, but I never asked for PDF/A."**

If the file was generated **without** `tagged: true`, it is a plain
ISO 32000-1 document and should not be validated against any PDF/A
profile. The veraPDF online demo lets you pick a profile manually,
which will then surface failures by design — every PDF/A rule about
metadata, output intents, font embedding, transparency, and color
spaces will fire because the file never claimed any of those things.

The `npm run validate:pdfa` wrapper avoids this trap: it scans each
PDF for a `pdfaid:part` declaration in the XMP packet and skips
files that don't claim PDF/A. The summary line reports how many were
skipped:

```
Scanned 146 PDF(s); 7 claim PDF/A, 139 skipped (not PDF/A).
```

If you want a file to be validated, generate it with `tagged: true`
(or any `'pdfa*'` value).

**"My tagged file still fails rule 6.3.4 (font embedding)."**

Register the Latin font module **and pass the resolved data as `fontEntries`**
(see the TL;DR above). Registration on its own does nothing for the synchronous
builders. Without it, pdfnative emits Helvetica as an unembedded standard-14
reference for byte-stable v1.0.x output. With it, every glyph used
in the document is embedded as `CIDFontType2` / `FontFile2` — see
the v1.1.0 status table above. Since v1.7.0 this configuration also emits the
`PDFA_NO_FONT_ENTRIES` diagnostic at build time (a thrown error under
`strict: true`), so the failure surfaces before veraPDF ever runs.

### Output bytes change in v1.0.4

v1.0.4 has no public API break, but PDF outputs differ byte-for-byte
from v1.0.3:

- Trailer `/ID` array is now always present.
- `/Info CreationDate` and `xmp:CreateDate` carry timezone offsets.
- `dc:creator` is emitted only when an author is provided.

If your test fixtures snapshot full PDF bytes, regenerate them.

## PDF/A vs encryption

ISO 19005-1 §6.3.2 forbids combining PDF/A with PDF encryption.
pdfnative validates this at the build boundary — passing both
`tagged: …` and `encryption: …` in the same call throws.

## Choosing a flavour

| Flavour | Base PDF | Notes |
|---------|----------|-------|
| PDF/A-1b (`'pdfa1b'`) | PDF 1.4 | Most conservative — required by some legacy archival systems. No transparency, no JPEG2000, no AES. |
| PDF/A-2b (`true` / `'pdfa2b'`) | PDF 1.7 | Default. Allows transparency, layers, embedded TrueType. |
| PDF/A-2u (`'pdfa2u'`) | PDF 1.7 | 2b + Unicode mapping for every glyph. Required when `/ActualText` and ToUnicode CMap completeness matter (recommended for accessibility). |
| PDF/A-3b (`'pdfa3b'`) | PDF 1.7 | 2b + arbitrary `/EmbeddedFile` attachments (XML, source data, etc.). |

All four flavours share the same XMP / OutputIntent / structure-tree
infrastructure — pdfnative only varies the PDF version, the
`pdfaid:part`, and the `pdfaid:conformance` value.

### Canonical list for tooling

The four legal `tagged` strings are also exposed as a
typed constant for tooling that needs to populate a JSON-schema
`enum:` (`pdfnative-mcp` does this for its MCP tool descriptions so
Gemini-CLI and other agents can autocomplete the right value):

```ts
import { PDF_A_CONFORMANCE_TARGETS, type PdfAConformanceTarget } from 'pdfnative';

PDF_A_CONFORMANCE_TARGETS;
// → readonly ['pdfa1b', 'pdfa2b', 'pdfa2u', 'pdfa3b']

function isValidTarget(s: string): s is PdfAConformanceTarget {
  return (PDF_A_CONFORMANCE_TARGETS as readonly string[]).includes(s);
}
```

The constant is the single source of truth — adding a new target in a
future minor release will surface automatically in every downstream
consumer that imports it.

## Hard invariants for contributors

These rules are documented in the contributor instruction file
[.github/instructions/pdfa-conformance.instructions.md](https://github.com/Nizoka/pdfnative/blob/main/.github/instructions/pdfa-conformance.instructions.md):

- `/Info CreationDate` and `xmp:CreateDate` come from the **same**
  `buildPdfMetadata()` call. Never inline `new Date()` in the builders.
- The unencrypted trailer `/ID` is derived deterministically from
  `MD5(title + creationDate + objectCount)`. Never randomize — it
  breaks `buildPDFBytes(params)` byte-equality tests.
- `dc:creator` is emitted only when an author is provided and is
  XML-escaped.
- XMP metadata streams are never compressed.
- Compression always happens **before** encryption (ISO 32000-1
  §7.3.8).

## See also

- [CHANGELOG.md](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
  — full v1.0.4 release notes.
- [veraPDF](https://verapdf.org) — the official reference validator.
- [ISO 19005-1](https://www.iso.org/standard/38920.html) /
  [ISO 19005-2](https://www.iso.org/standard/50655.html) /
  [ISO 19005-3](https://www.iso.org/standard/57229.html).
