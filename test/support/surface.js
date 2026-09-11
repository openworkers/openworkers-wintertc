import { readFileSync } from 'node:fs';

import { nativeMock } from '../mock/native.js';

// Must match NATIVE_NAMESPACE in src/lib.rs.
const NATIVE_NAMESPACE = '__ow';

// A throwaway global, holding whatever the host is said to provide.
export function sandbox(globals = {}) {
    const box = { ...globals };

    box[NATIVE_NAMESPACE] = nativeMock();

    return box;
}

// Evaluates modules into `box` the way a host does, so the surface under test
// never touches Bun's own globals.
export function evaluate(box, ...names) {
    for (const name of names) {
        const path = new URL(`../../js/${name}.js`, import.meta.url);

        // Running it as a classic script with a global of our choosing is the
        // point: it is what the host does.
        new Function('globalThis', readFileSync(path, 'utf8'))(box);
    }

    return box;
}

export function load(...names) {
    return evaluate(sandbox(), ...names);
}
