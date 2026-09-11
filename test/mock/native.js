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

const ops = {
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
