/**
 * Pin the process timezone to UTC — side-effect module.
 *
 * PDF dates carry a local UTC offset (ISO 32000-1 §7.9.4:
 * `D:YYYYMMDDHHmmSS+HH'mm'`), and `buildPdfMetadata()` formats them with the
 * machine's local calendar fields. A pinned `creationDate` is therefore not
 * enough on its own: the same instant renders as a different date string in
 * Paris and in a UTC CI runner, so the sample bytes — and their hashes —
 * would differ between a developer's machine and CI.
 *
 * Import this module FIRST, before anything that formats a date. ES modules
 * evaluate imports in source order, so a bare `import './helpers/tz.js';`
 * placed above the others runs before them.
 *
 * `process.env.TZ` has been honoured at runtime on every platform since
 * Node 16.2; the project's engine floor is Node 22.
 */
process.env.TZ = 'UTC';
