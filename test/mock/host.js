// Globals a host installs around the surface, answered in pure JavaScript.
//
// `ReadableStream` is the host's: it is backed by a real channel there, and
// `js/streams.js` extends its prototype, so each sandbox needs its own class
// rather than a shared one.

export function readableStreamClass() {
    class ReadableStreamDefaultController {
        constructor(stream) {
            this.stream = stream;
        }

        get desiredSize() {
            return 1;
        }

        enqueue(chunk) {
            this.stream.queue.push(chunk);
            this.stream.pump();
        }

        close() {
            this.stream.closed = true;
            this.stream.pump();
        }

        error(reason) {
            this.stream.failure = reason;
            this.stream.pump();
        }
    }

    class ReadableStreamDefaultReader {
        constructor(stream) {
            this.stream = stream;
        }

        read() {
            const stream = this.stream;

            if (!stream) {
                return Promise.reject(new TypeError('Reader is released'));
            }

            return new Promise((resolve, reject) => {
                stream.requests.push({ resolve, reject });
                stream.pump();
            });
        }

        cancel(reason) {
            return this.stream ? this.stream.cancel(reason) : Promise.resolve();
        }

        releaseLock() {
            if (this.stream) {
                this.stream.reader = null;
                this.stream = null;
            }
        }
    }

    class ReadableStream {
        constructor(source = {}) {
            this.source = source;
            this.queue = [];
            this.requests = [];
            this.closed = false;
            this.failure = null;
            this.reader = null;
            this.pulling = false;

            if (source.start) {
                source.start(new ReadableStreamDefaultController(this));
            }
        }

        get locked() {
            return this.reader !== null;
        }

        getReader() {
            if (this.reader) {
                throw new TypeError('ReadableStream is locked to a reader');
            }

            this.reader = new ReadableStreamDefaultReader(this);

            return this.reader;
        }

        cancel(reason) {
            this.closed = true;
            this.queue = [];
            this.pump();

            return Promise.resolve(this.source.cancel ? this.source.cancel(reason) : undefined);
        }

        pump() {
            while (this.requests.length > 0) {
                if (this.failure) {
                    this.requests.shift().reject(this.failure);

                    continue;
                }

                if (this.queue.length > 0) {
                    this.requests.shift().resolve({ done: false, value: this.queue.shift() });

                    continue;
                }

                if (this.closed) {
                    this.requests.shift().resolve({ done: true, value: undefined });

                    continue;
                }

                if (this.source.pull && !this.pulling) {
                    this.pulling = true;
                    Promise.resolve(this.source.pull(new ReadableStreamDefaultController(this)))
                        .then(() => {
                            this.pulling = false;
                            this.pump();
                        })
                        .catch((error) => {
                            this.pulling = false;
                            this.failure = error;
                            this.pump();
                        });
                }

                return;
            }
        }
    }

    return ReadableStream;
}
