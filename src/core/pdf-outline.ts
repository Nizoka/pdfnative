/**
 * pdfnative — Document Outline / Bookmarks (ISO 32000-1 §12.3.3)
 * ===============================================================
 * Builds the `/Outlines` hierarchy (a doubly-linked tree of
 * `/OutlineItem` dictionaries) for navigable PDF bookmarks.
 *
 * The builder is **pure**: it allocates a contiguous block of indirect
 * object numbers starting at `startObjNum`, wires the
 * `/First /Last /Next /Prev /Parent /Count` links, and resolves each
 * item's `/Dest` to a page object via the supplied `pageObjNumFor`
 * resolver. The catalog references the returned `rootObjNum` and adds
 * `/PageMode /UseOutlines`.
 *
 * Bookmarks are purely navigational and therefore PDF/A-safe — they add
 * no transparency, no JavaScript, and no external references.
 */

import { encodePdfTextString } from './pdf-text.js';

/**
 * Internal, already-normalised outline item used by the builder.
 * `color` is a PDF operator RGB string (`"R G B"`) or `undefined`.
 */
export interface OutlineRenderItem {
    readonly title: string;
    readonly pageIndex: number;
    readonly y?: number;
    readonly bold?: boolean;
    readonly italic?: boolean;
    readonly color?: string;
    /** Render expanded (`true`, default) or collapsed (`false`, negative `/Count`). */
    readonly open?: boolean;
    readonly children?: readonly OutlineRenderItem[];
}

/** Result of {@link buildOutlineObjects}. */
export interface BuiltOutline {
    /** Emitted objects in allocation order: `[objNum, body]`. */
    readonly objects: ReadonlyArray<readonly [number, string]>;
    /** Object number of the `/Outlines` root dictionary. */
    readonly rootObjNum: number;
    /** Total number of objects allocated (root + every item). */
    readonly totalObjects: number;
}

interface FlatNode {
    readonly item: OutlineRenderItem;
    readonly objNum: number;
    readonly parentObjNum: number;
    readonly depth: number;
    firstChildObjNum: number;
    lastChildObjNum: number;
    prevObjNum: number;
    nextObjNum: number;
    /** Magnitude of `/Count`: descendants visible when THIS node is open. */
    openDescendantCount: number;
    /** Whether this node renders expanded (`true`) or collapsed (`false`). */
    open: boolean;
}

/**
 * Build the `/Outlines` object tree.
 *
 * @param items         Top-level outline items (recursively containing children).
 * @param startObjNum   First object number to allocate (the `/Outlines` root).
 * @param pageObjNumFor Maps a 0-based page index to its page object number.
 * @param defaultY      Default destination Y (top of page) when an item omits `y`.
 * @param fmtNum        Numeric formatter (shared with the document builder).
 * @param pageCount     Total page count, for clamping out-of-range indices.
 */
export function buildOutlineObjects(
    items: readonly OutlineRenderItem[],
    startObjNum: number,
    pageObjNumFor: (pageIndex: number) => number,
    defaultY: number,
    fmtNum: (n: number) => string,
    pageCount: number,
): BuiltOutline {
    const rootObjNum = startObjNum;
    const nodes: FlatNode[] = [];

    // Depth-first allocation so parents precede children in object order.
    let nextObj = startObjNum + 1;
    function alloc(
        list: readonly OutlineRenderItem[],
        parentObjNum: number,
        depth: number,
    ): { first: number; last: number; visibleCount: number } {
        let first = 0;
        let last = 0;
        let prev = 0;
        let visibleCount = 0;
        const siblingNodes: FlatNode[] = [];
        for (const item of list) {
            const objNum = nextObj++;
            const open = item.open !== false;
            const node: FlatNode = {
                item,
                objNum,
                parentObjNum,
                depth,
                firstChildObjNum: 0,
                lastChildObjNum: 0,
                prevObjNum: prev,
                nextObjNum: 0,
                openDescendantCount: 0,
                open,
            };
            if (prev !== 0) {
                const prevNode = siblingNodes[siblingNodes.length - 1];
                prevNode.nextObjNum = objNum;
            }
            nodes.push(node);
            siblingNodes.push(node);
            if (first === 0) first = objNum;
            last = objNum;
            prev = objNum;
            // This node is itself visible (its parent is open by construction).
            visibleCount++;

            const children = item.children;
            if (children && children.length > 0) {
                const sub = alloc(children, objNum, depth + 1);
                node.firstChildObjNum = sub.first;
                node.lastChildObjNum = sub.last;
                node.openDescendantCount = sub.visibleCount;
                // Collapsed nodes hide their descendants from the parent's count.
                if (open) visibleCount += sub.visibleCount;
            }
        }
        return { first, last, visibleCount };
    }

    const top = alloc(items, rootObjNum, 0);

    const objects: Array<readonly [number, string]> = [];

    // Root /Outlines dictionary.
    objects.push([
        rootObjNum,
        `<< /Type /Outlines /First ${top.first} 0 R /Last ${top.last} 0 R /Count ${top.visibleCount} >>`,
    ]);

    // Each /OutlineItem.
    for (const node of nodes) {
        const it = node.item;
        const pageIdx = Math.max(0, Math.min(pageCount - 1, it.pageIndex | 0));
        const pageObj = pageObjNumFor(pageIdx);
        const y = it.y ?? defaultY;
        const parts: string[] = [
            `/Title ${encodePdfTextString(it.title)}`,
            `/Parent ${node.parentObjNum} 0 R`,
        ];
        if (node.prevObjNum !== 0) parts.push(`/Prev ${node.prevObjNum} 0 R`);
        if (node.nextObjNum !== 0) parts.push(`/Next ${node.nextObjNum} 0 R`);
        if (node.firstChildObjNum !== 0) {
            parts.push(`/First ${node.firstChildObjNum} 0 R`);
            parts.push(`/Last ${node.lastChildObjNum} 0 R`);
            // Positive count = open (expanded); negative = closed (collapsed).
            // Magnitude is the number of descendants visible when open.
            const count = node.open ? node.openDescendantCount : -node.openDescendantCount;
            parts.push(`/Count ${count}`);
        }
        parts.push(`/Dest [${pageObj} 0 R /XYZ 0 ${fmtNum(y)} null]`);
        const flags = (it.bold ? 2 : 0) | (it.italic ? 1 : 0);
        if (flags !== 0) parts.push(`/F ${flags}`);
        if (it.color) parts.push(`/C [${it.color}]`);
        objects.push([node.objNum, `<< ${parts.join(' ')} >>`]);
    }

    return { objects, rootObjNum, totalObjects: nodes.length + 1 };
}
