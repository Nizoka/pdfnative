/**
 * Test helper — a minimal interpreter of the text operators pdfnative writes
 * (ISO 32000-1 §9.4): `BT` / `ET`, `Tf`, `Td` / `TD`, `Tm`, `Tj`, `TJ`;
 * marked-content and graphics operators are skipped. Since 1.9.0 (C25) a
 * line is one text object whose runs are placed by relative `Td` moves and
 * whose shaped glyphs sit in `TJ` arrays, so a test that needs the origin of
 * a string or of a glyph replays the operators the way a viewer does: a `Td`
 * moves the line origin, a `TJ` number subtracts thousandths of the font
 * size from the pen, a glyph advances it by its `/W` width.
 *
 * TEST-ONLY tooling — not part of the published library.
 */

/** A string shown by one `Tj`, or one element of a `TJ` array. */
export interface TextString {
    /** Font resource name without the slash (e.g. `F3`). */
    readonly font: string;
    readonly size: number;
    /** Origin of the string's first glyph (user space). */
    readonly x: number;
    readonly y: number;
    /** The hex string's glyph ids (Identity-H), or the literal's byte codes. */
    readonly gids: readonly number[];
    /** Origin of every glyph of the string, as the viewer advances the pen. */
    readonly glyphX: readonly number[];
    /** The decoded literal for a `(…)` string, `null` for a hex string. */
    readonly text: string | null;
    /** The operator that showed it: `Tj`, or `TJ` for an element of an array (a justified or kerned run). */
    readonly op: 'Tj' | 'TJ';
}

/** One glyph of a hex string at the origin the viewer gives it. */
export interface GlyphOp {
    readonly font: string;
    readonly size: number;
    readonly x: number;
    readonly y: number;
    readonly gid: number;
}

/** The advance of a glyph (or literal byte) of `font`, in thousandths of the font size. */
export type WidthOf = (font: string, code: number) => number;

type Token =
    | { readonly kind: 'num'; readonly value: number }
    | { readonly kind: 'name'; readonly value: string }
    | { readonly kind: 'hex'; readonly value: string }
    | { readonly kind: 'lit'; readonly value: string }
    | { readonly kind: 'array'; readonly items: readonly Token[] }
    | { readonly kind: 'op'; readonly value: string };

const WS = /\s/;

/** Tokenise a content stream fragment; dictionaries (`<< … >>`) are skipped whole. */
function tokenize(src: string): Token[] {
    const out: Token[] = [];
    const stack: Token[][] = [out];
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        if (WS.test(c)) { i++; continue; }
        if (c === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
        if (c === '[') { const arr: Token[] = []; stack[stack.length - 1].push({ kind: 'array', items: arr }); stack.push(arr); i++; continue; }
        if (c === ']') { if (stack.length > 1) stack.pop(); i++; continue; }
        if (c === '<' && src[i + 1] === '<') {
            let depth = 0;
            while (i < n) {
                if (src.startsWith('<<', i)) { depth++; i += 2; continue; }
                if (src.startsWith('>>', i)) { depth--; i += 2; if (depth === 0) break; continue; }
                i++;
            }
            continue;
        }
        if (c === '<') {
            const end = src.indexOf('>', i);
            stack[stack.length - 1].push({ kind: 'hex', value: src.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, '') });
            i = end < 0 ? n : end + 1;
            continue;
        }
        if (c === '(') {
            let depth = 1;
            let j = i + 1;
            let text = '';
            while (j < n && depth > 0) {
                const ch = src[j];
                if (ch === '\\') {
                    const nx = src[j + 1];
                    const esc: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
                    if (nx !== undefined && esc[nx] !== undefined) { text += esc[nx]; j += 2; continue; }
                    const oct = /^[0-7]{1,3}/.exec(src.slice(j + 1, j + 4));
                    if (oct) { text += String.fromCharCode(parseInt(oct[0], 8)); j += 1 + oct[0].length; continue; }
                    j++;
                    continue;
                }
                if (ch === '(') depth++;
                else if (ch === ')') { depth--; if (depth === 0) break; }
                text += ch;
                j++;
            }
            stack[stack.length - 1].push({ kind: 'lit', value: text });
            i = j + 1;
            continue;
        }
        if (c === '/') {
            let j = i + 1;
            while (j < n && !WS.test(src[j]) && !'/[]<>(){}%'.includes(src[j])) j++;
            stack[stack.length - 1].push({ kind: 'name', value: src.slice(i + 1, j) });
            i = j;
            continue;
        }
        let j = i;
        while (j < n && !WS.test(src[j]) && !'/[]<>(){}%'.includes(src[j])) j++;
        if (j === i) { i++; continue; }
        const word = src.slice(i, j);
        if (/^[-+.\d]/.test(word) && !Number.isNaN(Number(word))) stack[stack.length - 1].push({ kind: 'num', value: Number(word) });
        else stack[stack.length - 1].push({ kind: 'op', value: word });
        i = j;
    }
    return out;
}

