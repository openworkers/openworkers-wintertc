// URL Standard, the `URL` and `URLSearchParams` interfaces.
// https://url.spec.whatwg.org/
//
// The parser is the host's: a JavaScript reimplementation of WHATWG parsing is
// a known way to score in the eighties and be wrong in the corners.

(() => {
    const STATE = Symbol('urlState');
    const PARAMS = Symbol('urlSearchParams');
    const PAIRS = Symbol('pairs');
    const OWNER = Symbol('owner');

    // In urlencoded, '+' is a space. Percent-decoding must not fail, so a
    // malformed input is decoded byte by byte and left to TextDecoder.
    const decode = (input) => {
        const plussed = input.replace(/\+/g, ' ');

        try {
            return decodeURIComponent(plussed);
        } catch {
            const encoder = new TextEncoder();
            const bytes = [];

            for (let i = 0; i < plussed.length; i++) {
                const hex = plussed.slice(i + 1, i + 3);

                if (plussed[i] === '%' && /^[0-9a-fA-F]{2}$/.test(hex)) {
                    bytes.push(parseInt(hex, 16));
                    i += 2;
                } else {
                    bytes.push(...encoder.encode(plussed[i]));
                }
            }

            return new TextDecoder().decode(new Uint8Array(bytes));
        }
    };

    // The urlencoded safe set is narrower than encodeURIComponent's, and
    // a space serializes as '+'.
    const encode = (input) => encodeURIComponent(input)
        .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%20/g, '+');

    const parsePairs = (input) => {
        const pairs = [];
        const query = input.charAt(0) === '?' ? input.slice(1) : input;

        for (const part of query.split('&')) {
            if (!part) {
                continue;
            }

            const eq = part.indexOf('=');
            const name = eq === -1 ? part : part.slice(0, eq);
            const value = eq === -1 ? '' : part.slice(eq + 1);

            pairs.push([decode(name), decode(value)]);
        }

        return pairs;
    };

    const parseUrl = (input, base) => __urlParse(
        String(input),
        base === undefined || base === null ? null : String(base)
    );

    const setPart = (url, part, value) => {
        const next = __urlUpdate(url[STATE].href, part, String(value));

        if (next === null) {
            return;
        }

        url[STATE] = next;

        if (url[PARAMS]) {
            url[PARAMS][PAIRS] = parsePairs(next.search);
        }
    };

    // Only href has to follow: the pairs are already what we just serialized.
    const syncOwner = (params) => {
        const owner = params[OWNER];

        if (!owner) {
            return;
        }

        const next = __urlUpdate(owner[STATE].href, 'search', params.toString());

        if (next !== null) {
            owner[STATE] = next;
        }
    };

    class URLSearchParams {
        constructor(init) {
            this[PAIRS] = [];
            this[OWNER] = null;

            if (init === undefined || init === null) {
                return;
            }

            if (typeof init === 'string') {
                this[PAIRS] = parsePairs(init);
            } else if (init instanceof URLSearchParams) {
                this[PAIRS] = init[PAIRS].map(([name, value]) => [name, value]);
            } else if (typeof init[Symbol.iterator] === 'function') {
                for (const pair of init) {
                    const entry = Array.from(pair);

                    if (entry.length !== 2) {
                        throw new TypeError('URLSearchParams init must hold [name, value] pairs');
                    }

                    this[PAIRS].push([String(entry[0]), String(entry[1])]);
                }
            } else {
                for (const name of Object.keys(init)) {
                    this[PAIRS].push([name, String(init[name])]);
                }
            }
        }

        get size() {
            return this[PAIRS].length;
        }

        append(name, value) {
            this[PAIRS].push([String(name), String(value)]);
            syncOwner(this);
        }

        delete(name, value) {
            const key = String(name);
            const target = value === undefined ? undefined : String(value);

            this[PAIRS] = this[PAIRS].filter(([n, v]) => n !== key || (target !== undefined && v !== target));
            syncOwner(this);
        }

        get(name) {
            const key = String(name);
            const hit = this[PAIRS].find(([n]) => n === key);

            return hit === undefined ? null : hit[1];
        }

        getAll(name) {
            const key = String(name);

            return this[PAIRS].filter(([n]) => n === key).map(([, v]) => v);
        }

        has(name, value) {
            const key = String(name);
            const target = value === undefined ? undefined : String(value);

            return this[PAIRS].some(([n, v]) => n === key && (target === undefined || v === target));
        }

        set(name, value) {
            const key = String(name);
            const next = String(value);
            const index = this[PAIRS].findIndex(([n]) => n === key);

            if (index === -1) {
                this[PAIRS].push([key, next]);
            } else {
                this[PAIRS][index] = [key, next];
                this[PAIRS] = this[PAIRS].filter(([n], i) => n !== key || i === index);
            }

            syncOwner(this);
        }

        sort() {
            this[PAIRS].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
            syncOwner(this);
        }

        toString() {
            return this[PAIRS]
                .map(([name, value]) => encode(name) + '=' + encode(value))
                .join('&');
        }

        *entries() {
            for (const [name, value] of this[PAIRS]) {
                yield [name, value];
            }
        }

        *keys() {
            for (const [name] of this[PAIRS]) {
                yield name;
            }
        }

        *values() {
            for (const [, value] of this[PAIRS]) {
                yield value;
            }
        }

        forEach(callback, thisArg) {
            for (const [name, value] of this[PAIRS]) {
                callback.call(thisArg, value, name, this);
            }
        }

        [Symbol.iterator]() {
            return this.entries();
        }
    }

    class URL {
        constructor(input, base) {
            const state = parseUrl(input, base);

            if (state === null) {
                throw new TypeError(`Invalid URL: ${String(input)}`);
            }

            this[STATE] = state;
            this[PARAMS] = null;
        }

        static canParse(input, base) {
            return parseUrl(input, base) !== null;
        }

        static parse(input, base) {
            const state = parseUrl(input, base);

            return state === null ? null : new URL(state.href);
        }

        get href() { return this[STATE].href; }
        set href(value) {
            const state = parseUrl(value, null);

            if (state === null) {
                throw new TypeError(`Invalid URL: ${String(value)}`);
            }

            this[STATE] = state;

            if (this[PARAMS]) {
                this[PARAMS][PAIRS] = parsePairs(state.search);
            }
        }

        get origin() { return this[STATE].origin; }

        get protocol() { return this[STATE].protocol; }
        set protocol(value) { setPart(this, 'protocol', value); }

        get username() { return this[STATE].username; }
        set username(value) { setPart(this, 'username', value); }

        get password() { return this[STATE].password; }
        set password(value) { setPart(this, 'password', value); }

        get host() { return this[STATE].host; }
        set host(value) { setPart(this, 'host', value); }

        get hostname() { return this[STATE].hostname; }
        set hostname(value) { setPart(this, 'hostname', value); }

        get port() { return this[STATE].port; }
        set port(value) { setPart(this, 'port', value); }

        get pathname() { return this[STATE].pathname; }
        set pathname(value) { setPart(this, 'pathname', value); }

        get search() { return this[STATE].search; }
        set search(value) { setPart(this, 'search', value); }

        get hash() { return this[STATE].hash; }
        set hash(value) { setPart(this, 'hash', value); }

        get searchParams() {
            if (!this[PARAMS]) {
                const params = new URLSearchParams(this[STATE].search);
                params[OWNER] = this;
                this[PARAMS] = params;
            }

            return this[PARAMS];
        }

        toString() { return this[STATE].href; }

        toJSON() { return this[STATE].href; }
    }

    globalThis.URL = URL;
    globalThis.URLSearchParams = URLSearchParams;
})();
