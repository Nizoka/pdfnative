# Long-term validation (LTV) — PAdES B-B to B-LTA

> **New in v1.7.0.** pdfnative signs PDFs that stay verifiable for decades: PAdES baseline signatures (ETSI EN 319 142-1), RFC 3161 signature timestamps, embedded revocation material (`/DSS` + `/VRI`), and document timestamps — all with **zero runtime dependencies** and **zero network access in the engine**. Transport is injected by your code.

## TL;DR

```ts
import {
  buildDocumentPDFBytes, addSignaturePlaceholder, estimateContentsSize,
  signPdfBytesWithTimestamp, addValidationInfo, addDocumentTimestamp,
  setTimestampProvider, setRevocationProvider,
} from 'pdfnative';

// 1. Your transports (the engine never fetches on its own).
setTimestampProvider({
  async getTimestamp(request) {           // DER TimeStampReq in…
    const res = await fetch('https://freetsa.org/tsr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: request.slice(),
    });
    return new Uint8Array(await res.arrayBuffer());  // …DER TimeStampResp out
  },
});
setRevocationProvider({
  async fetchOcsp(url, request) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request' },
      body: request.slice(),
    });
    return new Uint8Array(await res.arrayBuffer());
  },
  async fetchCrl(url) {
    const res = await fetch(url);
    return new Uint8Array(await res.arrayBuffer());
  },
});

// 2. Build → placeholder → sign+timestamp → embed validation → archive.
const unsigned = addSignaturePlaceholder(buildDocumentPDFBytes(params), {
  metadata: { subFilter: 'ETSI.CAdES.detached', reason: 'Contract v2' },
  placeholderBytes: estimateContentsSize([certDer.length], 'rsa-sha256', { timestamp: true }),
});
const signed  = await signPdfBytesWithTimestamp(unsigned, {
  signerCert, certChain: [intermediateCert], rsaKey,
  profile: 'pades',                       // ESS signing-certificate-v2, no CMS signing-time
});
const ltv     = await addValidationInfo(signed);       // /DSS + /VRI (B-LT)
const archive = await addDocumentTimestamp(ltv);       // DocTimeStamp (B-LTA)
```

Every step appends a non-destructive incremental revision — earlier bytes are never modified, so prior signatures stay intact.

## Why LTV

A plain signature proves *who* signed, but its verifiability decays: certificates expire, CAs go offline, revocation servers disappear. The PAdES baseline levels fix each failure mode in turn:

| Level | Adds | Protects against |
|---|---|---|
| **B-B** | CAdES signature with the ESS `signing-certificate-v2` attribute | Certificate substitution |
| **B-T** | RFC 3161 signature timestamp (`id-aa-signatureTimeStampToken`) | "Was the signature made while the certificate was valid?" |
| **B-LT** | `/DSS`: embedded certificates + OCSP/CRL responses, per-signature `/VRI` | Revocation servers disappearing |
| **B-LTA** | `/DocTimeStamp` covering the whole document | Algorithm/key aging — re-timestamp before the TSA certificate expires to extend the chain |

