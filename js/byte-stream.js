// Streams Standard, the byte tier of a readable stream.
// https://streams.spec.whatwg.org/#byte-streams
//
// A byte stream lets the consumer own the buffer: `read(view)` transfers it in,
// the producer writes into it, and the same memory comes back. The tier exists
// to remove an allocation per chunk, so what it can hand over it does not copy.

(() => {
    'use strict';

    const DefaultController = globalThis.ReadableStreamDefaultController;
    const DefaultReader = globalThis.ReadableStreamDefaultReader;

    const bytesOf = (chunk) => {
        if (ArrayBuffer.isView(chunk)) {
            return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        }

        if (chunk instanceof ArrayBuffer) {
            return new Uint8Array(chunk);
        }

        return null;
    };

    // What the producer sees while a consumer waits with its buffer: the view to
    // fill, and the two ways of saying how much was filled.
    class ReadableStreamBYOBRequest {
        constructor(controller, view) {
            this._controller = controller;
            this._view = view;
        }

        get view() {
            return this._view;
        }

        // Both answers validate before taking the request: a refused answer
        // leaves it answerable.
        respond(written) {
            this._alive();

            if (written > this._view.byteLength) {
                throw new RangeError('A BYOB request cannot answer with more bytes than its view holds');
            }

            this._take()._commit(this._view, written);
        }

        respondWithNewView(view) {
            this._alive();

            const bytes = bytesOf(view);

            if (bytes === null) {
                throw new TypeError('A BYOB request answers with a BufferSource');
            }

            // The point of the tier is that the memory does not change hands, so
            // the new view has to sit on the buffer the request handed out.
            if (bytes.buffer !== this._view.buffer) {
                throw new RangeError('A BYOB request answers over the buffer it was given');
            }

            this._take()._commit(bytes, bytes.byteLength);
        }

        _alive() {
            if (this._controller === null) {
                throw new TypeError('This BYOB request has already been answered');
            }
        }

        _take() {
            const controller = this._controller;
            this._controller = null;
            controller._byobRequest = null;

            return controller;
        }
    }

    class ReadableByteStreamController extends DefaultController {
        constructor(stream) {
            super(stream);

            this._byobRequest = null;
            this._pending = [];
            this._offset = 0;
            this._autoAllocateChunkSize = stream._underlyingSource.autoAllocateChunkSize;
        }

        get byobRequest() {
            return this._byobRequest;
        }

        enqueue(chunk) {
            const bytes = bytesOf(chunk);

            if (bytes === null) {
                throw new TypeError('A byte stream enqueues a BufferSource');
            }

            super.enqueue(bytes);
        }

        // Bytes the producer wrote straight into a waiting view, which never
        // passed through the queue.
        _commit(view, written) {
            const request = this._pending.shift();

            if (request === undefined) {
                return;
            }

            request.resolve({
                done: false,
                value: new Uint8Array(view.buffer, view.byteOffset, written),
            });
        }

        // A waiting consumer is what makes a byob request exist; a producer that
        // pulls without one sees null, as the standard says.
        _offerBuffer() {
            if (this._byobRequest !== null) {
                return;
            }

            const request = this._pending[0];

            if (request !== undefined) {
                this._byobRequest = new ReadableStreamBYOBRequest(this, request.view);

                return;
            }

            if (this._autoAllocateChunkSize > 0) {
                const view = new Uint8Array(this._autoAllocateChunkSize);
                this._byobRequest = new ReadableStreamBYOBRequest(this, view);
            }
        }
    }

    class ReadableStreamBYOBReader extends DefaultReader {
        read(view) {
            if (!this._stream) {
                return Promise.reject(new TypeError('Reader is released'));
            }

            const bytes = bytesOf(view);

            if (bytes === null || bytes.byteLength === 0) {
                return Promise.reject(new TypeError('A byob read takes a non-empty BufferSource'));
            }

            if (this._stream._state === 'errored') {
                return Promise.reject(this._stream._storedError);
            }

            // The standard transfers the buffer, so the view the caller holds
            // detaches and the bytes come back over the moved memory. The shape
            // has to be read before the transfer, which zeroes it.
            const offset = bytes.byteOffset;
            const length = bytes.byteLength;
            const moved = new Uint8Array(bytes.buffer.transfer(), offset, length);
            const controller = this._stream._controller;

            const answer = new Promise((resolve, reject) => {
                controller._pending.push({ view: moved, resolve, reject });
            });

            this._processQueue();

            if (controller._pending.length > 0 && this._stream._state === 'readable') {
                const source = this._stream._underlyingSource;

                controller._offerBuffer();

                if (source && source.pull) {
                    Promise.resolve()
                        .then(() => source.pull(controller))
                        .catch((err) => controller.error(err));
                }
            }

            return answer;
        }

        // Fills the waiting views from the queue, taking the head apart when a
        // chunk is larger than the view in front of it.
        _processQueue() {
            const controller = this._stream._controller;

            while (controller._pending.length > 0 && controller._queue.length > 0) {
                const item = controller._queue[0];

                if (item.type === 'close') {
                    controller._queue.shift();
                    this._stream._state = 'closed';

                    const request = controller._pending.shift();
                    request.resolve({ done: true, value: new Uint8Array(0) });

                    this._closePending();
                    break;
                }

                const request = controller._pending.shift();
                const available = item.value.subarray(controller._offset);
                const taken = Math.min(available.byteLength, request.view.byteLength);

                request.view.set(available.subarray(0, taken));

                if (taken === available.byteLength) {
                    controller._queue.shift();
                    controller._offset = 0;
                } else {
                    controller._offset += taken;
                }

                request.resolve({
                    done: false,
                    value: new Uint8Array(request.view.buffer, request.view.byteOffset, taken),
                });
            }

            if (this._stream._state === 'closed') {
                while (controller._pending.length > 0) {
                    const request = controller._pending.shift();
                    request.resolve({ done: true, value: new Uint8Array(0) });
                }
            }

        }

        _errorPending(error) {
            const controller = this._stream._controller;

            while (controller._pending.length > 0) {
                const request = controller._pending.shift();
                request.reject(error);
            }

            super._errorPending(error);
        }
    }

    globalThis.ReadableByteStreamController = ReadableByteStreamController;
    globalThis.ReadableStreamBYOBReader = ReadableStreamBYOBReader;
    globalThis.ReadableStreamBYOBRequest = ReadableStreamBYOBRequest;

    // The base picks its controller from the source's type, and its reader from
    // the mode the consumer asks for.
    const ReadableStream = globalThis.ReadableStream;
    const baseGetReader = ReadableStream.prototype.getReader;

    ReadableStream.prototype.getReader = function getReader(options = {}) {
        const mode = options === null || options === undefined ? undefined : options.mode;

        if (mode === undefined) {
            return baseGetReader.call(this);
        }

        if (mode !== 'byob') {
            throw new TypeError("The reader mode is 'byob' or nothing, not '" + mode + "'");
        }

        if (!(this._controller instanceof ReadableByteStreamController)) {
            throw new TypeError('A byob reader needs a stream created with type bytes');
        }

        if (this._reader) {
            throw new TypeError('ReadableStream is locked to a reader');
        }

        const reader = new ReadableStreamBYOBReader(this);
        this._reader = reader;

        return reader;
    };
})();
