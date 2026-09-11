import { readFileSync } from 'node:fs';

import { nativeMock } from '../mock/native.js';

// Must match NATIVE_NAMESPACE in src/lib.rs.
const NATIVE_NAMESPACE = '__ow';

// Loads modules into a throwaway global the way a host does, so the surface
// under test never touches Bun's own globals.
export function load(...names) {
    const sandbox = {};

    sandbox[NATIVE_NAMESPACE] = nativeMock();

    for (const name of names) {
        const path = new URL(`../../js/${name}.js`, import.meta.url);

        new Function('globalThis', readFileSync(path, 'utf8'))(sandbox);
    }

    return sandbox;
}
