# Digital signatures in pdfnative

> **CMS/PKCS#7 detached signatures in pure TypeScript** — RSA PKCS#1 v1.5 (SHA-256/384/512) and ECDSA P-256, the PAdES baseline profile and multiple signatures since v1.7.0, with a one-call `addSignaturePlaceholder()` workflow. For timestamps and B-T → B-LTA, see the [LTV guide](ltv.html).

pdfnative ships a zero-dependency CMS/PKCS#7 detached signature
implementation (ISO 32000-1 §12.8) with full crypto in pure TypeScript —
RSA PKCS#1 v1.5 (SHA-256, plus SHA-384/512 since v1.7.0) and ECDSA P-256 (SHA-256), X.509 DER parsing,
and ASN.1 DER encoding. No OpenSSL, no node-forge, no external crypto.

## TL;DR — sign any PDF in 3 lines

```ts
import {
    buildDocumentPDFBytes,
    addSignaturePlaceholder,
    signPdfBytes,
    parseCertificate,
    parseRsaPrivateKey,
} from 'pdfnative';

const unsigned = buildDocumentPDFBytes(params);
const placeheld = addSignaturePlaceholder(unsigned, { fieldName: 'Author' });
const signed = signPdfBytes(placeheld, {
    signerCert: parseCertificate(certDer),  // X509Certificate (from DER bytes)
    rsaKey: parseRsaPrivateKey(keyDer),     // RsaPrivateKey (from DER bytes)
    algorithm: 'rsa-sha256',
});
```

That's it. `addSignaturePlaceholder()` injects an
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

| Option            | Default          | Notes                                             |
|-------------------|------------------|---------------------------------------------------|
| `placeholderBytes`| `16384`          | Size of the `/Contents` hex placeholder           |
| `fieldName`       | `'Signature1'`   | AcroForm field name                               |
| `pageIndex`       | `0`              | Page to attach the (invisible) widget to          |
| `rect`            | `[0, 0, 0, 0]`   | Widget rectangle (invisible by default)           |
| `allowMultiple`   | `false`          | Append a placeholder even when signature fields already exist — the multi-signature flow (v1.7.0, see below) |

