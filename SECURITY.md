# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/pdfnative/security/advisories/new).

Alternatively, contact us at: **security@pdfnative.dev**

We will acknowledge receipt within 48 hours and target a fix within 7 days for Critical severity and within 14 days for High severity.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.9.x   | ✅        |
| 1.8.x   | ✅ (security fixes) |
| < 1.8   | ❌        |

### Supported runtimes

| | 1.x | What a minor may change |
|---|---|---|
| Node.js | Every line in Active or Maintenance LTS: Node.js 22 and 24, both run by the `ci` workflow on Linux, and 22 on Windows and macOS as required checks (v1.9.0). The newest LTS line (Node.js 26, in LTS since 2026-10-28) is run by the advisory `node-current` workflow until the first minor after that date, when it joins `ci.yml`, and promised by nothing until then; it joins the matrix at the first minor after its LTS date | Drop a line after its end of life (Node 22: 2027-04-30), announced one minor ahead |
| TypeScript (consumers) | TypeScript 5.0 and later, under `moduleResolution` `node16`/`nodenext`, `bundler` and `node10` | Raise the floor, never to a release younger than two years |
| ECMAScript | ES2020 syntax and library plus `TextEncoder`/`TextDecoder`; no Web Crypto and no Node built-in is required — every digest, cipher and signature primitive is pure TypeScript, and `node:zlib` (`initNodeCompression`) or `node:fs` (`streamToFile`) are reached only through an explicit, opt-in call | Nothing: raising it is major |
| Deno, Bun, browsers, Web Workers | Smoke-tested: the `runtimes` CI job runs the built package on Deno, Bun and headless Chromium (a document written and read back, Arabic shaped and extracted through ToUnicode, AES-256 round trip, a merge, a QR matrix); the full suite runs on Node.js only, and no version floor is promised | — |

`engines.node` is `>=22`. npm warns, and refuses only under `engine-strict`, when a runtime is outside the range.

## Compatibility promise

From 1.9.0, pdfnative proves three things mechanically for the whole 1.x line, on every pull request, so that "no breaking change" is a check and not a sentence:

| Leg | What is promised | Held by |
|---|---|---|
| The export surface | Every export of `pdfnative`, `pdfnative/worker` and `pdfnative/tools` keeps its name, its kind and a compatible signature (a widening — an optional parameter or member added — is a minor and is listed in the release note's compatibility ledger) | `tests/compat/api-<previous>.json` (the previous release's `docs/assets/api.json`, as tagged) against the current one, in `tests/tools/api-compat.test.ts` |
| The error vocabulary | Every diagnostic code of `onDiagnostic` keeps its name and severity; every build-error message keeps its text, or the release note's ledger records the replacement | `tests/compat/errors-<previous>.json` against `docs/data/errors.json`, in the same test |
| The behaviour | The previous release's own test suite, exactly as tagged, passes against the current sources; the files it may skip are listed in `tests/compat/allow-<previous>.json`, each with a reason and, for a behaviour change, the ledger entry that justifies it | `npm run compat:previous` (`scripts/run-compat.ts`), the required `compat-previous` check and the publish gate |

What a 1.x minor may change, and how it is declared:

| Change | Semver | Declared in |
|---|---|---|
| An export removed, renamed or given an incompatible signature; a diagnostic code removed or renamed; a diagnostic that was a warning now throwing | major | — |
| An option's default value changed | major | — |
| Emitted bytes that differ from the previous release's for the same input, because the previous bytes were wrong (a mispositioned mark, a missing ToUnicode entry, a punctuation mark on the wrong side of an RTL run) | minor | The release note's Upgrade section, one ledger entry (C1, C2, …) per cause, naming why the old bytes were wrong and which samples of `tests/regression/baselines/samples.sha256.json` were re-anchored |
| A new export, optional parameter or member, option, diagnostic code, build error, font module or script | minor | The release note's Added section and Downstream integration notes |
| A capability added where the engine refused or warned before (a joint PDF/A + PDF/X claim, an image format) | minor | The release note; a replaced error message is in the ledger |

The byte row is the one that distinguishes a PDF writer from a library with a stable API: pdfnative's output is a pure function of its inputs (`setDefaultCreationDate`, UTC dates), every sample is pinned by SHA-256 across releases, and a byte that moves without a ledger entry fails the `sample-regression` check.

## Security Model

pdfnative is a pure TypeScript library with **zero runtime dependencies**. This significantly reduces supply-chain risk.

