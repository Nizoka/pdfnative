# Onboarding — the pdfnative ecosystem in 90 seconds

> **Tracks:** library · CLI · MCP · React
> **Pick your entry point:** the library for code, the CLI for shell scripts, MCP for AI assistants, and React for declarative JSX. They all produce the same ISO 32000-1 / PDF/A-conformant PDFs from the same zero-dependency engine.

---

## 1. Library (Node, browser, Deno, Bun) — 30 seconds

```bash
npm install pdfnative
```

```ts
import { buildDocumentPDFBytes, registerFont } from 'pdfnative';

// Optional: enable a non-Latin script
registerFont('arabic', () => import('pdfnative/fonts/noto-arabic-data.js'));

const bytes = await buildDocumentPDFBytes({
  metadata: { title: 'Hello pdfnative', author: 'Me' },
  blocks: [
    { type: 'h1', text: 'Hello pdfnative' },
    { type: 'paragraph', text: 'Pure native PDF, zero runtime dependencies.' },
  ],
  layout: { tagged: 'pdfa2b' }, // optional PDF/A-2b
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

```bash
# Render a JSON document → PDF
pdfnative-cli render doc.json --output out.pdf --pdf-a 2b

# Sign it (auto-injects a signature placeholder if needed)
pdfnative-cli sign out.pdf signed.pdf \
  --key signer.key --cert signer.crt --algorithm rsa-sha256

# Verify the embedded CMS signature
pdfnative-cli verify signed.pdf --json
```

Iteration helpers: `--watch` re-renders on save, `--template` injects variables, `--font` enables any of the 22 bundled scripts + colour emoji. v1.1.0 adds `--stream-true` (constant-memory), `inspect --pdfua` (accessibility gate), and an agent-native `--json`/`E_*`/`--dry-run` contract.

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

The assistant calls `generate_basic_pdf` (with `pdfA: "pdfa2b"`), then `add_international_text` (with `lang: ["ar", "emoji"]`), `add_table`, `sign_pdf`, and finally `inspect_pdf` — confirming the result. v1.0.0 ships **12 tools** including `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD), and `extract_text`.

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
