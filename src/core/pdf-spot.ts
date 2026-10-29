/**
 * pdfnative — Spot colours: Separation and DeviceN colour spaces (v1.9.0)
 * ========================================================================
 * A spot colour is an ink the press runs on its own plate — a PANTONE
 * brand colour, a varnish, a die line. In PDF it is a `/Separation`
 * colour space named after the ink, with an alternate process colour a
 * viewer or a composite proof uses instead (ISO 32000-1 §8.6.6.4); a mix of
 * several inks is a `/DeviceN` space whose tint transform combines their
 * alternates (§8.6.6.5).
 *
 * The author declares the inks once (`layout.print.spotColours`: name and
 * alternate) and paints with `{ spot, tint }` or `{ inks }` colour values
 * anywhere a colour is accepted. `pdf-color.ts` turns those values into
 * `/<resource name> cs <tints> scn` operators whose resource names are
 * derived from the ink names alone, so no registry travels through the
 * hundred call sites; this module then writes, for each name a page's
 * content actually selects, the colour-space resource behind it. An ink
 * the content names but the author never declared is an error before any
 * byte is written.
 *
 * Alternates follow the OutputIntent the way device colours do: a CMYK
 * alternate needs a CMYK intent under a PDF/A or PDF/X claim (the builders
 * raise the same `PDFX_DEVICE_CMYK` / `PDFA_DEVICE_CMYK_CONTENT`
 * diagnostics), an RGB alternate under a press intent is covered by the
 * calibrated `/DefaultRGB` the resource dictionary already carries.
 *
 * @module core/pdf-spot
 */

import type { SpotColourDef } from '../types/pdf-types.js';
import { parseColourSpaceName, pdfNameEncode, spotColourSpaceName, inkMixColourSpaceName, SPOT_PREFIX, DEVICEN_PREFIX } from './pdf-color.js';

/** What the resource entries for a page's spot colours amount to. */
export interface SpotColourResources {
    /** `/Name [...]` colour-space entries, space-separated; `''` when none is used. */
    readonly entries: string;
    /** Whether an alternate space is DeviceCMYK (the intent must be CMYK under a claim). */
    readonly cmykAlternate: boolean;
    /** Whether an alternate space is DeviceRGB. */
    readonly rgbAlternate: boolean;
}

/** Format a 0–1 component the way content operands are written. */
const fmt = (n: number): string => {
    const r = Math.round(n * 1000) / 1000;
    return String(r);
};

/** A declared ink's alternate as 0–1 components and its device space. */
function alternateOf(def: SpotColourDef): { readonly space: 'cmyk' | 'rgb'; readonly components: number[] } {
    const alt = def.alternate;
    if (alt.length === 4) {
        for (const v of alt) if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`print.spotColours: '${def.name}' has a CMYK alternate out of range — percentages 0–100`);
        return { space: 'cmyk', components: alt.map(v => v / 100) };
    }
    if (alt.length === 3) {
        for (const v of alt) if (!Number.isFinite(v) || v < 0 || v > 255) throw new Error(`print.spotColours: '${def.name}' has an RGB alternate out of range — 0–255`);
        return { space: 'rgb', components: alt.map(v => v / 255) };
    }
    throw new Error(`print.spotColours: '${def.name}' needs an alternate of four CMYK percentages or three RGB values`);
}

/**
 * Check a spot colour declaration list: non-empty distinct names and valid
 * alternates. Throws with the remedy in the message.
 *
 * @since 1.9.0
 */
export function validateSpotColours(declared: readonly SpotColourDef[] | undefined): void {
    if (!declared) return;
    const seen = new Set<string>();
    for (const def of declared) {
        if (typeof def.name !== 'string' || def.name.trim() === '') throw new Error('print.spotColours: every ink needs a non-empty name');
        if (seen.has(def.name)) throw new Error(`print.spotColours: ink '${def.name}' is declared twice`);
        seen.add(def.name);
        alternateOf(def);
    }
}

/** `/Separation /Name /DeviceX << type-2 tint transform >>`. */
function separationEntry(def: SpotColourDef): string {
    const alt = alternateOf(def);
    const space = alt.space === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB';
    const c0 = alt.space === 'cmyk' ? '0 0 0 0' : '1 1 1';
    return `[/Separation /${pdfNameEncode(def.name)} ${space} << /FunctionType 2 /Domain [0 1] /C0 [${c0}] /C1 [${alt.components.map(fmt).join(' ')}] /N 1 >>]`;
}

/**
 * The PostScript calculator (type 4) tint transform of a DeviceN space over
 * `defs`: every output channel is the sum of each ink's tint times that
 * ink's alternate component (CMYK: ink added; RGB: light removed from 1).
 * A sum above 1 (or an RGB value below 0) is clipped by `/Range`
 * (ISO 32000-1 §7.10.1), so the code needs no clamp of its own.
 *
 * The code uses only the operators of ISO 32000-1 Table 42 — `copy`,
 * `mul`, `add`, `sub`, `exch`, `roll`, `pop`. In particular no `repeat`
 * (not a calculator operator) and no procedure outside `if`/`ifelse`:
 * Acrobat refuses the whole function otherwise ("Invalid Function
 * resource"). The `n` tints left under the results are popped one by one.
 */
