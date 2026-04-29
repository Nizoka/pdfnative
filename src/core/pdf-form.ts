/**
 * pdfnative — AcroForm Interactive Fields (ISO 32000-1 §12.7)
 * =============================================================
 * Builds AcroForm dictionaries, field widgets, and appearance streams.
 * Field types: text, multilineText, checkbox, radio, dropdown, listbox.
 *
 * All rendering uses Helvetica (/F1) for appearance streams — no CIDFont
 * complexity needed for form field display values.
 */

// ── P
/** Supported AcroForm field types (ISO 32000-1 §12.7.3–12.7.4). */
export type FormFieldType =
    | 'text'
    | 'multilineText'
    | 'checkbox'
    | 'radio'
    | 'dropdown'
    | 'listbox';

/** Resolved form field descriptor ready for PDF object emission. */
export interface FormField {
    readonly fieldType: FormFieldType;
    readonly name: string;
    readonly value: string;
    readonly rect: readonly [number, number, number, number];
    readonly fontSize: number;
    readonly options: readonly string[];
    readonly readOnly: boolean;
    readonly required: boolean;
    readonly maxLength: number | null;
    readonly page: number;
    readonly checked: boolean;
}

/** Context for building a radio button child widget within a group. */
export interface RadioGroupContext {
    /** Object number of the radio group parent field. */
    readonly parentObjNum: number;
    /** Export value name for this radio option (used as AP state name). */
    readonly exportValue: string;
}

/** Result of building a form field: widget annotation dict + appearance stream(s). */
export interface FormWidgetResult {
    /** PDF dictionary content for the widget annotation object. */
    readonly widgetDict: string;
    /** Appearance stream content (the /N normal appearance). For text/dropdown/listbox. */
    readonly appearanceStream: string;
    /** For checkbox/radio: the "Yes" state appearance stream. */
    readonly apYesStream?: string;
    /** For checkbox/radio: the "Off" state appearance stream. */
    readonly apOffStream?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_FIELD_HEIGHT_TEXT = 22;
const DEFAULT_FIELD_HEIGHT_MULTILINE = 60;
const DEFAULT_FIELD_HEIGHT_CHECK = 14;
const DEFAULT_FIELD_HEIGHT_RADIO = 14;
const DEFAULT_FIELD_HEIGHT_DROPDOWN = 22;
const DEFAULT_FIELD_HEIGHT_LISTBOX = 60;

const BORDER_COLOR = '0.6 0.6 0.6';
const BG_COLOR = '1 1 1';
const CHECK_COLOR = '0 0 0';

// ── Helpers ──────────────────────────────────────────────────────────

function pdfStr(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fmtNum(n: number): string {
    return Math.round(n * 100) / 100 === Math.round(n)
        ? String(Math.round(n))
        : (Math.round(n * 100) / 100).toString();
}

/** Get default widget height for a given field type. */
export function defaultFieldHeight(fieldType: FormFieldType): number {
    switch (fieldType) {
        case 'text': return DEFAULT_FIELD_HEIGHT_TEXT;
        case 'multilineText': return DEFAULT_FIELD_HEIGHT_MULTILINE;
        case 'checkbox': return DEFAULT_FIELD_HEIGHT_CHECK;
        case 'radio': return DEFAULT_FIELD_HEIGHT_RADIO;
        case 'dropdown': return DEFAULT_FIELD_HEIGHT_DROPDOWN;
        case 'listbox': return DEFAULT_FIELD_HEIGHT_LISTBOX;
    }
}

// ── Field Flags (ISO 32000-1 Table 221, 226, 229) ───────────────────

const FF_READONLY = 1;
const FF_REQUIRED = 1 << 1;
const FF_MULTILINE = 1 << 12;          // Tx field
const FF_COMBO = 1 << 17;              // Ch field — combo (dropdown) vs list
const FF_RADIO = 1 << 15;              // Btn field — radio button
const FF_NO_TOGGLE_TO_OFF = 1 << 14;   // Btn field — no toggle to off for radio

// ── Appearance Stream Builders ───────────────────────────────────────

function buildTextAppearance(
    value: string,
    rect: readonly [number, number, number, number],
    fontSize: number,
    multiline: boolean,
): string {
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];
    const pad = 2;

    const ops: string[] = [];
    // Background + border (static chrome — outside /Tx BMC)
    ops.push(`${BG_COLOR} rg`);
    ops.push(`0 0 ${fmtNum(w)} ${fmtNum(h)} re f`);
    ops.push(`${BORDER_COLOR} RG`);
    ops.push('0.5 w');
    ops.push(`0.5 0.5 ${fmtNum(w - 1)} ${fmtNum(h - 1)} re S`);

    // Variable text content — wrapped in /Tx BMC...EMC per ISO 32000-1 §12.7.3.3
    // This marked content tells Adobe Reader which part to replace during editing
    ops.push('/Tx BMC');
    ops.push('q');
    if (value) {
        ops.push('BT');
        ops.push(`0 0 0 rg`);
        ops.push(`/Helv ${fmtNum(fontSize)} Tf`);

        if (multiline) {
            const lineH = fontSize * 1.2;
            const maxW = w - pad * 2;
            const lines = wrapFormText(value, fontSize, maxW);
            let yPos = h - pad - fontSize;
            for (const line of lines) {
                if (yPos < pad) break;
                ops.push(`1 0 0 1 ${fmtNum(pad)} ${fmtNum(yPos)} Tm`);
                ops.push(`(${pdfStr(line)}) Tj`);
                yPos -= lineH;
            }
        } else {
            const yBase = (h - fontSize) / 2;
            ops.push(`${fmtNum(pad)} ${fmtNum(yBase)} Td`);
            ops.push(`(${pdfStr(value)}) Tj`);
        }
        ops.push('ET');
    }
    ops.push('Q');
    ops.push('EMC');

    return ops.join('\n');
}

function buildCheckboxAppearance(
    checked: boolean,
    rect: readonly [number, number, number, number],
): string {
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];

