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
  password?: string;                          // (encrypted input is rejected — see below)
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
  password?: string;    // (encrypted input is rejected)
}
```

Flattening a document with a **signed signature field** throws by default
(flattening is destructive to what was signed); pass `{ force: true }` to
override.

## Encrypted & signed documents

- **Encrypted input is rejected** (`FormUnsupportedError`): an incremental update
  would append plaintext objects to an encrypted file, producing an invalid
  hybrid. Decrypt-and-rebuild first (e.g. via [merge](pdf-manipulation.html)),
  then fill.
- **Signed documents:** filling *non-signature* fields is allowed and preserves
  the signed revision byte-for-byte (incremental update only appends). Viewers
  will report "document modified after signing" for the added revision — expected,
  since the fill is a new, unsigned revision layered on top.

## How it works

Both operations use the incremental modifier
([`createModifier`](architecture.html)), so the original bytes are never
rewritten — the update is appended after the existing body with a new xref and a
`/Prev` chain. That is why signatures on earlier revisions stay valid.

## See also

- [Signatures](signatures.html) — CMS/PKCS#7 signing
- [PDF manipulation](pdf-manipulation.html) — merge/split/extract, decryption
- [Accessibility](accessibility.html)
- [CHANGELOG](https://github.com/Nizoka/pdfnative/blob/main/CHANGELOG.md)
