// Minimal localStorage mock for node test environment
class LocalStorageMock {
    constructor() { this.store = new Map(); }
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
    setItem(k, v) { this.store.set(k, String(v)); }
    removeItem(k) { this.store.delete(k); }
    clear() { this.store.clear(); }
}
globalThis.localStorage = new LocalStorageMock();
