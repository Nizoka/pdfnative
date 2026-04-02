# Security Policy

## Reporting a Vulnerability

**Please do NOT open a public issue for security vulnerabilities.**

To report a security vulnerability, please use [GitHub's private vulnerability reporting](https://github.com/Nizoka/pdfnative/security/advisories/new).

Alternatively, contact us at: **security@plika.app**

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

### Input Validation

- `buildPDF()` and `buildDocumentPDF()` validate all inputs at the API boundary
- URL validation (`validateURL()`) blocks `javascript:`, `file:`, and `data:` URI schemes
- PDF string escaping prevents injection via `\`, `(`, `)` characters
- CIDFont hex encoding eliminates string injection vectors
- TTF subsetting uses typed arrays with bounds checking
- Row/block count limits prevent resource exhaustion (100K max)

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
