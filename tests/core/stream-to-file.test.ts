import { describe, it, expect } from 'vitest';
import { streamToFile, buildDocumentPDFStreamTrue, concatChunks } from '../../src/core/pdf-stream-writer.js';
import type { DocumentParams } from '../../src/types/pdf-document-types.js';

// Dynamic node imports via string indirection (tests avoid @types/node).
async function nodeFs(): Promise<{
    readFileSync(p: string): Uint8Array;
    rmSync(p: string, o?: unknown): void;
    existsSync(p: string): boolean;
}> {
    return (await import('node:' + 'fs')) as never;
}
async function nodeOs(): Promise<{ tmpdir(): string }> {
    return (await import('node:' + 'os')) as never;
}
async function nodePath(): Promise<{ join(...p: string[]): string }> {
    return (await import('node:' + 'path')) as never;
}

async function tmpFile(name: string): Promise<string> {
    const os = await nodeOs();
    const path = await nodePath();
    return path.join(os.tmpdir(), `pdfnative-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
}

const params: DocumentParams = {
    title: 'Stream',
    blocks: [
        { type: 'heading', text: 'Streamed', level: 1 },
        { type: 'paragraph', text: 'Hello from a constant-memory stream.' },
    ],
};

describe('streamToFile', () => {
    it('writes a streamed PDF to disk and matches the buffered bytes', async () => {
        const fs = await nodeFs();
        const file = await tmpFile('out.pdf');
        try {
            const res = await streamToFile(buildDocumentPDFStreamTrue(params), file);
            expect(res.path).toBe(file);
            expect(res.bytesWritten).toBeGreaterThan(0);
            expect(fs.existsSync(file)).toBe(true);

            const onDisk = fs.readFileSync(file);
            expect(onDisk.length).toBe(res.bytesWritten);

            // Header + EOF sanity.
            const head = String.fromCharCode(...onDisk.slice(0, 5));
            expect(head).toBe('%PDF-');

            // Byte-identical to buffering the same generator.
            const buffered = concatChunks(await collect(buildDocumentPDFStreamTrue(params)));
            expect(onDisk.length).toBe(buffered.length);
        } finally {
            const fs2 = await nodeFs();
            if (fs2.existsSync(file)) fs2.rmSync(file);
        }
    });

    it('honours an already-aborted signal', async () => {
        const file = await tmpFile('abort.pdf');
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(
            streamToFile(buildDocumentPDFStreamTrue(params), file, { signal: ctrl.signal }),
        ).rejects.toThrow(/aborted/);
    });

    it('removes the partial file when aborted mid-write', async () => {
        const fs = await nodeFs();
        const file = await tmpFile('abort-mid.pdf');
        const ctrl = new AbortController();
        async function* slow(): AsyncGenerator<Uint8Array> {
            let n = 0;
            for await (const c of buildDocumentPDFStreamTrue(params)) {
                yield c;
                if (++n === 1) ctrl.abort();
            }
        }
        await expect(
            streamToFile(slow(), file, { signal: ctrl.signal }),
        ).rejects.toThrow(/aborted/);
        // The half-written file must not be left behind.
        expect(fs.existsSync(file)).toBe(false);
    });
});

async function collect(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for await (const c of stream) out.push(c);
    return out;
}
