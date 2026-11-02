# CLI use cases

> **Five architectures on pdfnative-cli v1.6.0 (requires pdfnative ≥ 1.9.0 —
> pins `^1.9.0`; Node ≥ 22), each assembled from flags that ship today.** They
> extend the [ecosystem use cases](use-cases.html) with what only a command
> line does well — byte-reproducible builds, a PDF/X-4 press handoff, a house
> font without a code change, a process contract any language can drive and a
> right-to-left letter that extracts as typed — and every flag below is
> documented in the [CLI guide](cli.html).

Each case follows the hub's convention: the problem, the load-bearing
invocation, what you gain and where it stops — with an architecture diagram
where data crosses components. The companion pages
cover the same ground for the [MCP server](use-cases-mcp.html) and the
[React renderer](use-cases-react.html).

## Case 1 — Byte-reproducible document builds

A rendered PDF carries the wall clock in four places: `/Info /CreationDate`,
`xmp:CreateDate`, the `{date}` header and footer placeholder, and the trailer
`/ID` (an MD5 over the title, the creation date and the object count). Two
builds of the same template therefore never hash the same, and a release
pipeline cannot tell "the template changed" from "the clock moved". Since
<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
pdfnative 1.8.0 every date is written in UTC, and v1.5.0 adds the global
`--creation-date <iso8601>` — with `SOURCE_DATE_EPOCH` as the fallback the
reproducible-builds.org variable that distribution build tools (Debian, Nix) set — so that
**unencrypted output becomes a pure function of its inputs**: the same JSON
renders to the same bytes on every host, in every timezone.

![Architecture: a JSON template and a pinned creation instant, supplied as SOURCE_DATE_EPOCH or the global --creation-date flag, are rendered by pdfnative-cli on three build hosts running Linux, macOS and Windows in different timezones. Each host produces a PDF whose SHA-256 is identical to the other two, because /CreationDate, xmp:CreateDate, the {date} placeholder and the trailer /ID all derive from the pinned instant in UTC. A CI gate compares the hashes and releases when they are equal; when the engine version differs between builds it falls back to pdfnative compare --mode both, which compares content instead of bytes.](../assets/use-case-reproducible.svg)

```bash
# Any CI shell — the pin travels through the environment, or as a global flag.
export SOURCE_DATE_EPOCH=1767225600             # 2026-01-01T00:00:00Z
pdfnative --json --quiet render --input templates/report.json \
  --output out/report.pdf --tagged pdfa2b --font latin --lang latin \
  2> status.json          # {"ok":true,…,"creationDate":"2026-01-01T00:00:00.000Z"}
sha256sum out/report.pdf  # identical on Linux, macOS and Windows, in any TZ

# The same pin, explicit — global flags may precede the command since v1.5.0,
# and every render inside a manifest run inherits it.
pdfnative --creation-date 2026-01-01T00:00:00Z batch --manifest pipeline.json

# Across engine versions, gate on content instead of bytes.
pdfnative compare golden/report.pdf out/report.pdf --mode both --format json
```

Precedence is explicit: the `--creation-date` flag wins over
`layout.creationDate` in the document or a `--layout` file, which wins over
`SOURCE_DATE_EPOCH`, which wins over the wall clock. An unparsable value in
either the flag or the variable is a usage error (exit 2), never a silent
fall-back to the clock — that would defeat the convention. The pin becomes the
process-wide default, so a `batch --manifest` run applies it to every task,
and the `--json` envelope carries `creationDate` whenever a pin is active — the
one place to notice a `SOURCE_DATE_EPOCH` inherited from a build shell nobody
remembers exporting.

What you gain, concretely:

- **Hash-based release gating** — a SHA-256 in the artefact manifest becomes a
  real assertion: a changed hash means a changed template, font or engine, not
  a changed clock.
- **`{date}` footers that stop drifting** — the placeholder follows the pinned
  instant, so a dated footer no longer breaks the golden file every morning.
- **Content-addressed caches and deduplication** — identical input yields
  identical bytes, so a cache keyed on the JSON is a cache keyed on the PDF.
