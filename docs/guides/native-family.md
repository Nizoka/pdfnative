# The native family: pdfnative, zipnative and pkinative

> **Three zero-dependency engines, one doctrine.** pdfnative writes and reads
> the document, [zipnative](https://zipnative.dev) packs it into a
> deterministic archive, [pkinative](https://pkinative.dev) holds the keys and
> the trust that make a signature mean something. Each is a strict,
> pure-TypeScript implementation of its ISO or IETF standard with an empty
> runtime dependency tree, and the three compose through public APIs only:
> sign with pdfnative, prove it with pkinative, archive it with zipnative.

pdfnative is the oldest of the three. zipnative applied the same rules — no
runtime dependency, no native code, bytes that are identical for identical
inputs, every refusal a named error — to the ZIP format, and pkinative began
as pdfnative's own PAdES signature stack before it grew into a standalone
X.509, CMS and RFC 3161 library. The family shares an author, a licence
(MIT), a release discipline (a reference validator at the gate, provenance on
every package) and a vocabulary: an *engine* is the library, its *satellites*
are a command-line tool and a Model Context Protocol server built on it.

![Architecture: three columns, one per engine. In the middle, pdfnative builds the document as PDF/A-2b with a pinned creationDate, signs it to PAdES B-T through a signature placeholder, the caller's synchronous crypto provider and an injected RFC 3161 timestamp provider, and writes the CMS into /Contents. On the left, pkinative holds the trust: trust anchors decoded from PEM with CRL and OCSP material, certificate-chain validation at the time the timestamp token proves, and the verifier that checks the CMS signature over the digest of the PDF's /ByteRange. On the right, zipnative packs the signed PDF with its evidence into a deterministic ZIP whose SHA-256 is the same for the same inputs, and reads it back lazily years later. Arrows: the signed PDF is proven by pkinative (its /ByteRange digest and CMS go to verifySignedData), the signed PDF is packed into the archive, and a dashed path from the archive back to the verifier shows the later verification: open the ZIP, read the signatures back with pdfnative, verify the signed data with pkinative.](../assets/use-case-native-family.svg)

## What each engine owns

| Engine | Standard | It does | It deliberately does not |
|---|---|---|---|
| **pdfnative** | ISO 32000-1, ISO 19005 (PDF/A), ISO 15930-7 (PDF/X-4), ETSI PAdES | Writes PDFs from blocks, shapes 32 scripts, embeds fonts, signs to PAdES B-LTA, reads text, forms and signatures back | Verify a signature end to end, rasterise, decode JPEG 2000 |
| **zipnative** | PKWARE APPNOTE, RFC 1951 DEFLATE, Zip64 | Reads archives lazily, writes them deterministically, modifies them incrementally, streams with bounded memory | Encrypt or decrypt entries (it detects and labels encryption) |
| **pkinative** | RFC 5280 X.509, RFC 5652 CMS, RFC 3161 timestamps, PKCS#8 / PKCS#12 | Parses and verifies certificates, builds and validates chains with CRL and OCSP, creates and verifies CMS signatures and timestamp tokens, opens key stores into non-extractable Web Crypto keys | Generate keys, store anything, make a network request |

The column on the right is the point of the family: each engine stops where
another standard begins, so none of them re-implements a neighbour badly. The
cases below are the three seams where they meet.

## Case 1 — Sign with pdfnative, prove it with pkinative

pdfnative signs a PDF to PAdES B-B or B-T: `addSignaturePlaceholder()`
reserves the `/Contents` slot, `signPdfBytes()` hashes the `/ByteRange`,
builds the CMS SignedData and writes it in. What the engine does **not** ship
is a verifier — the [signatures guide](signatures.html#3-verifying) says so and
points at the CLI. pkinative is that verifier: a CMS implementation whose
`verifySignedData` call takes the digest you computed over the document's
byte ranges, so the PDF is never handed over, and judges the signer's chain
against your trust anchors, with CRL and OCSP material and, for a B-T
signature, at the time the timestamp token proves.

```ts
import { createPrivateKey, sign as nodeSign } from 'node:crypto';
import { addSignaturePlaceholder, signPdfBytes, parseCertificate, listSignatures, buildDocumentPDFBytes } from 'pdfnative';
import { verifySignedData, decodePem } from 'pkinative';

// 1. pdfnative: build, reserve the slot, sign. The private key never leaves
//    node:crypto — the provider receives the DER-encoded signedAttrs and
//    returns the signature; pdfnative's own RSA/ECDSA code is bypassed.
const key = createPrivateKey(pemPrivateKey);
const unsigned = buildDocumentPDFBytes(
  { title: 'Service agreement', blocks: [{ type: 'paragraph', text: 'Signed, then proven.' }] },
  { creationDate: new Date('2026-10-28T00:00:00Z') },
);
const signed = signPdfBytes(addSignaturePlaceholder(unsigned, { fieldName: 'Author' }), {
  signerCert: parseCertificate(signerDer),
  certChain: [issuerDer].map(parseCertificate),
  algorithm: 'rsa-sha256',
  profile: 'pades',
  provider: { sign: (tbs) => new Uint8Array(nodeSign('sha256', tbs, key)) },
});

// 2. The verifier's input: the signature bytes and the digest of what they cover.
const [sig] = listSignatures(signed);                        // byteRange + the /Contents bytes
const [a, aLen, b, bLen] = sig.byteRange;
const covered = new Uint8Array(aLen + bLen);
covered.set(signed.subarray(a, a + aLen), 0);
covered.set(signed.subarray(b, b + bLen), aLen);
const contentDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', covered));
const cms = sig.contents.subarray(0, derLength(sig.contents));  // drop the placeholder's zero padding

// 3. pkinative: verify the CMS over that digest and the chain against your roots.
const report = await verifySignedData({
  signedData: cms,
  contentDigest,                                               // detached, PDF-style: the document stays with you
  trustAnchors: decodePem(rootsPem),
  atTimeStamp: true,                                           // a B-T signature is judged at its token's time
});
if (!report.valid) for (const r of report.reasons) console.error(r.code, r.path, r.message);

/** Length of one DER element from its header (the CMS is the first and only element in /Contents). */
function derLength(der: Uint8Array): number {
  const first = der[1]!;
  if (first < 0x80) return 2 + first;
  const n = first & 0x7f;
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | der[2 + i]!;
  return 2 + n + len;
}
```

**What you gain**

- **A real verification verdict, in the same runtime as the signer.** The
  CLI's `pdfnative verify` and the MCP `verify_pdf` tool cover the shell and
  the assistant; pkinative covers the library and the browser, with every
  failure a coded reason rather than a boolean.
- **The document never crosses into the verifier.** `contentDigest` is the
  PDF-style path pkinative documents for exactly this: you hash the two byte
  ranges, pkinative checks the signature over the hash.
- **One trust policy for every artefact.** The roots, the revocation material
  and the `atTimeStamp` rule you pass here are the same objects pkinative uses
  to validate a TLS chain or a CMS message elsewhere in your system.

**Honest limits**

- pdfnative's `CryptoProvider` is synchronous (`sign(tbs, algorithm)` returns
  bytes), which `node:crypto`, an HSM binding or a smart-card library
  satisfy and the Web Crypto API does not. A non-extractable key that
  pkinative opened with `openPkcs12` therefore cannot drive `signPdfBytes()`
  directly; in a browser, keep pdfnative's pure-TypeScript RSA or ECDSA with a
  key you hold, or sign on a server.
- pkinative's `createSignedData` with `contentDigest` and an `ExternalSigner`
  can produce a PAdES-shaped CMS over pdfnative's `/ByteRange` digest with a
  key that never exists in JavaScript — but pdfnative does not yet export the
  writer that places an externally produced CMS into the placeholder. It is
  on the roadmap; until then, that composition goes through the CLI's
  external-signer flow.
- `allowTrailingData` on pkinative's parser accepts the placeholder's zero
  padding directly; the `derLength` helper above does the same trimming on
  pdfnative's side so the snippet runs against the documented options only.

## Case 2 — Archive deterministically with zipnative

A signed PDF is rarely the only artefact: the invoice travels with its JSON
source, the contract with its evidence, the batch with its manifest. ZIP is
the container everyone opens, and zipnative is a ZIP writer whose output is a
pure function of its input — `compression: { deterministic: true }` pins the
pure-TypeScript encoder and every date and attribute field, so the archive
built on a Linux runner today and on a Windows laptop in five years has the
same SHA-256. The document has had the same property since 1.8.0 through a
pinned `creationDate`, so the whole dossier is reproducible, not just the PDF.

```ts
import { buildDocumentPDFBytes, extractText } from 'pdfnative';
import { createZip, openZip } from 'zipnative';

const creationDate = new Date('2026-10-28T00:00:00Z');       // the only time the PDF would otherwise read from the clock
const pdf = buildDocumentPDFBytes(
  { title: 'Invoice 2026-0412', blocks: [{ type: 'paragraph', text: 'Total due: 1,250.00 EUR' }] },
  { creationDate, tagged: 'pdfa2b', fontEntries },
);

const zip = createZip({ compression: { deterministic: true } });
zip.add('invoice-2026-0412.pdf', pdf);
zip.add('invoice-2026-0412.json', JSON.stringify(source));
zip.add('manifest.json', JSON.stringify({ pdf: 'invoice-2026-0412.pdf', source: 'invoice-2026-0412.json' }));
const archive = zip.toBytes();                               // identical bytes for identical inputs, on every runtime

// Years later, on whatever runtime is current: read lazily, trust the CRC, re-read the text.
const stored = openZip(archive);
const again = stored.readEntry('invoice-2026-0412.pdf');
console.log(extractText(again)[0]?.text);                    // "Total due: 1,250.00 EUR"
```

**What you gain**

- **A digest you can commit.** The archive's SHA-256 is stable, so a CI job
  can regenerate the dossier and fail on any difference — the
  [CI document-regression gate](use-cases.html#case-3--a-document-regression-gate-in-ci)
  extended from one PDF to the whole package.
- **Bounded memory on both ends.** zipnative streams the archive in chunks
  and reads one entry at a time; pdfnative streams page trees the same way
  ([streaming guide](streaming.html)).
- **The compressor is the same code.** With zipnative's DEFLATE encoder also
  installed as pdfnative's codec through `setDeflateRawImpl()`
  ([use cases, Case 5](use-cases.html#case-5--swap-the-compressor-zipnative-as-pdfnatives-deflate-codec)),
  the PDF's streams and the ZIP's entries are compressed by one implementation
  and one determinism contract.

**Honest limits**

- zipnative does not encrypt. Confidentiality is pdfnative's job — encrypt the
  PDF (AES-256, `layout.encryption`) before it goes into the archive; zipnative
  documents that order as its own
  [encrypt-first case](https://zipnative.dev/guides/use-cases.html#case-5--encrypt-first-then-archive).
- Reproducibility is per compressor. A dossier built with the deterministic
  pure encoder and one built with the runtime's native zlib are both valid and
  differ in bytes; choose one per pipeline and rebaseline once.

## Case 3 — The whole chain: build, sign, pack, verify

Put the two seams together and the pipeline a regulated archive needs is four
calls, each in the engine that owns its standard — and each with a terminal
and an assistant surface for the people who will not write TypeScript.

```ts
// build — pdfnative
const pdf = buildDocumentPDFBytes(params, { creationDate, tagged: 'pdfa2b', fontEntries });
// sign to B-T — pdfnative, the token fetched through an injected transport
const signed = await signPdfBytesWithTimestamp(addSignaturePlaceholder(pdf), { ...signer, timestampProvider });
// pack — zipnative
const zip = createZip({ compression: { deterministic: true } });
zip.add('contract.pdf', signed);
zip.add('evidence/roots.pem', rootsPem);
const dossier = zip.toBytes();
// verify, any time later — pkinative, over what pdfnative reads back
const [sig] = listSignatures(openZip(dossier).readEntry('contract.pdf'));
const verdict = await verifySignedData({ signedData: trim(sig.contents), contentDigest, trustAnchors, atTimeStamp: true });
```

| Step | Library call | Terminal | Assistant (MCP) |
|---|---|---|---|
| Build | pdfnative `buildDocumentPDFBytes()` | `pdfnative render` | pdfnative-mcp `generate_basic_pdf` |
| Sign, timestamp, LTV | pdfnative `signPdfBytesWithTimestamp()`, `composeLtvData()` | `pdfnative sign --timestamp`, `pdfnative ltv` | pdfnative-mcp `sign_pdf`, `add_ltv` |
| Pack | zipnative `createZip` | zipnative-cli | zipnative-mcp |
| Verify the chain and the CMS | pkinative `verifyCertificateChain`, `verifySignedData` | pkinative-cli | pkinative-mcp |
| Read back | pdfnative `listSignatures()`, `extractText()` | `pdfnative inspect`, `pdfnative verify` | pdfnative-mcp `inspect_pdf`, `verify_pdf` |

**What you gain**

- **Three lockfiles with nothing in them.** `npm ls --omit=dev` on any of the
  three engines prints the package alone; the toolchain SBOM each release
  attests says the same. Supply-chain review of the whole pipeline is a review
  of three repositories.
- **One failure vocabulary.** Every refusal is a coded error — pdfnative's
  build errors and diagnostics, zipnative's and pkinative's reason codes — so
  the pipeline's error handling is a switch, not a regex over messages.
- **Runtime independence.** Node, Deno, Bun, browsers and Workers run all
  three; the pipeline that signs on a server can verify in a browser.

**Honest limits**

- Three packages are three release trains. Each pins the others nowhere — the
  seams are plain `Uint8Array` values — so an upgrade of one never forces
  another, but it also never carries another along.
- The terminal and assistant columns are separate installs
  (`pdfnative-cli`, `zipnative-cli`, `pkinative-cli` and their MCP servers);
  there is no umbrella binary, by design.

## Picking parts, not a platform

Nothing here locks you in. A PDF signed by pdfnative verifies in Adobe
Acrobat and in any CMS library, not only in pkinative; a zipnative archive
opens in every unzip tool ever written; pkinative validates certificates that
have nothing to do with PDFs. Use the engine whose standard you need, and
borrow its neighbours when the pipeline reaches their standard.

## See also

- [Ecosystem use cases](use-cases.html) — the five pdfnative architectures,
  Case 5 of which plugs zipnative in as the DEFLATE codec.
- [Digital signatures](signatures.html) and [Long-term validation](ltv.html) —
  the PAdES ladder in engine terms, and `composeLtvData()` for offline
  evidence.
- [Reproducible output](../playgrounds/reproducible.html) — the pinned
  `creationDate` behind Case 2, in the browser.
- [zipnative](https://zipnative.dev) · [zipnative use cases](https://zipnative.dev/guides/use-cases.html) —
  the archive engine and its own architectures.
- [pkinative](https://pkinative.dev) · [pkinative use cases](https://pkinative.dev/guides/use-cases.html) —
  the X.509 and CMS engine, including the PKCS#12 and timestamp cases this
  guide builds on.
