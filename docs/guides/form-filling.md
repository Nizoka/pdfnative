# Form filling & flattening

> **New in v1.6.0.** Read, fill, and flatten the **interactive AcroForm fields
> of existing PDFs** — whether authored by pdfnative or a third party — via
> non-destructive incremental update. Complements the form *builder* (which
> creates fields from scratch).

## TL;DR

```ts
import { readFormFields, fillForm, flattenForm } from 'pdfnative';
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('application.pdf');

// 1. Discover the fields
for (const f of readFormFields(src)) {
  console.log(f.name, f.type, f.value);
}

// 2. Fill by field name
const filled = fillForm(src, {
  fullName: 'Ada Lovelace',
  agree: true,               // checkbox
  country: 'France',         // dropdown option
});
writeFileSync('filled.pdf', filled);

// 3. Optionally flatten (make it non-editable)
writeFileSync('flat.pdf', flattenForm(filled));
```

## `readFormFields(bytes, options?)`

Returns a `ParsedFormField[]` describing every terminal field:

```ts
interface ParsedFormField {
  name: string;                               // fully-qualified (dotted) name
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'listbox'
      | 'button' | 'signature' | 'unknown';
  value: string | string[] | boolean | null;
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  options?: { export: string; label: string }[]; // choice fields
  maxLen?: number;
  onState?: string;                           // checkbox/radio "on" state name
  widgets: { pageIndex: number; rect: [number, number, number, number] }[];
  ref: number;                                // terminal field object number
}
```

Inherited attributes (`/FT`, `/Ff`, `/DA`, `/Opt`, `/MaxLen`) are resolved up the
`/Parent` chain, and UTF-16BE names/values are decoded.

## `fillForm(bytes, values, options?)`

`values` maps **fully-qualified field name → value**:

| Field type | Value |
|------------|-------|
| text / multiline | `string` |
| dropdown | `string` (one option's export/label) |
| listbox | `string` or `string[]` (multi-select) |
| checkbox / radio | `boolean`, or the export-state `string` |

```ts
interface FillFormOptions {
  flatten?: boolean;                          // fill then flatten in one call
  onUnknownField?: 'throw' | 'ignore';        // default 'throw'
  nonWinAnsi?: 'throw' | 'needAppearances';   // default 'throw'
  password?: string;                          // for encrypted documents (see below)
}
```

- Text/choice fields get a freshly generated, **self-contained** Helvetica
  appearance stream (its own `/Resources /Helv`), so filling never depends on the
  document's `/DR`.
- Checkbox/radio set `/V` and `/AS` from the widget's **own** `/AP` on/off states,
  preserving the document's original look.
- Non-WinAnsi text (e.g. CJK) can't be drawn with the built-in Helvetica
  appearance; pass `nonWinAnsi: 'needAppearances'` to write the value and let the
  viewer regenerate the appearance, or the call throws by default.

Errors: `FormFieldNotFoundError`, `FormValueTypeError`, `FormUnsupportedError`.

## `flattenForm(bytes, options?)`

Stamps each widget's appearance into its page content and removes the
interactive layer (`/AcroForm`, widget `/Annots`):

```ts
interface FlattenFormOptions {
  force?: boolean;      // flatten even over a signed signature field
  password?: string;    // for encrypted documents
}
```

Flattening a document with a **signed signature field** throws by default
(flattening is destructive to what was signed); pass `{ force: true }` to
override.

## Encrypted & signed documents

- **Encrypted documents are supported** (v1.6.0): pass the password —

  ```ts
  const filled = fillForm(encryptedPdf, { fullName: 'Grace Hopper' }, { password: 'secret' });
  const flat = flattenForm(filled, { password: 'secret' });
  ```

  The appended objects — field values, regenerated appearance streams,
  flatten overlays — are **encrypted under the document's existing scheme**
  (same `/Encrypt` dictionary, same file key; RC4, AES-128 and AES-256
  sources all work), so no plaintext ever leaks into an encrypted file and
  no downgrade or upgrade of the scheme is possible. A wrong or missing
  password throws `PdfPasswordError`. Note: the `/P` permission bits are
  **not enforced** — the update proceeds if the password authenticates;
  honouring the modify bit is the caller's responsibility
  (`openPdf(bytes, { password }).encryption.authenticatedAs` tells you
  which password opened the file).
- **Signed documents:** filling *non-signature* fields is allowed and preserves
  the signed revision byte-for-byte (incremental update only appends). Viewers
  will report "document modified after signing" for the added revision — expected,
  since the fill is a new, unsigned revision layered on top. Adding a *new*
  signature placeholder to an **encrypted** document is not supported
  (`addSignaturePlaceholder` needs a verbatim byte layout that cannot be
  transparently encrypted — it fails fast with a clear error).

## How it works

Both operations use the incremental modifier
([`createModifier`](architecture.html)), so the original bytes are never
rewritten — the update is appended after the existing body with a new xref and a
`/Prev` chain. That is why signatures on earlier revisions stay valid.

> **Searchable form text** _(v1.7.0)_. The AcroForm `/Helv` font dictionary now
> carries a `/ToUnicode` CMap in every mode, so text typed into form fields is
> searchable and extractable (see the [text extraction guide](text-extraction.html)).
> Because of that CMap, **every form-carrying document changes bytes** compared
> to v1.6.0 output (about 20 bytes) — a deliberate correctness fix, recorded in
> the v1.7.0 release notes. Under a PDF/A claim, a form field also raises the
> `PDFA_UNEMBEDDED_FORM_FONT` diagnostic (see the [PDF/A guide](pdfa.html)).

## See also

- [Signatures](signatures.html) — CMS/PKCS#7 signing
- [PDF manipulation](pdf-manipulation.html) — merge/split/extract, decryption
- [Accessibility](accessibility.html)
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
