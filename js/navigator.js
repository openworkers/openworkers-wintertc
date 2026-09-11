// WinterTC Minimum Common API, `navigator`.
// https://min-common-api.proposal.wintertc.org/#navigator
//
// The user agent names the runtime, which is the one thing a shared surface
// cannot know about itself, so the host declares it.

(() => {
    'use strict';

    globalThis.navigator = {
        // Read at access time, never captured: under a snapshot the surface is
        // built before any host has said what it is.
        get userAgent() {
            return globalThis.__ow.userAgent || 'OpenWorkers/unknown';
        },
    };
})();
