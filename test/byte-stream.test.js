// The byte tier of the Streams Standard.

import { describe, expect, test } from 'bun:test';

import { evaluate, intrinsics, sandbox } from './support/surface.js';

function surface() {
    return evaluate(
        sandbox({ TextEncoder, TextDecoder }),
        'events',
        'abort',
        'readable-stream',
        'byte-stream'
    );
}

const box = surface();
const { ReadableStream, ReadableStreamBYOBReader, ReadableByteStreamController } = box;
const { TypeError: BoxTypeError, Uint8Array: BoxUint8Array } = intrinsics(box);

const byteStream = (...chunks) =>
    new ReadableStream({
        type: 'bytes',
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(chunk);
            }

            controller.close();
        },
    });

describe('what the mode selects', () => {
    test('a byte stream gives a byob reader', () => {
        const reader = byteStream().getReader({ mode: 'byob' });

        expect(reader instanceof ReadableStreamBYOBReader).toBe(true);
    });

    test('a default stream refuses a byob reader', () => {
        const stream = new ReadableStream({ start() {} });

        expect(() => stream.getReader({ mode: 'byob' })).toThrow(BoxTypeError);
    });

    test('an unknown mode is refused', () => {
        expect(() => byteStream().getReader({ mode: 'bytes' })).toThrow(BoxTypeError);
    });

    test('no mode still gives the default reader', () => {
        const reader = byteStream().getReader();

        expect(reader instanceof ReadableStreamBYOBReader).toBe(false);
    });

    test('a byte stream gets a byte controller', () => {
        let seen = null;

        new ReadableStream({
            type: 'bytes',
            start(controller) {
                seen = controller;
            },
        });

        expect(seen instanceof ReadableByteStreamController).toBe(true);
    });
});

describe('reading into the buffer the consumer owns', () => {
    test('the supplied view is what comes back filled', async () => {
        const reader = byteStream(new Uint8Array([1, 2, 3, 4])).getReader({ mode: 'byob' });
        const { done, value } = await reader.read(new Uint8Array(4));

        expect(done).toBe(false);
        expect(Array.from(value)).toEqual([1, 2, 3, 4]);
    });

    test('the caller view detaches, as a transfer does', async () => {
        const reader = byteStream(new Uint8Array([9])).getReader({ mode: 'byob' });
        const view = new Uint8Array(1);

        const { value } = await reader.read(view);

        expect(view.byteLength).toBe(0);
        expect(value.byteLength).toBe(1);
    });

    test('a chunk larger than the view leaves the rest queued', async () => {
        const reader = byteStream(new Uint8Array([1, 2, 3, 4, 5])).getReader({ mode: 'byob' });

        const first = await reader.read(new Uint8Array(2));
        expect(Array.from(first.value)).toEqual([1, 2]);

        const second = await reader.read(new Uint8Array(2));
        expect(Array.from(second.value)).toEqual([3, 4]);

        const third = await reader.read(new Uint8Array(2));
        expect(Array.from(third.value)).toEqual([5]);
    });

    test('a closed stream answers done with an empty view', async () => {
        const reader = byteStream().getReader({ mode: 'byob' });
        const { done, value } = await reader.read(new Uint8Array(4));

        expect(done).toBe(true);
        expect(value.byteLength).toBe(0);
    });

    test('an empty view is refused', async () => {
        const reader = byteStream().getReader({ mode: 'byob' });

        await expect(reader.read(new Uint8Array(0))).rejects.toThrow(BoxTypeError);
    });

    test('a chunk that is not a BufferSource is refused', () => {
        expect(() =>
            new ReadableStream({
                type: 'bytes',
                start(controller) {
                    controller.enqueue('text');
                },
            })
        ).toThrow();
    });
});

describe('what the producer sees', () => {
    test('a byob request carries the view to fill', async () => {
        let filled = null;

        const stream = new ReadableStream({
            type: 'bytes',
            pull(controller) {
                const request = controller.byobRequest;
                filled = request === null ? null : request.view.byteLength;

                request.view.set([7, 7]);
                request.respond(2);
            },
        });

        const { value } = await stream.getReader({ mode: 'byob' }).read(new Uint8Array(4));

        expect(filled).toBe(4);
        expect(Array.from(value)).toEqual([7, 7]);
    });

    test('respond refuses more bytes than the view holds', async () => {
        let thrown = null;

        const stream = new ReadableStream({
            type: 'bytes',
            pull(controller) {
                try {
                    controller.byobRequest.respond(99);
                } catch (err) {
                    thrown = err.constructor.name;
                    controller.close();
                }
            },
        });

        await stream.getReader({ mode: 'byob' }).read(new Uint8Array(2));

        expect(thrown).toBe('RangeError');
    });

    test('a request answered twice is refused', async () => {
        let thrown = null;

        const stream = new ReadableStream({
            type: 'bytes',
            pull(controller) {
                const request = controller.byobRequest;
                request.respond(0);

                try {
                    request.respond(0);
                } catch (err) {
                    thrown = err.constructor.name;
                }

                controller.close();
            },
        });

        await stream.getReader({ mode: 'byob' }).read(new Uint8Array(2));

        expect(thrown).toBe('TypeError');
    });

    test('a refused answer leaves the request answerable', async () => {
        const seen = [];

        const stream = new ReadableStream({
            type: 'bytes',
            pull(controller) {
                const request = controller.byobRequest;

                try {
                    request.respond(99);
                } catch (err) {
                    seen.push(err.constructor.name);
                }

                request.view.set([5]);
                request.respond(1);
            },
        });

        const { value } = await stream.getReader({ mode: 'byob' }).read(new Uint8Array(2));

        expect(seen).toEqual(['RangeError']);
        expect(Array.from(value)).toEqual([5]);
    });

    test('answering over a foreign buffer is refused', async () => {
        const seen = [];

        const stream = new ReadableStream({
            type: 'bytes',
            pull(controller) {
                try {
                    controller.byobRequest.respondWithNewView(new Uint8Array(2));
                } catch (err) {
                    seen.push(err.constructor.name);
                }

                controller.close();
            },
        });

        await stream.getReader({ mode: 'byob' }).read(new Uint8Array(2));

        expect(seen).toEqual(['RangeError']);
    });

    test('a pull with nobody waiting sees no byob request', () => {
        let seen = 'unset';

        new ReadableStream({
            type: 'bytes',
            start(controller) {
                seen = controller.byobRequest;
            },
        });

        expect(seen).toBe(null);
    });
});
