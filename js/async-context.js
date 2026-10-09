// TC39 AsyncContext (stage 2), and Node's AsyncLocalStorage on top of it.
// https://github.com/tc39/proposal-async-context
// https://nodejs.org/api/async_context.html#class-asynclocalstorage
//
// The current context is a frame: a Map from each Variable to its value,
// never changed once it is current. The host keeps the current frame and
// carries it to promise reactions and await continuations. Each of its own
// asynchronous callbacks has to restore the frame of the code that
// registered it.

(() => {
    'use strict';

    // Read at call time: under a snapshot the host's ops come later.
    const frame = () => globalThis.__ow.asyncContextGet();
    const enter = (next) => globalThis.__ow.asyncContextSet(next);

    // Runs fn in `next` and comes back to the frame it found, whatever fn does.
    function within(next, fn, args) {
        const previous = frame();

        enter(next);

        try {
            return fn(...args);
        } finally {
            enter(previous);
        }
    }

    function withValue(variable, value) {
        const next = new Map(frame() ?? []);
        next.set(variable, value);

        return next;
    }

    class Variable {
        #name;
        #defaultValue;

        constructor(options = {}) {
            this.#name = options.name === undefined ? '' : String(options.name);
            this.#defaultValue = options.defaultValue;
        }

        get name() {
            return this.#name;
        }

        get() {
            const current = frame();

            return current !== undefined && current.has(this) ? current.get(this) : this.#defaultValue;
        }

        run(value, fn, ...args) {
            return within(withValue(this, value), fn, args);
        }
    }

    class Snapshot {
        #frame;

        constructor() {
            this.#frame = frame();
        }

        run(fn, ...args) {
            return within(this.#frame, fn, args);
        }

        static wrap(fn) {
            if (typeof fn !== 'function') {
                throw new TypeError('Snapshot.wrap expects a function');
            }

            const snapshot = new Snapshot();

            return function wrapped(...args) {
                return snapshot.run(() => fn.apply(this, args));
            };
        }
    }

    class AsyncLocalStorage {
        #variable = new Variable({ name: 'AsyncLocalStorage' });

        run(store, fn, ...args) {
            return this.#variable.run(store, fn, ...args);
        }

        getStore() {
            return this.#variable.get();
        }

        exit(fn, ...args) {
            return this.#variable.run(undefined, fn, ...args);
        }

        // For the rest of the current execution and what it schedules, as in
        // Node. The host clears the frame at the start of each event.
        enterWith(store) {
            enter(withValue(this.#variable, store));
        }

        disable() {
            this.enterWith(undefined);
        }

        static bind(fn) {
            return Snapshot.wrap(fn);
        }

        static snapshot() {
            const snapshot = new Snapshot();

            return (fn, ...args) => snapshot.run(fn, ...args);
        }
    }

    globalThis.AsyncContext = Object.freeze({ Variable, Snapshot });
    globalThis.AsyncLocalStorage = AsyncLocalStorage;
})();
