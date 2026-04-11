/**
 * pdfnative — PDF Stream Utilities
 * ==================================
 * Binary conversion and PDF byte-level helpers.
 */

/**
 * Convert a single-byte string to Uint8Array.
 * Each character is masked to 0xFF (WinAnsi = 1 byte per char).
 *
 * @param str - Binary string (each char ≤ 0xFF)
 * @returns Uint8Array of byte values
 */
export function toBytes(str: string): Uint8Array {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF;
    }
    return bytes;
}

/**
 * Sanitize string for use in filename (filesystem-safe).
 *
 * @param str - Input string to sanitize
 * @returns Filesystem-safe slug (max 60 chars)
 */
export function slugify(str: string): string {
    if (!str) return '';
    return String(str)
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
}

/**
 * Trigger a file download in the browser via a temporary <a> element.
 *
 * @param bytes - PDF file content
 * @param filename - Filename with extension
 */
export function downloadBlob(bytes: Uint8Array, filename: string): void {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}
