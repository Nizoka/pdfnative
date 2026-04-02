---
description: "Use when working on Web Worker integration, worker-api.ts, pdf-worker.ts, off-thread generation, or message passing. Covers worker lifecycle, error handling, and threshold logic."
applyTo: "src/worker/**"
---
# Web Worker Standards

## Architecture
- `worker-api.ts`: Main-thread dispatch — decides Worker vs main-thread based on row threshold
- `pdf-worker.ts`: Self-contained worker entry — bundles all dependencies (tsup `noExternal`)
- Message protocol: `WorkerInputMessage` → Worker → `WorkerOutputMessage`

## Worker Lifecycle
1. Create Worker from URL (`new Worker(workerUrl, { type: 'module' })`)
2. Post `WorkerInputMessage` with params + font data
3. Listen for `WorkerOutputMessage` (progress updates + final result)
4. Terminate Worker after completion or timeout
5. Always clean up: `worker.terminate()` in finally block

## Error Handling
- Worker errors: catch both `onerror` and `onmessageerror`
- Timeout: configurable via `WORKER_TIMEOUT_MS` (default: 30s)
- Fallback: if Worker creation fails, generate on main thread
- Never swallow errors — always propagate to caller

## Threshold Logic
- `WORKER_THRESHOLD`: default 500 rows — use Worker above this
- Configurable per-call via `options.threshold`
- Below threshold: call `generatePDFMainThread()` directly (avoid Worker overhead)
- Workers are one-shot — create, use, terminate (no connection pooling)

## Message Serialization
- All data must be structured-cloneable (no functions, no class instances)
- Font data: pass pre-loaded `FontData` objects (already serializable)
- Progress: periodic `{ type: 'progress', percent }` messages
- Result: `{ type: 'result', bytes: Uint8Array }`

## Testing
- Test Worker dispatch logic with mock Worker
- Test main-thread fallback path independently
- Test timeout behavior with artificially slow generation
- Integration test: actual Worker generation of a multi-font PDF