    const ops: string[] = [];
    // Background
    ops.push(`${BG_COLOR} rg`);
    ops.push(`0 0 ${fmtNum(w)} ${fmtNum(h)} re f`);
    // Border
    ops.push(`${BORDER_COLOR} RG`);
    ops.push('0.5 w');
    ops.push(`0.5 0.5 ${fmtNum(w - 1)} ${fmtNum(h - 1)} re S`);

    if (checked) {
        // Draw checkmark
        ops.push(`${CHECK_COLOR} RG`);
        ops.push('1.5 w');
        const x1 = w * 0.2, y1 = h * 0.5;
        const x2 = w * 0.4, y2 = h * 0.25;
        const x3 = w * 0.8, y3 = h * 0.8;
        ops.push(`${fmtNum(x1)} ${fmtNum(y1)} m`);
        ops.push(`${fmtNum(x2)} ${fmtNum(y2)} l`);
        ops.push(`${fmtNum(x3)} ${fmtNum(y3)} l`);
        ops.push('S');
    }

    return ops.join('\n');
}

function buildRadioAppearance(
    selected: boolean,
    rect: readonly [number, number, number, number],
): string {
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 1;

    const ops: string[] = [];
    // Background circle (approximated with Bézier)
    ops.push(`${BG_COLOR} rg`);
    ops.push(`${BORDER_COLOR} RG`);
    ops.push('0.5 w');
    ops.push(circlePathOps(cx, cy, r));
    ops.push('B');

    if (selected) {
        // Filled inner circle
        const ir = r * 0.5;
        ops.push(`${CHECK_COLOR} rg`);
        ops.push(circlePathOps(cx, cy, ir));
        ops.push('f');
    }

    return ops.join('\n');
}

