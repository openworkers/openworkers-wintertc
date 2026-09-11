// Fetch Standard, the `Headers` interface.
// https://fetch.spec.whatwg.org/#headers-class
//
// `_map` is read by the host to lift response headers out of the guest, so its
// shape is part of the contract: a Map keyed by the lowercased name, holding a
// string, or an array of strings for a header kept apart.

(function () {
    'use strict';

    // https://fetch.spec.whatwg.org/#header-name
    const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

    const SURROUNDING_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

    const FORBIDDEN_IN_VALUE = /[\0\n\r]/;

    // Apart so the host emits one line per value, which the standard only asks
    // for set-cookie.
    const KEPT_APART = ['set-cookie', 'www-authenticate', 'proxy-authenticate'];

    function normalizeName(name) {
        const key = String(name).toLowerCase();

        if (!NAME.test(key)) {
            throw new TypeError("'" + key + "' is not a valid header name");
        }

        return key;
    }

    function normalizeValue(value) {
        const normalized = String(value).replace(SURROUNDING_WHITESPACE, '');

        if (FORBIDDEN_IN_VALUE.test(normalized)) {
            throw new TypeError('the header value holds a forbidden character');
        }

        return normalized;
    }

    globalThis.Headers = class Headers {
        constructor(init) {
            this._map = new Map();

            if (!init) {
                return;
            }

            if (init instanceof Headers || Array.isArray(init)) {
                for (const [name, value] of init) {
                    this.append(name, value);
                }
            } else if (typeof init === 'object') {
                for (const name of Object.keys(init)) {
                    this.append(name, init[name]);
                }
            }
        }

        append(name, value) {
            const key = normalizeName(name);
            const normalized = normalizeValue(value);

            if (!this._map.has(key)) {
                this._map.set(key, normalized);

                return;
            }

            const existing = this._map.get(key);

            if (!KEPT_APART.includes(key)) {
                this._map.set(key, existing + ', ' + normalized);
            } else if (Array.isArray(existing)) {
                existing.push(normalized);
            } else {
                this._map.set(key, [existing, normalized]);
            }
        }

        delete(name) {
            this._map.delete(normalizeName(name));
        }

        get(name) {
            const value = this._map.get(normalizeName(name));

            if (value === undefined) {
                return null;
            }

            // Every value comma-joined, set-cookie included; getSetCookie is
            // what keeps those reachable one by one.
            return Array.isArray(value) ? value.join(', ') : value;
        }

        has(name) {
            return this._map.has(normalizeName(name));
        }

        set(name, value) {
            this._map.set(normalizeName(name), normalizeValue(value));
        }

        // https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
        *entries() {
            for (const key of [...this._map.keys()].sort()) {
                const value = this._map.get(key);

                if (Array.isArray(value)) {
                    for (const one of value) {
                        yield [key, one];
                    }
                } else {
                    yield [key, value];
                }
            }
        }

        *keys() {
            for (const [key] of this.entries()) {
                yield key;
            }
        }

        *values() {
            for (const [, value] of this.entries()) {
                yield value;
            }
        }

        forEach(callback, thisArg) {
            for (const [key, value] of this.entries()) {
                callback.call(thisArg, value, key, this);
            }
        }

        [Symbol.iterator]() {
            return this.entries();
        }

        getSetCookie() {
            const value = this._map.get('set-cookie');

            if (value === undefined) {
                return [];
            }

            return Array.isArray(value) ? [...value] : [value];
        }
    };
})();
