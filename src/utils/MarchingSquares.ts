/**
 * Proper Marching Squares implementation with segment stitching.
 *
 * Key design: the heightmap is padded with a 1-cell border of zeros before
 * running MS. This guarantees every contour closes properly — if terrain
 * reaches the grid edge, the zero-border forces the contour to close along
 * the boundary rather than producing open "dangling" segments.
 *
 * Pipeline:
 *   1. Pad grid with zeros (size w+2 × h+2)
 *   2. Collect edge segments from all 2×2 cells (with sub-pixel interpolation)
 *   3. Stitch segments into closed polygons via endpoint adjacency map
 *   4. Shift coordinates back by -1 to restore original grid space
 */

export interface Point2D {
    x: number;
    y: number;
}

export type Contour = Point2D[];

/** A raw edge segment: two interpolated points on adjacent cell edges */
interface Segment {
    a: Point2D;
    b: Point2D;
}

// ─── Lookup table ─────────────────────────────────────────────────────────────
// For each of the 16 MS configs, which pairs of cell-edge indices to connect.
// Edge indices: 0=top, 1=right, 2=bottom, 3=left
// Cases 5 and 10 are saddle points — resolved separately using cell-center.
const MS_EDGES: Record<number, [number, number][]> = {
    0: [],
    1: [[3, 2]],
    2: [[2, 1]],
    3: [[3, 1]],
    4: [[0, 1]],
    5: [],        // saddle — handled below
    6: [[0, 2]],
    7: [[0, 3]],
    8: [[0, 3]],
    9: [[0, 2]],
    10: [],        // saddle — handled below
    11: [[0, 1]],
    12: [[3, 1]],
    13: [[2, 1]],
    14: [[3, 2]],
    15: [],
};

// Corner offsets [dx, dy] for corner index: 0=TL, 1=TR, 2=BR, 3=BL
const CORNER_OFFSET: [number, number][] = [
    [0, 0], // TL
    [1, 0], // TR
    [1, 1], // BR
    [0, 1], // BL
];

