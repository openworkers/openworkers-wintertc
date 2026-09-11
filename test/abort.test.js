// `AbortController`, `AbortSignal` and `DOMException`, against the DOM Standard.

import { describe, expect, test } from 'bun:test';

import { intrinsics, load } from './support/surface.js';

// AbortSignal extends EventTarget, so the event core loads with it.
function surface() {
    const sandbox = load('events', 'abort');

    sandbox.console = { error() {} };

    return sandbox;
}

const box = surface();
const { AbortController, AbortSignal, DOMException, Event } = box;
const { Error } = intrinsics(box);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AbortController', () => {
    test('exposes a signal that starts unaborted', () => {
        const controller = new AbortController();

        expect(controller.signal).toBeInstanceOf(AbortSignal);
        expect(controller.signal.aborted).toBe(false);
    });

    test('abort flips the signal', () => {
        const controller = new AbortController();
        controller.abort();

        expect(controller.signal.aborted).toBe(true);
    });

    test('the reason defaults to an AbortError', () => {
        const controller = new AbortController();
        controller.abort();

        expect(controller.signal.reason).toBeInstanceOf(DOMException);
        expect(controller.signal.reason.name).toBe('AbortError');
    });

    test('abort takes a reason', () => {
        const controller = new AbortController();
        controller.abort('because');

        expect(controller.signal.reason).toBe('because');
    });

    test('abort fires an abort event, once', () => {
        const controller = new AbortController();
        let fired = 0;
        controller.signal.addEventListener('abort', () => {
            fired++;
        });
        controller.abort();
        controller.abort();

        expect(fired).toBe(1);
    });

    test('a second abort keeps the first reason', () => {
        const controller = new AbortController();
        controller.abort('first');
        controller.abort('second');

        expect(controller.signal.reason).toBe('first');
    });
});

describe('AbortSignal', () => {
    test('is an EventTarget, so listeners take options', () => {
        const controller = new AbortController();
        let fired = 0;
        controller.signal.addEventListener(
            'abort',
            () => {
                fired++;
            },
            { once: true }
        );
        controller.signal.dispatchEvent(new Event('abort'));
        controller.signal.dispatchEvent(new Event('abort'));

        expect(fired).toBe(1);
    });

    test('onabort fires on abort', () => {
        const controller = new AbortController();
        let fired = false;
        controller.signal.onabort = () => {
            fired = true;
        };
        controller.abort();

        expect(fired).toBe(true);
    });

    test('onabort replaces the previous handler', () => {
        const controller = new AbortController();
        const seen = [];
        controller.signal.onabort = () => seen.push('first');
        controller.signal.onabort = () => seen.push('second');
        controller.abort();

        expect(seen).toEqual(['second']);
    });

    test('removeEventListener drops the listener', () => {
        const controller = new AbortController();
        let fired = false;
        const listener = () => {
            fired = true;
        };
        controller.signal.addEventListener('abort', listener);
        controller.signal.removeEventListener('abort', listener);
        controller.abort();

        expect(fired).toBe(false);
    });

    test('throwIfAborted throws the reason, and nothing before', () => {
        const controller = new AbortController();
        controller.signal.throwIfAborted();
        controller.abort('stop');

        expect(() => controller.signal.throwIfAborted()).toThrow('stop');
    });

    test('abort returns an aborted signal', () => {
        expect(AbortSignal.abort().aborted).toBe(true);
        expect(AbortSignal.abort().reason.name).toBe('AbortError');
        expect(AbortSignal.abort('why').reason).toBe('why');
    });

    test('timeout aborts after the delay', async () => {
        const signal = AbortSignal.timeout(10);

        expect(signal.aborted).toBe(false);
        await delay(40);
        expect(signal.aborted).toBe(true);
        expect(signal.reason.name).toBe('TimeoutError');
    });
});

describe('AbortSignal.any', () => {
    test('aborts with the first signal to abort', () => {
        const first = new AbortController();
        const second = new AbortController();
        const combined = AbortSignal.any([first.signal, second.signal]);

        expect(combined.aborted).toBe(false);
        second.abort('second');
        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe('second');
    });

    test('is already aborted when one of them is', () => {
        const combined = AbortSignal.any([AbortSignal.abort('done'), new AbortController().signal]);

        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe('done');
    });

    test('keeps the first reason when the others follow', () => {
        const first = new AbortController();
        const second = new AbortController();
        const combined = AbortSignal.any([first.signal, second.signal]);

        first.abort('first');
        second.abort('second');

        expect(combined.reason).toBe('first');
    });

    test('an empty list never aborts', () => {
        expect(AbortSignal.any([]).aborted).toBe(false);
    });
});

describe('DOMException', () => {
    test('carries a message and a name', () => {
        const error = new DOMException('boom', 'DataError');

        expect(error.name).toBe('DataError');
        expect(error.message).toBe('boom');
        expect(error).toBeInstanceOf(Error);
    });

    test('defaults its name to Error', () => {
        expect(new DOMException('boom').name).toBe('Error');
    });
});
