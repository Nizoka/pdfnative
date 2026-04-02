import { describe, it, expect, vi } from 'vitest';
import { toBytes, slugify, downloadBlob } from '../../src/core/pdf-stream.js';

describe('toBytes', () => {
    it('should convert ASCII string to Uint8Array', () => {
        const result = toBytes('ABC');
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(3);
        expect(result[0]).toBe(65); // A
        expect(result[1]).toBe(66); // B
        expect(result[2]).toBe(67); // C
    });

    it('should handle empty string', () => {
        const result = toBytes('');
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result.length).toBe(0);
    });

    it('should mask characters to 0xFF (single byte)', () => {
        const result = toBytes('\u00E9'); // é = 0xE9
        expect(result.length).toBe(1);
        expect(result[0]).toBe(0xE9);
    });

    it('should handle PDF binary header bytes', () => {
        const result = toBytes('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        expect(result[0]).toBe(37);  // %
        expect(result[8]).toBe(10);  // \n
        expect(result[9]).toBe(37);  // %
        expect(result[10]).toBe(0xE2);
        expect(result[11]).toBe(0xE3);
        expect(result[12]).toBe(0xCF);
        expect(result[13]).toBe(0xD3);
    });

    it('should handle high bytes correctly', () => {
        const result = toBytes('\xFF\x00\x80');
        expect(result[0]).toBe(255);
        expect(result[1]).toBe(0);
        expect(result[2]).toBe(128);
    });
});

describe('slugify', () => {
    it('should return empty string for empty input', () => {
        expect(slugify('')).toBe('');
    });

    it('should replace spaces with hyphens', () => {
        expect(slugify('hello world')).toBe('hello-world');
    });

    it('should remove filesystem-unsafe characters', () => {
        expect(slugify('file:name*test?')).toBe('filenametest');
    });

    it('should collapse multiple hyphens', () => {
        expect(slugify('a - - b')).toBe('a-b');
    });

    it('should trim leading/trailing hyphens', () => {
        expect(slugify(' -hello- ')).toBe('hello');
    });

    it('should truncate to 60 characters', () => {
        const long = 'a'.repeat(100);
        expect(slugify(long).length).toBeLessThanOrEqual(60);
    });

    it('should handle special PDF characters', () => {
        expect(slugify('Relevé <2026>')).toBe('Relevé-2026');
    });
});

describe('downloadBlob', () => {
    it('should create a temporary link, click it, and clean up', () => {
        const revokeObjectURL = vi.fn();
        const createObjectURL = vi.fn(() => 'blob:http://test/abc');
        const click = vi.fn();
        const fakeAnchor = { href: '', download: '', style: { display: '' }, click } as unknown as HTMLAnchorElement;
        const appendChild = vi.fn();
        const removeChild = vi.fn();

        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.stubGlobal('Blob', class { constructor(public parts: unknown[], public opts: unknown) {} });
        vi.stubGlobal('document', {
            createElement: vi.fn(() => fakeAnchor),
            body: { appendChild, removeChild },
        });

        const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
        downloadBlob(bytes, 'test.pdf');

        expect(createObjectURL).toHaveBeenCalledOnce();
        expect(fakeAnchor.href).toBe('blob:http://test/abc');
        expect(fakeAnchor.download).toBe('test.pdf');
        expect(fakeAnchor.style.display).toBe('none');
        expect(appendChild).toHaveBeenCalledWith(fakeAnchor);
        expect(click).toHaveBeenCalledOnce();
        expect(removeChild).toHaveBeenCalledWith(fakeAnchor);

        vi.unstubAllGlobals();
    });

    it('should revoke object URL after timeout', () => {
        vi.useFakeTimers();
        const revokeObjectURL = vi.fn();
        const createObjectURL = vi.fn(() => 'blob:http://test/xyz');
        const fakeAnchor = { href: '', download: '', style: { display: '' }, click: vi.fn() } as unknown as HTMLAnchorElement;

        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        vi.stubGlobal('Blob', class { constructor(public parts: unknown[], public opts: unknown) {} });
        vi.stubGlobal('document', {
            createElement: vi.fn(() => fakeAnchor),
            body: { appendChild: vi.fn(), removeChild: vi.fn() },
        });

        downloadBlob(new Uint8Array([1]), 'x.pdf');
        expect(revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(5000);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://test/xyz');

        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
});
