// The second tier of the Streams Standard.

import { describe, expect, test } from 'bun:test';

import { readableStreamClass } from './mock/host.js';
import { evaluate, intrinsics, sandbox } from './support/surface.js';

function surface() {
    return evaluate(
        sandbox({ ReadableStream: readableStreamClass(), TextEncoder, TextDecoder }),
        'streams'
    );
}

const host = surface();
const { ReadableStream, WritableStream, TransformStream } = host;
const { CountQueuingStrategy, ByteLengthQueuingStrategy } = host;
const { TextEncoderStream, TextDecoderStream } = host;
const { TypeError } = intrinsics(host);

function streamOf(values) {
    return new ReadableStream({
        start(controller) {
            for (const value of values) {
                controller.enqueue(value);
            }

            controller.close();
        },
    });
}

async function readAll(stream) {
    const reader = stream.getReader();
    const chunks = [];

    for (;;) {
        const { done, value } = await reader.read();

        if (done) {
            return chunks;
        }

        chunks.push(value);
    }
}

describe('WritableStream', () => {
    test('receives what is written', async () => {
        const written = [];
        const stream = new WritableStream({
            write(chunk) {
                written.push(chunk);
            },
        });
        const writer = stream.getWriter();
        await writer.write('a');
        await writer.close();

        expect(written).toEqual(['a']);
    });

    test('writes run in order, one at a time', async () => {
        const order = [];
        const stream = new WritableStream({
            async write(chunk) {
                await new Promise((resolve) => setTimeout(resolve, chunk === 'slow' ? 20 : 0));
                order.push(chunk);
            },
        });
        const writer = stream.getWriter();
        const first = writer.write('slow');
        const second = writer.write('fast');
        await Promise.all([first, second]);

        expect(order).toEqual(['slow', 'fast']);
    });

    test('reports locked while a writer is held', () => {
        const stream = new WritableStream();

        expect(stream.locked).toBe(false);
        stream.getWriter();
        expect(stream.locked).toBe(true);
    });

    test('refuses a second writer', () => {
        const stream = new WritableStream();
        stream.getWriter();

        expect(() => stream.getWriter()).toThrow(TypeError);
    });

    test('releaseLock unlocks the stream', () => {
        const stream = new WritableStream();
        stream.getWriter().releaseLock();

        expect(stream.locked).toBe(false);
    });

    test('calls close on the sink', async () => {
        let closed = false;
        const stream = new WritableStream({
            close() {
                closed = true;
            },
        });
        await stream.getWriter().close();

        expect(closed).toBe(true);
    });

    test('abort reaches the sink and refuses later writes', async () => {
        let reason = null;
        const stream = new WritableStream({
            abort(given) {
                reason = given;
            },
        });
        const writer = stream.getWriter();
        await writer.abort('stop');

        expect(reason).toBe('stop');
        await expect(writer.write('a')).rejects.toBeDefined();
    });

    test('a released writer refuses to write', async () => {
        const stream = new WritableStream();
        const writer = stream.getWriter();
        writer.releaseLock();

        await expect(writer.write('a')).rejects.toBeInstanceOf(TypeError);
    });
});

describe('TransformStream', () => {
    test('maps chunks through pipeThrough', async () => {
        const upper = new TransformStream({
            transform(chunk, controller) {
                controller.enqueue(chunk.toUpperCase());
            },
        });

        expect(await readAll(streamOf(['a', 'b']).pipeThrough(upper))).toEqual(['A', 'B']);
    });

    test('passes chunks through when it has no transform', async () => {
        expect(await readAll(streamOf(['a']).pipeThrough(new TransformStream()))).toEqual(['a']);
    });

    test('flush can enqueue a last chunk', async () => {
        const counted = new TransformStream({
            transform(chunk, controller) {
                controller.enqueue(chunk);
            },
            flush(controller) {
                controller.enqueue('end');
            },
        });

        expect(await readAll(streamOf(['a']).pipeThrough(counted))).toEqual(['a', 'end']);
    });

    test('terminate closes the readable side', async () => {
        const stopper = new TransformStream({
            transform(chunk, controller) {
                controller.enqueue(chunk);
                controller.terminate();
            },
        });

        expect(await readAll(streamOf(['a', 'b']).pipeThrough(stopper))).toEqual(['a']);
    });
});

