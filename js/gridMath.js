// Pure grid math — no browser, GPU or WASM access, fully unit-testable.
// Extracted from gridGenerator.js (which re-exports these for compatibility).

export const HEX_VERTICAL_FACTOR = 0.866;

/**
 * Calculate optimal grid dimensions based on total caps and image aspect ratio
 * @param {number} totalCaps - Total available beercaps
 * @param {number} imageWidth - Original image width
 * @param {number} imageHeight - Original image height
 * @param {string} layout - 'square' or 'hex'
 * @returns {Object} Grid dimensions {width, height, totalCells, layout}
 */
export function calculateGridDimensions(totalCaps, imageWidth, imageHeight, layout = 'hex') {
    const aspectRatio = imageWidth / imageHeight;

    if (layout === 'hex') {
        // In hexagonal packing:
        // - Rows are packed tighter vertically (factor of ~0.866)
        // - Even rows are offset, so effective aspect ratio changes
        // - We need to account for the visual aspect ratio being different from grid aspect ratio

        // Adjust aspect ratio for hex packing visual appearance
        const visualAspectRatio = aspectRatio / HEX_VERTICAL_FACTOR;

        let gridWidth = Math.sqrt(totalCaps * visualAspectRatio);
        let gridHeight = Math.sqrt(totalCaps / visualAspectRatio);

        gridWidth = Math.floor(gridWidth);
        gridHeight = Math.floor(gridHeight);

        gridWidth = Math.max(1, gridWidth);
        gridHeight = Math.max(1, gridHeight);

        // Calculate total cells accounting for hex layout
        // In hex, we can fit more rows in the same vertical space
        // Adjust to maximize usage without exceeding
        while (calculateHexTotalCells(gridWidth + 1, gridHeight) <= totalCaps) {
            gridWidth++;
        }
        while (calculateHexTotalCells(gridWidth, gridHeight + 1) <= totalCaps) {
            gridHeight++;
        }

        return {
            width: gridWidth,
            height: gridHeight,
            totalCells: calculateHexTotalCells(gridWidth, gridHeight),
            layout: 'hex'
        };
    } else {
        // Square grid - original logic
        let gridWidth = Math.sqrt(totalCaps * aspectRatio);
        let gridHeight = Math.sqrt(totalCaps / aspectRatio);

        gridWidth = Math.floor(gridWidth);
        gridHeight = Math.floor(gridHeight);

        gridWidth = Math.max(1, gridWidth);
        gridHeight = Math.max(1, gridHeight);

        while ((gridWidth + 1) * gridHeight <= totalCaps) {
            gridWidth++;
        }
        while (gridWidth * (gridHeight + 1) <= totalCaps) {
            gridHeight++;
        }

        return {
            width: gridWidth,
            height: gridHeight,
            totalCells: gridWidth * gridHeight,
            layout: 'square'
        };
    }
}

/**
 * Calculate total cells in a hexagonal grid
 * Even rows (0-indexed: 0, 2, 4...) have full width, odd rows have full width too
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @returns {number} Total cells
 */
export function calculateHexTotalCells(width, height) {
    // All rows have the same width in our implementation
    return width * height;
}

/**
 * Build an exact user-defined grid (custom size/shape rectangle)
 * @param {number} width - Grid width in cells
 * @param {number} height - Grid height in cells
 * @param {string} layout - 'square' or 'hex'
 * @param {number} totalCaps - Available caps, used only to flag a shortage
 * @returns {Object} {width, height, totalCells, layout, needsMoreCaps}
 */
export function calculateCustomGridDimensions(width, height, layout = 'hex', totalCaps = Infinity) {
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));

    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
        throw new Error('Grid dimensions must be positive integers');
    }
    if (layout !== 'hex' && layout !== 'square') {
        throw new Error("Layout must be 'hex' or 'square'");
    }

    const totalCells = w * h;
    return {
        width: w,
        height: h,
        totalCells,
        layout,
        needsMoreCaps: totalCells > totalCaps,
    };
}
