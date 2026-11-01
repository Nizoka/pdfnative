# React use cases

> **Four architectures built on pdfnative-react v1.4.0 (peer `pdfnative ^1.9.0`,
> React `^19.0.0`, Node ≥ 22).** Lint a document model in CI before any PDF
> exists; typeset long-form documents like a book from JSX; render one
> component tree into a screen PDF/A file and a press PDF/X-4 file; and ship a
> spot-colour press sheet that claims PDF/A-2b and PDF/X-4 in one file. Every
> prop, export and lint rule named below ships in v1.4.0.

This guide is the React companion to the [ecosystem use cases](use-cases.html),
which sets the convention (problem, load-bearing code, gains, limits — with an
architecture diagram where data crosses components) and covers the cross-surface architectures. The
[React guide](react.html) is the reference for the components, the rendering
entry points and the `DocSpec` authoring surface used here.

## Case 1 — A DocSpec lint gate in CI, before any PDF exists

Most document bugs are visible in the model long before a byte is written: a
PDF/A claim with no embedded fonts, a chart with two series in a pie, a
`pdfx` document whose output intent is a monitor profile. pdfnative-react
compiles JSX and `DocSpec` to the same `DocumentParams`, and `lintDocument` /
`lintSpec` run **41 rules** on that model — 26 errors, 14 warnings, 1 info —
without rendering. The twelve rules added in v1.3.0 cover the engine 1.8.0
surface: `L_TYPOGRAPHY_INEFFECTIVE`, `L_PRINT_COLOUR_BARS`,
`L_CMYK_INTENT_MISMATCH`, `L_OUTPUT_INTENT_PROFILE` and the eight
`L_PDFX_*` rules (`L_PDFX_TARGET`, `L_PDFX_TAGGED_CONFLICT`,
`L_PDFX_ENCRYPTED`, `L_PDFX_OUTPUT_INTENT`, `L_PDFX_TRAPPED_UNKNOWN`,
`L_PDFX_BOXES`, `L_PDFX_NO_FONTS`, `L_PDFX_ANNOTATIONS`). The four added in
v1.4.0 cover engine 1.9.0: `L_CHART_SERIES_COLORS`, `L_SPOT_UNDECLARED` and
`L_SPOT_INK_MIX` (errors — the engine's own messages) and `L_PDFA_JPX_IMAGE`
(a warning mirroring the `PDFA1_JPX_IMAGE` / `PDFA_JPX_IMAGE` diagnostics).

![Architecture: a pull request carries two kinds of input, a JSX document tree and stored DocSpec JSON records. Both flow into the same lint stage, lintDocument for JSX and lintSpec for JSON, preceded by validateSpec for the JSON shape. The stage runs 41 rules on the compiled document model and writes no PDF bytes. A report with ok equal to true passes the pull-request check; a report with error findings fails it and prints each finding's code, message and hint. A dashed arrow leads from the passing report to a separate bytes stage, the hub's Case 3, where the document is rendered and compared against a golden PDF.](../assets/use-case-lint-gate.svg)

The stored-spec route pairs `validateSpec` (is this JSON a `DocSpec` at all —
unknown fields, wrong types, the 19 `DOC_SPEC_FIELDS` from `title` to the
1.4.0 `direction`, with the 1.3.0 `pdfx`, `outputIntent`, `typography` and
`creationDate` in between) with `lintSpec` (is it a document the engine will
accept and a reader can use). Both return plain data: a `LintReport` is
`{ ok, findings, counts }`, where `ok` is `false` only when a finding has
severity `'error'`.

```tsx
// tests/documents.lint.test.tsx — runs on every pull request; writes nothing.
import { describe, expect, it } from 'vitest';
import { lintDocument, lintSpec, validateSpec } from 'pdfnative-react';
import type { DocSpec } from 'pdfnative-react';
import { Invoice } from '../src/documents/Invoice.js';
import stored from './fixtures/stored-specs.json'; // DocSpecs as the database holds them
import fixture from './fixtures/invoice.json';

describe('document lint gate', () => {
  it('the JSX invoice has no blocking finding', () => {
    const report = lintDocument(<Invoice data={fixture} />, { overflow: true });
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
  it.each(stored)('stored spec $title still validates and lints', (spec: unknown) => {
    expect(validateSpec(spec).errors).toEqual([]);        // shape: fields and types
    const report = lintSpec(spec as DocSpec);             // model: engine + accessibility
    expect(report.ok, JSON.stringify(report.findings, null, 2)).toBe(true);
  });
});
```

What you gain, concretely:

- **Throws become findings.** Of the 41 rules, twenty-three pre-empt an
  exception the engine raises at build time and six mirror an engine
  diagnostic (a warning on the default channel, a throw under
  `layout.strict`). For the PDF/X, spot-colour and series-colour rules the
  finding's message is the engine's message.
- **One report for both doors.** JSX and JSON compile to the same model, so a
  rule written once covers the component tree your developers write and the
  specs your agents or your database produce. The rule table is exported as
  `LINT_RULES`, the code list as `LINT_RULE_CODES`.
- **Composes with the hub.** This is the model stage; hub
  [Case 3](use-cases.html#case-3--a-document-regression-gate-in-ci) is the
  bytes stage (`render` + `compare` against a golden PDF), and hub
  [Case 1](use-cases.html#case-1--store-the-spec-not-the-pdf) is where the
  stored specs in the fixture come from.

Honest limits: lint checks the **model, not the bytes**. A PDF/A claim is
still verified by veraPDF on the rendered file, and a PDF/X-4 claim by the
engine's structural validator, which is deliberately not re-exported — it is
one import away, as `docs/RECIPES.md` in the package shows:

```tsx
import { validatePdfX } from 'pdfnative';
import { renderToBytes } from 'pdfnative-react';
const { valid, errors } = validatePdfX(renderToBytes(<PressSheet />));
```

`L_OVERFLOW` (a block taller than the page) needs a full layout pass and is
opt-in through `{ overflow: true }` — it costs about as much as rendering.
There is no visual check: nothing in the model says whether the page *looks*
right.

## Case 2 — Long-form documents typeset like a book, in JSX

A report that runs to forty pages exposes every default of a naive
paginator: a heading stranded at the foot of a page, a single line carried to
the next one, ragged right margins in a two-column brief. Engine 1.8.0 ships a
typography engine, and pdfnative-react v1.3.0 exposes it as a `<Document>` <!-- verify-docs:allow version-token (historical: the typography prop shipped in v1.3.0) -->
prop (`typography`, sugar over `layout.typography`) with per-block overrides:
`<Heading keepWithNext>`, `<Paragraph align="justify" keepWithNext splittable>`.

```tsx
import { Document, Heading, Paragraph, Table, inspectDocument, renderToBytes,
         resolveFonts, setHyphenationProvider } from 'pdfnative-react';
const fontEntries = await resolveFonts({ latin: () => import('pdfnative/fonts/noto-sans-data.js') });
setHyphenationProvider((word, lang) => hyphenate(word, lang)); // optional: your Liang-pattern library

const book = (
  <Document title="Field guide" fontEntries={fontEntries}
            typography={{ splitParagraphs: true, orphans: 2, widows: 2,
                          keepHeadingsWithNext: { minLines: 3 }, opticalMargins: true,
                          kerning: true, fontFeatures: ['onum'], hyphenationLanguage: 'en' }}>
    <Heading level={1}>Chapter 1</Heading>
    <Heading level={2} keepWithNext>Habitat</Heading>
    <Paragraph align="justify" splittable>{chapterOne}</Paragraph>
    <Paragraph keepWithNext>Table 1 summarises the ranges:</Paragraph>
    <Table rows={ranges} />
  </Document>
);
const { totalPages } = inspectDocument(book);          // the same planner, no bytes
if (totalPages > 48) throw new Error(`page budget exceeded: ${totalPages} pages`);
const bytes = renderToBytes(book);
```

`inspectDocument` runs the planner that `renderToBytes` uses and returns the
page count and every block's placement, so a page budget or a "table 1 is on
the same page as its caption" assertion is a unit test, not a PDF you open.

What you gain, concretely:

- **All twelve engine keys, locked at compile time.** `splitParagraphs`,
  `orphans`, `widows`, `keepHeadingsWithNext`, `unitBinding`,
  `bindShortWords`, `punctuationSpacing`, `opticalMargins`, `metrics`,
  `fontFeatures`, `kerning` and `hyphenationLanguage` are typed against the
  engine's `TypographyOptions`; a key the engine adds later is a build error
  in pdfnative-react, not a silently ignored prop.
- **Byte-identical when unset.** A document without `typography` compiles to
  the same `DocumentParams` as before; every key is opt-in.
- **Ineffective settings are warnings before render.**
  `L_TYPOGRAPHY_INEFFECTIVE` reports `orphans` / `widows` without
  `splitParagraphs`, an unknown `fontFeatures` tag, a line quota below 1, and
  `kerning`, `fontFeatures` or the `'fr'` punctuation preset without a
  registered font.

Honest limits: `kerning`, `fontFeatures` and the narrow no-break space of
`punctuationSpacing: 'fr'` need a registered font (`fontEntries`) — the
base-14 faces carry no OpenType tables and no U+202F. `tnum` and `lnum` are
no-ops on the bundled Noto Sans, whose figures are tabular and lining already.
No hyphenation dictionary ships: soft hyphens (U+00AD) are honoured, and a
provider set through `setHyphenationProvider` receives `hyphenationLanguage`
with every word. The React renderer does not sign, fill forms or post-process
existing PDFs — hand its bytes to the CLI or the engine for that.

## Case 3 — One component tree, two palettes: screen PDF/A and press PDF/X-4

The same catalogue goes to a customer portal and to a printer, and the two
files have contradictory requirements: the portal wants a tagged PDF/A-2b file
with sRGB colours; the press wants PDF/X-4 with CMYK plate values, a printer
output intent, a bleed and colour bars — and no conversion bridges the two
colour models, so each file must be authored in its own. Since v1.3.0 every
colour prop accepts a CMYK value beside hex and RGB, and `pdfx`,
`outputIntent` and `print` are `<Document>` props, so the palette is the only
thing that changes between the two renders.

![Architecture: one Sheet component tree receives a palette prop and is rendered twice. The first wrapper is a Document with tagged set to pdfa2b and the screen palette in hex; it produces the portal PDF, a tagged PDF/A-2b file under the built-in sRGB output intent. The second wrapper is a Document with pdfx set to pdfx4, a CMYK ICC output intent, trapped set to False and print bleed with crop marks and colour bars; it receives the press palette as CMYK tuples and produces the press PDF. A guard labelled L_CMYK_INTENT_MISMATCH sits on the screen path: a CMYK value that leaks into the PDF/A render is a lint warning, mirroring the engine diagnostic PDFA_DEVICE_CMYK_CONTENT.](../assets/use-case-two-palettes.svg)

```tsx
import { Document, Heading, Paragraph, renderToBytes } from 'pdfnative-react';
const palette = {
  screen: { ink: '#111827', accent: '#2563EB' },              // hex, for the portal
  press:  { ink: [0, 0, 0, 100], accent: [100, 60, 0, 0] },   // C M Y K in percent, for the press
} as const;

const Sheet = ({ p }: { p: (typeof palette)[keyof typeof palette] }) => (
  <>
    <Heading color={p.ink}>Spring catalogue</Heading>
    <Paragraph color={p.accent}>Prices valid until 30 June.</Paragraph>
  </>
);

const portal = renderToBytes(
  <Document tagged="pdfa2b" fontEntries={fontEntries}><Sheet p={palette.screen} /></Document>);
const press = renderToBytes(
  <Document pdfx="pdfx4" fontEntries={fontEntries} metadata={{ trapped: 'False' }}
            outputIntent={{ iccProfile: pressProfile, outputConditionIdentifier: 'FOGRA39' }}
            print={{ bleed: 14.17, marks: { crop: true, colourBars: true } }}>
    <Sheet p={palette.press} /></Document>);
```

`iccProfile` is the printer's ICC profile as bytes (a `prtr` device class —
a monitor profile such as sRGB is refused by `L_PDFX_OUTPUT_INTENT`), and
`trapped: 'False'` states the trapping status PDF/X requires — pdfnative never
traps. A 5 mm bleed (14.17 pt) is the strip the engine recommends for the
colour bars: below it the patches fall under a densitometer aperture and
`L_PRINT_COLOUR_BARS` warns; under 4 pt the engine skips the bars.

What you gain, concretely:

- **One tree, two conformance claims.** The components, the copy and the
  layout are written once; `tagged="pdfa2b"` and `pdfx="pdfx4"` are wrapper
  props, not forks of the template.
- **A leaked press token is a lint warning.** A CMYK value inside the PDF/A
  render trips `L_CMYK_INTENT_MISMATCH` (the built-in PDF/A intent is sRGB),
  mirroring the engine's `PDFA_DEVICE_CMYK_CONTENT` diagnostic; a monitor
  profile on the press render trips `L_PDFX_OUTPUT_INTENT`. Skip the linter
  and the profile error reaches `toErrorEnvelope` as `E_INPUT`, while the
  CMYK leak stays a `PDFA_DEVICE_CMYK_CONTENT` diagnostic (a throw only under
  `layout.strict`).
- **Press marks without a prepress tool.** `print.marks.colourBars` draws the
  four process colours at 100 % and 50 % in the bottom bleed strip; the crop
  marks stop 0.5 pt short of the trim line.

Honest limits: there is **no RGB → CMYK conversion** — plate values are
authored, and the engine performs no colour management beyond mapping RGB
content under a CMYK or Gray intent through `/DefaultRGB`. The two files here
differ by palette, not only by claim: since v1.4.0 (engine 1.9.0) the press
wrapper may also carry `tagged="pdfa2b"` or `"pdfa2u"` and ship one file with
both claims — Case 4 does exactly that — while `L_PDFX_TAGGED_CONFLICT` now
fires only for `'pdfa1b'` (PDF 1.4 has no PDF/X-4) and `'pdfa3b'` (embedded
files, which PDF/X forbids). The bytes-level PDF/X-4 check is the engine's
`validatePdfX` import shown in Case 1, and a `valid` result means the
structural prerequisites hold — confirm the file with a certified preflight
before it goes to press. No press profile ships with either package; the ICC
profile is yours.

## Case 4 — Spot-colour press sheet with the dual claim

A brand sheet goes to a press that runs a mixed ink — a brand blue, a spot
varnish — beside the four process colours, and the same file goes into the
archive, where PDF/A-2b is the acceptance criterion. Until engine 1.9.0 that
was two documents: a CMYK build cannot name an ink, and a PDF/X file could not
carry the archival claim. In pdfnative-react v1.4.0 the document declares each
ink once under `print.spotColours`, paints with `{ spot }`, `{ spot, tint }`
and `{ inks }` on any colour position — headings, paragraphs, table zebra and
borders, one colour per bar in a chart — and `tagged="pdfa2b"` sits beside
`pdfx="pdfx4"` on one `<Document>`: one set of bytes, both claims, and every
named ink written as its own `/Separation` plate.

![Architecture: one Document tree, with tagged set to pdfa2b and pdfx set to pdfx4, declares three inks under print.spotColours and paints headings, a table zebra, an ink mix and one chart bar per ink with spot colour values. The tree flows into the lint gate, lintDocument, which reports L_SPOT_UNDECLARED, L_SPOT_INK_MIX and L_CHART_SERIES_COLORS and raises nothing for the dual claim, because L_PDFX_TAGGED_CONFLICT fires only for pdfa1b and pdfa3b. The clean model flows into renderToBytes, which writes a Separation colour space per spot value and a DeviceN space per ink mix, each with a tint transform to its CMYK alternate, and an XMP packet carrying both pdfaid and pdfxid. The result is one PDF holding both claims, a tagged structure tree, a TrimBox, a Trapped entry, a prtr output intent and the three plates Brand Blue, Warm Grey and Varnish. Two checks read the bytes: the engine's validatePdfX, imported from pdfnative, for the PDF/X-4 structure, and veraPDF for the PDF/A-2b claim. A guard pill under the lint gate notes that an undeclared ink fails the check before any byte exists.](../assets/use-case-spot-dual-claim.svg)

```tsx
import { readFile } from 'node:fs/promises';
import { validatePdfX } from 'pdfnative';                  // deliberately not re-exported by pdfnative-react
import { Chart, Document, Heading, Paragraph, Table, lintDocument, renderToBytes,
         resolveFonts } from 'pdfnative-react';
import type { PrintOptions } from 'pdfnative-react';

const fontEntries = await resolveFonts({ latin: () => import('pdfnative/fonts/noto-sans-data.js') });
const pressProfile = new Uint8Array(await readFile('./press.icc')); // the printer's prtr profile
const BLEED = 14.17; // 5 mm

const print: PrintOptions = {
  bleed: BLEED,
  marks: { crop: true, registration: true, colourBars: true },
  spotColours: [
    { name: 'Brand Blue', alternate: [100, 44, 0, 0] }, // a CMYK alternate
    { name: 'Warm Grey', alternate: [0, 5, 10, 45] },
    { name: 'Varnish', alternate: [0, 0, 0, 8] },
  ],
};

const sheet = (
  <Document title="Spot colours" tagged="pdfa2b" pdfx="pdfx4" fontEntries={fontEntries}
            metadata={{ author: 'Acme Inc', trapped: 'False' }}
            outputIntent={{ iccProfile: pressProfile, outputConditionIdentifier: 'FOGRA39' }}
            print={print} layout={{ pageWidth: 595.28 + 2 * BLEED, pageHeight: 841.89 + 2 * BLEED }}>
    <Heading level={1} color={{ spot: 'Brand Blue' }}>Brand blue, as a plate of its own</Heading>
    <Paragraph color={{ spot: 'Brand Blue', tint: 0.5 }}>
      A 50 % tint of the same ink — one /Separation space, one plate, screened by the RIP.
    </Paragraph>
    <Paragraph color={{ inks: { 'Brand Blue': 1, Varnish: 0.6 } }}>
      An ink mix: full Brand Blue under 60 % varnish, through a /DeviceN space over the two inks.
    </Paragraph>
    <Table headers={['Plate', 'Alternate', 'Use']}
           rows={[
             { cells: ['Brand Blue', 'C100 M44', 'Headings, chart'], type: 'default', pointed: false },
             { cells: ['Warm Grey', 'K45 + warm', 'Rules, zebra'], type: 'default', pointed: false },
             { cells: ['Varnish', 'K8 (preview only)', 'Spot varnish'], type: 'default', pointed: false },
           ]}
           zebra={{ spot: 'Warm Grey', tint: 0.15 }}
           cellBorders={{ all: true, color: { spot: 'Warm Grey' } }} />
    <Chart chartType="bar" categories={['Brand Blue', 'Warm Grey', 'Varnish']}
           series={[{ label: 'Coverage (%)', values: [38, 22, 61],
                      // One colour per bar: each plate drawn in its own ink (engine 1.9.0).
                      colors: [{ spot: 'Brand Blue' }, { spot: 'Warm Grey' }, { spot: 'Varnish' }] }]}
           axis={{ yMin: 0, yMax: 100 }} dataLabels={{ suffix: ' %' }}
           altText="Ink coverage per plate: Brand Blue 38 %, Warm Grey 22 %, Varnish 61 %." />
  </Document>
);

const report = lintDocument(sheet);                          // model: inks, mixes, bars, the dual claim
if (!report.ok) throw new Error(report.findings.map((f) => `${f.code}: ${f.message}`).join('\n'));
const bytes = renderToBytes(sheet);
const { valid, errors } = validatePdfX(bytes);               // bytes: the PDF/X-4 structure, in-process
if (!valid) throw new Error(errors.join('\n'));
// PDF/A-2b: hand `bytes` to veraPDF — the package's conformance corpus does, on every release.
```

`alternate` is what a device without the ink shows in its place — four CMYK
percentages (0–100) or three RGB values (0–255); `{ spot, tint }` becomes a
`/Separation` colour space with a tint transform to that alternate, and
`{ inks }` a `/DeviceN` space over the named inks with its `/Colorants`
attributes dictionary, so a RIP separates the plates and a viewer still
shows the sheet. The three inks of the chart are three plates: `series.colors`
carries one colour per value on the bar kinds, and a length that differs from
`values` is `L_CHART_SERIES_COLORS` before it is an engine throw. The 5 mm
bleed is the strip the colour bars need (Case 3).

What you gain, concretely:

- **An undeclared ink never reaches the press.** Paint `{ spot: 'Foil' }`
  without declaring `Foil` and `lintDocument` returns `L_SPOT_UNDECLARED`
  with the engine's own message — `Spot colour 'Foil' is not declared — add
  { name: 'Foil', alternate: [c, m, y, k] } to layout.print.spotColours`;
  a tint outside 0–1, an empty `{ inks }` mix or a mix across CMYK and RGB
  alternates is `L_SPOT_INK_MIX`; an empty or duplicate ink name, or an
  alternate out of range, is `L_PRINT_BOXES`. The dual claim itself raises
  nothing: `L_PDFX_TAGGED_CONFLICT` fires for `'pdfa1b'` (PDF 1.4 has no
  PDF/X-4) and `'pdfa3b'` (embedded files) only.
- **One file for the archive and the press.** The XMP packet carries both
  `pdfaid` and `pdfxid`; the structure tree, the TrimBox, `/Trapped` and the
  `prtr` output intent coexist, and that intent serves both standards — a
  spot colour whose alternate is CMYK is quiet under it, where the sRGB
  intent of a plain PDF/A render would make it an `L_CMYK_INTENT_MISMATCH`
  warning.
- **Both claims are checked on the bytes, not trusted.** `validatePdfX`
  resolves every `/Separation` and `/DeviceN` alternate against the output
  intent and returns `{ valid, errors, warnings }` in-process; veraPDF
  validates the PDF/A-2b claim, as the package's conformance corpus does with
  its `jsx-pdfa2b-pdfx4-dual.pdf` on every release.

Honest limits: there is **no RGB → CMYK conversion** — plate values and
alternates are authored, and the engine performs no colour management beyond
`/DefaultRGB` under a CMYK or Gray intent. Colour bars paint the process inks
only; a bar in a spot ink is not available. Outline bookmark colours are
process colour by the PDF specification: `outline[].color` is typed by
`$defs.processColor` (hex, RGB, CMYK), and a `{ spot }` or `{ inks }` value
there is an engine throw, not a plate. `tagged: true` is the engine's default
claim, PDF/A-2b, byte-identical to `'pdfa2b'` — but the three PDF/A lint rules
(`L_TAGGED_NO_FONTS`, `L_TAGGED_FORM_FONTS`, `L_PDFA_JPX_IMAGE`) evaluate the
string levels only, so name the level to get the pre-flight. `layout.colors`
is accepted by the types but never read by the block-flow renderer — colour
the blocks, not the layout. A PNG with an alpha channel is refused by the
engine (`parsePNG: alpha channel PNGs … are not supported`): flatten it first,
or use JPEG or JPEG 2000. The synthetic CMYK profile the package's sample uses
characterises no press — the ICC profile is yours, and a certified preflight
still has the last word before the job runs.

## See also

- [Ecosystem use cases](use-cases.html) — the hub: stored specs, air-gapped
  PAdES B-LTA, the CI regression gate, edge caching and zipnative as the
  DEFLATE codec.
- [React guide](react.html) — components, rendering entry points and the
  `DocSpec` authoring surface.
- [CLI use cases](use-cases-cli.html) and [MCP use cases](use-cases-mcp.html)
  — the sibling per-surface guides.
- [React playground](../playgrounds/react.html) — the JSX renderer in the
  browser.
- [DocSpec lint playground](../playgrounds/docspec-lint.html) — paste a
  `DocSpec`, read the 41-rule report.