describe('pipeTo', () => {
    test('drains into a writable', async () => {
        const written = [];
        await streamOf(['a', 'b']).pipeTo(
            new WritableStream({
                write(chunk) {
                    written.push(chunk);
                },
            })
        );

        expect(written).toEqual(['a', 'b']);
    });

    test('closes the destination', async () => {
        let closed = false;
        await streamOf(['a']).pipeTo(
            new WritableStream({
                close() {
                    closed = true;
                },
            })
        );

        expect(closed).toBe(true);
    });

    test('preventClose leaves the destination open', async () => {
        let closed = false;
        await streamOf(['a']).pipeTo(
            new WritableStream({
                close() {
                    closed = true;
                },
            }),
            { preventClose: true }
        );

        expect(closed).toBe(false);
    });

    test('unlocks both ends when it is done', async () => {
        const source = streamOf(['a']);
        const destination = new WritableStream();
        await source.pipeTo(destination);

        expect(source.locked).toBe(false);
        expect(destination.locked).toBe(false);
    });
});

describe('async iteration', () => {
    test('a stream is async iterable', () => {
        expect(typeof streamOf(['a'])[Symbol.asyncIterator]).toBe('function');
    });

    test('iterating yields every chunk', async () => {
        const seen = [];

        for await (const chunk of streamOf(['a', 'b'])) {
            seen.push(chunk);
        }

        expect(seen).toEqual(['a', 'b']);
    });

    test('breaking out cancels the stream', async () => {
        let cancelled = false;
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue('a');
                controller.enqueue('b');
            },
            cancel() {
                cancelled = true;
            },
        });

        for await (const chunk of stream) {
            expect(chunk).toBe('a');

            break;
        }

        expect(cancelled).toBe(true);
    });
});

describe('ReadableStream.from', () => {
    test('wraps an array', async () => {
        expect(await readAll(ReadableStream.from(['a', 'b']))).toEqual(['a', 'b']);
    });

    test('wraps an async iterable', async () => {
        async function* source() {
            yield 'a';
            yield 'b';
        }

        expect(await readAll(ReadableStream.from(source()))).toEqual(['a', 'b']);
    });
});

describe('the queuing strategies', () => {
    test('CountQueuingStrategy sizes everything as one', () => {
        const strategy = new CountQueuingStrategy({ highWaterMark: 3 });

        expect(strategy.highWaterMark).toBe(3);
        expect(strategy.size('anything')).toBe(1);
    });

    test('ByteLengthQueuingStrategy sizes by byteLength', () => {
        expect(new ByteLengthQueuingStrategy({ highWaterMark: 8 }).size(new Uint8Array(4))).toBe(4);
    });
});

describe('the text streams', () => {
    test('TextEncoderStream encodes a piped string', async () => {
        const chunks = await readAll(streamOf(['hi']).pipeThrough(new TextEncoderStream()));

        expect([...chunks[0]]).toEqual([104, 105]);
    });

    test('TextDecoderStream joins a sequence split across chunks', async () => {
        const source = streamOf([new Uint8Array([0xc3]), new Uint8Array([0xa9])]);
        const chunks = await readAll(source.pipeThrough(new TextDecoderStream()));

        expect(chunks.join('')).toBe('\u00e9');
    });

    test('TextDecoderStream emits a chunk as soon as it is complete', async () => {
        const source = streamOf([new Uint8Array([0x61]), new Uint8Array([0x62])]);
        const chunks = await readAll(source.pipeThrough(new TextDecoderStream()));

        expect(chunks).toEqual(['a', 'b']);
    });

    test('TextDecoderStream does not hold a complete stream back', async () => {
        const source = streamOf([new TextEncoder().encode('hello')]);
        const chunks = await readAll(source.pipeThrough(new TextDecoderStream()));

        expect(chunks).toEqual(['hello']);
    });
});
