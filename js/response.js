// Fetch Standard, the `Response` interface.
// https://fetch.spec.whatwg.org/#response-class
//
// The host reads `_isBuffered`, `_getRawBody` and `_nativeStreamId` off a
// response to decide how to put its body on the wire, so those three are part
// of the contract, not private.

(() => {
    'use strict';

    // A network error carries a status the constructor would otherwise refuse.
    const INTERNAL = Symbol('internal');

    // https://fetch.spec.whatwg.org/#null-body-status
    const NULL_BODY = [101, 103, 204, 205, 304];

    const inferredType = (body) => {
        if (typeof body === 'string') {
            return 'text/plain;charset=UTF-8';
        }

        if (body instanceof globalThis.URLSearchParams) {
            return 'application/x-www-form-urlencoded;charset=UTF-8';
        }

        if (globalThis.Blob && body instanceof globalThis.Blob && body.type) {
            return body.type;
        }

        return null;
    };

    globalThis.Response = class Response {
        constructor(body, init) {
            init = init || {};

            const status = init.status === undefined ? 200 : init.status;
            const given = body !== null && body !== undefined;

            // The one status outside the standard's range a worker may build: it
            // carries the socket of an accepted upgrade, as Workers does.
            const upgrading = status === 101 && !!init.webSocket;

            if (!init[INTERNAL]) {
                if (!upgrading && (status < 200 || status > 599)) {
                    throw new RangeError('Response status ' + status + ' is outside the 200-599 range');
                }

                if (given && NULL_BODY.includes(status)) {
                    throw new TypeError('Response with status ' + status + ' cannot carry a body');
                }
            }

            this.status = status;
            this.statusText = init.statusText || '';
            this.ok = this.status >= 200 && this.status < 300;
            this.bodyUsed = false;
            this._nativeStreamId = null;

            if (upgrading) {
                this.webSocket = init.webSocket;
            }

            // Standard Response properties
            this.url = init.url || '';
            this.type = init.type || 'default';
            this.redirected = init.redirected || false;

            // Convert headers to Headers instance
            if (init.headers instanceof Headers) {
                this.headers = init.headers;
            } else {
                this.headers = new Headers(init.headers);
            }

            const inferred = inferredType(body);

            if (inferred && !this.headers.has('content-type')) {
                this.headers.set('content-type', inferred);
            }

            // Support different body types - all wrapped in ReadableStream
            // _isBuffered marks responses where body data is already fully available
            // (created from string/Uint8Array/ArrayBuffer, not a user-provided stream)
            if (body instanceof ReadableStream) {
                this.body = body;
                this._isBuffered = false; // User-provided stream - must be streamed
                if (body._nativeStreamId !== undefined) {
                    this._nativeStreamId = body._nativeStreamId;
                }
            } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
                const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
                this.body = new ReadableStream({
                    type: 'bytes',
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    }
                });
                this._isBuffered = true; // Data fully available - can use _getRawBody()
            } else if (body === null || body === undefined) {
                this.body = null;
                this._isBuffered = true; // No body - definitely buffered
            } else {
                const encoder = new TextEncoder();
                const bytes = encoder.encode(String(body));
                this.body = new ReadableStream({
                    type: 'bytes',
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    }
                });
                this._isBuffered = true; // Data fully available - can use _getRawBody()
            }
        }

        async text() {
            if (this.bodyUsed) {
                throw new TypeError('Body has already been consumed');
            }
            this.bodyUsed = true;

            if (!this.body) {
                return '';
            }

            const reader = this.body.getReader();
            const chunks = [];

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            const decoder = new TextDecoder();
            return decoder.decode(result);
        }

        async arrayBuffer() {
            if (this.bodyUsed) {
                throw new TypeError('Body has already been consumed');
            }
            this.bodyUsed = true;

            if (!this.body) {
                return new ArrayBuffer(0);
            }

            const reader = this.body.getReader();
            const chunks = [];

            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }
            } finally {
                reader.releaseLock();
            }

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result.buffer;
        }

        async json() {
            const text = await this.text();
            return JSON.parse(text);
        }

        async bytes() {
            return new Uint8Array(await this.arrayBuffer());
        }

        async blob() {
            const type = this.headers.get('content-type') || '';

            return new Blob([new Uint8Array(await this.arrayBuffer())], { type });
        }

        async formData() {
            const contentType = this.headers.get('content-type') || '';
            const formData = new FormData();

            if (contentType.includes('application/x-www-form-urlencoded')) {
                const text = await this.text();
                const params = new URLSearchParams(text);

                for (const [key, value] of params) {
                    formData.append(key, value);
                }
            } else if (contentType.includes('multipart/form-data')) {
                const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/);

                if (!boundaryMatch) {
                    throw new TypeError('Missing boundary in multipart/form-data');
                }

                const boundary = '--' + (boundaryMatch[1] || boundaryMatch[2]);
                const boundaryBytes = new TextEncoder().encode(boundary);
                const crlfcrlf = new Uint8Array([13, 10, 13, 10]); // \r\n\r\n

                const buffer = await this.arrayBuffer();
                const data = new Uint8Array(buffer);

                // Find byte pattern in array
                const findPattern = (arr, pattern, start = 0) => {
                    outer: for (let i = start; i <= arr.length - pattern.length; i++) {
                        for (let j = 0; j < pattern.length; j++) {
                            if (arr[i + j] !== pattern[j]) continue outer;
                        }
                        return i;
                    }
                    return -1;
                };

                let pos = findPattern(data, boundaryBytes);

                while (pos !== -1) {
                    pos += boundaryBytes.length;

                    // Check for final boundary (--)
                    if (data[pos] === 45 && data[pos + 1] === 45) break;

                    // Skip CRLF after boundary
                    if (data[pos] === 13 && data[pos + 1] === 10) pos += 2;

                    // Find header end
                    const headerEnd = findPattern(data, crlfcrlf, pos);
                    if (headerEnd === -1) break;

                    // Parse headers as text
                    const headerBytes = data.slice(pos, headerEnd);
                    const headerText = new TextDecoder().decode(headerBytes);

                    // Find next boundary for body end
                    const nextBoundary = findPattern(data, boundaryBytes, headerEnd + 4);
                    const bodyEnd = nextBoundary !== -1 ? nextBoundary - 2 : data.length; // -2 for CRLF before boundary

                    // Extract body as bytes
                    const bodyBytes = data.slice(headerEnd + 4, bodyEnd);

                    const nameMatch = headerText.match(/name="([^"]+)"/);

                    if (!nameMatch) {
                        pos = nextBoundary;
                        continue;
                    }

                    const name = nameMatch[1];
                    const filenameMatch = headerText.match(/filename="([^"]+)"/);

                    if (filenameMatch) {
                        const filename = filenameMatch[1];
                        const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
                        const fileType = contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream';
                        const file = new File([bodyBytes], filename, { type: fileType });
                        formData.append(name, file, filename);
                    } else {
                        // Text field - decode as UTF-8
                        const value = new TextDecoder().decode(bodyBytes);
                        formData.append(name, value);
                    }

                    pos = nextBoundary;
                }
            } else {
                throw new TypeError('Invalid content-type for formData()');
            }

            return formData;
        }

        _getRawBody() {
            if (!this.body || !this.body._controller) {
                return new Uint8Array(0);
            }

            const queue = this.body._controller._queue;
            if (!queue || queue.length === 0) {
                return new Uint8Array(0);
            }

            const chunks = [];
            for (const item of queue) {
                if (item.type === 'chunk' && item.value) {
                    chunks.push(item.value);
                }
            }

            if (chunks.length === 0) {
                return new Uint8Array(0);
            }

            if (chunks.length === 1) {
                return chunks[0];
            }

            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.length;
            }

            return result;
        }

        clone() {
            if (this.bodyUsed) {
                throw new TypeError('Cannot clone a Response whose body has been consumed');
            }

            let clonedBody = null;
            if (this.body) {
                const [stream1, stream2] = this.body.tee();
                this.body = stream1;
                clonedBody = stream2;
            }

            return new Response(clonedBody, {
                status: this.status,
                statusText: this.statusText,
                headers: new Headers(this.headers),
                url: this.url,
                type: this.type,
                redirected: this.redirected
            });
        }

        static json(data, init) {
            init = init || {};
            const body = JSON.stringify(data);
            const headers = new Headers(init.headers);
            if (!headers.has('content-type')) {
                headers.set('content-type', 'application/json');
            }
            return new Response(body, {
                status: init.status || 200,
                statusText: init.statusText || '',
                headers: headers
            });
        }

        static redirect(url, status) {
            status = status || 302;
            if (![301, 302, 303, 307, 308].includes(status)) {
                throw new RangeError('Invalid redirect status code');
            }
            const headers = new Headers({ 'Location': url });
            return new Response(null, {
                status: status,
                headers: headers
            });
        }

        static error() {
            return new Response(null, { status: 0, type: 'error', [INTERNAL]: true });
        }
    };
})();