Adobe Reader shows a B-LT/B-LTA document as **"LTV enabled"** (with the chain's root trusted).

## The provider architecture

pdfnative **never opens a socket**. Two small interfaces move bytes; you own transport, proxies, retries and trust decisions:

```ts
interface TimestampProvider {
  getTimestamp(request: Uint8Array): Promise<Uint8Array>;   // TimeStampReq → TimeStampResp
}
interface RevocationProvider {
  fetchOcsp?(url: string, request: Uint8Array): Promise<Uint8Array>; // OCSPRequest → OCSPResponse
  fetchCrl?(url: string): Promise<Uint8Array>;                      // → CertificateList
}
```

Install globally (`setTimestampProvider` / `setRevocationProvider`) or pass per call (`timestampProvider:` / `revocationProvider:` options — per-call wins). pdfnative builds and parses every RFC 3161 / RFC 6960 / RFC 5280 structure itself, verifies the token's message imprint and nonce echo, and **refuses to embed** a rejected or tampered response.

## Step by step

### B-B — a PAdES baseline signature

```ts
const signed = signPdfBytes(placeheld, {
  signerCert, certChain, rsaKey,
  profile: 'pades',          // adds ESS signing-certificate-v2 (RFC 5035)
});
```

Pair `profile: 'pades'` with the placeholder's `metadata: { subFilter: 'ETSI.CAdES.detached' }` so the `/Sig` dictionary declares the PAdES SubFilter. The legacy default (`adbe.pkcs7.detached`, `profile: 'pkcs7'`) is unchanged. `digestAlgorithm: 'sha384' | 'sha512'` upgrades the whole CMS digest chain.

### B-T — the signature timestamp

`signPdfBytesWithTimestamp` (async) signs, hashes the CMS signature value, asks your `TimestampProvider` for a token, verifies it, and attaches it as an unsigned attribute — the signed bytes are untouched, so the signature stays valid. Reserve room for the token when creating the placeholder:

```ts
placeholderBytes: estimateContentsSize(certSizes, 'rsa-sha256', { timestamp: true })  // +8 KiB
```

### B-LT — the Document Security Store

```ts
const data = await collectValidationInfo(signed);   // async: chains + OCSP/CRL via provider
const ltv  = embedValidationInfo(signed, data);     // sync, offline, deterministic
// …or in one call: await addValidationInfo(signed)
```

`collectValidationInfo` walks every signed signature (and the TSA certificates inside embedded timestamp tokens), deduplicates the certificate pool, and requests OCSP (preferred) or CRL data for every certificate that advertises a source via its AIA / CRL-distribution-point extensions — skipping self-signed roots and `id-pkix-ocsp-nocheck` responders. Missing intermediates can be supplied with `extraCertificates`.

`embedValidationInfo` writes the `/DSS` dictionary — `/Certs`, `/OCSPs`, `/CRLs` stream arrays plus a `/VRI` entry per signature keyed by the uppercase-hex SHA-1 of its full `/Contents` value (the Adobe convention; `vriKeyForContents` exposes the computation). An existing `/DSS` is merged, never replaced. The split matters: collect once online, embed deterministically offline (or in tests).

### B-LTA — the document timestamp

```ts
const archive = await addDocumentTimestamp(ltv);
```

Appends a signature field whose dictionary is `/Type /DocTimeStamp /SubFilter /ETSI.RFC3161` with a **bare** TimeStampToken as `/Contents` (ISO 32000-2 §12.8.5 — no `/M`: the token's genTime is the time assertion). Field names auto-suffix (`DocTimeStamp1`, `DocTimeStamp2`, …) so periodic re-timestamping chains naturally.

## Multiple signatures

```ts
const a = signPdfBytes(addSignaturePlaceholder(pdf, { fieldName: 'Author' }), opts);
const b = signPdfBytes(
  addSignaturePlaceholder(a, { fieldName: 'Reviewer', allowMultiple: true }),
  { ...opts, fieldName: 'Reviewer' },
);
```

`allowMultiple: true` opts out of the historical one-signature short-circuit; the `fieldName` selector on `signPdfBytes` targets the right placeholder. Signed signatures are located by their real ByteRange values and can never be overwritten. Inspect any document with `listSignatures(bytes)`.

## Testing without a real TSA or CA

The repository ships a deterministic offline mock PKI (`scripts/helpers/mock-pki.ts`): a root CA, a signer with AIA/CRL-DP extensions, a TSA with the critical `id-kp-timeStamping` EKU and an OCSP responder with `ocsp-nocheck` — plus providers that produce **real, signed** TimeStampTokens, BasicOCSPResponses and CRLs. The `signature/signature-pades-*.pdf` samples and the `ltv-pipeline` integration suite run the full B-LTA chain with zero network. Public TSAs for manual testing include `https://freetsa.org/tsr`.

## Verification checklist

- `listSignatures(bytes)` — every entry, its SubFilter, ByteRange, placeholder/timestamp status.
- Adobe Reader: *Signature Panel → Certificate Details* — trust the mock/company root, then look for **"LTV enabled"** on B-LT documents and a valid document timestamp on B-LTA.
- `openssl ts -reply -in token.der -text` inspects extracted timestamp tokens.
- pdfnative itself ships **no signature verifier** — validation belongs to dedicated tooling (veraPDF for PDF/A, Adobe/DSS for signatures, `pdfnative-cli verify` for structural checks).

## Limits & scope (v1.7.0)

- ECDSA stays P-256 with SHA-256; RSA supports SHA-256/384/512.
- Chain building uses exact issuer-name matching over the embedded pool; cross-certification and bridge PKIs are out of scope.
- `collectValidationInfo` fetches from the **first** advertised OCSP/CRL URL; provider-side failover is your transport's business.
- Encrypted documents cannot take signature placeholders (unchanged from v1.2).
- PDF 2.0 `/Extensions` declarations are not emitted; the ISO 32000-2 constructs used here are accepted by all mainstream validators.