### Encryption

- AES-128 (V4/R4/AESV2) and AES-256 (V5/R6/AESV3) — pure TypeScript implementations
- Since v1.6.0 the parser also **reads/decrypts** RC4 V1–V4, AES-128, and AES-256 documents (`openPdf(bytes, { password })`); on the **write** side only AES-128/AES-256 are emitted — RC4 is never produced
- Per-object encryption keys with random initialization vectors (AES-CBC)
- No ECB mode — all encryption uses CBC with PKCS7 padding
- Key derivation follows ISO 32000-1 (PDF 1.7) specification
- **Cryptographically secure randomness is required.** All random material
  (document `/ID`, AES IVs, key salts) is sourced exclusively from the platform
  CSPRNG via `globalThis.crypto.getRandomValues` (Web Crypto — available in
  Node.js ≥ 18, browsers, Deno, Bun, and Web Workers). pdfnative **never** falls
  back to `Math.random()` for cryptographic material: if no secure source is
  available the encryption path **throws** rather than producing predictable
  output (since 1.3.0).

### Digital Signatures

- CMS/PKCS#7 detached signatures (ISO 32000-1 §12.8)
- RSA PKCS#1 v1.5 (SHA-256, and SHA-384/512 since v1.7.0) and ECDSA P-256 (SHA-256) — pure TypeScript, zero external dependencies
- X.509 DER certificate parsing for certificate chain embedding
- `/ByteRange` ensures only the signature `/Contents` is excluded from the signed digest

### Cryptographic Implementation Scope & Known Limitations

