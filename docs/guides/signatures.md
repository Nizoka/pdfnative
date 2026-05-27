# Digital signatures in pdfnative

pdfnative ships a zero-dependency CMS/PKCS#7 detached signature
implementation (ISO 32000-1 §12.8) with full crypto in pure TypeScript —
RSA PKCS#1 v1.5 and ECDSA P-256, SHA-256/384/512, X.509 DER parsing,
and ASN.1 DER encoding. No OpenSSL, no node-forge, no external crypto.

## TL;DR — sign any PDF in 3 lines (v1.2.0)

```ts
import {
    buildDocumentPDFBytes,
    addSignaturePlaceholder,
    signPdfBytes,
} from 'pdfnative';

const unsigned = buildDocumentPDFBytes(params);
const placeheld = addSignaturePlaceholder(unsigned, { fieldName: 'Author' });
const signed = signPdfBytes(placeheld, {
    signerCert,           // PEM or DER bytes
    rsaKey,               // RSA PKCS#8 private key
    algorithm: 'rsa-sha256',
});
```

That's it. `addSignaturePlaceholder()` (new in v1.2.0) injects an
AcroForm + invisible signature widget + `/Sig` dictionary into the
existing PDF via an incremental update (ISO 32000-1 §7.5.6), then
`signPdfBytes()` computes the `/ByteRange`, hashes the document, builds
the CMS SignedData, and writes the result into the `/Contents`
placeholder.

## Three-step pipeline

```
buildDocumentPDFBytes(params)
        │
        ▼
   unsigned PDF
        │
        │  addSignaturePlaceholder()  ← injects AcroForm + /Sig dict
        ▼
   PDF with /ByteRange + /Contents placeholder
        │
        │  signPdfBytes()             ← hashes, signs, fills /Contents
        ▼
   signed PDF (Adobe Reader ✓ / openssl-cms ✓)
```

### 1. `addSignaturePlaceholder(pdfBytes, options?)`

Idempotent. If the input already contains an `/FT /Sig` widget,
returns the input unchanged. Throws on encrypted input.

Options:

| Option            | Default          | Notes                                           |
|-------------------|------------------|-------------------------------------------------|
| `placeholderBytes`| `16384`          | Size of the `/Contents` hex placeholder         |
| `fieldName`       | `'Signature1'`   | AcroForm field name                             |
| `pageIndex`       | `0`              | Page to attach the (invisible) widget to        |
| `signingTime`     | _omitted_        | `Date` — forwarded to `/M` in the `/Sig` dict   |
| `name`            | _omitted_        | Signer name (`/Name`)                           |
| `reason`          | _omitted_        | Signing reason (`/Reason`)                      |
| `location`        | _omitted_        | Signing location (`/Location`)                  |
| `contactInfo`     | _omitted_        | Contact info (`/ContactInfo`)                   |

### 2. `signPdfBytes(pdfBytes, options)`

Reads the `/ByteRange`, hashes the two byte ranges (everything except
the `/Contents` slot), builds a CMS SignedData with the certificate
chain and `signedAttrs` (content-type, message-digest, signing-time),
signs the `signedAttrs` digest, and writes the DER-encoded CMS into
`/Contents`.

Options:

- `signerCert` — PEM string or DER bytes (X.509 v3).
- `rsaKey` _or_ `ecdsaKey` — PKCS#8 private key.
- `algorithm` — `'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512' | 'ecdsa-sha256'`.
- `extraCerts?` — additional certificates for the chain.
- `signingTime?` — `Date` to embed in `signedAttrs`.

### 3. `verifyPdfSignature(pdfBytes)` _(optional)_

Round-trip helper that re-parses the `/ByteRange`, recomputes the
hash, parses the CMS, and verifies the signature against the embedded
certificate. Returns `{ valid, signerSubject, signingTime, algorithm }`.

## Why a separate placeholder step?

The PDF signature spec is unusual: the `/Contents` field of the `/Sig`
dictionary must contain the CMS bytes, **but the `/ByteRange` excludes
exactly that slot**. So the PDF is hashed _without_ the bytes we're
about to write, which means the file must already have the right
layout — including the placeholder reserved bytes — before we sign.

`addSignaturePlaceholder()` is the canonical way to produce that
layout. It replaces the ad-hoc reimplementations that downstream
tooling (notably `pdfnative-cli`'s `sign` command and `pdfnative-mcp`'s
`prepare_signature_placeholder` workaround) previously had to ship.

## Algorithms

| Algorithm        | Hash      | Curve / Modulus     | Notes                          |
|------------------|-----------|---------------------|--------------------------------|
| `rsa-sha256`     | SHA-256   | 2048 / 3072 / 4096  | PKCS#1 v1.5                    |
| `rsa-sha384`     | SHA-384   | 2048 / 3072 / 4096  | PKCS#1 v1.5                    |
| `rsa-sha512`     | SHA-512   | 2048 / 3072 / 4096  | PKCS#1 v1.5                    |
| `ecdsa-sha256`   | SHA-256   | P-256 (secp256r1)   | DER-encoded ECDSA signature    |

All primitives live under [src/crypto/](https://github.com/Nizoka/pdfnative/tree/main/src/crypto):
SHA-256/384/512 in `sha.ts`, ASN.1 DER in `asn1.ts`, RSA modular
arithmetic in `rsa.ts`, ECDSA P-256 in `ecdsa.ts`, X.509 parsing in
`x509.ts`, and the CMS SignedData builder in `cms.ts`.

## Validating the output

```bash
# openssl-cms — extract the CMS payload and verify against the certificate
openssl pkcs7 -in signed.pdf -inform DER -print_certs

# Adobe Reader — open signed.pdf; signatures panel shows the field name,
# signing time, signer subject, and a green check if the chain validates.

# pdfnative itself
import { verifyPdfSignature } from 'pdfnative';
const result = verifyPdfSignature(await fs.readFile('signed.pdf'));
// → { valid: true, signerSubject: 'CN=...', signingTime: Date, algorithm: 'rsa-sha256' }
```

## Caveats

- **Encrypted PDFs.** `addSignaturePlaceholder()` throws on encrypted
  input — sign before encrypting, or decrypt first.
- **Timestamping (RFC 3161).** Not in v1.2.0. The
  `pdfnative-cli` may detect RFC 3161 timestamp tokens for display
  purposes; embedding a TSA token requires a future API.
- **Multiple signatures.** Each signature requires its own
  `addSignaturePlaceholder()` + `signPdfBytes()` pass (incremental
  updates compose naturally because `/Prev` chains accumulate).
- **PDF/A + signatures.** PDF/A-2b/3b allow signatures; ISO 19005-2
  §6.3.5 forbids certain `/Sig` dictionary fields (`/Reference`,
  `/Changes`). pdfnative emits only the conformant subset.

## Full example

See [scripts/generators/digital-signature.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/digital-signature.ts)
for a runnable RSA + ECDSA sample (key generation, certificate
construction, sign, verify) and
[scripts/generators/signature-placeholder.ts](https://github.com/Nizoka/pdfnative/blob/main/scripts/generators/signature-placeholder.ts)
for the idempotency proof.

## Related guides

- [PDF/A conformance →](pdfa.html) — how signatures interact with PDF/A-2b/3b.
- [Architecture →](architecture.html) — where the crypto module sits in the dependency graph.
- [CLI →](cli.html) — `pdfnative-cli sign` wraps this exact pipeline.
- [MCP integration →](mcp.html) — `pdfnative-mcp` exposes signing as an AI tool.
