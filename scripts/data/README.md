# Unicode Character Database source files

Checked-in Unicode® data files used by dev-time generators to (re)build
TypeScript data modules under `src/`. They are **never** shipped in the npm
package and never loaded at runtime — only the generated `.ts` modules are.

| File | Generator | Output |
|---|---|---|
| `BidiMirroring.txt` | `scripts/generate-bidi-mirroring.ts` | `src/shaping/bidi-mirroring-data.ts` |

## License

These files are © Unicode, Inc., distributed under the
[Unicode License v3](https://www.unicode.org/license.txt) — a permissive,
OSI-approved, MIT-compatible license that allows redistribution as long as the
copyright notice is retained (each file keeps its original header). This
mirrors the precedent of the Noto source fonts committed under `fonts/ttf/`
(SIL OFL 1.1, see `fonts/LICENSE`).

## Upgrading

Replace the file with the new UCD release (keep its header), re-run the
generator, and review the regenerated module diff.
