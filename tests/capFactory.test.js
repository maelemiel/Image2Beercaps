import { describe, it, expect } from 'vitest';
import { createCapFromColor } from '../js/capFactory.js';

describe('createCapFromColor', () => {
    it('creates a cap from a name, hex color and quantity', () => {
        const cap = createCapFromColor({ name: 'Heineken green', hex: '#00FF00', quantity: 12 });
        expect(cap.name).toBe('Heineken green');
        expect(cap.color).toEqual({ r: 0, g: 255, b: 0 });
        expect(cap.quantity).toBe(12);
        expect(cap.imageData).toBeNull();
        expect(typeof cap.id).toBe('string');
        expect(cap.id.length).toBeGreaterThan(0);
    });

    it('accepts hex without # and uppercase', () => {
        const cap = createCapFromColor({ name: 'Corona', hex: 'AB12CD', quantity: 1 });
        expect(cap.color).toEqual({ r: 171, g: 18, b: 205 });
    });

    it('trims the name', () => {
        const cap = createCapFromColor({ name: '  Leffe  ', hex: '#ffffff', quantity: 3 });
        expect(cap.name).toBe('Leffe');
    });

    it('rejects an empty name', () => {
        expect(() => createCapFromColor({ name: '   ', hex: '#ffffff', quantity: 3 }))
            .toThrow(/name/i);
    });

    it('rejects an invalid hex color', () => {
        expect(() => createCapFromColor({ name: 'X', hex: 'nope', quantity: 3 })).toThrow(/color/i);
        expect(() => createCapFromColor({ name: 'X', hex: '#12345', quantity: 3 })).toThrow(/color/i);
    });

    it('rejects a negative or non-numeric quantity', () => {
        expect(() => createCapFromColor({ name: 'X', hex: '#ffffff', quantity: -1 })).toThrow(/quantity/i);
        expect(() => createCapFromColor({ name: 'X', hex: '#ffffff', quantity: 'abc' })).toThrow(/quantity/i);
    });

    it('accepts quantity 0 (cap seen but out of stock)', () => {
        const cap = createCapFromColor({ name: 'X', hex: '#ffffff', quantity: 0 });
        expect(cap.quantity).toBe(0);
    });

    it('floors a fractional quantity', () => {
        const cap = createCapFromColor({ name: 'X', hex: '#ffffff', quantity: 4.7 });
        expect(cap.quantity).toBe(4);
    });
});
