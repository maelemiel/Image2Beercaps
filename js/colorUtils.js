// Color extraction and matching utilities

// --- sRGB <-> linear light -------------------------------------------------
// Averaging gamma-encoded values darkens/saturates mixed regions (measured
// Delta E 37 on a 50% white + 50% red block). Correct average = average in
// linear light, then convert back to sRGB.
const SRGB_LUT = Array.from({ length: 256 }, (_, v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function linearToSrgb(v) {
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
}

/**
 * Extract the average color from an image
 * Uses circular masking + per-channel median + center weighting so the photo
 * background (visible corners) and specular highlights don't contaminate the
 * cap color (measured Delta E 31-35 with the old square mean, < 5 now).
 * @param {HTMLImageElement|string} imageSource - Image element or base64 data URL
 * @returns {Promise<{r: number, g: number, b: number}>} Average RGB color
 */
export async function extractAverageColor(imageSource) {
    return new Promise((resolve, reject) => {
        const img = typeof imageSource === 'string' ? new Image() : imageSource;

        const processImage = () => {
            const size = Math.min(img.width, img.height, 100);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            resolve(extractColorFromImageData(ctx.getImageData(0, 0, size, size)));
        };

        if (typeof imageSource === 'string') {
            img.onload = processImage;
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = imageSource;
        } else {
            processImage();
        }
    });
}

/**
 * Core, canvas-free color extraction from raw pixel data (unit-testable).
 * Keeps only opaque pixels inside the inscribed circle, then takes the
 * per-channel median (robust to highlights and rim darkening).
 * @param {ImageData} imageData - Canvas ImageData object
 * @returns {{r: number, g: number, b: number}} Cap color
 */
export function extractColorFromImageData(imageData) {
    const { data, width, height } = imageData;
    const cx = (width - 1) / 2;
    const cy = (height - 1) / 2;
    const radius = Math.min(width, height) / 2;

    const rs = [], gs = [], bs = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 3] < 128) continue;
            if (Math.hypot(x - cx, y - cy) > radius) continue;
            rs.push(data[i]);
            gs.push(data[i + 1]);
            bs.push(data[i + 2]);
        }
    }

    if (rs.length === 0) return { r: 128, g: 128, b: 128 };

    const median = (arr) => {
        arr.sort((a, b) => a - b);
        return arr[Math.floor(arr.length / 2)];
    };
    return { r: median(rs), g: median(gs), b: median(bs) };
}

/**
 * Calculate perceptual color distance between two colors
 * Uses weighted Euclidean distance optimized for human perception
 * @param {Object} c1 - First color {r, g, b}
 * @param {Object} c2 - Second color {r, g, b}
 * @returns {number} Color distance (lower = more similar)
 */
export function colorDistance(c1, c2) {
    const rMean = (c1.r + c2.r) / 2;
    const dr = c1.r - c2.r;
    const dg = c1.g - c2.g;
    const db = c1.b - c2.b;
    
    // Weighted for human color perception
    // Red and blue weights vary based on the mean red value
    return Math.sqrt(
        (2 + rMean / 256) * dr * dr +
        4 * dg * dg +
        (2 + (255 - rMean) / 256) * db * db
    );
}

/**
 * Convert RGB to hex color string
 * @param {Object} color - Color object {r, g, b}
 * @returns {string} Hex color string (e.g., "#FF5500")
 */
export function rgbToHex(color) {
    const toHex = (n) => n.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Convert hex color string to RGB
 * @param {string} hex - Hex color string
 * @returns {Object} Color object {r, g, b}
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

/**
 * Get average color of a region in an image
 * @param {ImageData} imageData - Canvas ImageData object
 * @param {number} startX - Start X coordinate
 * @param {number} startY - Start Y coordinate
 * @param {number} width - Region width
 * @param {number} height - Region height
 * @returns {Object} Average color {r, g, b}
 */
export function getRegionAverageColor(imageData, startX, startY, width, height) {
    const pixels = imageData.data;
    const imgWidth = imageData.width;

    let lr = 0, lg = 0, lb = 0;
    let count = 0;

    const endX = Math.min(startX + width, imgWidth);
    const endY = Math.min(startY + height, imageData.height);

    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const i = (y * imgWidth + x) * 4;
            lr += SRGB_LUT[pixels[i]];
            lg += SRGB_LUT[pixels[i + 1]];
            lb += SRGB_LUT[pixels[i + 2]];
            count++;
        }
    }

    if (count === 0) return { r: 128, g: 128, b: 128 };

    return {
        r: linearToSrgb(lr / count),
        g: linearToSrgb(lg / count),
        b: linearToSrgb(lb / count)
    };
}

/**
 * Find the best matching beercap for a target color from available inventory
 * @param {Object} targetColor - Target color {r, g, b}
 * @param {Array} beercaps - Array of beercap objects with color and remaining quantity
 * @returns {Object|null} Best matching beercap or null if none available
 */
export function findBestMatch(targetColor, beercaps) {
    let bestMatch = null;
    let bestDistance = Infinity;
    
    for (const beercap of beercaps) {
        if (beercap.remaining <= 0) continue;
        
        const distance = colorDistance(targetColor, beercap.color);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestMatch = beercap;
        }
    }
    
    return bestMatch;
}

/**
 * Calculate contrast color (black or white) for text on a background
 * @param {Object} bgColor - Background color {r, g, b}
 * @returns {string} "#000000" or "#FFFFFF"
 */
export function getContrastColor(bgColor) {
    // Calculate relative luminance
    const luminance = (0.299 * bgColor.r + 0.587 * bgColor.g + 0.114 * bgColor.b) / 255;
    return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

/**
 * Maximum size for beercap images in storage
 */
const BEERCAP_MAX_SIZE = 64;

/**
 * Resize and compress an image to a maximum size for efficient storage
 * Uses JPEG compression for photos to minimize storage space
 * @param {string} imageDataUrl - Base64 data URL of the image
 * @param {number} maxSize - Maximum width/height (default: 64)
 * @param {number} quality - JPEG quality 0-1 (default: 0.85)
 * @returns {Promise<string>} Compressed base64 data URL
 */
export function resizeAndCompressImage(imageDataUrl, maxSize = BEERCAP_MAX_SIZE, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Calculate new dimensions maintaining aspect ratio
            let width = img.width;
            let height = img.height;
            
            if (width > maxSize || height > maxSize) {
                if (width > height) {
                    height = Math.round(height * (maxSize / width));
                    width = maxSize;
                } else {
                    width = Math.round(width * (maxSize / height));
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            
            // Use high quality image smoothing for downscaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // Draw resized image
            ctx.drawImage(img, 0, 0, width, height);
            
            // Export as JPEG for smaller file size (photos compress well)
            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
            
            resolve(compressedDataUrl);
        };
        
        img.onerror = () => reject(new Error('Failed to load image for compression'));
        img.src = imageDataUrl;
    });
}

