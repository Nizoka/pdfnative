/**
 * pdfnative — Worker API
 * ========================
 * High-level API for generating PDFs using Web Workers or main thread fallback.
 */

import type { PdfParams, PdfLayoutOptions, WorkerInputMessage, WorkerOutputMessage } from '../types/pdf-types.js';
import { buildPDFBytes } from '../core/pdf-builder.js';

/** Default threshold: use Worker for datasets above this row count. */
export const WORKER_THRESHOLD = 500;

/** Worker timeout in milliseconds. */
export const WORKER_TIMEOUT_MS = 60000;

/**
 * Generate PDF in a Web Worker (off-main-thread).
 * Returns Uint8Array via Transferable (zero-copy).
 *
 * @param workerUrl - URL to the worker script (e.g. import.meta.url for bundled worker)
 * @param pdfParams - Parameters for PDF generation
 * @param onProgress - Called with percent (0-100)
 * @returns PDF binary data
 */
export function generatePDFInWorker(
    workerUrl: string | URL,
    pdfParams: PdfParams,
    onProgress?: (percent: number) => void
): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        let worker: Worker;
        try {
            worker = new Worker(workerUrl, { type: 'module' });
        } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
        }

        const timeoutId = setTimeout(() => {
            worker.terminate();
            reject(new Error('PDF Worker timeout'));
        }, WORKER_TIMEOUT_MS);

        worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
            const msg = e.data;

            if (msg.type === 'progress') {
                onProgress?.(msg.percent);
            } else if (msg.type === 'complete') {
                clearTimeout(timeoutId);
                worker.terminate();
                resolve(msg.pdfBytes);
            } else if (msg.type === 'error') {
                clearTimeout(timeoutId);
                worker.terminate();
                reject(new Error(msg.message));
            }
        };

        worker.onerror = (e) => {
            clearTimeout(timeoutId);
            worker.terminate();
            reject(new Error(`Worker error: ${e.message}`));
        };

        const message: WorkerInputMessage = {
            type: 'GENERATE_PDF',
            params: pdfParams,
        };
        worker.postMessage(message);
    });
}

/**
 * Main-thread fallback: generate PDF synchronously.
 * Used when Worker is unavailable (Node.js, Jest/jsdom, CSP restrictions, small datasets).
 */
export function generatePDFMainThread(pdfParams: PdfParams, layoutOptions?: Partial<PdfLayoutOptions>): Uint8Array {
    return buildPDFBytes(pdfParams, layoutOptions);
}

/**
 * Smart PDF generation: uses Worker for large datasets, main thread for small ones.
 *
 * @param pdfParams - Parameters for PDF generation
 * @param options - Configuration
 * @returns PDF as Uint8Array
 */
export async function createPDF(
    pdfParams: PdfParams,
    options?: {
        workerUrl?: string | URL;
        threshold?: number;
        onProgress?: (percent: number) => void;
        layoutOptions?: Partial<PdfLayoutOptions>;
    }
): Promise<Uint8Array> {
    const threshold = options?.threshold ?? WORKER_THRESHOLD;
    const workerUrl = options?.workerUrl;
    const useWorker = pdfParams.rows.length > threshold && typeof Worker !== 'undefined' && workerUrl;

    if (useWorker) {
        try {
            return await generatePDFInWorker(workerUrl, pdfParams, options?.onProgress);
        } catch {
            // Fallback to main thread on Worker failure
            return generatePDFMainThread(pdfParams, options?.layoutOptions);
        }
    }

    return generatePDFMainThread(pdfParams, options?.layoutOptions);
}
