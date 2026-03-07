/**
 * ContourUtils — post-processing for contour polygons.
 *
 * Two-stage pipeline for clean, print-ready contours:
 *   1. Douglas-Peucker simplification  — removes collinear / redundant points
 *      that come from the grid-aligned nature of Marching Squares output
 *   2. Chaikin corner cutting          — smooth B-spline approximation
 *      that turns the angular polygon into a smooth closed curve
 */

import type { Point2D, Contour } from './MarchingSquares';

// ─── Douglas-Peucker ──────────────────────────────────────────────────────────

/**
 * Perpendicular distance from point P to the line defined by A and B.
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        // A === B
        const ex = p.x - a.x;
        const ey = p.y - a.y;
        return Math.sqrt(ex * ex + ey * ey);
    }
    // Scalar projection t onto the line, clamped to [0,1]
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    const ex = p.x - projX;
    const ey = p.y - projY;
    return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Recursive Douglas-Peucker on a slice [start, end] of points.
 */
function dpRecurse(points: Point2D[], start: number, end: number, epsilon: number, keep: boolean[]): void {
    if (end <= start + 1) return;

    let maxDist = 0;
    let maxIdx = start;

    const a = points[start];
    const b = points[end];

    for (let i = start + 1; i < end; i++) {
        const d = perpendicularDistance(points[i], a, b);
        if (d > maxDist) {
            maxDist = d;
            maxIdx = i;
        }
    }

    if (maxDist > epsilon) {
        keep[maxIdx] = true;
        dpRecurse(points, start, maxIdx, epsilon, keep);
        dpRecurse(points, maxIdx, end, epsilon, keep);
    }
}

/**
 * Douglas-Peucker simplification.
 * @param contour  Input polygon (closed or open)
 * @param epsilon  Maximum allowed deviation in grid units (e.g. 0.5)
 */
export function douglasPeucker(contour: Contour, epsilon: number): Contour {
    if (contour.length <= 2) return contour;

    const keep = new Array<boolean>(contour.length).fill(false);
    keep[0] = true;
    keep[contour.length - 1] = true;

    dpRecurse(contour, 0, contour.length - 1, epsilon, keep);

    return contour.filter((_, i) => keep[i]);
}

// ─── Chaikin corner cutting ───────────────────────────────────────────────────

/**
 * One pass of Chaikin's corner-cutting algorithm on a closed polygon.
 * Each segment AB is replaced by two points:
 *   Q = A + 0.25 * (B - A)
 *   R = A + 0.75 * (B - A)
 *
 * After N iterations this converges to a quadratic B-spline approximation.
 */
function chaikinPass(points: Point2D[]): Point2D[] {
    const n = points.length;
    const result: Point2D[] = [];

    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];

        result.push({
            x: a.x + 0.25 * (b.x - a.x),
            y: a.y + 0.25 * (b.y - a.y),
        });
        result.push({
            x: a.x + 0.75 * (b.x - a.x),
            y: a.y + 0.75 * (b.y - a.y),
        });
    }

    return result;
}

/**
 * Smooth a closed polygon using Chaikin corner cutting.
 * @param contour    Input closed polygon
 * @param iterations How many times to apply the algorithm (3–4 is usually enough)
 */
export function chaikinSmooth(contour: Contour, iterations = 3): Contour {
    if (contour.length < 3) return contour;

    // Make sure we're working with a proper closed polygon (no duplicate first/last)
    let pts = contour;
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
        pts = pts.slice(0, -1); // remove duplicated closing point
    }

    for (let i = 0; i < iterations; i++) {
        pts = chaikinPass(pts);
    }

    // Re-close the polygon
    pts.push({ ...pts[0] });
    return pts;
}

// ─── Combined pipeline ────────────────────────────────────────────────────────

/**
 * Full post-processing pipeline:
 *   Douglas-Peucker simplification → Chaikin smoothing
 *
 * @param contours   Raw contours from Marching Squares
 * @param epsilon    DP epsilon in grid units (default 0.5 = half a grid cell)
 * @param smoothIter Chaikin iterations (default 3)
 */
export function processContours(
    contours: Contour[],
    epsilon = 0.5,
    smoothIter = 3
): Contour[] {
    return contours
        .map(c => douglasPeucker(c, epsilon))
        .filter(c => c.length >= 3)
        .map(c => chaikinSmooth(c, smoothIter));
}
