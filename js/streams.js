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
    const SIZE = Symbol('size');
    const QUEUED = Symbol('queued');
    const READY = Symbol('ready');
    const PRESSURE = Symbol('pressure');
    const DESIRED = Symbol('desired');
    const UPDATE = Symbol('update');
    const FAIL = Symbol('fail');
    const END = Symbol('end');

    const deferred = () => {
        const settle = {};

        settle.promise = new Promise((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
        });

        return settle;
    };

    // The standard marks the ready promise handled, so its rejection is not
    // reported to a guest that never looks at it.
    const handledRejection = (reason) => {
        const promise = Promise.reject(reason);
        promise.catch(() => {});

        return promise;
    };

    class WritableStreamDefaultController {
        constructor(stream) {
            this[STREAM] = stream;
        }

        error(reason) {
            this[STREAM][FAIL](reason);
        }
    }

    class WritableStream {
        constructor(sink = {}, strategy = {}) {
            const highWaterMark =
                strategy.highWaterMark === undefined ? 1 : Number(strategy.highWaterMark);

            if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
                throw new RangeError('highWaterMark must be a non-negative number');
            }

            this[SINK] = sink;
            this[STATE] = 'writable';
            this[ERROR] = undefined;
            this[WRITER] = null;
            this[CONTROLLER] = new WritableStreamDefaultController(this);
            this[SIZE] = strategy.size === undefined ? () => 1 : (chunk) => strategy.size(chunk);
            this[QUEUED] = 0;
            this[PRESSURE] = false;
            this[READY] = { promise: Promise.resolve(), resolve() {} };
            this.highWaterMark = highWaterMark;

            // Writes run one at a time, in the order they were made.
            this[QUEUE] = Promise.resolve(
                sink.start ? sink.start(this[CONTROLLER]) : undefined
            );
            this[QUEUE].catch((error) => this[FAIL](error));

            this[UPDATE]();
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

            this[FAIL](reason);

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
            this[UPDATE]();

            return this[QUEUE];
        }

        [DESIRED]() {
            if (this[STATE] === 'errored') {
                return null;
            }

            if (this[STATE] === 'closed') {
                return 0;
            }

            return this.highWaterMark - this[QUEUED];
        }

        // The ready promise stays pending while the queue holds as much as the
        // strategy allows, and settles once a write drains it below that.
        [UPDATE]() {
            const pressure = this[STATE] === 'writable' && this[DESIRED]() <= 0;

            if (pressure === this[PRESSURE]) {
                return;
            }

            this[PRESSURE] = pressure;

            if (pressure) {
                this[READY] = deferred();
            } else {
                this[READY].resolve();
            }
        }

        [FAIL](reason) {
            if (this[STATE] === 'errored') {
                return;
            }

            this[STATE] = 'errored';
            this[ERROR] = reason;

            const ready = this[PRESSURE] ? this[READY] : deferred();

            ready.promise.catch(() => {});
            ready.reject(reason);
            this[READY] = ready;
            this[PRESSURE] = false;
        }

        [WRITE](chunk) {
            if (this[STATE] !== 'writable') {
                return Promise.reject(this[ERROR] || new TypeError('WritableStream is not writable'));
            }

            let size;

            try {
                size = this[SIZE](chunk);
            } catch (error) {
                this[FAIL](error);

                return Promise.reject(error);
            }

            if (!(size >= 0) || size === Infinity) {
                const error = new RangeError('A chunk size must be a finite, non-negative number');
                this[FAIL](error);

                return Promise.reject(error);
            }

            this[QUEUED] += size;
            this[UPDATE]();

            const written = this[QUEUE].then(() =>
                this[SINK].write ? this[SINK].write(chunk, this[CONTROLLER]) : undefined
            );

            this[QUEUE] = written.then(
                () => {
                    this[QUEUED] -= size;
                    this[UPDATE]();
                },
                (error) => {
                    this[QUEUED] -= size;
                    this[FAIL](error);

                    throw error;
                }
            );

            return this[QUEUE];
        }
    }

    class WritableStreamDefaultWriter {
        constructor(stream) {
            this[STREAM] = stream;
        }

        get desiredSize() {
            if (!this[STREAM]) {
                throw new TypeError('Writer is released');
            }

            return this[STREAM][DESIRED]();
        }

        get ready() {
            if (!this[STREAM]) {
                return handledRejection(new TypeError('Writer is released'));
            }

            return this[STREAM][READY].promise;
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
        constructor(readableController, end) {
            this[CONTROLLER] = readableController;
            this[END] = end;
        }

        get desiredSize() {
            return this[CONTROLLER].desiredSize;
        }

        enqueue(chunk) {
            this[CONTROLLER].enqueue(chunk);
        }

        error(reason) {
            this[CONTROLLER].error(reason);
            this[END]();
        }

        terminate() {
            this[CONTROLLER].close();
            this[END]();
        }
    }

    class TransformStream {
        constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
            let readableController = null;
            // Set while a write waits for the reader to want more.
            let pulled = null;
            // The readable side is closed, errored or cancelled: its desired
            // size says nothing about a reader any more.
            let ended = false;

            const release = () => {
                if (pulled) {
                    pulled.resolve();
                    pulled = null;
                }
            };

            const end = () => {
                ended = true;
                release();
            };

            // The host calls start synchronously, so the controller is in hand
            // before the constructor returns.
            this.readable = new globalThis.ReadableStream({
                start(controller) {
                    readableController = controller;
                },
                pull() {
                    release();
                },
                cancel(reason) {
                    end();

                    return transformer.cancel ? transformer.cancel(reason) : undefined;
                },
            }, readableStrategy);

            const controller = new TransformStreamDefaultController(readableController, end);

            this.writable = new WritableStream({
                start() {
                    return transformer.start ? transformer.start(controller) : undefined;
                },
                async write(chunk) {
                    // The readable side holds what nobody read yet: transform
                    // nothing more until a reader pulls.
                    if (!ended && readableController.desiredSize <= 0) {
                        pulled = deferred();
                        await pulled.promise;
                    }

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
        let written = Promise.resolve();

        try {
            for (;;) {
                // Read nothing the destination has no room for.
                await writer.ready;

                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                // A failed write errors the destination, and the next ready
                // or the wait below reports it.
                written = writer.write(value);
                written.catch(() => {});
            }

            await written;

            if (!options.preventClose) {
                await writer.close();
            }
        } catch (error) {
            if (!options.preventAbort) {
                await writer.abort(error);
            }

            if (!options.preventCancel) {
                await reader.cancel(error).catch(() => {});
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