// Edge corners: edge index → [cornerA, cornerB]
const EDGE_CORNERS: [number, number][] = [
    [0, 1], // edge 0 = top
    [1, 2], // edge 1 = right
    [3, 2], // edge 2 = bottom
    [0, 3], // edge 3 = left
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPaddedVal(grid: Float32Array, width: number, x: number, y: number): number {
    return grid[y * width + x] ?? 0;
}

/**
 * Interpolated point on a cell edge (sub-pixel accuracy).
 * Works in padded-grid coordinates.
 */
function edgeMidpointPadded(
    grid: Float32Array,
    width: number,
    cx: number,
    cy: number,
    edgeIdx: number,
    threshold: number
): Point2D {
    const [c0, c1] = EDGE_CORNERS[edgeIdx];
    const [dx0, dy0] = CORNER_OFFSET[c0];
    const [dx1, dy1] = CORNER_OFFSET[c1];

    const x0 = cx + dx0, y0 = cy + dy0;
    const x1 = cx + dx1, y1 = cy + dy1;

    const v0 = getPaddedVal(grid, width, x0, y0);
    const v1 = getPaddedVal(grid, width, x1, y1);

    let t = 0.5;
    if (Math.abs(v1 - v0) > 1e-6) t = (threshold - v0) / (v1 - v0);
    t = Math.max(0, Math.min(1, t));

    return {
        x: x0 + t * (x1 - x0),
        y: y0 + t * (y1 - y0),
    };
}

/** Point key with 4-decimal precision for endpoint matching */
function ptKey(p: Point2D): string {
    return `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Extract closed contour polygons from a heightmap at a given threshold.
 *
 * The grid is internally padded with a 1-cell border of zeros before running
 * Marching Squares. This guarantees that any contour reaching the original
 * grid boundary will close properly — no open "dangling" segments.
 * Returned coordinates are in the original grid space (0 … width-1, 0 … height-1).
 */
export function marchingSquares(
    grid: Float32Array,
    width: number,
    height: number,
    threshold: number
): Contour[] {
    // ── 1. Pad with a 1-cell border of zeros ──────────────────────────────
    const pw = width + 2;
    const ph = height + 2;
    const padded = new Float32Array(pw * ph); // zero-initialized

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            padded[(y + 1) * pw + (x + 1)] = grid[y * width + x];
        }
    }

    // ── 2. Collect segments from the padded grid ──────────────────────────
    const segments: Segment[] = [];

    for (let cy = 0; cy < ph - 1; cy++) {
        for (let cx = 0; cx < pw - 1; cx++) {
            const tl = padded[cy * pw + cx];
            const tr = padded[cy * pw + cx + 1];
            const br = padded[(cy + 1) * pw + cx + 1];
            const bl = padded[(cy + 1) * pw + cx];

            let config = 0;
            if (tl >= threshold) config |= 8;
            if (tr >= threshold) config |= 4;
            if (br >= threshold) config |= 2;
            if (bl >= threshold) config |= 1;

            if (config === 0 || config === 15) continue;

            // Saddle points: use cell-center average to disambiguate
            if (config === 5 || config === 10) {
                const center = (tl + tr + br + bl) / 4;
                if (config === 5) {
                    if (center >= threshold) {
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 0, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 3, threshold) });
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 1, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 2, threshold) });
                    } else {
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 0, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 1, threshold) });
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 2, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 3, threshold) });
                    }
                } else {
                    if (center >= threshold) {
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 0, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 1, threshold) });
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 2, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 3, threshold) });
                    } else {
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 0, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 3, threshold) });
                        segments.push({ a: edgeMidpointPadded(padded, pw, cx, cy, 1, threshold), b: edgeMidpointPadded(padded, pw, cx, cy, 2, threshold) });
                    }
                }
                continue;
            }

            for (const [e0, e1] of MS_EDGES[config]) {
                segments.push({
                    a: edgeMidpointPadded(padded, pw, cx, cy, e0, threshold),
                    b: edgeMidpointPadded(padded, pw, cx, cy, e1, threshold),
                });
            }
        }
    }

    // ── 3. Stitch into closed polygons ────────────────────────────────────
    const contours = stitchSegments(segments);

    // ── 4. Shift coordinates back: padded space → original grid space ─────
    return contours.map(c => c.map(p => ({ x: p.x - 1, y: p.y - 1 })));
}

// ─── Segment stitching ────────────────────────────────────────────────────────

/**
 * Stitches a flat list of segments (segment soup) into ordered closed polygons.
 * Uses an endpoint → segment adjacency map.
 */
function stitchSegments(segments: Segment[]): Contour[] {
    if (segments.length === 0) return [];

    const adjacency = new Map<string, number[]>();

    const addToMap = (key: string, idx: number) => {
        const list = adjacency.get(key);
        if (list) list.push(idx);
        else adjacency.set(key, [idx]);
    };

    for (let i = 0; i < segments.length; i++) {
        addToMap(ptKey(segments[i].a), i);
        addToMap(ptKey(segments[i].b), i);
    }

    const used = new Uint8Array(segments.length);
    const contours: Contour[] = [];

    for (let start = 0; start < segments.length; start++) {
        if (used[start]) continue;

        const contour: Point2D[] = [];
        let currentPt = segments[start].a;
        let currentSeg = start;

        while (true) {
            if (used[currentSeg]) break;
            used[currentSeg] = 1;

            contour.push(currentPt);

            const seg = segments[currentSeg];
            const otherPt = ptKey(currentPt) === ptKey(seg.a) ? seg.b : seg.a;
            currentPt = otherPt;

            const neighbours = adjacency.get(ptKey(currentPt)) ?? [];
            let nextSeg = -1;
            for (const n of neighbours) {
                if (!used[n]) {
                    nextSeg = n;
                    break;
                }
            }

            if (nextSeg === -1) {
                contour.push(currentPt);
                break;
            }

            currentSeg = nextSeg;
        }

        if (contour.length >= 3) {
            contours.push(contour);
        }
    }

    return contours;
}
