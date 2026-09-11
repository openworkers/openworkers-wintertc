// Encoding Standard, `TextEncoder` and `TextDecoder`.
// https://encoding.spec.whatwg.org/

globalThis.TextEncoder = class TextEncoder {
    constructor() {
        this.encoding = 'utf-8';
    }

    encode(input) {
        return __text_encode(input);
    }

    encodeInto(source, destination) {
        const encoded = __text_encode(source);
        const len = Math.min(encoded.length, destination.length);
        destination.set(encoded.subarray(0, len));
        return { read: len, written: len };
    }
};

globalThis.TextDecoder = class TextDecoder {
    #encoding;
    #fatal;
    #ignoreBOM;

    constructor(label = 'utf-8', options = {}) {
        this.#encoding = label.toLowerCase().trim();
        this.#fatal = !!options.fatal;
        this.#ignoreBOM = !!options.ignoreBOM;

        // Validate encoding by attempting a decode
        // encoding_rs will reject invalid labels
        try {
            __text_decode(new Uint8Array(0), this.#encoding, this.#fatal);
        } catch (e) {
            if (e instanceof RangeError) throw e;
            throw e;
        }
    }

    get encoding() {
        // encoding_rs normalizes labels, but we store the canonical name
        // The spec says to return the lowercase name
        return this.#encoding;
    }

    get fatal() {
        return this.#fatal;
    }

    get ignoreBOM() {
        return this.#ignoreBOM;
    }

    decode(input, options) {
        if (!input) return '';

        const bytes = input instanceof Uint8Array
            ? input
            : ArrayBuffer.isView(input)
                ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
                : input instanceof ArrayBuffer
                    ? new Uint8Array(input)
                    : input;

        return __text_decode(bytes, this.#encoding, this.#fatal);
    }
};