pdfnative ships pure-TypeScript implementations of RSA (PKCS#1 v1.5) and ECDSA (P-256) to uphold the zero-dependency contract and to support restricted runtimes (browsers, Deno, Bun, Web Workers) where native crypto may be unavailable.

**RSA signature verification** (`rsaVerify`) is designed to resist Bleichenbacher-style signature forgery attacks: rather than parsing the PKCS#1 v1.5 padding leniently, it reconstructs the full expected `EM` encoding and compares byte-by-byte using a constant-time XOR accumulator (`diff |= em[i] ^ expected[i]`). This eliminates the class of "lax parser" forgery attacks.

**ECDSA P-256** uses RFC 6979 deterministic `k` generation (HMAC-DRBG over the private key and message hash), which eliminates nonce-reuse vulnerabilities inherent in CSPRNG-based `k` selection.

**Timing-attack caveat**: JavaScript's `BigInt` arithmetic (used throughout `src/crypto/`) does not execute in constant time in V8 or SpiderMonkey. In particular the modular exponentiation (`modPow`) underpinning RSA is a square-and-multiply loop whose execution path depends on the secret exponent's bits, and is therefore **not** constant-time. (The RSA *verification* equality check is the one place that is deliberately constant-time — see above.) This is a fundamental limitation of pure-JS big-integer arithmetic. The practical impact is:

- **Low risk in typical usage**: signing a PDF once per user action on a server is not meaningfully exploitable.
- **Higher risk in high-frequency server-side pipelines**: a backend signing thousands of PDFs per second with the same private key under adversarial timing observation could theoretically leak key material over many measurements.

**Recommendation for high-security, high-frequency server pipelines**: perform signing externally using Node.js native `crypto.sign()` / `crypto.verify()` or WebCrypto `crypto.subtle.sign()` / `crypto.subtle.verify()`, both of which provide hardware-backed constant-time operations. You can then inject the pre-computed CMS/PKCS#7 blob into the PDF via `signPdfBytes()`. This avoids the pure-JS BigInt arithmetic path entirely.

**Built-in escape hatch (since v1.4.0)**: rather than signing externally and re-injecting, you can install a native, constant-time signer directly via `setCryptoProvider(provider)` (global) or per call via `PdfSignOptions.provider`. The provider receives the DER-encoded CMS signed attributes and returns the raw signature value, so pdfnative's CMS assembly is reused while the secret-dependent RSA/ECDSA math runs in `node:crypto` / Web Crypto / an HSM. When a provider is set, `rsaKey` / `ecKey` are not required and the pure-JS BigInt path is never executed.

```ts
import { setCryptoProvider } from 'pdfnative';
import { createSign, createPrivateKey } from 'node:crypto';

const key = createPrivateKey(pemPrivateKey);
setCryptoProvider({
  sign(tbs /* DER signed attributes */, algorithm) {
    // node:crypto hashes `tbs` with SHA-256 internally and returns the sig.
    return new Uint8Array(createSign('sha256').update(tbs).sign(key));
  },
});
```

### Input Validation

- `buildPDF()` and `buildDocumentPDF()` validate all inputs at the API boundary
- URL validation (`validateURL()`) blocks `javascript:`, `file:`, and `data:` URI schemes
- PDF string escaping prevents injection via `\`, `(`, `)` characters
- CIDFont hex encoding eliminates string injection vectors
- TTF subsetting uses typed arrays with bounds checking
- Row/block count limits prevent resource exhaustion (100K max)

### PDF Parser Safety

- PDF tokenizer validates all token types before parsing
- Cross-reference parser follows `/Prev` chains with loop detection
- Stream decompression uses bounded buffers to prevent zip-bomb attacks
- Object parser uses type guards for safe type narrowing (no `any` casts)

### Code Safety

- No `eval()`, `Function()`, or dynamic code execution
- No external crypto dependencies
- Tree-shakeable (`sideEffects: false`) — no module-level side effects
- NPM provenance — every release is published by `.github/workflows/publish.yml` in four jobs (v1.9.0): a `guard` that refuses anything but a `v*` tag matching `package.json` before any approval is asked; a `build` that runs the publish gate and packs the tarball once, recording its SHA-256 and SHA-512, without the right to mint a token; a `publish` behind the protected `npm-publish` environment that installs nothing, verifies the handed-on tarball against those digests and uploads exactly it with npm Trusted Publishing (OIDC, no long-lived token) through an npm client pinned by the SHA-512 of its registry tarball, `npm publish --provenance`; and an `attest` that fetches the published tarball back from the registry, checks it against the same digests and `npm audit signatures`, and attests the bytes npm serves together with the CycloneDX and SPDX SBOMs and a toolchain SBOM, attaching them and the Sigstore bundle to the GitHub release. The provenance is **SLSA Build L2** (hosted platform, signed provenance): L3 would need the build in a reusable workflow isolated from the signing step, which this pipeline does not do
- Release gate — the build job installs a checksummed veraPDF (`.github/checksums/`), downloads the source fonts pinned by commit and SHA-256 (`fonts/SOURCES.json`), fetches the previous release tag, and runs `scripts/gate.ts --publish --require-all`, so no check — veraPDF, font reproducibility, the previous release's suite — can be skipped on the runner
- Hardened workflows — every action pinned to a commit SHA and resolved to one SHA across the tree, `persist-credentials: false` on every checkout, `step-security/harden-runner` on every job (block mode with an allow-list where the endpoints are known, audit with a dated reason elsewhere), `npm ci --ignore-scripts` (also `ignore-scripts=true` in `.npmrc`), write permissions at job level only, Dependency Review, a weekly `npm audit`, Dependabot with a seven-day cooldown, the workflows themselves linted by zizmor and actionlint on every pull request, CodeQL (`security-extended`, the `actions` language included) on every push, and the parser surface fuzzed by ClusterFuzzLite (`fuzz/`, Jazzer.js pinned by lockfile inside the build image, never in the package) — all of it held by `tests/tools/workflows.test.ts`
- OpenSSF Scorecard — scanned weekly on `main` (`scorecard.yml`, results in the Security tab and the public dataset). Two findings are deliberate and stay: the `attest` job holds `contents: write` at the job level (the pipeline's only write grant, needed to attach the files to the release — Scorecard deducts one point for any `contents: write`), and that job installs `pdfnative@<exact version>` with `--ignore-scripts` into a throwaway project after checking the tarball against the build digests, because `npm audit signatures` verifies an installed tree (Scorecard reads every `npm install` as unpinned). Code review by a second maintainer is not available in a single-maintainer project; the required checks, CodeQL, the previous release's suite replayed on every pull request, the fuzzers and the `npm-publish` environment approval stand in for it. The OpenSSF Best Practices badge is in progress.
- Parser robustness — the seven fuzz targets rethrow any engine error (`TypeError`, `RangeError`, …) and swallow only the refusals the library writes, and `tests/fuzzing/targets.test.ts` runs them on a seeded, truncated and mutated corpus at every gate run

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Report vulnerabilities privately (see above)
2. Allow reasonable time for a fix before public disclosure
3. Do not exploit the vulnerability beyond what is necessary to demonstrate it
