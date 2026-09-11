// The DOM event core, against the DOM Standard.

import { describe, expect, test } from 'bun:test';

import { load } from './support/surface.js';

// The module reaches for console and queueMicrotask, which a host provides.
function surface() {
    const sandbox = load('events');

    sandbox.console = { error() {} };

    return sandbox;
}

const { Event, EventTarget, CustomEvent, ErrorEvent, MessageEvent, MessageChannel } = surface();

describe('Event', () => {
    test('exposes its type and defaults', () => {
        const event = new Event('ping');

        expect(event.type).toBe('ping');
        expect(event.bubbles).toBe(false);
        expect(event.cancelable).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    test('preventDefault sets defaultPrevented when cancelable', () => {
        const event = new Event('ping', { cancelable: true });
        event.preventDefault();

        expect(event.defaultPrevented).toBe(true);
    });

    test('preventDefault does nothing when it is not cancelable', () => {
        const event = new Event('ping');
        event.preventDefault();

        expect(event.defaultPrevented).toBe(false);
    });
});

describe('EventTarget', () => {
    test('dispatches to a listener', () => {
        const target = new EventTarget();
        let seen = null;
        target.addEventListener('ping', (event) => {
            seen = event.type;
        });
        target.dispatchEvent(new Event('ping'));

        expect(seen).toBe('ping');
    });

    test('calls listeners in order', () => {
        const target = new EventTarget();
        const order = [];
        target.addEventListener('ping', () => order.push(1));
        target.addEventListener('ping', () => order.push(2));
        target.dispatchEvent(new Event('ping'));

        expect(order).toEqual([1, 2]);
    });

    test('ignores a duplicate listener', () => {
        const target = new EventTarget();
        let fired = 0;
        const listener = () => {
            fired++;
        };
        target.addEventListener('ping', listener);
        target.addEventListener('ping', listener);
        target.dispatchEvent(new Event('ping'));

        expect(fired).toBe(1);
    });

    test('removeEventListener drops it', () => {
        const target = new EventTarget();
        let fired = 0;
        const listener = () => {
            fired++;
        };
        target.addEventListener('ping', listener);
        target.removeEventListener('ping', listener);
        target.dispatchEvent(new Event('ping'));

        expect(fired).toBe(0);
    });

    test('honours the once option', () => {
        const target = new EventTarget();
        let fired = 0;
        target.addEventListener(
            'ping',
            () => {
                fired++;
            },
            { once: true }
        );
        target.dispatchEvent(new Event('ping'));
        target.dispatchEvent(new Event('ping'));

        expect(fired).toBe(1);
    });

    test('accepts an object with handleEvent', () => {
        const target = new EventTarget();
        let seen = null;
        target.addEventListener('ping', {
            handleEvent(event) {
                seen = event.type;
            },
        });
        target.dispatchEvent(new Event('ping'));

        expect(seen).toBe('ping');
    });

    test('sets target and currentTarget while dispatching', () => {
        const target = new EventTarget();
        let seen = null;
        target.addEventListener('ping', (event) => {
            seen = [event.target === target, event.currentTarget === target];
        });
        target.dispatchEvent(new Event('ping'));

        expect(seen).toEqual([true, true]);
    });

    test('stopImmediatePropagation skips the listeners that follow', () => {
        const target = new EventTarget();
        const order = [];
        target.addEventListener('ping', (event) => {
            order.push(1);
            event.stopImmediatePropagation();
        });
        target.addEventListener('ping', () => order.push(2));
        target.dispatchEvent(new Event('ping'));

        expect(order).toEqual([1]);
    });

    test('a listener added while dispatching waits for the next event', () => {
        const target = new EventTarget();
        const order = [];
        target.addEventListener('ping', () => {
            order.push('first');
            target.addEventListener('ping', () => order.push('added'));
        });
        target.dispatchEvent(new Event('ping'));

        expect(order).toEqual(['first']);
    });

    test('dispatchEvent reports whether the default held', () => {
        const target = new EventTarget();
        target.addEventListener('ping', (event) => event.preventDefault());

        expect(target.dispatchEvent(new Event('ping', { cancelable: true }))).toBe(false);
        expect(target.dispatchEvent(new Event('pong'))).toBe(true);
    });

    test('a listener that throws does not stop the ones that follow', () => {
        const target = new EventTarget();
        const order = [];
        target.addEventListener('ping', () => {
            order.push(1);
            throw new Error('boom');
        });
        target.addEventListener('ping', () => order.push(2));
        target.dispatchEvent(new Event('ping'));

        expect(order).toEqual([1, 2]);
    });
});

describe('the event types', () => {
    test('CustomEvent carries a detail', () => {
        expect(new CustomEvent('ping', { detail: { a: 1 } }).detail.a).toBe(1);
    });

    test('CustomEvent defaults its detail to null', () => {
        expect(new CustomEvent('ping').detail).toBeNull();
    });

    test('ErrorEvent carries the error and its position', () => {
        const error = new Error('boom');
        const event = new ErrorEvent('error', { message: 'boom', lineno: 3, error });

        expect(event.message).toBe('boom');
        expect(event.lineno).toBe(3);
        expect(event.error).toBe(error);
    });

    test('MessageEvent carries its data', () => {
        expect(new MessageEvent('message', { data: 'ping' }).data).toBe('ping');
    });

    test('an event type is an Event', () => {
        expect(new CustomEvent('ping')).toBeInstanceOf(Event);
        expect(new MessageEvent('message')).toBeInstanceOf(Event);
    });
});

describe('MessageChannel', () => {
    test('delivers a message to the other port', async () => {
        const channel = new MessageChannel();
        const received = new Promise((resolve) => {
            channel.port2.onmessage = (event) => resolve(event.data);
        });
        channel.port1.postMessage('ping');
        channel.port2.start();

        expect(await received).toBe('ping');
    });

    test('delivery is never synchronous', () => {
        const channel = new MessageChannel();
        let seen = null;
        channel.port2.onmessage = (event) => {
            seen = event.data;
        };
        channel.port1.postMessage('ping');

        expect(seen).toBeNull();
    });

    test('a port holds its messages until it starts', async () => {
        const channel = new MessageChannel();
        const seen = [];
        channel.port2.addEventListener('message', (event) => seen.push(event.data));
        channel.port1.postMessage('one');
        channel.port1.postMessage('two');

        await Promise.resolve();
        expect(seen).toEqual([]);

        channel.port2.start();
        await Promise.resolve();
        expect(seen).toEqual(['one', 'two']);
    });

    test('onmessage replaces the previous handler', async () => {
        const channel = new MessageChannel();
        const seen = [];
        channel.port2.onmessage = () => seen.push('first');
        channel.port2.onmessage = (event) => seen.push(event.data);
        channel.port1.postMessage('ping');

        await Promise.resolve();
        expect(seen).toEqual(['ping']);
    });

    test('a closed port delivers nothing', async () => {
        const channel = new MessageChannel();
        const seen = [];
        channel.port2.onmessage = (event) => seen.push(event.data);
        channel.port2.close();
        channel.port1.postMessage('ping');

        await Promise.resolve();
        expect(seen).toEqual([]);
    });
});

describe('the global handler attributes', () => {
    test('exist on the global', () => {
        const sandbox = surface();

        expect('onerror' in sandbox).toBe(true);
        expect('onunhandledrejection' in sandbox).toBe(true);
        expect('onrejectionhandled' in sandbox).toBe(true);
    });

    test('hold what is assigned, and nothing else', () => {
        const sandbox = surface();
        const handler = () => {};
        sandbox.onerror = handler;

        expect(sandbox.onerror).toBe(handler);

        sandbox.onerror = 'not callable';
        expect(sandbox.onerror).toBeNull();
    });

    test('reportError reaches onerror', () => {
        const sandbox = surface();
        const seen = [];
        sandbox.onerror = (message) => seen.push(message);
        sandbox.reportError(new Error('boom'));

        expect(seen).toEqual(['boom']);
    });
});