function buildDropdownAppearance(
    value: string,
    rect: readonly [number, number, number, number],
    fontSize: number,
): string {
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];
    const pad = 2;

    const ops: string[] = [];
    // Background
    ops.push(`${BG_COLOR} rg`);
    ops.push(`0 0 ${fmtNum(w)} ${fmtNum(h)} re f`);
    // Border
    ops.push(`${BORDER_COLOR} RG`);
    ops.push('0.5 w');
    ops.push(`0.5 0.5 ${fmtNum(w - 1)} ${fmtNum(h - 1)} re S`);

    // Dropdown arrow area
    const arrowW = 16;
    const arrowX = w - arrowW;
    ops.push(`${BORDER_COLOR} rg`);
    ops.push(`${fmtNum(arrowX)} 0 ${fmtNum(arrowW)} ${fmtNum(h)} re f`);

    // Arrow triangle
    ops.push('1 1 1 rg');
    const ax = arrowX + arrowW / 2;
    const ay1 = h * 0.6, ay2 = h * 0.35;
    ops.push(`${fmtNum(ax - 3)} ${fmtNum(ay1)} m`);
    ops.push(`${fmtNum(ax + 3)} ${fmtNum(ay1)} l`);
    ops.push(`${fmtNum(ax)} ${fmtNum(ay2)} l`);
    ops.push('f');

    // Variable text — /Tx BMC...EMC per ISO 32000-1 §12.7.3.3
    ops.push('/Tx BMC');
    ops.push('q');
    if (value) {
        ops.push('BT');
        ops.push('0 0 0 rg');
        ops.push(`/Helv ${fmtNum(fontSize)} Tf`);
        const yBase = (h - fontSize) / 2;
        ops.push(`${fmtNum(pad)} ${fmtNum(yBase)} Td`);
        ops.push(`(${pdfStr(value)}) Tj`);
        ops.push('ET');
    }
    ops.push('Q');
    ops.push('EMC');

    return ops.join('\n');
}

function buildListboxAppearance(
    value: string,
    options: readonly string[],
    rect: readonly [number, number, number, number],
    fontSize: number,
): string {
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];
    const pad = 2;
    const lineH = fontSize * 1.4;

    const ops: string[] = [];
    // Background
    ops.push(`${BG_COLOR} rg`);
    ops.push(`0 0 ${fmtNum(w)} ${fmtNum(h)} re f`);
    // Border
    ops.push(`${BORDER_COLOR} RG`);
    ops.push('0.5 w');
    ops.push(`0.5 0.5 ${fmtNum(w - 1)} ${fmtNum(h - 1)} re S`);

    // Variable text — /Tx BMC...EMC per ISO 32000-1 §12.7.3.3
    ops.push('/Tx BMC');
    ops.push('q');
    let yPos = h - pad - fontSize;
    for (const opt of options) {
        if (yPos < pad) break;

        // Highlight selected
        if (opt === value) {
            ops.push('0.8 0.85 1 rg');
            ops.push(`${fmtNum(pad)} ${fmtNum(yPos - 2)} ${fmtNum(w - pad * 2)} ${fmtNum(lineH)} re f`);
        }

        ops.push('BT');
        ops.push('0 0 0 rg');
        ops.push(`/Helv ${fmtNum(fontSize)} Tf`);
        ops.push(`${fmtNum(pad)} ${fmtNum(yPos)} Td`);
        ops.push(`(${pdfStr(opt)}) Tj`);
        ops.push('ET');

        yPos -= lineH;
    }
    ops.push('Q');
    ops.push('EMC');

    return ops.join('\n');
}

// ── Circle path helper (4 cubic Bézier arcs) ────────────────────────

const K = 0.5522847498; // 4*(sqrt(2)-1)/3

function circlePathOps(cx: number, cy: number, r: number): string {
    const kr = r * K;
    return [
        `${fmtNum(cx + r)} ${fmtNum(cy)} m`,
        `${fmtNum(cx + r)} ${fmtNum(cy + kr)} ${fmtNum(cx + kr)} ${fmtNum(cy + r)} ${fmtNum(cx)} ${fmtNum(cy + r)} c`,
        `${fmtNum(cx - kr)} ${fmtNum(cy + r)} ${fmtNum(cx - r)} ${fmtNum(cy + kr)} ${fmtNum(cx - r)} ${fmtNum(cy)} c`,
        `${fmtNum(cx - r)} ${fmtNum(cy - kr)} ${fmtNum(cx - kr)} ${fmtNum(cy - r)} ${fmtNum(cx)} ${fmtNum(cy - r)} c`,
        `${fmtNum(cx + kr)} ${fmtNum(cy - r)} ${fmtNum(cx + r)} ${fmtNum(cy - kr)} ${fmtNum(cx + r)} ${fmtNum(cy)} c`,
    ].join('\n');
}

