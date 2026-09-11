// Fetch Standard, the `Headers` interface.
// https://fetch.spec.whatwg.org/#headers-class
//
// `_map` is read by the host to lift response headers out of the guest, so its
// shape is part of the contract: a Map keyed by the lowercased name, holding a
// string, or an array of strings for a header kept apart.

globalThis.Headers = class Headers {
    constructor(init) {
        this._map = new Map();

        if (init) {
            if (init instanceof Headers) {
                // Copy from another Headers object - use entries() to get all values
                for (const [key, value] of init.entries()) {
                    this.append(key, value);
                }
            } else if (Array.isArray(init)) {
                // Array of [key, value] pairs
                for (const [key, value] of init) {
                    this.append(key, value);
                }
            } else if (typeof init === 'object') {
                // Plain object
                for (const key of Object.keys(init)) {
                    this.append(key, init[key]);
                }
            }
        }
    }

    // Normalize header name (lowercase)
    _normalizeKey(name) {
        return String(name).toLowerCase();
    }

    append(name, value) {
        const key = this._normalizeKey(name);
        const strValue = String(value);

        // Special headers that must not be combined with comma separation
        const specialHeaders = ['set-cookie', 'www-authenticate', 'proxy-authenticate'];
        const isSpecial = specialHeaders.includes(key);

        if (this._map.has(key)) {
            const existing = this._map.get(key);
            if (isSpecial) {
                // Store as array
                if (Array.isArray(existing)) {
                    existing.push(strValue);
                } else {
                    this._map.set(key, [existing, strValue]);
                }
            } else {
                // Combine with comma separator for regular headers
                this._map.set(key, existing + ', ' + strValue);
            }
        } else {
            // First value - store as-is (string)
            this._map.set(key, strValue);
        }
    }

    delete(name) {
        this._map.delete(this._normalizeKey(name));
    }

    get(name) {
        const value = this._map.get(this._normalizeKey(name));
        if (value === undefined) return null;
        // If it's an array (special headers), return the first value
        return Array.isArray(value) ? value[0] : value;
    }

    has(name) {
        return this._map.has(this._normalizeKey(name));
    }

    set(name, value) {
        this._map.set(this._normalizeKey(name), String(value));
    }

    // Iteration methods
    *entries() {
        for (const [key, value] of this._map) {
            if (Array.isArray(value)) {
                // Yield each array value as a separate entry
                for (const v of value) {
                    yield [key, v];
                }
            } else {
                yield [key, value];
            }
        }
    }

    *keys() {
        for (const [key, value] of this._map) {
            if (Array.isArray(value)) {
                // Yield the key multiple times for array values
                for (let i = 0; i < value.length; i++) {
                    yield key;
                }
            } else {
                yield key;
            }
        }
    }

    *values() {
        for (const value of this._map.values()) {
            if (Array.isArray(value)) {
                yield* value;
            } else {
                yield value;
            }
        }
    }

    forEach(callback, thisArg) {
        for (const [key, value] of this._map) {
            if (Array.isArray(value)) {
                for (const v of value) {
                    callback.call(thisArg, v, key, this);
                }
            } else {
                callback.call(thisArg, value, key, this);
            }
        }
    }

    // Make Headers iterable
    [Symbol.iterator]() {
        return this.entries();
    }

    // getSetCookie returns all Set-Cookie headers as array
    getSetCookie() {
        const value = this._map.get('set-cookie');
        if (!value) return [];
        // If it's already an array (multiple set-cookie headers), return it
        // Otherwise wrap single value in array
        return Array.isArray(value) ? value : [value];
    }
};