function deviceNFunction(defs: readonly SpotColourDef[], space: 'cmyk' | 'rgb'): SpotFunctionStream {
    const n = defs.length;
    const alts = defs.map(d => alternateOf(d).components);
    const channels = space === 'cmyk' ? 4 : 3;
    // With the n tints t1…tn on the stack, `n copy` duplicates them, the
    // multiply/add chain folds the copies into one channel value, and the
    // roll tucks it under the tints for the next channel.
    const channel = (k: number): string => {
        const coef = (i: number): number => (space === 'cmyk' ? alts[i][k] : 1 - alts[i][k]);
        let ps = `${n} copy ${fmt(coef(n - 1))} mul`;
        for (let i = n - 2; i >= 0; i--) ps += ` exch ${fmt(coef(i))} mul add`;
        if (space === 'rgb') ps += ' 1 exch sub';
        return `${ps} ${n + 1} 1 roll`;
    };
    const body = Array.from({ length: channels }, (_, k) => channel(k)).join(' ');
    const pops = Array.from({ length: n }, () => 'pop').join(' ');
    const domain = Array.from({ length: n }, () => '0 1').join(' ');
    const range = Array.from({ length: channels }, () => '0 1').join(' ');
    const data = `{ ${body} ${pops} }`;
    return { dict: `<< /FunctionType 4 /Domain [${domain}] /Range [${range}] /Length ${data.length}`, data };
}

/**
 * The DeviceN attributes dictionary (ISO 32000-1 §8.6.6.5, Table 71): a
 * `/Colorants` dictionary naming every ink of the mix with the same
 * `/Separation` array its own resource uses, so a reader can show the inks
 * one by one and PDF/A-2 (ISO 19005-2 §6.2.4.4) finds every colorant
 * described with one tint transform throughout the file.
 */
function deviceNAttributes(defs: readonly SpotColourDef[]): string {
    const colorants = defs.map(d => `/${pdfNameEncode(d.name)} ${separationEntry(d)}`).join(' ');
    return `<< /Colorants << ${colorants} >> >>`;
}

/** A type-4 function as a stream object: its dictionary (open, `/Length` last) and its PostScript code. */
export interface SpotFunctionStream {
    readonly dict: string;
    readonly data: string;
}

/**
 * The `/ColorSpace` resource entries for the spot colour spaces a content
 * stream selects, built from the author's declarations.
 *
 * @param declared - `layout.print.spotColours`
 * @param usedNames - The resource names the content selects with `cs`/`CS`
 *   (`scanDeviceColour(...).named`, decoded), spot or not — other names are
 *   ignored
 * @param deviceNFunctionRef - Allocates an indirect object for a DeviceN
 *   tint transform (a type-4 function is a stream, so it cannot be inline;
 *   the builder emits it with its stream writer) and returns its `N 0 R`
 *   reference
 * @throws when the content names an ink that is not declared
 * @since 1.9.0
 */
export function spotColourResources(
    declared: readonly SpotColourDef[] | undefined,
    usedNames: readonly string[],
    deviceNFunctionRef: (fn: SpotFunctionStream) => string,
): SpotColourResources {
    const entries: string[] = [];
    let cmykAlternate = false;
    let rgbAlternate = false;
    const byName = new Map<string, SpotColourDef>((declared ?? []).map(d => [d.name, d]));
    const lookup = (ink: string): SpotColourDef => {
        const def = byName.get(ink);
        if (!def) {
            throw new Error(`Spot colour '${ink}' is not declared — add { name: '${ink}', alternate: [c, m, y, k] } to layout.print.spotColours`);
        }
        return def;
    };
    const seen = new Set<string>();
    for (const usedName of usedNames) {
        const parsed = parseColourSpaceName(usedName);
        if (parsed === null) continue;
        if (parsed.kind === 'separation') {
            const def = lookup(parsed.inks[0]);
            const resourceName = spotColourSpaceName(def.name);
            if (seen.has(resourceName)) continue;
            seen.add(resourceName);
            const alt = alternateOf(def);
            if (alt.space === 'cmyk') cmykAlternate = true; else rgbAlternate = true;
            entries.push(`/${resourceName} ${separationEntry(def)}`);
        } else {
            const defs = parsed.inks.map(lookup);
            const resourceName = inkMixColourSpaceName(defs.map(d => d.name));
            if (seen.has(resourceName)) continue;
            seen.add(resourceName);
            const spaces = new Set(defs.map(d => alternateOf(d).space));
            if (spaces.size > 1) {
                throw new Error(`Ink mix ${parsed.inks.map(i => `'${i}'`).join(' + ')}: every ink of a mix needs the same alternate space (all CMYK or all RGB)`);
            }
            const space = defs.length > 0 && alternateOf(defs[0]).space === 'rgb' ? 'rgb' : 'cmyk';
            if (space === 'cmyk') cmykAlternate = true; else rgbAlternate = true;
            const fnRef = deviceNFunctionRef(deviceNFunction(defs, space));
            const names = defs.map(d => `/${pdfNameEncode(d.name)}`).join(' ');
            entries.push(`/${resourceName} [/DeviceN [${names}] ${space === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB'} ${fnRef} ${deviceNAttributes(defs)}]`);
        }
    }
    return { entries: entries.join(' '), cmykAlternate, rgbAlternate };
}

/** Whether a colour-space resource name is one of pdfnative's spot names. */
export function isSpotColourSpaceName(name: string): boolean {
    return name.startsWith(SPOT_PREFIX) || name.startsWith(DEVICEN_PREFIX);
}