// ── Simple text wrapping for multiline fields ────────────────────────

function wrapFormText(text: string, fontSize: number, maxWidth: number): string[] {
    // Approximate Helvetica char width at given font size
    const charW = fontSize * 0.5;
    const maxChars = Math.max(1, Math.floor(maxWidth / charW));
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        if (current.length + word.length + 1 > maxChars && current) {
            lines.push(current);
            current = word;
        } else {
            current = current ? current + ' ' + word : word;
        }
    }
    if (current) lines.push(current);
    return lines;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Build a form field widget annotation dictionary and its appearance stream.
 *
 * @param field - Resolved form field descriptor.
 * @param apObjNum - Object number for the appearance stream XObject.
 * @param radioCtx - Optional radio group context for child widgets.
 * @returns Widget annotation dictionary content and appearance stream.
 */
export function buildFormWidget(field: FormField, apObjNum: number, radioCtx?: RadioGroupContext): FormWidgetResult {
    const [x1, y1, x2, y2] = field.rect;
    const isButton = field.fieldType === 'checkbox' || field.fieldType === 'radio';

    // Build appearance stream based on field type
    let apStream = '';
    let apYesStream: string | undefined;
    let apOffStream: string | undefined;

    switch (field.fieldType) {
        case 'text':
            apStream = buildTextAppearance(field.value, field.rect, field.fontSize, false);
            break;
        case 'multilineText':
            apStream = buildTextAppearance(field.value, field.rect, field.fontSize, true);
            break;
        case 'checkbox':
            apYesStream = buildCheckboxAppearance(true, field.rect);
            apOffStream = buildCheckboxAppearance(false, field.rect);
            break;
        case 'radio':
            apYesStream = buildRadioAppearance(true, field.rect);
            apOffStream = buildRadioAppearance(false, field.rect);
            break;
        case 'dropdown':
            apStream = buildDropdownAppearance(field.value, field.rect, field.fontSize);
            break;
        case 'listbox':
            apStream = buildListboxAppearance(field.value, field.options, field.rect, field.fontSize);
            break;
    }

    // Build field flags
    let ff = 0;
    if (field.readOnly) ff |= FF_READONLY;
    if (field.required) ff |= FF_REQUIRED;

    // Build widget dictionary
    const parts: string[] = [
        '<< /Type /Annot /Subtype /Widget',
        `/Rect [${fmtNum(x1)} ${fmtNum(y1)} ${fmtNum(x2)} ${fmtNum(y2)}]`,
        '/F 4',
    ];

    // Radio children within a group: field-level keys (/FT, /Ff, /T, /V) live on parent
    if (radioCtx) {
        parts.push(`/Parent ${radioCtx.parentObjNum} 0 R`);
        parts.push('/Border [0 0 0.5]');
        const ev = radioCtx.exportValue;
        parts.push(field.checked ? `/AS /${ev}` : '/AS /Off');
        parts.push(`/AP << /N << /${ev} ${apObjNum} 0 R /Off ${apObjNum + 1} 0 R >> >>`);
    } else {
        parts.push(`/T (${pdfStr(field.name)})`);
        parts.push('/Border [0 0 0.5]');

        switch (field.fieldType) {
            case 'text':
            case 'multilineText':
                parts.push('/FT /Tx');
                if (field.fieldType === 'multilineText') ff |= FF_MULTILINE;
                if (field.value) parts.push(`/V (${pdfStr(field.value)})`);
                parts.push(`/DA (/Helv ${fmtNum(field.fontSize)} Tf 0 0 0 rg)`);
                if (field.maxLength !== null) parts.push(`/MaxLen ${field.maxLength}`);
                break;

            case 'checkbox': {
                parts.push('/FT /Btn');
                const isChecked = field.checked || field.value === 'Yes';
                parts.push(isChecked ? '/V /Yes /AS /Yes' : '/V /Off /AS /Off');
                break;
            }

            case 'radio':
                // Standalone radio (no group) — treated as checkbox-like toggle
                parts.push('/FT /Btn');
                ff |= FF_RADIO | FF_NO_TOGGLE_TO_OFF;
                parts.push(field.checked ? '/V /Yes /AS /Yes' : '/V /Off /AS /Off');
                break;

            case 'dropdown':
                parts.push('/FT /Ch');
                ff |= FF_COMBO;
                if (field.value) parts.push(`/V (${pdfStr(field.value)})`);
                parts.push(`/DA (/Helv ${fmtNum(field.fontSize)} Tf 0 0 0 rg)`);
                if (field.options.length > 0) {
                    const optArr = field.options.map(o => `(${pdfStr(o)})`).join(' ');
                    parts.push(`/Opt [${optArr}]`);
                }
                break;

            case 'listbox':
                parts.push('/FT /Ch');
                if (field.value) parts.push(`/V (${pdfStr(field.value)})`);
                parts.push(`/DA (/Helv ${fmtNum(field.fontSize)} Tf 0 0 0 rg)`);
                if (field.options.length > 0) {
                    const optArr = field.options.map(o => `(${pdfStr(o)})`).join(' ');
                    parts.push(`/Opt [${optArr}]`);
                }
                break;
        }

        if (ff !== 0) parts.push(`/Ff ${ff}`);

        // Appearance dictionary — checkbox/radio use state dict, others use single stream
        if (isButton) {
            parts.push(`/AP << /N << /Yes ${apObjNum} 0 R /Off ${apObjNum + 1} 0 R >> >>`);
        } else {
            parts.push(`/AP << /N ${apObjNum} 0 R >>`);
        }
    }
    parts.push('>>');

    const widgetDict = parts.join(' ');

    return { widgetDict, appearanceStream: apStream, apYesStream, apOffStream };
}

