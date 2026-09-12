// High Resolution Time, the `Performance` interface.
// https://w3c.github.io/hr-time/
//
// The host owns the clock: `now` counts from the moment the worker started, and
// `timeOrigin` places that moment on the wall clock.

(() => {
    'use strict';

    globalThis.Performance = class Performance {
        get timeOrigin() {
            return globalThis.__ow.timeOrigin;
        }

        now() {
            return globalThis.__ow.performanceNow();
        }
    };

    globalThis.performance = new globalThis.Performance();
})();
