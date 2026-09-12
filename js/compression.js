// Compression Streams, the `CompressionStream` and `DecompressionStream`
// interfaces.
// https://compression.spec.whatwg.org/
//
// The codec belongs to the host and carries state between chunks, so the id has
// to be released: on flush when the stream ends, on cancel when it does not.

(() => {
    'use strict';

    const FORMATS = ['deflate', 'deflate-raw', 'gzip'];

    const transformFor = (format, decompress) => {
        if (!FORMATS.includes(format)) {
            throw new TypeError("Unsupported compression format: '" + format + "'");
        }

        let id = globalThis.__ow.compressionStart(format, decompress);

        return new globalThis.TransformStream({
            transform(chunk, controller) {
                const out = globalThis.__ow.compressionPush(id, chunk);

                if (out.byteLength > 0) {
                    controller.enqueue(out);
                }
            },

            flush(controller) {
                const out = globalThis.__ow.compressionFinish(id);
                id = null;

                if (out.byteLength > 0) {
                    controller.enqueue(out);
                }
            },

            cancel() {
                if (id !== null) {
                    globalThis.__ow.compressionDrop(id);
                    id = null;
                }
            },
        });
    };

    globalThis.CompressionStream = class CompressionStream {
        constructor(format) {
            const transform = transformFor(String(format), false);

            this.readable = transform.readable;
            this.writable = transform.writable;
        }
    };

    globalThis.DecompressionStream = class DecompressionStream {
        constructor(format) {
            const transform = transformFor(String(format), true);

            this.readable = transform.readable;
            this.writable = transform.writable;
        }
    };
})();