/**
 * Build the /AcroForm dictionary content for the catalog.
 *
 * @param fieldObjNums - Array of object numbers for form field widgets.
 * @param fontObjNum - Optional object number for the /Helv font (indirect reference).
 * @returns AcroForm dictionary string (without outer << >>).
 */
export function buildAcroFormDict(fieldObjNums: readonly number[], fontObjNum?: number): string {
    const refs = fieldObjNums.map(n => `${n} 0 R`).join(' ');
    const fontEntry = fontObjNum !== undefined
        ? `/Helv ${fontObjNum} 0 R`
        : '/Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    return `/AcroForm << /Fields [${refs}] /DR << /Font << ${fontEntry} >> >> /NeedAppearances false >>`;
}

/**
 * Build the Form XObject dictionary header for an appearance stream.
 *
 * @param w - Widget width in points.
 * @param h - Widget height in points.
 * @param streamLength - Byte length of the stream content.
 * @param fontObjNum - Optional object number for the /Helv font (indirect reference).
 * @returns Stream dict header (for use with emitStreamObj).
 */
export function buildAppearanceStreamDict(w: number, h: number, streamLength: number, fontObjNum?: number): string {
    const fontEntry = fontObjNum !== undefined
        ? `/Helv ${fontObjNum} 0 R`
        : '/Helv << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    return `<< /Type /XObject /Subtype /Form /BBox [0 0 ${fmtNum(w)} ${fmtNum(h)}] /Resources << /Font << ${fontEntry} >> >> /Length ${streamLength}`;
}

/**
 * Build the parent field dictionary for a radio button group (ISO 32000-1 §12.7.4.2.4).
 *
 * @param name - Group field name (/T entry).
 * @param selectedValue - Export value of the initially selected option, or empty for none.
 * @param childObjNums - Object numbers of child widget annotations.
 * @param readOnly - Whether the group is read-only.
 * @param required - Whether the group is required.
 * @returns Parent field dictionary string.
 */
export function buildRadioGroupParent(
    name: string,
    selectedValue: string,
    childObjNums: readonly number[],
    readOnly: boolean,
    required: boolean,
): string {
    let ff = FF_RADIO | FF_NO_TOGGLE_TO_OFF;
    if (readOnly) ff |= FF_READONLY;
    if (required) ff |= FF_REQUIRED;
    const kids = childObjNums.map(n => `${n} 0 R`).join(' ');
    const v = selectedValue ? `/${selectedValue}` : '/Off';
    return `<< /FT /Btn /Ff ${ff} /T (${pdfStr(name)}) /V ${v} /Kids [${kids}] >>`;
}
