# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/pdfnative/security/advisories/new).

Alternatively, contact us at: **security@pdfnative.dev**

We will acknowledge receipt within 48 hours and aim to provide a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |
| < 1.0   | ❌        |

## Security Model

pdfnative is a pure TypeScript library with **zero runtime dependencies**. This significantly reduces supply-chain risk.

### Encryption

- AES-128 (V4/R4/AESV2) and AES-256 (V5/R6/AESV3) — pure TypeScript implementations
- Per-object encryption keys with random initialization vectors (AES-CBC)
- No ECB mode — all encryption uses CBC with PKCS7 padding
- Key derivation follows ISO 32000-1 (PDF 1.7) specification

### Digital Signatures

- CMS/PKCS#7 detached signatures (ISO 32000-1 §12.8)
- RSA PKCS#1 v1.5 (SHA-256) and ECDSA P-256 — pure TypeScript, zero external dependencies
- X.509 DER certificate parsing for certificate chain embedding
- `/ByteRange` ensures only the signature `/Contents` is excluded from the signed digest

### Cryptographic Implementation Scope & Known Limitations

pdfnative ships pure-TypeScript implementations of RSA (PKCS#1 v1.5) and ECDSA (P-256) to uphold the zero-dependency contract and to support restricted runtimes (browsers, Deno, Bun, Web Workers) where native crypto may be unavailable.

**RSA signature verification** (`rsaVerify`) is designed to resist Bleichenbacher-style signature forgery attacks: rather than parsing the PKCS#1 v1.5 padding leniently, it reconstructs the full expected `EM` encoding and compares byte-by-byte using a constant-time XOR accumulator (`diff |= em[i] ^ expected[i]`). This eliminates the class of "lax parser" forgery attacks.

**ECDSA P-256** uses RFC 6979 deterministic `k` generation (HMAC-DRBG over the private key and message hash), which eliminates nonce-reuse vulnerabilities inherent in CSPRNG-based `k` selection.

**Timing-attack caveat**: JavaScript's `BigInt` arithmetic (used throughout `src/crypto/`) does not execute in constant time in V8 or SpiderMonkey. This is a fundamental limitation of pure-JS big-integer arithmetic. The practical impact is:

- **Low risk in typical usage**: signing a PDF once per user action on a server is not meaningfully exploitable.
- **Higher risk in high-frequency server-side pipelines**: a backend signing thousands of PDFs per second with the same private key under adversarial timing observation could theoretically leak key material over many measurements.

**Recommendation for high-security, high-frequency server pipelines**: perform signing externally using Node.js native `crypto.sign()` / `crypto.verify()` or WebCrypto `crypto.subtle.sign()` / `crypto.subtle.verify()`, both of which provide hardware-backed constant-time operations. You can then inject the pre-computed CMS/PKCS#7 blob into the PDF via `signPdfBytes()`. This avoids the pure-JS BigInt arithmetic path entirely.

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
- NPM provenance — signed builds via GitHub Actions OIDC

## Disclosure Policy

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). We ask that you:

1. Report vulnerabilities privately (see above)
2. Allow reasonable time for a fix before public disclosure
3. Do not exploit the vulnerability beyond what is necessary to demonstrate it
