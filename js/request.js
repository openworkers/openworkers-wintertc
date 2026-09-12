// Fetch Standard, the `Request` interface.
// https://fetch.spec.whatwg.org/#request-class

(() => {
    'use strict';

    // https://fetch.spec.whatwg.org/#concept-method
    const METHOD = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

    // Only these six are uppercased; any other token is kept as it was given.
    const NORMALIZED = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'];

    const normalizeMethod = (method) => {
        const token = String(method);

        if (!METHOD.test(token)) {
            throw new TypeError("'" + token + "' is not a valid HTTP method");
        }

        const upper = token.toUpperCase();

        return NORMALIZED.includes(upper) ? upper : token;
    };

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

    globalThis.Request = class Request {
        constructor(input, init) {
            init = init || {};

            // The host builds the incoming request through this constructor, and a
            // client is free to put a body on a GET; only a guest is held to the
            // standard's refusal.
            const method = normalizeMethod(init.method || 'GET');
            const carries = init.body !== null && init.body !== undefined;

            if (!init._fromHost && carries && (method === 'GET' || method === 'HEAD')) {
                throw new TypeError('Request with method ' + method + ' cannot carry a body');
            }

            // A body that encodes itself (FormData) does it once: the content type
            // has to name the boundary it produced.
            const form =
                init.body && typeof init.body._encode === 'function' ? init.body._encode() : null;
            const body = form ? form.bytes : init.body;

            // Handle input - can be a URL string or another Request
            if (input instanceof Request) {
                // Clone from another Request
                this.url = input.url;
                this.method = init.method === undefined ? input.method : method;
                this.headers = new Headers(init.headers || input.headers);
                // Body handling for clone
                if (init.body !== undefined) {
                    this._initBody(body);
                } else if (input.body && !input.bodyUsed) {
                    // Tee it, or the two requests would drain the one stream.
                    const [mine, theirs] = input.body.tee();

                    input.body = theirs;
                    this._initBody(mine);
                } else {
                    this.body = null;
                }
            } else {
                // Parsed against no base, so a relative url is a TypeError.
                this.url = new URL(input).href;
                this.method = method;
                this.headers = new Headers(init.headers);

                // Handle streaming body from native (passed as _bodyStreamId)
                if (init._bodyStreamId !== undefined) {
                    this.body = __createNativeStream(init._bodyStreamId);
                } else {
                    this._initBody(body);
                }
            }

            this.bodyUsed = false;
            this.signal = init.signal || new globalThis.AbortController().signal;
            this.keepalive = Boolean(init.keepalive);

            const inferred = form ? form.type : inferredType(init.body);

            if (inferred && !this.headers.has('content-type')) {
                this.headers.set('content-type', inferred);
            }

            // Additional properties (simplified)
            this.mode = init.mode || 'cors';
            this.credentials = init.credentials || 'same-origin';
            this.cache = init.cache || 'default';
            this.redirect = init.redirect || 'follow';
            this.referrer = init.referrer || 'about:client';
            this.integrity = init.integrity || '';
        }

        _initBody(body) {
            if (body instanceof ReadableStream) {
                this.body = body;
            } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
                const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
                this.body = new ReadableStream({
                    type: 'bytes',
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    }
                });
            } else if (body === null || body === undefined) {
                this.body = null;
            } else {
                // String or other
                const encoder = new TextEncoder();
                const bytes = encoder.encode(String(body));
                this.body = new ReadableStream({
                    type: 'bytes',
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    }
                });
            }
        }

        async text() {
            if (this.bodyUsed) {
                throw new TypeError('Body has already been consumed');
            }

            // Nothing to disturb, so a body-less read can be repeated.
            if (!this.body) {
                return '';
            }

            this.bodyUsed = true;

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
                const crlf = new Uint8Array([13, 10]); // \r\n

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

        async arrayBuffer() {
            if (this.bodyUsed) {
                throw new TypeError('Body has already been consumed');
            }

            // Nothing to disturb, so a body-less read can be repeated.
            if (!this.body) {
                return new ArrayBuffer(0);
            }

            this.bodyUsed = true;

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

        clone() {
            if (this.bodyUsed) {
                throw new TypeError('Cannot clone a Request whose body has been consumed');
            }

            let clonedBody = null;
            if (this.body) {
                const [stream1, stream2] = this.body.tee();
                this.body = stream1;
                clonedBody = stream2;
            }

            return new Request(this.url, {
                method: this.method,
                headers: new Headers(this.headers),
                body: clonedBody,
                mode: this.mode,
                credentials: this.credentials,
                cache: this.cache,
                redirect: this.redirect,
                referrer: this.referrer,
                integrity: this.integrity
            });
        }
    };
})();
