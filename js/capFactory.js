// Factory for declaring a beercap by color, without a photo.
import { hexToRgb } from './colorUtils.js';
import { generateId } from './storage.js';

/**
 * Create a beercap object from a plain color declaration
 * @param {Object} params
 * @param {string} params.name - Display name (e.g. "Heineken green")
 * @param {string} params.hex - Hex color, with or without '#', case-insensitive
 * @param {number} params.quantity - How many caps you own (>= 0)
 * @returns {Object} beercap {id, name, color, quantity, imageData: null}
 * @throws {Error} with a user-readable message on invalid input
 */
export function createCapFromColor({ name, hex, quantity }) {
    const cleanName = String(name ?? '').trim();
    if (!cleanName) {
        throw new Error('Name is required');
    }

    const color = hexToRgb(String(hex ?? ''));
    if (!color) {
        throw new Error('Invalid color: expected a hex value like #AABBCC');
    }

    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty < 0) {
        throw new Error('Quantity must be a number >= 0');
    }

    return {
        id: generateId(),
        name: cleanName,
        color,
        quantity: qty,
        imageData: null,
    };
}
