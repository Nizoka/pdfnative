/**
 * pdfnative — PDF Worker Entry Point
 * =====================================
 * Self-contained Web Worker that generates PDFs off the main thread.
 * This file is bundled separately by tsup as a standalone worker script.
 *
 * Protocol:
 *   Main → Worker: { type: 'GENERATE_PDF', params: PdfParams }
 *   Worker → Main: { type: 'progress', percent: number }
 *   Worker → Main: { type: 'complete', pdfBytes: Uint8Array } (Transferable)
 *   Worker → Main: { type: 'error', message: string }
 */

import type { PdfParams, WorkerInputMessage } from '../types/pdf-types.js';
import { buildPDF } from '../core/pdf-builder.js';
import { toBytes } from '../core/pdf-stream.js';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<WorkerInputMessage>) => {
    const msg = e.data;

    if (msg.type !== 'GENERATE_PDF') return;

    try {
        const params: PdfParams = msg.params;

        // Report start
        self.postMessage({ type: 'progress', percent: 10 });

        // Build PDF string
        const pdfString = buildPDF(params);
        self.postMessage({ type: 'progress', percent: 80 });

        // Convert to bytes
        const pdfBytes = toBytes(pdfString);
        self.postMessage({ type: 'progress', percent: 95 });

        // Send back via Transferable (zero-copy)
        self.postMessage(
            { type: 'complete', pdfBytes },
            { transfer: [pdfBytes.buffer] }
        );
    } catch (err) {
        self.postMessage({
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
        });
    }
};

// Announce capabilities
self.postMessage({ type: 'ready', version: '0.1.0' });
