import { describe, it, expect } from 'vitest';
import { scanDeviceColour } from '../../src/core/pdf-content-colour.js';

describe('scanDeviceColour', () => {
    it('reports each device operator family', () => {
        expect(scanDeviceColour('0.1 0.2 0.3 rg')).toEqual({ rgb: true, cmyk: false, gray: false });
        expect(scanDeviceColour('0 0 0 1 K')).toEqual({ rgb: false, cmyk: true, gray: false });
        expect(scanDeviceColour('0.5 g')).toEqual({ rgb: false, cmyk: false, gray: true });
    });

    it('reports nothing for a stream without colour', () => {
        expect(scanDeviceColour('q 1 0 0 1 10 10 cm 0 0 5 5 re f Q')).toEqual({ rgb: false, cmyk: false, gray: false });
        expect(scanDeviceColour('')).toEqual({ rgb: false, cmyk: false, gray: false });
    });

    it('reads cs / CS naming a device space', () => {
        expect(scanDeviceColour('/DeviceCMYK cs 0 0 0 1 sc').cmyk).toBe(true);
        expect(scanDeviceColour('/DeviceRGB CS').rgb).toBe(true);
        expect(scanDeviceColour('/DeviceGray cs').gray).toBe(true);
    });

    it('ignores a named non-device space', () => {
        expect(scanDeviceColour('/CS0 cs 0.5 scn')).toEqual({ rgb: false, cmyk: false, gray: false });
    });

    it('never reads text as an operator', () => {
        expect(scanDeviceColour('BT /F1 12 Tf (0 0 0 1 k) Tj ET').cmyk).toBe(false);
        expect(scanDeviceColour('BT (a \\) 1 0 0 0 k \\( b) Tj ET').cmyk).toBe(false);
        expect(scanDeviceColour('BT (nested (0 0 0 1 k) parens) Tj ET').cmyk).toBe(false);
    });

    it('skips hex strings, comments and property dictionaries', () => {
        expect(scanDeviceColour('BT <3020302030203120206B> Tj ET').cmyk).toBe(false);
        expect(scanDeviceColour('% 0 0 0 1 k\n0 g').cmyk).toBe(false);
        expect(scanDeviceColour('/Span << /ActualText <FEFF006B> >> BDC 0 0 1 rg EMC')).toEqual({ rgb: true, cmyk: false, gray: false });
    });

    it('does not mistake a name such as /k for the operator', () => {
        expect(scanDeviceColour('/k gs').cmyk).toBe(false);
    });

    it('skips inline image data', () => {
        const binary = 'BI /W 2 /H 1 /CS /RGB /BPC 8 ID \x00k\x01K rg EI 0.5 g';
        expect(scanDeviceColour(binary)).toEqual({ rgb: false, cmyk: false, gray: true });
    });

    it('finds colour in operators glued to delimiters', () => {
        expect(scanDeviceColour('[]0 d 1 0 0 0 k')).toEqual({ rgb: false, cmyk: true, gray: false });
    });
});
