import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

import { nativeMock } from '../mock/native.js';

// Must match NATIVE_NAMESPACE in src/lib.rs.
const NATIVE_NAMESPACE = '__ow';

// A throwaway global, holding whatever the host is said to provide.
//
// It is a real context rather than an object passed as a parameter, so a bare
// identifier in a module resolves here instead of escaping to Bun's own
// globals: a module that writes `new Headers()` has to find the one this
// surface installed.
export function sandbox(globals = {}) {
    // Timers and the microtask queue come from the host everywhere the surface
    // runs, and parts of it lean on them: AbortSignal.timeout, and a message
    // port that never delivers synchronously.
    const box = createContext({ setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, ...globals });

    box[NATIVE_NAMESPACE] = nativeMock();

    return box;
}

// Evaluates modules into `box` the way a host does: a classic script, in order.
export function evaluate(box, ...names) {
    for (const name of names) {
        const path = new URL(`../../js/${name}.js`, import.meta.url);

        runInContext(readFileSync(path, 'utf8'), box, { filename: `js/${name}.js` });
    }

    return box;
}

export function load(...names) {
    return evaluate(sandbox(), ...names);
}

// The constructors of the sandbox's own realm. An assertion about what the
// surface built has to compare against these, not against Bun's.
export function intrinsics(box) {
    return runInContext('({ Error, TypeError, RangeError, Map, Uint8Array })', box);
}
