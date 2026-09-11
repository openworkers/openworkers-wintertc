// DOM Standard, `AbortController`, `AbortSignal` and `DOMException`.
// https://dom.spec.whatwg.org/#aborting-ongoing-activities

(() => {
    'use strict';

    const SIGNAL_ABORT = Symbol('signalAbort');
    const ONABORT = Symbol('onabort');

    class DOMException extends Error {
        constructor(message, name) {
            super(message);
            this.name = name || 'Error';
        }
    }

    class AbortSignal extends globalThis.EventTarget {
        constructor() {
            super();
            this.aborted = false;
            this.reason = undefined;
        }

        throwIfAborted() {
            if (this.aborted) {
                throw this.reason;
            }
        }

        [SIGNAL_ABORT](reason) {
            if (this.aborted) {
                return;
            }

            this.aborted = true;
            this.reason = reason;
            this.dispatchEvent(new globalThis.Event('abort'));
        }

        static abort(reason) {
            const signal = new AbortSignal();

            signal[SIGNAL_ABORT](reason === undefined ? new DOMException('Aborted', 'AbortError') : reason);

            return signal;
        }

        static timeout(ms) {
            const signal = new AbortSignal();

            setTimeout(() => {
                signal[SIGNAL_ABORT](new DOMException('Timeout', 'TimeoutError'));
            }, ms);

            return signal;
        }

        static any(signals) {
            const combined = new AbortSignal();

            for (const signal of signals) {
                if (signal.aborted) {
                    combined[SIGNAL_ABORT](signal.reason);

                    return combined;
                }
            }

            for (const signal of signals) {
                signal.addEventListener(
                    'abort',
                    () => {
                        combined[SIGNAL_ABORT](signal.reason);
                    },
                    { once: true }
                );
            }

            return combined;
        }
    }

    // One listener that a later assignment replaces.
    Object.defineProperty(AbortSignal.prototype, 'onabort', {
        configurable: true,
        enumerable: true,
        get() {
            return this[ONABORT] || null;
        },
        set(handler) {
            if (this[ONABORT]) {
                this.removeEventListener('abort', this[ONABORT]);
            }

            this[ONABORT] = typeof handler === 'function' ? handler : null;

            if (this[ONABORT]) {
                this.addEventListener('abort', this[ONABORT]);
            }
        },
    });

    class AbortController {
        constructor() {
            this.signal = new AbortSignal();
        }

        abort(reason) {
            this.signal[SIGNAL_ABORT](
                reason === undefined ? new DOMException('Aborted', 'AbortError') : reason
            );
        }
    }

    globalThis.DOMException = DOMException;
    globalThis.AbortSignal = AbortSignal;
    globalThis.AbortController = AbortController;
})();
