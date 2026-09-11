// DOM Standard, the event core: `Event`, `EventTarget` and the event types the
// Minimum Common API asks for, plus the message channel that carries them.
// https://dom.spec.whatwg.org/#events

(() => {
    'use strict';

    const LISTENERS = Symbol('listeners');
    const STOPPED = Symbol('stopped');
    const HANDLERS = Symbol('handlers');

    // A listener argument is a function or an object with handleEvent.
    const callable = (listener) =>
        typeof listener === 'function' ? listener : listener && listener.handleEvent;

    class Event {
        constructor(type, options = {}) {
            this.type = String(type);
            this.bubbles = Boolean(options.bubbles);
            this.cancelable = Boolean(options.cancelable);
            this.composed = Boolean(options.composed);
            this.defaultPrevented = false;
            this.target = null;
            this.currentTarget = null;
            this.eventPhase = 0;
            this.timeStamp = Date.now();
            this[STOPPED] = false;
        }

        preventDefault() {
            if (this.cancelable) {
                this.defaultPrevented = true;
            }
        }

        stopPropagation() {
            this[STOPPED] = true;
        }

        stopImmediatePropagation() {
            this[STOPPED] = true;
        }
    }

    class EventTarget {
        constructor() {
            this[LISTENERS] = new Map();
        }

        addEventListener(type, listener, options = {}) {
            if (!callable(listener)) {
                return;
            }

            const key = String(type);
            const once = Boolean(options === true ? false : options.once);
            const existing = this[LISTENERS].get(key);

            if (!existing) {
                this[LISTENERS].set(key, [{ listener, once }]);

                return;
            }

            // The same listener registered twice for the same type counts once.
            if (existing.some((entry) => entry.listener === listener)) {
                return;
            }

            existing.push({ listener, once });
        }

        removeEventListener(type, listener) {
            const key = String(type);
            const existing = this[LISTENERS].get(key);

            if (!existing) {
                return;
            }

            this[LISTENERS].set(
                key,
                existing.filter((entry) => entry.listener !== listener)
            );
        }

        dispatchEvent(event) {
            const existing = this[LISTENERS].get(event.type) || [];

            event.target = this;
            event.currentTarget = this;
            event.eventPhase = 2;

            // A listener added while dispatching does not run for this event.
            for (const entry of [...existing]) {
                if (event[STOPPED]) {
                    break;
                }

                if (entry.once) {
                    this.removeEventListener(event.type, entry.listener);
                }

                try {
                    callable(entry.listener).call(this, event);
                } catch (error) {
                    globalThis.reportError(error);
                }
            }

            event.currentTarget = null;
            event.eventPhase = 0;

            return !event.defaultPrevented;
        }
    }

    // An `onfoo` property is one listener that a later assignment replaces.
    const handlerAccessor = (type) => ({
        configurable: true,
        enumerable: true,
        get() {
            const handlers = this[HANDLERS];

            return (handlers && handlers.get(type)) || null;
        },
        set(handler) {
            if (!this[HANDLERS]) {
                this[HANDLERS] = new Map();
            }

            const previous = this[HANDLERS].get(type);

            if (previous) {
                this.removeEventListener(type, previous);
            }

            if (callable(handler)) {
                this[HANDLERS].set(type, handler);
                this.addEventListener(type, handler);
            } else {
                this[HANDLERS].delete(type);
            }
        },
    });

    class CustomEvent extends Event {
        constructor(type, options = {}) {
            super(type, options);
            this.detail = options.detail === undefined ? null : options.detail;
        }
    }

    class ErrorEvent extends Event {
        constructor(type, options = {}) {
            super(type, options);
            this.message = options.message === undefined ? '' : String(options.message);
            this.filename = options.filename === undefined ? '' : String(options.filename);
            this.lineno = options.lineno === undefined ? 0 : options.lineno;
            this.colno = options.colno === undefined ? 0 : options.colno;
            this.error = options.error === undefined ? null : options.error;
        }
    }

    class MessageEvent extends Event {
        constructor(type, options = {}) {
            super(type, options);
            this.data = options.data === undefined ? null : options.data;
            this.origin = options.origin === undefined ? '' : String(options.origin);
            this.lastEventId = options.lastEventId === undefined ? '' : String(options.lastEventId);
            this.source = options.source === undefined ? null : options.source;
            this.ports = options.ports === undefined ? [] : [...options.ports];
        }
    }

    class PromiseRejectionEvent extends Event {
        constructor(type, options = {}) {
            super(type, options);
            this.promise = options.promise;
            this.reason = options.reason;
        }
    }

    const ENTANGLED = Symbol('entangled');
    const QUEUE = Symbol('queue');
    const STARTED = Symbol('started');

    class MessagePort extends EventTarget {
        constructor() {
            super();
            this[ENTANGLED] = null;
            this[QUEUE] = [];
            this[STARTED] = false;
        }

        postMessage(data) {
            const other = this[ENTANGLED];

            if (!other) {
                return;
            }

            other[QUEUE].push(data);
            deliver(other);
        }

        start() {
            this[STARTED] = true;
            deliver(this);
        }

        close() {
            const other = this[ENTANGLED];

            this[ENTANGLED] = null;
            this[QUEUE] = [];

            if (other) {
                other[ENTANGLED] = null;
            }
        }
    }

    const onmessage = handlerAccessor('message');

    Object.defineProperty(MessagePort.prototype, 'onmessage', {
        ...onmessage,
        set(handler) {
            onmessage.set.call(this, handler);
            // Assigning onmessage starts the port, as the standard asks.
            this.start();
        },
    });

    Object.defineProperty(MessagePort.prototype, 'onmessageerror', handlerAccessor('messageerror'));

    // Delivery is never synchronous with postMessage.
    const deliver = (port) => {
        if (!port[STARTED] || port[QUEUE].length === 0) {
            return;
        }

        const pending = port[QUEUE].splice(0);

        queueMicrotask(() => {
            for (const data of pending) {
                port.dispatchEvent(new MessageEvent('message', { data }));
            }
        });
    };

    class MessageChannel {
        constructor() {
            this.port1 = new MessagePort();
            this.port2 = new MessagePort();
            this.port1[ENTANGLED] = this.port2;
            this.port2[ENTANGLED] = this.port1;
        }
    }

    globalThis.Event = Event;
    globalThis.EventTarget = EventTarget;
    globalThis.CustomEvent = CustomEvent;
    globalThis.ErrorEvent = ErrorEvent;
    globalThis.MessageEvent = MessageEvent;
    globalThis.PromiseRejectionEvent = PromiseRejectionEvent;
    globalThis.MessagePort = MessagePort;
    globalThis.MessageChannel = MessageChannel;

    globalThis.reportError = function reportError(error) {
        const handler = globalThis.onerror;

        if (typeof handler === 'function') {
            handler.call(globalThis, String(error && error.message ? error.message : error));
        }

        globalThis.console.error(error);
    };

    // Nothing dispatches to these but reportError: there is no global error
    // pipeline in this surface yet.
    for (const name of ['onerror', 'onunhandledrejection', 'onrejectionhandled']) {
        let current = null;

        Object.defineProperty(globalThis, name, {
            configurable: true,
            enumerable: true,
            get: () => current,
            set: (handler) => {
                current = callable(handler) ? handler : null;
            },
        });
    }
})();
