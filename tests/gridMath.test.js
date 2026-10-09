import { describe, it, expect } from 'vitest';
import {
    calculateGridDimensions, calculateCustomGridDimensions, calculateHexTotalCells,
} from '../js/gridMath.js';

describe('calculateGridDimensions (characterization, moved from gridGenerator)', () => {
    it('square: total cells never exceed available caps', () => {
        for (const totalCaps of [1, 10, 100, 500, 2500]) {
            const d = calculateGridDimensions(totalCaps, 4000, 3000, 'square');
            expect(d.totalCells).toBeLessThanOrEqual(totalCaps);
            expect(d.layout).toBe('square');
            expect(d.width).toBeGreaterThanOrEqual(1);
            expect(d.height).toBeGreaterThanOrEqual(1);
        }
    });

    it('hex: total cells never exceed available caps', () => {
        for (const totalCaps of [1, 10, 100, 500, 2500]) {
            const d = calculateGridDimensions(totalCaps, 4000, 3000, 'hex');
            expect(d.totalCells).toBeLessThanOrEqual(totalCaps);
            expect(d.layout).toBe('hex');
        }
    });

    it('square: respects landscape aspect ratio (wider than tall)', () => {
        const d = calculateGridDimensions(10000, 2000, 1000, 'square');
        expect(d.width).toBeGreaterThan(d.height);
    });

    it('square: respects portrait aspect ratio (taller than wide)', () => {
        const d = calculateGridDimensions(10000, 1000, 2000, 'square');
        expect(d.height).toBeGreaterThan(d.width);
    });

    it('hex: for a square image, grid is wider in cells than square layout (rows are visually shorter)', () => {
        const total = 400;
        const sq = calculateGridDimensions(total, 1000, 1000, 'square');
        const hx = calculateGridDimensions(total, 1000, 1000, 'hex');
        expect(hx.width).toBeGreaterThanOrEqual(sq.width);
        expect(hx.height).toBeLessThanOrEqual(sq.height);
    });
});

describe('calculateHexTotalCells', () => {
    it('is width * height (all rows same width)', () => {
        expect(calculateHexTotalCells(5, 4)).toBe(20);
        expect(calculateHexTotalCells(1, 1)).toBe(1);
    });
});

describe('calculateCustomGridDimensions', () => {
    it('builds the exact grid asked for', () => {
        const d = calculateCustomGridDimensions(30, 20, 'hex', 1000);
        expect(d).toEqual({ width: 30, height: 20, totalCells: 600, layout: 'hex', needsMoreCaps: false });
    });

    it('floors fractional inputs', () => {
        const d = calculateCustomGridDimensions(10.9, 5.2, 'square', 999);
        expect(d.width).toBe(10);
        expect(d.height).toBe(5);
        expect(d.totalCells).toBe(50);
    });

    it('flags when the grid needs more caps than available', () => {
        const d = calculateCustomGridDimensions(30, 20, 'square', 599);
        expect(d.needsMoreCaps).toBe(true);
        expect(d.totalCells).toBe(600);
    });

    it('rejects zero or negative dimensions', () => {
        expect(() => calculateCustomGridDimensions(0, 10)).toThrow(/positive/i);
        expect(() => calculateCustomGridDimensions(10, -2)).toThrow(/positive/i);
    });

    it('rejects non-numeric input', () => {
        expect(() => calculateCustomGridDimensions('abc', 10)).toThrow(/positive/i);
        expect(() => calculateCustomGridDimensions(NaN, 10)).toThrow(/positive/i);
    });

    it('rejects unknown layouts', () => {
        expect(() => calculateCustomGridDimensions(10, 10, 'circle')).toThrow(/layout/i);
    });

    it('defaults layout to hex and totalCaps to unlimited', () => {
        const d = calculateCustomGridDimensions(10, 10);
        expect(d.layout).toBe('hex');
        expect(d.needsMoreCaps).toBe(false);
    });
});
