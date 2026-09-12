// Streams Standard, the second tier: everything that stands on a readable
// stream rather than being one.
// https://streams.spec.whatwg.org/
//
// `ReadableStream` stays with the host, which backs it with its own channel;
// this module adds what the standard builds on top of it, and extends its
// prototype with the members that need a writable side to exist.

(() => {
    'use strict';

    const STATE = Symbol('state');
    const SINK = Symbol('sink');
    const WRITER = Symbol('writer');
    const STREAM = Symbol('stream');
    const QUEUE = Symbol('queue');
    const ERROR = Symbol('error');
    const CONTROLLER = Symbol('controller');
    const WRITE = Symbol('write');

    class WritableStreamDefaultController {
        constructor(stream) {
            this[STREAM] = stream;
        }

        error(reason) {
            this[STREAM][ERROR] = reason;
            this[STREAM][STATE] = 'errored';
        }
    }

    class WritableStream {
        constructor(sink = {}, strategy = {}) {
            this[SINK] = sink;
            this[STATE] = 'writable';
            this[ERROR] = undefined;
            this[WRITER] = null;
            this[CONTROLLER] = new WritableStreamDefaultController(this);

            // Writes run one at a time, in the order they were made.
            this[QUEUE] = Promise.resolve(
                sink.start ? sink.start(this[CONTROLLER]) : undefined
            );

            this.highWaterMark = strategy.highWaterMark === undefined ? 1 : strategy.highWaterMark;
        }

        get locked() {
            return this[WRITER] !== null;
        }

        getWriter() {
            if (this[WRITER]) {
                throw new TypeError('WritableStream is locked to a writer');
            }

            this[WRITER] = new WritableStreamDefaultWriter(this);

            return this[WRITER];
        }

        abort(reason) {
            if (this[STATE] !== 'writable') {
                return Promise.resolve();
            }

            this[STATE] = 'errored';
            this[ERROR] = reason;

            return Promise.resolve(this[SINK].abort ? this[SINK].abort(reason) : undefined);
        }

        close() {
            if (this[STATE] !== 'writable') {
                return Promise.reject(new TypeError('WritableStream is not writable'));
            }

            this[QUEUE] = this[QUEUE].then(() =>
                this[SINK].close ? this[SINK].close() : undefined
            );
            this[STATE] = 'closed';

            return this[QUEUE];
        }

        [WRITE](chunk) {
            if (this[STATE] !== 'writable') {
                return Promise.reject(this[ERROR] || new TypeError('WritableStream is not writable'));
            }

            this[QUEUE] = this[QUEUE].then(() =>
                this[SINK].write ? this[SINK].write(chunk, this[CONTROLLER]) : undefined
            );

            return this[QUEUE];
        }
    }

    class WritableStreamDefaultWriter {
        constructor(stream) {
            this[STREAM] = stream;
        }

        get desiredSize() {
            return this[STREAM] ? this[STREAM].highWaterMark : null;
        }

        get ready() {
            return Promise.resolve();
        }

        get closed() {
            return this[STREAM] ? this[STREAM][QUEUE] : Promise.resolve();
        }

        write(chunk) {
            if (!this[STREAM]) {
                return Promise.reject(new TypeError('Writer is released'));
            }

            return this[STREAM][WRITE](chunk);
        }

        close() {
            if (!this[STREAM]) {
                return Promise.reject(new TypeError('Writer is released'));
            }

            return this[STREAM].close();
        }

        abort(reason) {
            if (!this[STREAM]) {
                return Promise.reject(new TypeError('Writer is released'));
            }

            return this[STREAM].abort(reason);
        }

        releaseLock() {
            if (!this[STREAM]) {
                return;
            }

            this[STREAM][WRITER] = null;
            this[STREAM] = null;
        }
    }

    class TransformStreamDefaultController {
        constructor(readableController) {
            this[CONTROLLER] = readableController;
        }

        get desiredSize() {
            return this[CONTROLLER].desiredSize;
        }

        enqueue(chunk) {
            this[CONTROLLER].enqueue(chunk);
        }

        error(reason) {
            this[CONTROLLER].error(reason);
        }

        terminate() {
            this[CONTROLLER].close();
        }
    }

    class TransformStream {
        constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
            let readableController = null;

            // The host calls start synchronously, so the controller is in hand
            // before the constructor returns.
            this.readable = new globalThis.ReadableStream({
                start(controller) {
                    readableController = controller;
                },
                cancel(reason) {
                    return transformer.cancel ? transformer.cancel(reason) : undefined;
                },
            }, readableStrategy);

            const controller = new TransformStreamDefaultController(readableController);

            this.writable = new WritableStream({
                start() {
                    return transformer.start ? transformer.start(controller) : undefined;
                },
                write(chunk) {
                    if (transformer.transform) {
                        return transformer.transform(chunk, controller);
                    }

                    controller.enqueue(chunk);

                    return undefined;
                },
                async close() {
                    if (transformer.flush) {
                        await transformer.flush(controller);
                    }

                    readableController.close();
                },
                async abort(reason) {
                    if (transformer.cancel) {
                        await transformer.cancel(reason);
                    }

                    readableController.error(reason);
                },
            }, writableStrategy);
        }
    }

    class CountQueuingStrategy {
        constructor(init = {}) {
            this.highWaterMark = init.highWaterMark;
        }

        size() {
            return 1;
        }
    }

    class ByteLengthQueuingStrategy {
        constructor(init = {}) {
            this.highWaterMark = init.highWaterMark;
        }

        size(chunk) {
            return chunk.byteLength;
        }
    }

    class TextEncoderStream {
        constructor() {
            const encoder = new globalThis.TextEncoder();

            this.encoding = 'utf-8';
            this[STREAM] = new TransformStream({
                transform(chunk, controller) {
                    controller.enqueue(encoder.encode(String(chunk)));
                },
            });
        }

        get readable() {
            return this[STREAM].readable;
        }

        get writable() {
            return this[STREAM].writable;
        }
    }

    // Where the last, possibly incomplete, UTF-8 sequence of `bytes` starts.
    // Decoding has to stop there, or a sequence split across two chunks comes
    // back as replacement characters.
    const boundary = (bytes) => {
        for (let back = 1; back <= 3 && back <= bytes.length; back++) {
            const at = bytes.length - back;
            const byte = bytes[at];

            if (byte < 0x80) {
                return bytes.length;
            }

            if (byte >= 0xc0) {
                const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : 2;

                return back < expected ? at : bytes.length;
            }
        }

        return bytes.length;
    };

    class TextDecoderStream {
        constructor(label = 'utf-8', options = {}) {
            const decoder = new globalThis.TextDecoder(label, options);
            let pending = new Uint8Array(0);

            this.encoding = decoder.encoding;
            this.fatal = Boolean(options.fatal);
            this.ignoreBOM = Boolean(options.ignoreBOM);

            this[STREAM] = new TransformStream({
                transform(chunk, controller) {
                    const bytes = ArrayBuffer.isView(chunk)
                        ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
                        : new Uint8Array(chunk);
                    const joined = new Uint8Array(pending.length + bytes.length);

                    joined.set(pending);
                    joined.set(bytes, pending.length);

                    const at = boundary(joined);

                    pending = joined.slice(at);

                    if (at > 0) {
                        controller.enqueue(decoder.decode(joined.slice(0, at)));
                    }
                },
                flush(controller) {
                    if (pending.length > 0) {
                        controller.enqueue(decoder.decode(pending));
                    }
                },
            });
        }

        get readable() {
            return this[STREAM].readable;
        }

        get writable() {
            return this[STREAM].writable;
        }
    }

    const ReadableStream = globalThis.ReadableStream;

    ReadableStream.prototype.pipeTo = async function pipeTo(destination, options = {}) {
        const reader = this.getReader();
        const writer = destination.getWriter();

        try {
            for (;;) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                await writer.write(value);
            }

            if (!options.preventClose) {
                await writer.close();
            }
        } catch (error) {
            if (!options.preventAbort) {
                await writer.abort(error);
            }

            throw error;
        } finally {
            writer.releaseLock();
            reader.releaseLock();
        }
    };

    ReadableStream.prototype.pipeThrough = function pipeThrough(transform, options = {}) {
        // The standard does not wait for the pipe: the readable end is the
        // answer, and a failure surfaces there.
        this.pipeTo(transform.writable, options).catch(() => {});

        return transform.readable;
    };

    ReadableStream.prototype.values = function values(options = {}) {
        const reader = this.getReader();

        return {
            async next() {
                const { done, value } = await reader.read();

                if (done) {
                    reader.releaseLock();

                    return { done: true, value: undefined };
                }

                return { done: false, value };
            },
            async return(value) {
                if (!options.preventCancel) {
                    await reader.cancel(value);
                }

                reader.releaseLock();

                return { done: true, value };
            },
            [Symbol.asyncIterator]() {
                return this;
            },
        };
    };

    ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;

    ReadableStream.from = function from(iterable) {
        const iterator =
            iterable[Symbol.asyncIterator] !== undefined
                ? iterable[Symbol.asyncIterator]()
                : iterable[Symbol.iterator]();

        return new ReadableStream({
            async pull(controller) {
                const { done, value } = await iterator.next();

                if (done) {
                    controller.close();

                    return;
                }

                controller.enqueue(value);
            },
            async cancel(reason) {
                if (iterator.return) {
                    await iterator.return(reason);
                }
            },
        });
    };

    globalThis.WritableStream = WritableStream;
    globalThis.WritableStreamDefaultWriter = WritableStreamDefaultWriter;
    globalThis.WritableStreamDefaultController = WritableStreamDefaultController;
    globalThis.TransformStream = TransformStream;
    globalThis.TransformStreamDefaultController = TransformStreamDefaultController;
    globalThis.CountQueuingStrategy = CountQueuingStrategy;
    globalThis.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
    globalThis.TextEncoderStream = TextEncoderStream;
    globalThis.TextDecoderStream = TextDecoderStream;
})();
