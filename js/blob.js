// File API, the `Blob` and `File` interfaces.
// https://w3c.github.io/FileAPI/

globalThis.Blob = class Blob {
    constructor(blobParts = [], options = {}) {
        this.type = String(options.type || '').toLowerCase();
        this._parts = [];

        for (const part of blobParts) {
            if (part instanceof Blob) {
                this._parts.push(...part._parts);
            } else if (part instanceof ArrayBuffer) {
                this._parts.push(new Uint8Array(part));
            } else if (ArrayBuffer.isView(part)) {
                this._parts.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
            } else {
                this._parts.push(new TextEncoder().encode(String(part)));
            }
        }
    }

    get size() {
        return this._parts.reduce((sum, part) => sum + part.byteLength, 0);
    }

    slice(start = 0, end = this.size, contentType = '') {
        const bytes = this._getBytes();
        const sliced = bytes.slice(start, end);
        return new Blob([sliced], { type: contentType });
    }

    async arrayBuffer() {
        return this._getBytes().buffer;
    }

    async bytes() {
        return new Uint8Array(await this.arrayBuffer());
    }

    async text() {
        return new TextDecoder().decode(this._getBytes());
    }

    stream() {
        const bytes = this._getBytes();
        return new ReadableStream({
            start(controller) {
                controller.enqueue(bytes);
                controller.close();
            }
        });
    }

    _getBytes() {
        if (this._parts.length === 0) return new Uint8Array(0);
        if (this._parts.length === 1) return this._parts[0];

        const totalLength = this._parts.reduce((sum, p) => sum + p.byteLength, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of this._parts) {
            result.set(part, offset);
            offset += part.byteLength;
        }
        return result;
    }
};

globalThis.File = class File extends Blob {
    constructor(fileBits, fileName, options = {}) {
        super(fileBits, options);
        this.name = fileName;
        this.lastModified = options.lastModified || Date.now();
    }
};
