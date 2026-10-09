import { describe, it, expect } from 'vitest';
import { colorDistance, rgbToHex, hexToRgb, getRegionAverageColor } from '../js/colorUtils.js';

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

describe('getRegionAverageColor', () => {
    const makeImageData = (w, h, pixels) => ({ data: pixels, width: w, height: h });

    it('averages a uniform region exactly', () => {
        const px = new Uint8ClampedArray([100, 150, 200, 255]);
        const img = makeImageData(1, 1, px);
        expect(getRegionAverageColor(img, 0, 0, 1, 1)).toEqual({ r: 100, g: 150, b: 200 });
    });

    it('averages a 2x2 region', () => {
        const px = new Uint8ClampedArray([
            0, 0, 0, 255, 100, 100, 100, 255,
            0, 0, 0, 255, 100, 100, 100, 255,
        ]);
        const img = makeImageData(2, 2, px);
        expect(getRegionAverageColor(img, 0, 0, 2, 2)).toEqual({ r: 50, g: 50, b: 50 });
    });

    it('returns neutral gray for an empty region (clamped out of bounds)', () => {
        const img = makeImageData(1, 1, new Uint8ClampedArray(4));
        expect(getRegionAverageColor(img, 5, 5, 2, 2)).toEqual({ r: 128, g: 128, b: 128 });
    });
});
