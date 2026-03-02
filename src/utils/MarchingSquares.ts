/**
 * Marching Squares algorithm — extracts 2D contour paths from a heightmap at a given threshold.
 */
export interface Point2D {
    x: number;
    y: number;
}

export type Contour = Point2D[];

/**
 * Extract contours at a specific height threshold from a 2D grid of heights.
 * @param grid - 2D array of height values (row-major).
 * @param width - number of columns
 * @param height - number of rows
 * @param threshold - height value at which to extract contour
 * @returns Array of contour polylines
 */
export function marchingSquares(
    grid: Float32Array,
    width: number,
    height: number,
    threshold: number
): Contour[] {
    const contours: Contour[] = [];
    const visited = new Set<string>();

    for (let y = 0; y < height - 1; y++) {
        for (let x = 0; x < width - 1; x++) {
            const key = `${x},${y}`;
            if (visited.has(key)) continue;

            const config = getConfig(grid, width, x, y, threshold);
            if (config === 0 || config === 15) continue;

            // Trace a contour starting from this cell
            const contour = traceContour(grid, width, height, x, y, threshold, visited);
            if (contour.length > 2) {
                contours.push(contour);
            }
        }
    }

    return contours;
}

function getVal(grid: Float32Array, width: number, x: number, y: number): number {
    return grid[y * width + x];
}

function getConfig(grid: Float32Array, width: number, x: number, y: number, threshold: number): number {
    let config = 0;
    if (getVal(grid, width, x, y) >= threshold) config |= 8;
    if (getVal(grid, width, x + 1, y) >= threshold) config |= 4;
    if (getVal(grid, width, x + 1, y + 1) >= threshold) config |= 2;
    if (getVal(grid, width, x, y + 1) >= threshold) config |= 1;
    return config;
}

function interpolate(v1: number, v2: number, threshold: number): number {
    if (Math.abs(v2 - v1) < 0.0001) return 0.5;
    return (threshold - v1) / (v2 - v1);
}

function traceContour(
    grid: Float32Array,
    width: number,
    height: number,
    startX: number,
    startY: number,
    threshold: number,
    visited: Set<string>
): Contour {
    const contour: Contour = [];
    let cx = startX;
    let cy = startY;
    const maxIter = width * height;
    let iter = 0;

    while (iter++ < maxIter) {
        if (cx < 0 || cy < 0 || cx >= width - 1 || cy >= height - 1) break;

        const key = `${cx},${cy}`;
        if (visited.has(key) && contour.length > 2) break;
        visited.add(key);

        const config = getConfig(grid, width, cx, cy, threshold);
        if (config === 0 || config === 15) break;

        const tl = getVal(grid, width, cx, cy);
        const tr = getVal(grid, width, cx + 1, cy);
        const br = getVal(grid, width, cx + 1, cy + 1);
        const bl = getVal(grid, width, cx, cy + 1);

        let px: number, py: number;

        // Get the interpolated edge point for each configuration
        switch (config) {
            case 1: case 14:
                px = cx + 0;
                py = cy + interpolate(tl, bl, threshold);
                contour.push({ x: px, y: py });
                px = cx + interpolate(bl, br, threshold);
                py = cy + 1;
                contour.push({ x: px, y: py });
                break;
            case 2: case 13:
                px = cx + interpolate(bl, br, threshold);
                py = cy + 1;
                contour.push({ x: px, y: py });
                px = cx + 1;
                py = cy + interpolate(tr, br, threshold);
                contour.push({ x: px, y: py });
                break;
            case 3: case 12:
                px = cx + 0;
                py = cy + interpolate(tl, bl, threshold);
                contour.push({ x: px, y: py });
                px = cx + 1;
                py = cy + interpolate(tr, br, threshold);
                contour.push({ x: px, y: py });
                break;
            case 4: case 11:
                px = cx + interpolate(tl, tr, threshold);
                py = cy + 0;
                contour.push({ x: px, y: py });
                px = cx + 1;
                py = cy + interpolate(tr, br, threshold);
                contour.push({ x: px, y: py });
                break;
            case 6: case 9:
                px = cx + interpolate(tl, tr, threshold);
                py = cy + 0;
                contour.push({ x: px, y: py });
                px = cx + interpolate(bl, br, threshold);
                py = cy + 1;
                contour.push({ x: px, y: py });
                break;
            case 7: case 8:
                px = cx + interpolate(tl, tr, threshold);
                py = cy + 0;
                contour.push({ x: px, y: py });
                px = cx + 0;
                py = cy + interpolate(tl, bl, threshold);
                contour.push({ x: px, y: py });
                break;
            case 5:
                px = cx + interpolate(tl, tr, threshold);
                py = cy + 0;
                contour.push({ x: px, y: py });
                px = cx + 1;
                py = cy + interpolate(tr, br, threshold);
                contour.push({ x: px, y: py });
                break;
            case 10:
                px = cx + 0;
                py = cy + interpolate(tl, bl, threshold);
                contour.push({ x: px, y: py });
                px = cx + interpolate(bl, br, threshold);
                py = cy + 1;
                contour.push({ x: px, y: py });
                break;
            default:
                break;
        }

        // Simple directional walk — move to next cell
        switch (config) {
            case 1: case 3: case 5: case 13: cx--; break;
            case 2: case 10: case 12: cy++; break;
            case 4: case 6: case 14: cx++; break;
            case 7: case 8: case 11: cy--; break;
            case 9: cy--; break;
            default: cx++; break;
        }
    }

    return contour;
}

/**
 * Generate a filled polygon (flood-fill style) for a layer between minH and maxH.
 * Returns the path of the layer outline suitable for drawing/export.
 */
export function getLayerOutline(
    grid: Float32Array,
    gridW: number,
    gridH: number,
    minThreshold: number,
    _maxThreshold: number,
    terrainW: number,
    terrainD: number
): Contour[] {
    const contours = marchingSquares(grid, gridW, gridH, minThreshold);
    // Scale contour points from grid space to real mm space
    const scaleX = terrainW / (gridW - 1);
    const scaleY = terrainD / (gridH - 1);
    return contours.map(c =>
        c.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }))
    );
}