- **One flag for a whole pipeline** — the pin covers every render of a
  `batch` run without touching the manifest.

The other surfaces pin the same instant their own way: the MCP server reads
`PDFNATIVE_MCP_CREATION_DATE` and then `SOURCE_DATE_EPOCH` at start-up, while
the React renderer takes `<Document creationDate>` per document or
`setDefaultCreationDate` per process and deliberately reads no environment
variable.

Honest limits: **encrypted output is never reproducible** — the file keys come
from a CSPRNG by design. `sign` appends an incremental revision whose `/ID` is
drawn at signing time, and `sign --signing-time` and `metadata --mod-date` are
separate, deliberately unpinned instants: a signature's time has a legal
meaning of its own. An engine upgrade legitimately changes bytes without
<!-- verify-docs:allow version-token (historical: this companion release was built on pdfnative 1.8.0) -->
changing content — pdfnative 1.8.0 itself moved every date to UTC and kept
the hinting tables in TrueType subsets — so rebaseline once per upgrade, or
gate with `compare --mode both`, which survives exactly that.

## Case 2 — Press handoff: PDF/X-4 from a JSON template

A printer's preflight is the most expensive place to learn that a logo was
RGB, a form font was not embedded or the output intent was missing: the job is
already late. PDF/X-4 (ISO 15930-7) is the exchange format press workflows
expect, and the CLI has written it since v1.5.0 from the same JSON template
as every other document — since v1.6.0 with spot plates and next to a PDF/A-2
claim — with the claim **refused at build time** when its prerequisites do
not hold, rather than discovered at the printer.

