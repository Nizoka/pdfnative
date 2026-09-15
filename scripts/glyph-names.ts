/**
 * Print the PostScript glyph names behind glyph ids of a TrueType font — the
 * names the shaping tests quote beside every expected glyph id, so a reader
 * can tell `kssa` from `ka_virama_ssa.half` without opening the font.
 *
 * Usage:
 *   npx tsx scripts/glyph-names.ts fonts/ttf/NotoSansTamil-Regular.ttf 141 163
 *   npx tsx scripts/glyph-names.ts fonts/ttf/NotoSansDevanagari-Regular.ttf --name reph
 *
 * Reads the `post` table (format 2.0: an index per glyph into the 258
 * Macintosh standard names or the Pascal strings that follow). A font with
 * a format 3.0 `post` carries no names, which the script says so.
 *
 * Dependencies: none.
 */

import { readFileSync } from 'node:fs';

const MAC_GLYPH_NAMES = ('.notdef .null nonmarkingreturn space exclam quotedbl numbersign dollar percent ampersand quotesingle '
    + 'parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon '
    + 'semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash '
    + 'bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright '
    + 'asciitilde Adieresis Aring Ccedilla Eacute Ntilde Odieresis Udieresis aacute agrave acircumflex adieresis atilde aring '
    + 'ccedilla eacute egrave ecircumflex edieresis iacute igrave icircumflex idieresis ntilde oacute ograve ocircumflex odieresis '
    + 'otilde uacute ugrave ucircumflex udieresis dagger degree cent sterling section bullet paragraph germandbls registered '
    + 'copyright trademark acute dieresis notequal AE Oslash infinity plusminus lessequal greaterequal yen mu partialdiff '
    + 'summation product pi integral ordfeminine ordmasculine Omega ae oslash questiondown exclamdown logicalnot radical '
    + 'florin approxequal Delta guillemotleft guillemotright ellipsis nonbreakingspace Agrave Atilde Otilde OE oe endash emdash '
    + 'quotedblleft quotedblright quoteleft quoteright divide lozenge ydieresis Ydieresis fraction currency guilsinglleft '
    + 'guilsinglright fi fl daggerdbl periodcentered quotesinglbase quotedblbase perthousand Acircumflex Ecircumflex Aacute '
    + 'Edieresis Egrave Iacute Icircumflex Idieresis Igrave Oacute Ocircumflex apple Ograve Uacute Ucircumflex Ugrave dotlessi '
    + 'circumflex tilde macron breve dotaccent ring cedilla hungarumlaut ogonek caron Lslash lslash Scaron scaron Zcaron zcaron '
    + 'brokenbar Eth eth Yacute yacute Thorn thorn minus multiply onesuperior twosuperior threesuperior onehalf onequarter '
    + 'threequarters franc Gbreve gbreve Idotaccent Scedilla scedilla Cacute cacute Ccaron ccaron dcroat').split(' ');

/** Glyph id → name for every glyph the `post` table names, or `null` for a nameless font. */
export function readGlyphNames(bytes: Uint8Array): string[] | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const numTables = view.getUint16(4);
    let post = -1;
    for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        if (tag(o) === 'post') post = view.getUint32(o + 8);
    }
    if (post < 0) return null;
    const version = view.getUint32(post);
    if (version === 0x00010000) return MAC_GLYPH_NAMES;
    if (version !== 0x00020000) return null;
    const numGlyphs = view.getUint16(post + 32);
    const indices: number[] = [];
    let p = post + 34;
    for (let i = 0; i < numGlyphs; i++) { indices.push(view.getUint16(p)); p += 2; }
    const names: string[] = [];
    while (p < bytes.length && names.length < numGlyphs) {
        const len = bytes[p];
        names.push(String.fromCharCode(...bytes.subarray(p + 1, p + 1 + len)));
        p += 1 + len;
    }
    return indices.map(ix => (ix < 258 ? MAC_GLYPH_NAMES[ix] : names[ix - 258] ?? `#${ix}`));
}

function main(): void {
    const [file, ...rest] = process.argv.slice(2);
    if (!file) {
        console.error('Usage: npx tsx scripts/glyph-names.ts <font.ttf> <gid>… | --name <fragment>');
        process.exit(2);
    }
    const names = readGlyphNames(readFileSync(file));
    if (names === null) {
        console.log('no glyph names (post table format 3.0 or absent)');
        return;
    }
    if (rest[0] === '--name') {
        const needle = rest[1] ?? '';
        names.forEach((n, gid) => { if (n.includes(needle)) console.log(`${gid}\t${n}`); });
        return;
    }
    for (const arg of rest) {
        const gid = Number(arg);
        console.log(`${gid}\t${names[gid] ?? '(out of range)'}`);
    }
}

const isMain = process.argv[1] !== undefined && /glyph-names\.ts$/.test(process.argv[1]);
if (isMain) main();
