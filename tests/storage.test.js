import { describe, it, expect, beforeEach } from 'vitest';
import {
    getBeercaps, saveBeercaps, addBeercap, updateBeercap, deleteBeercap,
    generateId, getTotalBeercapCount, clearAllBeercaps,
} from '../js/storage.js';

const cap = (over = {}) => ({
    id: generateId(),
    name: 'Test Cap',
    color: { r: 1, g: 2, b: 3 },
    quantity: 4,
    imageData: 'data:image/png;base64,xxx',
    ...over,
});

beforeEach(() => localStorage.clear());

describe('storage round-trip', () => {
    it('adds and reads back a cap with all fields intact', () => {
        const c = cap();
        addBeercap(c);
        const all = getBeercaps();
        expect(all).toHaveLength(1);
        expect(all[0]).toEqual(c);
    });

    it('survives a cap without imageData (color-only caps)', () => {
        const c = cap({ imageData: null });
        addBeercap(c);
        expect(getBeercaps()[0].imageData).toBeNull();
    });

    it('updates quantity and name by id', () => {
        const c = cap();
        addBeercap(c);
        updateBeercap(c.id, { quantity: 10, name: 'Renamed' });
        const updated = getBeercaps()[0];
        expect(updated.quantity).toBe(10);
        expect(updated.name).toBe('Renamed');
    });

    it('deletes by id', () => {
        const a = cap(), b = cap();
        addBeercap(a); addBeercap(b);
        deleteBeercap(a.id);
        expect(getBeercaps()).toHaveLength(1);
        expect(getBeercaps()[0].id).toBe(b.id);
    });

    it('counts total caps as sum of quantities', () => {
        addBeercap(cap({ quantity: 7 }));
        addBeercap(cap({ quantity: 5 }));
        expect(getTotalBeercapCount()).toBe(12);
    });

    it('clears everything', () => {
        addBeercap(cap());
        clearAllBeercaps();
        expect(getBeercaps()).toHaveLength(0);
    });
});

describe('generateId', () => {
    it('produces unique ids', () => {
        const ids = new Set(Array.from({ length: 200 }, () => generateId()));
        expect(ids.size).toBe(200);
    });
});