![Architecture: a JSON template with CMYK colours, colour bars and a trim box, together with the printer's ICC output profile, is rendered by pdfnative render with the PDF/X-4 claim and the strict gate; engine coherence errors and PDF/X diagnostics fail the build before the first byte. The resulting PDF is asserted by pdfnative inspect --check pdfx, whose exit code 0 or 1 gates the handoff. A dry run of the same render gives the same verdict without writing a file. The final printer preflight, drawn dashed, happens outside pdfnative.](../assets/use-case-press-pdfx.svg)

```bash
# The template carries CMYK colours ("c m y k" in 0–1 or [c,m,y,k] in percent),
# layout.print.bleed (derives the TrimBox), layout.print.marks.colourBars and,
# since v1.6.0, layout.print.spotColours painted by { "spot": … } values.
# --output-intent-icc: the printer's prtr profile, CMYK or Gray (16 MiB cap);
# --trapped: PDF/X needs true|false, never unknown;
# --font latin --lang latin: every font embedded;
# --strict: PDFX_* diagnostics fail before any byte.
pdfnative render --input templates/brochure.json --output out/brochure.pdf \
  --pdfx pdfx4 \
  --output-intent-icc press/printer.icc \
  --output-intent-id "ISO Coated v2 (ECI)" \
  --trapped false \
  --font latin --lang latin \
  --strict

# Same verdict, nothing written — --dry-run runs the real build in memory.
pdfnative --json --dry-run render --input templates/brochure.json \
  --pdfx pdfx4 --output-intent-icc press/printer.icc --trapped false \
  --font latin --lang latin --strict

# Assert the claim on any file: exit 0 when the prerequisites hold, 1 otherwise.
pdfnative inspect --input out/brochure.pdf --check pdfx --json --summary

# Since v1.6.0: archive and press in one file — PDF/A-2b and PDF/X-4 together,
# both asserted by one inspect run (--check takes a comma list).
pdfnative render --input templates/brochure.json --output out/brochure-dual.pdf \
  --tagged pdfa2b --pdfx pdfx4 \
  --output-intent-icc press/printer.icc --trapped false \
  --font latin --lang latin --strict
pdfnative inspect --input out/brochure-dual.pdf --check pdfa,pdfx --json --summary
```

Two layers refuse a bad file. Engine coherence errors — no output intent, an
ICC profile without the `acsp` signature, `layout.pdfx` combined with a
PDF/A-1 or PDF/A-3 `layout.tagged` level, an unknown trapping state, a spot
plate painted but never declared — map to `E_INPUT` and produce no output at
all. Under `--strict`, the conformance diagnostics
`PDFX_NO_FONT_ENTRIES`, `PDFX_DEVICE_CMYK` and `PDFX_ANNOTATIONS` escalate to
`E_CHECK_FAILED` before the first output byte; without it they are stderr
warnings and a `diagnostics[]` array in the envelope, which also carries
`pdfx: "pdfx4"`. On the receiving side, `inspect` always reports the XMP claim
as `pdfxConformance`, `--pdfx` adds the full structural report and
`--check pdfx` turns it into an exit code; `--summary` keeps the verdict to
five fields.

What you gain, concretely:

- **The claim is refused at build time** — a template that cannot be PDF/X-4
  never produces a file that says it is.
- **A dry-run verdict without writing** — the same errors, escalations and
  diagnostics as the real run, with `dryRun: true` and no `bytes` in the
  envelope; nothing touches the disk.
- **The profile comes from the command line** — `--output-intent-icc` reads a
  path you name (or the layout JSON carries the profile as an inline byte
  array, under the same 16 MiB cap); no JSON payload can ever name a file on
  disk.
- **One template, two markets — or one file for both** — the same JSON
  renders to PDF/A for the archive and PDF/X-4 for the press by changing the
  conformance flags, and since v1.6.0 `--tagged pdfa2b` (or `pdfa2u`) next to
  `--pdfx pdfx4` writes both claims into one file.
- **Spot plates from the JSON** — `layout.print.spotColours` declares the
  inks (name plus a CMYK or RGB alternate) and `{ "spot": "PANTONE 300 C" }`,
  `{ "spot": …, "tint": 0.5 }` or `{ "inks": … }` colour values paint them as
  `/Separation` and `/DeviceN`; like every `print.*` option it is JSON-only,
  with no flag.

The MCP server exposes the same claim as `pdfx: 'pdfx4'` on its generation
tools and checks it with `validate_pdf` and `standard: 'pdf-x-4'`; the React
renderer takes `pdfx="pdfx4"` on `<Document>` and leaves the check to the
engine's `validatePdfX`, one import away.

Honest limits: `inspect --check pdfx` is pdfnative's **structural validator,
not a certified preflight** — it checks the output intent, the page boxes,
font embedding and forbidden annotations, not colour appearance or rendering;
the printer's preflight still runs. Only PDF/X-4 is exposed: no PDF/X-1a, no
PDF/X-3. Spot colours are JSON-only since v1.6.0 — `layout.print.spotColours`
plus `{ "spot" }` / `{ "inks" }` values — and the CLI adds no validator of its
own: an undeclared plate or a mix across alternate spaces is the engine's
`Spot colour …` / `Ink mix …` error, transmitted as `E_INPUT` (its
`Invalid spot colour` / `Invalid ink mix` shape errors come back as `E_RUNTIME`), and there is no RGB-to-CMYK
conversion of a process colour. `metadata` rewrites the XMP without the PDF/X
identification, so re-check any file you edit afterwards. Since v1.6.0 the
claim combines with PDF/A-2b or PDF/A-2u (`--tagged pdfa2b --pdfx pdfx4`,
verified in one run by `inspect --check pdfa,pdfx`); PDF/A-1b and PDF/A-3b
with `--pdfx` are refused by the engine (`E_INPUT`, no CLI pre-check), and
encryption stays exclusive — PDF/X forbids it, and the usage error exits 2
before the build. And no press profile ships: the `synthetic-cmyk.icc` under
the CLI's samples is structurally valid and colourimetrically meaningless —
ask the printer for theirs.

## Case 3 — A house font and book typesetting without a code change

Corporate templates arrive with a licensed house font, and long documents need
the rules a typesetter takes for granted — widows and orphans, a heading that
never ends a page alone, paragraphs that may split, kerning, old-style
numerals. Before v1.5.0 a font outside the bundled set meant a wrapper script
around the library, and the typography options needed TypeScript. Now
`--font-file` registers the file from disk and four flags plus
`layout.typography` cover the rest — **from the command line, against the
same JSON**.

```bash
# House font from disk, typesetting rules from the layout file — no TypeScript.
# --font-file: TTF/OTF, 32 MiB cap, validated before registration;
# book/typography.json holds {"typography":{"widows":2,"orphans":2,"opticalMargins":true}};
# --strict: TYPOGRAPHY_FEATURE_INEFFECTIVE fails the build.
pdfnative render --input book/manuscript.json --output out/book.pdf \
  --font-file fonts/HouseSerif-Regular.ttf:house-serif \
  --split-paragraphs --keep-headings-with-next \
  --kerning --font-features onum,smcp \
  --layout book/typography.json \
  --strict

# Preflight the font and the feature tags without writing anything.
pdfnative --json --dry-run render --input book/manuscript.json \
  --font-file fonts/HouseSerif-Regular.ttf:house-serif --font-features onum,smcp
```

`--font-file <path.ttf>[:name]` is repeatable and guarded the same way as
every other binary input: the path is checked against traversal, the file is
capped at 32 MiB, the sfnt signature is required (TrueType collections and
WOFF containers are refused), and the program is parsed and then validated
with the engine's `validateFontData` before it is registered — format and
validation failures are `E_INPUT`, warnings go to stderr. The name defaults
to the file stem (`[a-z0-9-]`); a malformed name or one that collides with a
bundled shortcut is a usage error (exit 2). The name is added to `--lang`, so
the font is embedded as a CIDFont Type2 subset like every other.
Fonts are never loaded from a JSON payload — only from this flag.

The four flags are shortcuts for the most common `layout.typography` keys; the
full set (`widows`, `orphans`, `splitParagraphs`, `keepHeadingsWithNext`,
`opticalMargins`, `punctuationSpacing`, `unitBinding`, `bindShortWords`,
`kerning`, `fontFeatures`, `metrics`, `hyphenationLanguage`) lives in the JSON — the document, a
`--layout` file and the flags merge one level deep, flags winning. Paragraph
blocks accept `align: "justify"`, `keepWithNext` and `splittable`, and any
text may carry soft hyphens (U+00AD). Under `--strict`, a feature tag the font
does not implement is not a silent no-op: `TYPOGRAPHY_FEATURE_INEFFECTIVE`
fails the build, and `--dry-run --json` reports it in `diagnostics[]` before
anything is written.

What you gain, concretely:

- **A house font without a build step** — the licensed TTF stays a file on
  disk, registered per invocation.
- **Book rules in data, not code** — a `typography.json` reviewed like any
  other configuration.
- **Feature tags that are asserted** — the build says when `onum` or `smcp`
  changed nothing in this font, instead of shipping lining numerals quietly.

Honest limits: there is **no hyphenation dictionary** — the engine ships a
provider seam and no patterns, the CLI does not expose the seam, and
`hyphenationLanguage` passes through with nothing to drive; the only break
opportunities inside a word are the soft hyphens the author wrote, which are
honoured unconditionally. `metrics: "exact"` acts on the base-14 path only —
once a font is registered, that font measures the text. A custom font covers
only the code points in its own cmap; everything else falls to the other
registered fonts, so pair it with `--font latin --lang house-serif,latin` for
a Latin fallback — `--font` alone registers the module without embedding it,
and the first font in `--lang` order that covers a code point wins, so the
house face goes first.
`--kerning` needs a registered font. And `tnum` on Noto Sans is a no-op — the
bundled module declares the feature, but its figures are already tabular and
lining, so the tag substitutes nothing, which is exactly what the diagnostic
reports.

## Case 4 — Any-language orchestrator on the process contract

The MCP server is the right integration for a conversational assistant; a
Python job queue, a Go service or a Jenkins step wants a **process contract**,
not a protocol. The CLI's contract has three channels and nothing else: the
artefact on stdout, diagnostics and a JSON envelope on stderr, and an exit
code of 0 (success), 1 (runtime error) or 2 (usage error). Under `--json` the
envelope is always the **last line of stderr**, `--quiet` drops everything
before it, and every failure carries one of 12 stable `E_*` codes to branch
on — never the human message.

![Architecture: an orchestrator written in any language spawns one pdfnative process per task and reads three lanes back — the artefact on stdout (PDF bytes, extracted text, or the JSON report of inspect, verify and batch), the JSON envelope as the last line of stderr, and the exit code 0, 1 or 2. A side box shows pdfnative schema manifest, which lists every command, its flags, the global flags and the 12 stable error codes as one JSON document, so the orchestrator can register the CLI as a tool set at runtime. A dry run validates the same inputs without writing a file or touching the network.](../assets/use-case-orchestrator.svg)

```python
import json, subprocess

def pdfnative(*args: str) -> tuple[int, dict | None, str]:
    """One process per task: (exit code, stderr envelope or None, stdout artefact)."""
    p = subprocess.run(["pdfnative", "--json", "--quiet", *args], capture_output=True, text=True)
    lines = p.stderr.strip().splitlines()
    envelope = json.loads(lines[-1]) if lines else None           # the envelope is the LAST stderr line
    failed_check = p.returncode == 1 and envelope is not None and envelope["error"]["code"] == "E_CHECK_FAILED"
    if p.returncode != 0 and not failed_check:                     # 1 = runtime error, 2 = usage error
        raise RuntimeError(f"{envelope['error']['code']}: {envelope['error']['message']}" if envelope else f"exit {p.returncode}")
    return p.returncode, envelope, p.stdout

pdfnative("render", "--input", "doc.json", "--output", "out.pdf", "--dry-run")  # preflight; never touches the network
_, status, _ = pdfnative("render", "--input", "doc.json", "--output", "out.pdf")  # status["bytes"]; status["creationDate"] when pinned
code, _, verdict = pdfnative("inspect", "--input", "out.pdf", "--check", "pdfa", "--summary")  # verdict JSON on stdout; code 0 pass, 1 fail
```

The contract is discoverable at runtime. `pdfnative schema manifest` emits one
JSON document listing every command, its flags, the global flags and the
error codes — enough to register the CLI as a tool set without reading a
manual — and `schema render`, `schema status` and the other subjects are
JSON Schemas (Draft 2020-12) whose `$id` embeds the CLI version, so your own
validator checks the input before the process starts and detects drift after
an upgrade. `--dry-run` validates the same inputs the real run would — JSON
parsed, layout assembled, fonts and profiles read, credentials loaded — and
**never performs network I/O** on the commands that implement it (`render`,
`sign`, `ltv`, `doc-timestamp`, `batch`), even when a network flag is
present; `verify` has no dry run, so `--revocation online` always fetches.

What you gain, concretely:

- **One contract for 21 commands** — render, sign, verify, merge, extract,
  compare and the rest all answer through the same three channels and the
  same 12 codes.
- **Token-cheap stdout** — `--summary` collapses `inspect`, `verify` and
  `batch` to the fields an orchestrator gates on, `--fields a,b.c` projects
  any path, and the JSON is compact by default under `--json`.
- **Offline by default** — the only network opt-ins are explicit flags
  (`sign --timestamp`, `ltv collect|add --online`, `doc-timestamp --url`,
  `verify --revocation online`), each behind an SSRF guard, each failing with
  `E_NETWORK` rather than a silent fallback. Since v1.6.0 the air-gapped
  ladder has a second offline rung next to `ltv embed --data`: `ltv embed
  --cert <pem|der> --ocsp <der> --crl <der> --match all|chain` builds the
  `/DSS` from material you already hold — every flag repeatable, 16 MiB per
  file, nothing fetched, exclusive with `--data` (one or the other, exit 2
  for both).

Honest limits: `inspect`, `verify` and `batch` put their result **on stdout as
JSON**, not in the envelope — on success there may be no stderr line at all,
which is why the wrapper above returns both channels. `ltv` and `compare` take
positional arguments and are not callable from a `batch --manifest` pipeline
yet; run them as their own process. And the CLI is stateless by design — one
process per task, no daemon, no session — so concurrency, retries and queueing
are the orchestrator's job, driven by the exit code.

## Case 5 — Right-to-left letter in, logical-order text out

<!-- demo-language: ar (one word in visual and in logical order) -->
A customer letter arrives as a JSON template with an Arabic body, a Hebrew
body and a Latin closing, and the rendered PDF has to feed a search or RAG
index afterwards. Right-to-left text breaks a PDF pipeline in two places. On
the way in, the paragraphs are set like Latin — left-aligned, justified from
the wrong edge — unless somebody annotates each block. On the way out, what
extracts from the file comes back letter by letter in **visual** order, `ةيبرع`
for `عربية`, because a content stream stores glyphs as drawn and nothing says
which way to read them. Since v1.6.0 (pdfnative ≥ 1.9.0) one flag fixes the
first and the engine fixes the second: `--direction auto` resolves each
paragraph's base direction from its first strong character (full UAX #9), and
every untagged right-to-left run leaves the writer as a `/Span /ActualText`
carrying its logical text — which `extract-text` returns **as typed, with no
flag and no PDF/A claim**.

![Architecture: a JSON letter with Arabic and Hebrew paragraphs under layout.direction auto is rendered by pdfnative render with --direction auto and the ar, he and latin font modules into an untagged letter.pdf, where every right-to-left run is a /Span /ActualText span carrying its logical text inside one text object per line. pdfnative extract-text --format ndjson reads the file with no extra flag — the span is applied once, as Chrome and Acrobat Reader do — and writes one JSON object per page in logical order, which a search or RAG index ingests page by page without a reversal heuristic or an OCR step. The footer names --actual-text false as the switch that drops the spans (bare runs in visual order, not the 1.8.0 bytes), and the limits: a Thai above vowel and tone mark pair and a line mixing directions extract geometrically, and watermark and form-label text carries no span.](../assets/use-case-rtl-roundtrip.svg)

<!-- demo-language: ar, he (right-to-left sample text) -->
```json
{
  "title": "Right-to-left letter",
  "layout": { "direction": "auto" },
  "blocks": [
    { "type": "heading", "text": "Right-to-left letter", "level": 1 },
    { "type": "paragraph", "text": "السلام عليكم ورحمة الله وبركاته. هذه الفقرة مكتوبة من اليمين إلى اليسار، وتحتوي على أرقام مثل 2026 وكلمات لاتينية مثل pdfnative داخل الجملة.", "align": "justify" },
    { "type": "paragraph", "text": "שלום עולם, ברוכים הבאים. פסקה זו נכתבת מימין לשמאל ומיושרת לימין באופן אוטומטי.", "align": "justify" },
    { "type": "paragraph", "text": "هذه الفقرة تُجبر على الاتجاه من اليسار إلى اليمين عبر direction: ltr على الكتلة نفسها.", "direction": "ltr" },
    { "type": "paragraph", "text": "Signed on 2026-01-01 — the Latin closing is set left to right." }
  ]
}
```

```bash
# --direction auto: every paragraph resolves its own base direction (UAX #9
# P2–P3); omit the flag and the 1.8.0 left-aligned paragraphs stay — there
# is no default. --font registers the three modules, --lang orders the
# fallback; --json: the envelope carries "direction": "auto".
pdfnative --json render --input letter.json --output letter.pdf \
  --direction auto \
  --font ar --font he --font latin --lang ar,he,latin

# Logical order, as typed — one JSON object per page for the index.
pdfnative extract-text --input letter.pdf --format ndjson > letter.ndjson

# The same page without the spans (not the 1.8.0 bytes): every letter is
# still there, in visual order.
pdfnative render --input letter.json --output letter-bare.pdf \
  --direction auto --actual-text false \
  --font ar --font he --font latin --lang ar,he,latin
```

```python
import json

# index is your own search or RAG client; its add() signature is yours
with open("letter.ndjson", encoding="utf-8") as pages:   # {"pageIndex": 0, "text": "…"} per line
    for line in pages:
        page = json.loads(line)
        index.add(doc_id="letter", page=page["pageIndex"], text=page["text"])  # logical order, as typed
```

`--direction` has no default. Omitted, nothing is set and the output is the
1.8.0 behaviour: the bidi algorithm already orders the letters correctly, but
every paragraph is set left-aligned, like Latin. `auto` aligns right-to-left
paragraphs to the right and justifies them in visual order; `rtl` and `ltr`
force a base direction on every paragraph; a paragraph block's own
`direction` wins over all three, which is how the third paragraph above stays
left to right. The value also travels as `layout.direction` through the
document JSON or a `--layout` file, flags winning, and the `--json` envelope
carries `direction` whenever it was set. `actualText: false` appears in the
envelope only when the opt-out was used — the default emits nothing, so an
envelope without the key means the spans are there.

The extraction side needs no flag. pdfnative 1.9.0 wraps every untagged
right-to-left run, and every shaped run whose glyph order differs from its
text (an Indic pre-base vowel sign or reph, a Khmer or Myanmar pre-base vowel,
a Thai tone mark set before a below vowel), in a `/Span /ActualText` carrying
its logical text, inside one text object per line — the structure Skia and
Chrome write — so Acrobat Reader, Chrome and `extract-text` all return the
source string once. Tagged output (`--tagged`) carried it already in its
structure spans; the untagged letter above needs no PDF/A claim to extract as
typed. `--actual-text false` is the one switch that drops the spans: the bare runs
come back in visual order, as 1.8.0 wrote them — not the 1.8.0 bytes, since
the 1.9.0 subsets and line structure still apply — and the logical-order
guarantee goes with them.

What you gain, concretely:

<!-- demo-language: ar (the greeting of the second item, logical order) -->
- **A letter set the way its readers expect** — right-aligned, justified in
  visual order, with the Latin closing left to right and no per-block
  annotation.
- **Logical-order text for the index, tagged or not** — `extract-text`
  returns `السلام عليكم`, not its mirror image, from an untagged file; the
  NDJSON streams page by page into a retrieval pipeline with no reversal
  heuristic and no OCR step. `--runs` adds `{ text, x, y, fontSize,
  fontName }` when the index wants positions.
- **One switch for the spans** — `--actual-text false` is the only knob,
  named in the envelope, for a pipeline that must keep the bare runs (it
  removes the spans; it does not restore 1.8.0 bytes).
- **The same letter, three surfaces** — the MCP server takes `direction` and
  `actualText` on its nine document tools and `onStreamError` on
  `extract_text`; the React renderer takes `<Document direction>` and
  `<Paragraph direction>`, with `layout.actualText: false` as its layout-only
  opt-out.

<!-- demo-language: th (one Thai cluster in geometric and in logical order) -->
Honest limits: a Thai above vowel and tone mark pair may still extract in
**geometric order** from untagged output (`ตั้ง` comes back as `ตัง้`) — the
ToUnicode is right and the span covers reordered clusters, not that pair. A
line that mixes directions extracts **run by run**: each right-to-left run
logical, the runs in geometric order, what a Chrome-printed page gives — so
keep a sentence the index must quote verbatim in one direction. Text drawn
outside the paragraph flow — a watermark, a form label — carries no span.
And `extract-text` refuses rather than guesses: under `--on-stream-error
limit` (the default) a content or font stream past the global
`--max-inflate-size` (100 MiB) is `E_INPUT`, with the message naming both
remedies — raise the cap, or `--on-stream-error skip` to read the page without
that stream's text; `throw` fails on any undecodable stream, while `limit`
still skips a corrupt one as before. Branch on the code and prefer `limit` for
untrusted input; `compare` takes the same flag, and only `throw` rules out an
equal verdict over an unread stream.

## See also

- [Ecosystem use cases](use-cases.html) — the hub: five cross-surface
  architectures, including the CI regression gate and the air-gapped PAdES
  ladder these cases build on.
- [CLI guide](cli.html) — the complete v1.6.0 command reference behind every
  flag above.
- [MCP use cases](use-cases-mcp.html) and [React use cases](use-cases-react.html)
  — four cases each, the same engine seen from the other two surfaces.
- [CLI playground](../playgrounds/cli.html) — compose a `pdfnative` invocation
  in the browser.
- [Reproducible output playground](../playgrounds/reproducible.html) — pin a
  creation date and watch the bytes stay identical.
