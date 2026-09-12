// WebAssembly Web API, the two entry points that take a `Response`.
// https://webassembly.github.io/spec/web-api/
//
// The bytes are collected before compiling: the engine compiles from a buffer,
// so streaming here buys nothing a worker can observe.

(() => {
    'use strict';

    const wasm = globalThis.WebAssembly;

    if (!wasm) {
        return;
    }

    const bytesOf = async (source) => {
        const response = await source;

        if (!response.ok) {
            throw new TypeError('The response for a WebAssembly module is not ok');
        }

        const type = response.headers.get('content-type') || '';

        if (type.split(';')[0].trim().toLowerCase() !== 'application/wasm') {
            throw new TypeError('A WebAssembly module must be served as application/wasm');
        }

        return response.arrayBuffer();
    };

    wasm.compileStreaming = async function compileStreaming(source) {
        return wasm.compile(await bytesOf(source));
    };

    wasm.instantiateStreaming = async function instantiateStreaming(source, imports) {
        return wasm.instantiate(await bytesOf(source), imports);
    };
})();
