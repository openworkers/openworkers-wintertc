// Encoding Standard, `TextEncoder` and `TextDecoder`.
// https://encoding.spec.whatwg.org/

(() => {
    'use strict';

    // The labels a host is not expected to normalise for us. Everything else
    // goes to the host, which refuses what it does not know.
    const ALIASES = {
        utf8: 'utf-8',
        'unicode-1-1-utf-8': 'utf-8',
        latin1: 'windows-1252',
        'iso-8859-1': 'windows-1252',
        ascii: 'windows-1252',
        'us-ascii': 'windows-1252',
    };

    const asBytes = (input) => {
        if (input instanceof Uint8Array) {
            return input;
        }

        if (ArrayBuffer.isView(input)) {
            return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        }

        if (input instanceof ArrayBuffer) {
            return new Uint8Array(input);
        }

        return input;
    };

    // Where the last, possibly incomplete, UTF-8 sequence of `bytes` starts.
    // A decode that runs past it turns a sequence split across two calls into
    // replacement characters.
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

    globalThis.TextEncoder = class TextEncoder {
        constructor() {
            this.encoding = 'utf-8';
        }

        encode(input = '') {
            return globalThis.__ow.textEncode(input);
        }

        encodeInto(source, destination) {
            const encoded = globalThis.__ow.textEncode(source);
            const room = Math.min(encoded.length, destination.length);

            // A sequence is written whole or not at all, so step back over any
            // continuation byte the room cuts through.
            let written = room;

            while (written > 0 && written < encoded.length && (encoded[written] & 0xc0) === 0x80) {
                written--;
            }

            destination.set(encoded.subarray(0, written));

            // `read` counts code units of the source, which differ from bytes
            // outside ASCII: decoding what was written gives the count back.
            const read = written === encoded.length
                ? source.length
                : globalThis.__ow.textDecode(encoded.subarray(0, written), 'utf-8', false).length;

            return { read, written };
        }
    };

    globalThis.TextDecoder = class TextDecoder {
        #encoding;
        #fatal;
        #ignoreBOM;
        #pending;
        #sawBOM;

        constructor(label = 'utf-8', options = {}) {
            const asked = String(label).toLowerCase().trim();

            this.#encoding = ALIASES[asked] || asked;
            this.#fatal = !!options.fatal;
            this.#ignoreBOM = !!options.ignoreBOM;
            this.#pending = new Uint8Array(0);
            this.#sawBOM = false;

            // The host knows the labels; an unknown one has to fail here rather
            // than on the first decode.
            globalThis.__ow.textDecode(new Uint8Array(0), this.#encoding, this.#fatal);
        }

        get encoding() {
            return this.#encoding;
        }

        get fatal() {
            return this.#fatal;
        }

        get ignoreBOM() {
            return this.#ignoreBOM;
        }

        decode(input, options = {}) {
            const streaming = !!options.stream;
            const bytes = input ? asBytes(input) : new Uint8Array(0);
            const joined = new Uint8Array(this.#pending.length + bytes.length);

            joined.set(this.#pending);
            joined.set(bytes, this.#pending.length);

            const at = streaming ? boundary(joined) : joined.length;

            this.#pending = streaming ? joined.slice(at) : new Uint8Array(0);

            let text = globalThis.__ow.textDecode(joined.slice(0, at), this.#encoding, this.#fatal);

            // The mark is dropped once, at the very start of the stream.
            if (!this.#ignoreBOM && !this.#sawBOM && text.charCodeAt(0) === 0xfeff) {
                text = text.slice(1);
            }

            if (text.length > 0 || at > 0) {
                this.#sawBOM = true;
            }

            if (!streaming) {
                this.#sawBOM = false;
            }

            return text;
        }
    };
})();
