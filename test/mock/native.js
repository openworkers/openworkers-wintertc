// The native contract, answered in pure JavaScript, so the surface runs under
// Bun with no engine embedding.

// The components a host hands back for a parsed URL.
function parts(url) {
    return {
        href: url.href,
        origin: url.origin,
        protocol: url.protocol,
        username: url.username,
        password: url.password,
        host: url.host,
        hostname: url.hostname,
        port: url.port,
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
    };
}

// The URLPattern grammar belongs to the host, and standing in for it here
// would be writing the very parser the op exists to avoid. This covers the init
// form with literal segments, `:name` and `*`, which is enough to exercise the
// matching the module does; the grammar itself is judged by the conformance
// suite and by the crate upstream.
const COMPONENTS = ['protocol', 'username', 'password', 'hostname', 'port', 'pathname', 'search', 'hash'];

function component(pattern) {
    if (pattern === '*') {
        return {
            patternString: '*',
            regexpString: '^(.*)$',
            matcher: { prefix: '', suffix: '', kind: 'singleCapture', filter: null, allowEmpty: true },
            groupNameList: ['0'],
        };
    }

    if (!/[:*]/.test(pattern)) {
        return {
            patternString: pattern,
            regexpString: '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
            matcher: { prefix: '', suffix: '', kind: 'literal', literal: pattern },
            groupNameList: [],
        };
    }

    const names = [];
    const source = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
            names.push(name);

            return '([^/]+)';
        })
        .replace(/\*/g, '(.*)');

    return {
        patternString: pattern,
        regexpString: '^' + source + '$',
        matcher: { prefix: '', suffix: '', kind: 'regExp', regexp: source },
        groupNameList: names,
    };
}

const ops = {
    urlPatternParse(input, base) {
        if (typeof input === 'string' || base !== null) {
            return null;
        }

        const parsed = { hasRegexpGroups: false };

        for (const name of COMPONENTS) {
            parsed[name] = component(input[name] === undefined ? '*' : input[name]);
        }

        return parsed;
    },

    urlPatternProcessInput(input, base) {
        let url;

        try {
            url = base === null ? new URL(input) : new URL(input, base);
        } catch {
            return null;
        }

        return {
            protocol: url.protocol.replace(/:$/, ''),
            username: url.username,
            password: url.password,
            hostname: url.hostname,
            port: url.port,
            pathname: url.pathname,
            search: url.search.replace(/^\?/, ''),
            hash: url.hash.replace(/^#/, ''),
        };
    },

    textEncode(input) {
        return new TextEncoder().encode(String(input));
    },

    // The host hands the bytes back as they decode, mark included: dropping the
    // byte order mark is the module's job, and a mock that did it for free
    // would hide whether the module does it at all.
    textDecode(bytes, label, fatal) {
        return new TextDecoder(label, { fatal, ignoreBOM: true }).decode(bytes);
    },

    urlParse(input, base) {
        try {
            return parts(base === null ? new URL(input) : new URL(input, base));
        } catch {
            return null;
        }
    },

    // A WHATWG setter ignores a value it cannot apply, which is what the
    // platform setters below already do.
    urlUpdate(href, part, value) {
        let url;

        try {
            url = new URL(href);
        } catch {
            return null;
        }

        try {
            url[part] = value;
        } catch {
            // Left as it was, like the host does.
        }

        return parts(url);
    },
};

// `calls` is how a test catches a module that stops asking its host: v8 went
// from 46 to 68 of 68 on URL by handing the parsing to the `url` crate, and a
// module that reimplements it in JavaScript would undo that silently.
export function nativeMock() {
    const calls = [];
    const namespace = { calls };

    for (const [name, implementation] of Object.entries(ops)) {
        namespace[name] = (...args) => {
            calls.push({ name, args });

            return implementation(...args);
        };
    }

    return namespace;
}
