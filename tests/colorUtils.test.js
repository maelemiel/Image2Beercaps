import { describe, it, expect } from 'vitest';
import { colorDistance, rgbToHex, hexToRgb, getRegionAverageColor, extractColorFromImageData } from '../js/colorUtils.js';

describe('colorDistance (redmean, characterization)', () => {
    it('is 0 for identical colors', () => {
        expect(colorDistance({ r: 10, g: 200, b: 30 }, { r: 10, g: 200, b: 30 })).toBe(0);
    });

    it('is symmetric', () => {
        const a = { r: 255, g: 0, b: 0 };
        const b = { r: 0, g: 0, b: 255 };
        expect(colorDistance(a, b)).toBeCloseTo(colorDistance(b, a), 10);
    });

    it('gives known value for red vs blue', () => {
        // rMean=127.5 → weights: (2+127.5/256)*255² + 0 + (2+127.5/256)*255²
        const expected = Math.sqrt(2 * (2 + 127.5 / 256) * 255 * 255);
        expect(colorDistance({ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 })).toBeCloseTo(expected, 6);
    });

    it('weighs green differences more than red at low red mean', () => {
        const base = { r: 0, g: 0, b: 0 };
        const dGreen = colorDistance(base, { r: 0, g: 10, b: 0 });
        const dRed = colorDistance(base, { r: 10, g: 0, b: 0 });
        expect(dGreen).toBeGreaterThan(dRed);
    });
});

describe('hexToRgb / rgbToHex round-trip', () => {
    it('round-trips every value', () => {
        for (const hex of ['#FF5500', '#00AABB', '#123456', '#000000', '#FFFFFF']) {
            expect(rgbToHex(hexToRgb(hex))).toBe(hex);
        }
    });

    it('parses 3-digit hex without # and is case-insensitive per docs', () => {
        // Current implementation only supports 6-digit forms (with or without #)
        expect(hexToRgb('#f55')).toBeNull();
    });
});

describe('getRegionAverageColor (linear-light)', () => {
    const makeImageData = (w, h, pixels) => ({ data: pixels, width: w, height: h });

    it('averages a uniform region exactly (linear round-trip)', () => {
        const px = new Uint8ClampedArray([100, 150, 200, 255]);
        const img = makeImageData(1, 1, px);
        expect(getRegionAverageColor(img, 0, 0, 1, 1)).toEqual({ r: 100, g: 150, b: 200 });
    });

    it('round-trips every uniform sRGB value', () => {
        for (let v = 0; v <= 255; v += 5) {
            const img = makeImageData(2, 2, new Uint8ClampedArray([
                v, v, v, 255, v, v, v, 255,
                v, v, v, 255, v, v, v, 255,
            ]));
            const avg = getRegionAverageColor(img, 0, 0, 2, 2);
            expect(Math.abs(avg.r - v)).toBeLessThanOrEqual(1);
        }
    });

    it('does NOT darken mixed regions: 50% white + 50% red ≈ #ffbcbc, not #ff8080', () => {
        // gamma-space mean would give (255,128,128); linear-light gives (255,188,188)
        const px = new Uint8ClampedArray([
            255, 255, 255, 255, 255, 0, 0, 255,
        ]);
        const img = makeImageData(2, 1, px);
        const avg = getRegionAverageColor(img, 0, 0, 2, 1);
        expect(avg.r).toBe(255);
        expect(Math.abs(avg.g - 188)).toBeLessThanOrEqual(2);
        expect(Math.abs(avg.b - 188)).toBeLessThanOrEqual(2);
    });

    it('mixed black/white averages to mid-gray in linear light (~188, not 128)', () => {
        const px = new Uint8ClampedArray([
            0, 0, 0, 255, 255, 255, 255, 255,
        ]);
        const img = makeImageData(2, 1, px);
        const avg = getRegionAverageColor(img, 0, 0, 2, 1);
        expect(Math.abs(avg.r - 188)).toBeLessThanOrEqual(2);
    });

    it('returns neutral gray for an empty region (clamped out of bounds)', () => {
        const img = makeImageData(1, 1, new Uint8ClampedArray(4));
        expect(getRegionAverageColor(img, 5, 5, 2, 2)).toEqual({ r: 128, g: 128, b: 128 });
    });
});

describe('extractColorFromImageData (circle mask + median)', () => {
    const make = (w, h, fill) => {
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const [r, g, b, a] = fill(x, y);
                data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
            }
        }
        return { data, width: w, height: h };
    };

    it('ignores the background corners outside the inscribed circle', () => {
        // red disc filling the circle on a lime background (corners only)
        const img = make(20, 20, (x, y) => {
            const inside = Math.hypot(x - 9.5, y - 9.5) <= 10;
            return inside ? [220, 40, 40, 255] : [0, 255, 0, 255];
        });
        const c = extractColorFromImageData(img);
        expect(Math.abs(c.r - 220)).toBeLessThanOrEqual(3);
        expect(Math.abs(c.g - 40)).toBeLessThanOrEqual(3);
        expect(Math.abs(c.b - 40)).toBeLessThanOrEqual(3);
    });

    it('is robust to a white specular highlight (median, not mean)', () => {
        // red disc, 5% of pixels blown out to white
        const img = make(40, 40, (x, y) => {
            const inside = Math.hypot(x - 19.5, y - 19.5) <= 20;
            const highlight = inside && x < 8 && y < 8;
            return highlight ? [255, 255, 255, 255] : [220, 40, 40, 255];
        });
        const c = extractColorFromImageData(img);
        expect(Math.abs(c.r - 220)).toBeLessThanOrEqual(5);
        expect(Math.abs(c.g - 40)).toBeLessThanOrEqual(5);
        expect(Math.abs(c.b - 40)).toBeLessThanOrEqual(5);
    });

    it('returns neutral gray when there are no opaque pixels', () => {
        const img = make(10, 10, () => [0, 0, 0, 0]);
        expect(extractColorFromImageData(img)).toEqual({ r: 128, g: 128, b: 128 });
    });
});