To size `placeholderBytes` from your actual certificate chain instead of
relying on the 16 KiB default, use `estimateContentsSize(certSizes, algorithm)`.
Since v1.7.0 it takes an options object: `estimateContentsSize(certSizes,
'rsa-sha256', { timestamp: true })` reserves ~8 KiB of extra headroom for an
RFC 3161 timestamp token (covering the TSA's own certificate chain) when an
external signer will add one to the CMS.

Signer metadata (`name`, `reason`, `location`, `contactInfo`, `signingTime`)
is **not** set here — the placeholder writes an empty `/Sig` dictionary; pass
the metadata to `signPdfBytes`, which writes it at signing time.

### 2. `signPdfBytes(pdfBytes, options)`

Reads the `/ByteRange`, hashes the two byte ranges (everything except
the `/Contents` slot), builds a CMS SignedData with the certificate
chain and `signedAttrs` (content-type, message-digest, signing-time),
signs the `signedAttrs` digest, and writes the DER-encoded CMS into
`/Contents`.

Options:

- `signerCert` — `X509Certificate` (parse DER bytes with `parseCertificate`).
- `rsaKey` _or_ `ecKey` — the private key. Parse RSA keys from DER with
  `parseRsaPrivateKey`; for ECDSA there is no DER parser in the engine — supply
  the `EcPrivateKey` scalar directly, or install a crypto provider
  (`setCryptoProvider` / per-call `provider`) and omit the raw key entirely.
- `algorithm` — `'rsa-sha256' | 'rsa-sha384' | 'rsa-sha512' | 'ecdsa-sha256'`
  (default `'rsa-sha256'`; the SHA-384/512 RSA variants are new in v1.7.0).
- `certChain?` — additional intermediate-CA certificates for the chain.
- `signingTime?` — forwarded to `signedAttrs`.
- `fieldName?` — with several unsigned placeholders in the file (the
  `allowMultiple` flow below), selects which one to sign by its AcroForm field
  name. With a single placeholder — the only case prior to v1.7.0 — the option
  is unnecessary and behaviour is unchanged. (v1.7.0)

### 3. Verifying

The library does **not** ship a PDF-signature verifier — its
verification surface is limited to `openPdf()` plus
`verifyCertSignature()` (an X.509 certificate-signature check). To
verify a signed PDF end to end (byte-range digest, CMS signature value,
chain, trust, timestamps, revocation), use
[`pdfnative-cli verify`](cli.html#pdfnative-verify) or the
[`verify_pdf` MCP tool](mcp.html) — the CMS verification logic lives
there. Since pdfnative-mcp 1.6.0, `verify_pdf` also validates
`/DocTimeStamp` fields as RFC 3161 tokens and reports the achieved
PAdES level (B-B → B-LTA) with `ltv: true`.

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

## Multiple signatures (v1.7.0)

Simply repeating the placeholder + sign pass does **not** add a second
signature: `addSignaturePlaceholder()` is idempotent by contract, so on a PDF
that already carries any `/FT /Sig` field it returns the input unchanged. To
add further signatures, opt in with `allowMultiple` and give each signature its
own field name:

```ts
// First signer.
let pdf = addSignaturePlaceholder(unsigned, { fieldName: 'Author' });
pdf = signPdfBytes(pdf, {
    signerCert: authorCert, rsaKey: authorKey, algorithm: 'rsa-sha256',
});

// Second signer — appended as a fresh incremental update.
pdf = addSignaturePlaceholder(pdf, { fieldName: 'Reviewer', allowMultiple: true });
pdf = signPdfBytes(pdf, {
    signerCert: reviewerCert, rsaKey: reviewerKey, algorithm: 'rsa-sha256',
    fieldName: 'Reviewer', // selects which unsigned placeholder to fill
});
```

The exact semantics:

- **`allowMultiple: false`** (default) preserves the 1.x idempotent
  short-circuit: any existing signature field returns the input unchanged.
- **`allowMultiple: true`** — an existing *unsigned* placeholder with the same
  `fieldName` returns the input unchanged (per-name idempotence); a *signed*
  field with the same name throws (pass a fresh `fieldName`); other signature
  fields are left alone and a new placeholder is appended via incremental
  update, so `/Prev` chains compose naturally.
- **`signPdfBytes` with several unsigned placeholders** requires the
  `fieldName` selector — without it, the call throws and lists the unsigned
  field names. Already-signed signatures are never modified.

## Inspecting signatures — `listSignatures()` (v1.7.0)

`listSignatures(pdfBytes)` enumerates every signature field in a PDF, in
AcroForm `/Fields` order — signed signatures, document timestamps, and
still-unsigned placeholders:

```ts
import { listSignatures } from 'pdfnative';

for (const sig of listSignatures(signedPdf)) {
    console.log(sig.fieldName, sig.subFilter, sig.isPlaceholder);
}
// → 'Author'   'adbe.pkcs7.detached' false
// → 'Reviewer' 'adbe.pkcs7.detached' false
```

Each entry is a `PdfSignatureInfo`:

| Field | Type | Meaning |
|-------|------|---------|
| `fieldName?` | `string` | The widget's `/T` field name, when present |
| `subFilter` | `string` | `/SubFilter` — e.g. `'adbe.pkcs7.detached'`, `'ETSI.CAdES.detached'`, `'ETSI.RFC3161'` (`''` when absent) |
| `byteRange` | `readonly number[]` | `/ByteRange` offsets |
| `contents` | `Uint8Array` | The full decoded `/Contents` value, trailing zero padding included |
| `isDocTimestamp` | `boolean` | `true` for `/Type /DocTimeStamp` entries (ISO 32000-2 §12.8.5) |
| `isPlaceholder` | `boolean` | `true` for an unsigned placeholder (all-zero `/ByteRange`) |
| `sigObjNum` | `number` | Object number of the `/Sig` dictionary |

`listSignatures()` is a read-only inspection API — it never **verifies**
anything (see *Verifying* above for the verification story).

Related v1.7.0 addition: `SigDictMetadata` — the metadata subset shared by
`buildSigDict()` and the signing options — gains a `subFilter` field,
`'adbe.pkcs7.detached'` (default, unchanged legacy behaviour) or
`'ETSI.CAdES.detached'` to declare a PAdES (ETSI EN 319 142) signature.
`buildSigDict()` writes it into the `/Sig` dictionary, and `listSignatures()`
reports it back on each entry. When declaring `'ETSI.CAdES.detached'`, pair it
with the `profile: 'pades'` signing option so the CMS carries the matching
ESS `signing-certificate-v2` attribute.

## Algorithms

| Algorithm        | Hash      | Curve / Modulus     | Notes                          |
|------------------|-----------|---------------------|--------------------------------|
| `rsa-sha256`     | SHA-256   | 2048 / 3072 / 4096  | PKCS#1 v1.5 (default)          |
| `rsa-sha384`     | SHA-384   | 2048 / 3072 / 4096  | PKCS#1 v1.5 (v1.7.0)           |
| `rsa-sha512`     | SHA-512   | 2048 / 3072 / 4096  | PKCS#1 v1.5 (v1.7.0)           |
| `ecdsa-sha256`   | SHA-256   | P-256 (secp256r1)   | DER-encoded ECDSA signature    |

That is the complete `SignatureAlgorithm` union — the RSA variants widened
to SHA-384/512 in v1.7.0; ECDSA is offered with SHA-256 only.

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

# pdfnative-cli — full CMS verification (the library itself has no PDF-signature verifier)
npx pdfnative-cli verify --input signed.pdf --strict
# → { "signatures": [ { "integrity": true, "signatureValid": true, ... } ] }
```

## Reading the validator output

Two warnings commonly surface when testing the sample PDFs in Adobe Reader.
Both are **expected by spec** — they are not pdfnative bugs.

### "Validity unknown" / "Identité du signataire inconnue"

Adobe shows this whenever the signing certificate's issuer chain does
not terminate in a root CA listed in Adobe's Approved Trust List (AATL)
or in the user's locally configured Trusted Identities.

- The `scripts/generators/digital-signature.ts` sample uses a
  **self-signed demo CA** so it can ship deterministically. The
  cryptographic signature itself is valid (Adobe says so:
  *"Le document n'a pas été modifié depuis l'apposition de la signature"*);
  only the identity link to a public root is missing.
- To remove the warning in Adobe Reader: **Preferences → Signatures →
  Identités → Identités autorisées → Ajouter** and import the demo
  certificate as a trusted root.
- To verify the CMS independently of any trust store, use
  `openssl pkcs7 -in signed.pdf -inform DER -print_certs` and
  `openssl cms -verify -CAfile demo-ca.pem`.
- For production signatures, use a certificate issued by a CA in the
  Adobe Approved Trust List (Sectigo, DigiCert, GlobalSign…) or your
  organisation's enterprise CA distributed via group policy.

### "Signature non valable" on a placeholder PDF

A PDF that has only been through `addSignaturePlaceholder()` (i.e. not
yet `signPdfBytes()`) **will** read as invalid in Adobe — and that is
correct behaviour. The `/Sig` dictionary's `/Contents` slot is
zero-padded hex by design, reserved for the CMS SignedData that the
external signer will produce. Adobe sees a malformed CMS and reports
the signature as broken.

The `scripts/generators/signature-placeholder.ts` sample produces
exactly this shape on purpose, to demonstrate:

1. The placeholder layout is byte-stable (the `-idempotent` companion
   PDF proves it — re-running the function produces identical bytes).
2. Downstream tooling (HSMs, cloud KMS, smartcards) can fill in
   `/Contents` without touching the surrounding objects.

To turn a placeholder into a valid signature, call `signPdfBytes()` on
the placeholder bytes — that's the pipeline shown in the TL;DR above.

## Caveats

- **Encrypted PDFs.** `addSignaturePlaceholder()` throws on encrypted
  input — sign before encrypting, or decrypt first.
- **Timestamping (RFC 3161).** Supported since v1.7.0 —
  `signPdfBytesWithTimestamp()` embeds a verified TSA token as the
  `id-aa-signatureTimeStampToken` unsigned attribute, and
  `addDocumentTimestamp()` appends `/DocTimeStamp` revisions. See the
  [Long-term validation guide](ltv.html) for the full PAdES B-B → B-LTA
  pipeline (timestamps, `/DSS` + `/VRI`, injected providers).
- **Multiple signatures.** Supported since v1.7.0, but **not** by naively
  repeating the placeholder + sign pass — `addSignaturePlaceholder()` is
  idempotent and returns an already-signed PDF unchanged. Pass
  `allowMultiple: true` with a fresh `fieldName`, then select that field in
  `signPdfBytes` — see [Multiple signatures](#multiple-signatures-v170)
  above.
- **PDF/A + signatures.** PDF/A-2b/3b allow signatures; ISO 19005-2
  §6.3.5 forbids certain `/Sig` dictionary fields (`/Reference`,
  `/Changes`). pdfnative emits only the conformant subset.
- **Timing side-channels (pure-JS BigInt).** The RSA/ECDSA math runs on
  JavaScript `BigInt`, which is **not** constant-time — the RSA modular
  exponentiation in particular is a secret-dependent square-and-multiply
  loop. Signing a PDF once per user action is not meaningfully
  exploitable, but a high-frequency server signing thousands of PDFs/s
  with the same key under adversarial timing observation could
  theoretically leak key material. For such pipelines, install a native
  constant-time signer via `setCryptoProvider()` (see below) — or compute the
  CMS/PKCS#7 blob with a constant-time native backend (Node.js
  `crypto.sign()` or WebCrypto `crypto.subtle.sign()`) and inject it via
  `signPdfBytes()`. See [SECURITY.md](https://github.com/Nizoka/pdfnative/blob/main/SECURITY.md#cryptographic-implementation-scope--known-limitations)
  for the full analysis.

## Native crypto provider (v1.4.0)

For high-security, high-frequency server pipelines you can replace
pdfnative's pure-JS RSA/ECDSA math with a native, **constant-time** signer
without giving up the zero-dependency default. Install a provider globally
with `setCryptoProvider(provider)`, or pass one per call via
`PdfSignOptions.provider` (per-call wins over global). When a provider is set,
`rsaKey` / `ecKey` are no longer required.

```ts
import { setCryptoProvider, signPdfBytes } from 'pdfnative';
import { createSign, createPrivateKey } from 'node:crypto';

const key = createPrivateKey(pemPrivateKey);

setCryptoProvider({
    // `tbs` is the DER-encoded CMS signed attributes. The provider hashes it
    // with SHA-256 internally (node:crypto does this for you) and returns the
    // raw signature value (RSA PKCS#1 v1.5, or a DER-encoded ECDSA-P256 sig).
    sign(tbs, algorithm) {
        return new Uint8Array(createSign('sha256').update(tbs).sign(key));
    },
});

const signed = signPdfBytes(placeheld, {
    signerCert: cert,
    algorithm: 'rsa-sha256', // rsaKey/ecKey no longer needed
});

// Restore the pure-JS default at any time:
setCryptoProvider(null);
```

This is the in-library escape hatch for the BigInt timing caveat above — the
secret-dependent math runs in `node:crypto` / Web Crypto / an HSM while
pdfnative's CMS/PKCS#7 assembly is reused unchanged.

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
- [MCP integration →](mcp.html) — `pdfnative-mcp` exposes signing as an AI tool, and since v1.6.0 the complete PAdES ladder: `sign_pdf` (`profile: 'pades'`, RFC 3161 `timestamp`) → `add_ltv` (`/DSS` + `/VRI`, B-LT) → `timestamp_pdf` (`/DocTimeStamp`, B-LTA), verified with `verify_pdf ltv: true`.