/** Glyph ids of a hex string, four digits each. */
function hexGids(hex: string): number[] {
    const gids: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) gids.push(parseInt(hex.slice(i, i + 4), 16));
    return gids;
}

/**
 * Replay the text operators of `content` and return every string shown, in
 * stream order, with the origin the viewer gives it. `widthOf` supplies the
 * advances (the `/W` entries of a CIDFont, the AFM widths of a base-14 font).
 */
export function interpretTextStrings(content: string, widthOf: WidthOf): TextString[] {
    const out: TextString[] = [];
    let font = '';
    let size = 0;
    let lx = 0;
    let ly = 0;
    let tx = 0;
    let ty = 0;
    let operands: Token[] = [];

    const num = (t: Token | undefined): number => (t !== undefined && t.kind === 'num' ? t.value : 0);
    const show = (t: Token, op: 'Tj' | 'TJ'): void => {
        if (t.kind !== 'hex' && t.kind !== 'lit') return;
        const gids = t.kind === 'hex' ? hexGids(t.value) : Array.from(t.value, ch => ch.charCodeAt(0) & 0xFF);
        const glyphX: number[] = [];
        const x = tx;
        for (const gid of gids) {
            glyphX.push(tx);
            tx += widthOf(font, gid) / 1000 * size;
        }
        out.push({ font, size, x, y: ty, gids, glyphX, text: t.kind === 'lit' ? t.value : null, op });
    };

    for (const tok of tokenize(content)) {
        if (tok.kind !== 'op') { operands.push(tok); continue; }
        switch (tok.value) {
            case 'BT': lx = ly = tx = ty = 0; break;
            case 'Tf': {
                const name = operands[operands.length - 2];
                font = name !== undefined && name.kind === 'name' ? name.value : font;
                size = num(operands[operands.length - 1]);
                break;
            }
            case 'Td':
            case 'TD':
                lx += num(operands[operands.length - 2]);
                ly += num(operands[operands.length - 1]);
                tx = lx; ty = ly;
                break;
            case 'Tm':
                lx = num(operands[operands.length - 2]);
                ly = num(operands[operands.length - 1]);
                tx = lx; ty = ly;
                break;
            case 'Tj': {
                const s = operands[operands.length - 1];
                if (s !== undefined) show(s, 'Tj');
                break;
            }
            case 'TJ': {
                const arr = operands[operands.length - 1];
                if (arr !== undefined && arr.kind === 'array') {
                    for (const item of arr.items) {
                        if (item.kind === 'num') tx -= item.value / 1000 * size;
                        else show(item, 'TJ');
                    }
                }
                break;
            }
            default: break;
        }
        operands = [];
    }
    return out;
}

/** Every glyph of every hex string of `content`, one entry per glyph, at its origin. */
export function interpretGlyphs(content: string, widthOf: WidthOf): GlyphOp[] {
    const out: GlyphOp[] = [];
    for (const s of interpretTextStrings(content, widthOf)) {
        if (s.text !== null) continue;
        for (let i = 0; i < s.gids.length; i++) out.push({ font: s.font, size: s.size, x: s.glyphX[i], y: s.y, gid: s.gids[i] });
    }
    return out;
}

/**
 * Whether every `/ActualText` span of `content` holds at most one text object
 * — the C25 invariant: a reader that applies the span's text once per text
 * object (Acrobat) pastes it once. Returns the `BT` count of every span.
 */
export function textObjectsPerActualTextSpan(content: string): number[] {
    const counts: number[] = [];
    for (const m of content.matchAll(/\/ActualText[^]*?BDC([^]*?)EMC/g)) {
        counts.push((m[1].match(/\bBT\b/g) ?? []).length);
    }
    return counts;
}

/** The text-showing operators (`Tj` and `TJ`) inside every `/ActualText` span of `content`. */
export function showOpsPerActualTextSpan(content: string): number[] {
    const counts: number[] = [];
    for (const m of content.matchAll(/\/ActualText[^]*?BDC([^]*?)EMC/g)) {
        counts.push((m[1].match(/\bT[jJ]\b/g) ?? []).length);
    }
    return counts;
}
