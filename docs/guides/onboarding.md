# Onboarding — the pdfnative ecosystem in 90 seconds

> **Tracks:** library v1.1.0 · CLI v0.3.0 · MCP v0.3.0
> **Pick your entry point:** library for code, CLI for shell scripts, MCP for AI assistants. They all produce the same ISO 32000-1 / PDF/A-conformant PDFs.

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

Iteration helpers (v0.3.0): `--watch` re-renders on save, `--template` injects variables, `--font latin|emoji` enables the bundled fonts.

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

The assistant calls `create_document` (with `pdfA: "2b"`), then `add_international_text` (with `lang: ["ar", "emoji"]`), `add_table`, `sign_document`, and finally `inspect_pdf` — the 9th tool added in v0.3.0 — to confirm the result.

Next: [MCP guide →](mcp.html) · [MCP playground →](../playgrounds/mcp.html)

---

## What to read next

- New to PDFs in code? Start with [Quick Start](quickstart.html) and [Architecture](architecture.html).
- Need accessible / archive-grade output? Read [Accessibility](accessibility.html) and [PDF/A conformance](pdfa.html).
- Hit a snag? See [Troubleshooting](troubleshooting.html) and the [FAQ](faq.html).
- Curious about the trade-offs? The [FAQ](faq.html) compares pdfnative with pdfkit, jsPDF, and pdf-lib.

If pdfnative saved you time, a ⭐ on [GitHub](https://github.com/Nizoka/pdfnative) helps others find it. Thanks!
