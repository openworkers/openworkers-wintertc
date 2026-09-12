// XMLHttpRequest Standard, the `FormData` interface.
// https://xhr.spec.whatwg.org/#interface-formdata

globalThis.FormData = class FormData {
    constructor() {
        this._entries = [];
    }

    append(name, value, filename) {
        if (value instanceof Blob && filename === undefined && value instanceof File) {
            filename = value.name;
        }
        this._entries.push([String(name), value instanceof Blob ? value : String(value), filename]);
    }

    delete(name) {
        const strName = String(name);
        this._entries = this._entries.filter(([k]) => k !== strName);
    }

    get(name) {
        const strName = String(name);
        const entry = this._entries.find(([k]) => k === strName);
        return entry ? entry[1] : null;
    }

    getAll(name) {
        const strName = String(name);
        return this._entries.filter(([k]) => k === strName).map(([, v]) => v);
    }

    has(name) {
        const strName = String(name);
        return this._entries.some(([k]) => k === strName);
    }

    set(name, value, filename) {
        const strName = String(name);
        if (value instanceof Blob && filename === undefined && value instanceof File) {
            filename = value.name;
        }
        // Remove all existing entries with this name
        this._entries = this._entries.filter(([k]) => k !== strName);
        // Add the new entry
        this._entries.push([strName, value instanceof Blob ? value : String(value), filename]);
    }

    *entries() {
        for (const [name, value] of this._entries) {
            yield [name, value];
        }
    }

    *keys() {
        for (const [name] of this._entries) {
            yield name;
        }
    }

    *values() {
        for (const [, value] of this._entries) {
            yield value;
        }
    }

    forEach(callback, thisArg) {
        for (const [name, value] of this._entries) {
            callback.call(thisArg, value, name, this);
        }
    }

    [Symbol.iterator]() {
        return this.entries();
    }

    // The multipart encoding, bytes and content type together: the header has to
    // name the boundary the body uses, and a file part is arbitrary binary.
    _encode() {
        const boundary =
            '----OpenWorkersFormBoundary' +
            Math.random().toString(36).slice(2) +
            Math.random().toString(36).slice(2);
        const encoder = new TextEncoder();
        const chunks = [];

        // https://html.spec.whatwg.org/#multipart-form-data
        const escape = (text) =>
            String(text).replace(/\r\n|[\r\n]/g, '%0D%0A').replace(/"/g, '%22');

        for (const [name, value, filename] of this._entries) {
            let head = '--' + boundary + '\r\nContent-Disposition: form-data; name="' +
                escape(name) + '"';

            if (value instanceof Blob) {
                head += '; filename="' + escape(filename === undefined ? 'blob' : filename) + '"';
                head += '\r\nContent-Type: ' + (value.type || 'application/octet-stream');
            }

            chunks.push(encoder.encode(head + '\r\n\r\n'));
            chunks.push(value instanceof Blob ? value._getBytes() : encoder.encode(value));
            chunks.push(encoder.encode('\r\n'));
        }

        chunks.push(encoder.encode('--' + boundary + '--\r\n'));

        const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
        let offset = 0;

        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }

        return { bytes, type: 'multipart/form-data; boundary=' + boundary };
    }
};
