---
description: Use when working on PDF/A conformance — XMP metadata, trailer /ID, /Info dictionary, OutputIntent, ICC profiles, font embedding under PDF/A modes. Covers ISO 19005-1/2/3 invariants and veraPDF rule mappings.
applyTo: 'src/core/pdf-tags.ts,src/core/pdf-builder.ts,src/core/pdf-document.ts,src/core/pdf-assembler.ts'
---

# PDF/A conformance — engineering invariants

## Source of truth

- ISO 19005-1 (PDF/A-1) — PDF 1.4 base
- ISO 19005-2 (PDF/A-2) — PDF 1.7 base, default in pdfnative
- ISO 19005-3 (PDF/A-3) — adds `/EmbeddedFile` attachments
- ISO 32000-1 §7.5.5 (file trailer), §14.3 (metadata), §14.4 (file IDs)
- veraPDF reference validator — <https://verapdf.org>

## Hard invariants — must hold for every build

### Trailer `/ID` (ISO 19005-1 §6.1.3, ISO 32000-1 §14.4)

- Trailer dict **must** contain `/ID [<hex32> <hex32>]` whether or not the
  file is encrypted.
- Unencrypted ID derivation lives in
  [src/core/pdf-assembler.ts](../../src/core/pdf-assembler.ts) and uses
  `md5(\`pdfnative|${idSeed}|${totalObjs}\`)` where `idSeed` is
  `\`${title}|${pdfDate}\``. **Do not introduce randomness here** — it
  breaks `buildPDFBytes(params)` determinism tests.
- Encrypted path reuses `encState.docId` (already random per build).
- Both ID array elements are identical 16-byte MD5 outputs hex-encoded.

### `/Info` ↔ XMP parity (veraPDF rule 6.7.3)

- The single source of truth for timestamps is `buildPdfMetadata()` in
  [src/core/pdf-tags.ts](../../src/core/pdf-tags.ts). Both `/Info
  CreationDate` and `xmp:CreateDate` **must** be derived from this
  helper's `pdfDate` and `xmpDate` outputs in the same call.
- `pdfDate` format: `D:YYYYMMDDHHmmSS+HH'mm'` (ISO 32000-1 §7.9.4).
- `xmpDate` format: `YYYY-MM-DDTHH:mm:ss±HH:MM` (ISO 8601).
- The two formats represent the **same instant** including timezone
  offset. Never inline `new Date()` in `pdf-builder.ts` /
  `pdf-document.ts` — always go through `buildPdfMetadata()`.
- XMP also emits `xmp:ModifyDate` and `xmp:MetadataDate` equal to
  `xmp:CreateDate` for static documents.

### `dc:creator` ↔ `/Info /Author` parity

- `dc:creator` is emitted **only** when the user provides
  `metadata.author`. Empty/absent author = no `dc:creator` element at
  all.
- When emitted, the value is XML-escaped via the local `escapeXml()`
  helper in `pdf-tags.ts`.
- The same author string flows to `/Info /Author` (PDF text string
  encoded via `encodePdfTextString`).

### Compression ordering

- ISO 32000-1 §7.3.8: compress **before** encrypt.
- XMP metadata streams must remain **uncompressed** (`skipCompress`) for
  validator robustness.

### PDF/A vs encryption

- ISO 19005-1 §6.3.2: mutually exclusive. Validated at the build
  boundary; never relax this check.

## Latin font embedding (rule 6.3.4) — resolved in v1.1.0 (#28)

- Historical note: through v1.0.4, pdfnative emitted `/Helvetica` and
  `/Helvetica-Bold` as unembedded Type 1 references — invalid under any
  PDF/A mode (rule 6.3.4 `isFontEmbedded`), which made the `pdfaid:part`
  claim aspirational for documents containing Latin runs.
- Since v1.1.0, Noto Sans VF (OFL-1.1, bundled as
  `fonts/noto-sans-data.{js,d.ts}` under lang `'latin'`) is auto-embedded
  for Latin text in tagged/PDF-A mode, so PDF/A output carries only
  embedded fonts. Do not reintroduce unembedded base-14 references in any
  PDF/A code path.

## Declaration guards (v1.7.0)

- Configurations that would break the declared PDF/A level surface a
  diagnostic through `src/core/pdf-diagnostics.ts`: `console.warn` by default
  (deduplicated once per code), a caller-supplied `onDiagnostic` sink, or a
  thrown error under `strict: true` (`onDiagnostic` is ignored when `strict`
  is set — diagnostics throw instead).
- Current codes (stable, additions-only union `PdfDiagnosticCode`):
  `PDFA_NO_FONT_ENTRIES` (base-14 text without embedded fonts under a claim),
  `PDFA_UNEMBEDDED_FORM_FONT` (any form field under a claim — the AcroForm
  `/DR /Helv` is an unembedded Type 1), `PDFA_DEVICE_CMYK_IMAGE` (CMYK JPEG
  against the sRGB OutputIntent).
- When adding a new guard: extend the union (never remove or rename a code),
  include the remedy in the message, and cover both the warn path and the
  `strict` throw path in tests.

## Validator workflow

1. `npm run test:generate` — regenerate `test-output/`.
2. `npm run validate:pdfa` — runs every PDF/A-claiming sample through
   the official veraPDF CLI. Skips silently when veraPDF isn't on
   `$PATH` and `VERAPDF_HOME` is unset.
3. CI workflow `.github/workflows/verapdf.yml` enforces the same on
   every PR.

## Adding a new PDF/A flavour or metadata field

- All XMP shape changes go through `buildXMPMetadata()` in
  [src/core/pdf-tags.ts](../../src/core/pdf-tags.ts).
- `resolvePdfAConfig(tagged)` is the single mapper from public option →
  `{ pdfVersion, pdfaPart, pdfaConformance, subtype }`. Extend there;
  never fork the resolution.
- Add a generator under `scripts/generators/` and a regression test
  under `tests/core/`.
- Run `npm run validate:pdfa` locally with veraPDF installed before
  pushing — CI will run it again.
