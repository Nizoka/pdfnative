# Onboarding — the pdfnative ecosystem in 90 seconds

> **Pick your entry point:** the library for code, the CLI for shell scripts, MCP for AI assistants, and React for declarative JSX. They all produce the same ISO 32000-1 / PDF/A-conformant PDFs from the same zero-dependency engine. Live versions for every package are shown at the top of the [documentation home](../index.html).

---

## 1. Library (Node, browser, Deno, Bun) — 30 seconds

```bash
npm install pdfnative
```

```ts
import { buildDocumentPDFBytes, registerFont, loadFontData } from 'pdfnative';

// Optional: enable a non-Latin script — register under the script code ('ar'),
// then load the data and pass it via fontEntries (registration alone is a no-op):
registerFont('ar', () => import('pdfnative/fonts/noto-arabic-data.js'));
const ar = await loadFontData('ar');
if (!ar) throw new Error('Arabic font failed to load');

// Synchronous — returns a Uint8Array, not a Promise.
const bytes = buildDocumentPDFBytes({
  title: 'Hello pdfnative',              // top-level, not inside metadata
  metadata: { author: 'Me' },            // author / subject / keywords only
  blocks: [
    { type: 'heading', text: 'Hello pdfnative', level: 1 },
    { type: 'paragraph', text: 'Pure native PDF, zero runtime dependencies.' },
  ],
  fontEntries: [{ fontData: ar, fontRef: '/F3', lang: 'ar' }], // /F1 and /F2 are reserved
  layout: { tagged: 'pdfa2b' },          // optional PDF/A-2b
});

// In Node: await fs.writeFile('out.pdf', bytes);
// In browser: new Blob([bytes], { type: 'application/pdf' });
```

Next: [Quick Start →](quickstart.html) · [Architecture →](architecture.html) · [PDF/A conformance →](pdfa.html)

---

## 2. CLI — 30 seconds

```bash
npm install -g pdfnative-cli   # or: npx pdfnative-cli ...
```

> The package is named `pdfnative-cli`, but the binary it puts on your PATH is
> **`pdfnative`**. Under `npx`, either name works.

```bash
# Check the environment first — the fastest way to confirm the install worked
pdfnative doctor

# Render a JSON document → PDF. Input and output are flags, not positionals;
# with neither, render reads stdin and writes stdout.
pdfnative render --input doc.json --output out.pdf --tagged pdfa2b

# Sign it (auto-injects a signature placeholder if needed)
pdfnative sign --input out.pdf --output signed.pdf \
  --key signer.key --cert signer.crt --algorithm rsa-sha256

# Verify the embedded CMS signature
pdfnative verify --input signed.pdf --json
```

Iteration helpers: `--watch` re-renders on save, `--template` injects variables, `--font` enables any of the 22 bundled scripts + colour emoji + the math font. v1.1.0 added `--stream-true`, `inspect --pdfua` (accessibility gate), and an agent-native `--json`/`E_*`/`--dry-run` contract; v1.2.0 added page-tree `merge` / `split` / `extract`, markup `annotate`, an AI-governance `govern` gate, and `render --outline` / `--font math` / `--inspect-layout`; **v1.3.0** adds `fill`, `encrypt`, `decrypt`, `extract-text` and `doctor`, native `chart` blocks in `render`, passwords on the page-tree commands, and PowerShell completion.

> **Upgrading from v1.2.0?** `render --encrypt` was a silent no-op in that
> release — documents you thought were encrypted were written in the clear.
> v1.3.0 fixes it and unifies the flags under `--encrypt` / `--owner-password` /
> `--user-password` / `--permissions`. Re-run any affected job.

Next: [CLI guide →](cli.html) · [CLI playground →](../playgrounds/cli.html)

---

## 3. MCP (Claude Desktop, Cursor, Continue, Zed) — 30 seconds

```bash
npm install -g pdfnative-mcp
```

Add the server to your client config — Claude Desktop example (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"]
    }
  }
}
```

Then prompt your assistant:

> *Create a PDF/A-2b invoice for ACME Inc, add a multilingual paragraph in Arabic, and sign it with my key.*

The assistant calls `generate_basic_pdf` (with `pdfA: "pdfa2b"`), then `add_international_text` (with `lang: ["ar", "emoji"]`), `add_table`, `sign_pdf`, and finally `inspect_pdf` — confirming the result. v1.4.0 ships **24 tools**, including the page-tree trio `merge_pdfs`, `split_pdf`, `extract_pages`, markup `annotate_pdf`, the network-free `draft_governance_issue`, plus `validate_pdf`, `verify_pdf`, `add_attachment`, `extract_attachments`, and `extract_text`.

Next: [MCP guide →](mcp.html) · [MCP playground →](../playgrounds/mcp.html)

---

## 4. React (Next.js, Remix, any React 19 app) — 30 seconds

```bash
npm install pdfnative-react pdfnative react
```

```tsx
import { Document, Heading, Text, Table, renderToBytes } from 'pdfnative-react';

const bytes = renderToBytes(
  <Document title="Invoice #1024" footerText="Acme Inc">
    <Heading level={1}>Invoice #1024</Heading>
    <Text>Thank you for your business.</Text>
    <Table headers={['Item', 'Total']} rows={[{ cells: ['Pro plan', '$49.00'], type: 'default', pointed: false }]} zebra />
  </Document>,
); // → Uint8Array, a valid PDF
```

A custom React reconciler compiles your JSX to pdfnative blocks on-device — no DOM, no headless browser. Preview live with the `usePdf` hook / `PDFViewer`, or let AI agents author with the token-frugal `DocSpec`. **React 19 is a peer dependency of `pdfnative-react` only** — the engine stays zero-dependency.

Next: [React guide →](react.html) · [React playground →](../playgrounds/react.html)

---

## What to read next

- New to PDFs in code? Start with [Quick Start](quickstart.html) and [Architecture](architecture.html).
- Need accessible / archive-grade output? Read [Accessibility](accessibility.html) and [PDF/A conformance](pdfa.html).
- Hit a snag? See [Troubleshooting](troubleshooting.html) and the [FAQ](faq.html).
- Curious about the trade-offs? The [FAQ](faq.html) compares pdfnative with pdfkit, jsPDF, and pdf-lib.

If pdfnative saved you time, a ⭐ on [GitHub](https://github.com/Nizoka/pdfnative) helps others find it. Thanks!
