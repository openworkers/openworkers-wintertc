// `FormData` as a request and response body, against the XHR and HTML standards.

import { describe, expect, test } from 'bun:test';

import { evaluate, sandbox } from './support/surface.js';

// The blob types come from the surface here, not from the host: a file part is
// a `File` the surface built.
function surface() {
    return evaluate(
        sandbox({ TextEncoder, TextDecoder, console: { error() {} } }),
        'blob',
        'form-data',
        'events',
        'abort',
        'readable-stream',
        'byte-stream',
        'url',
        'headers',
        'request',
        'response'
    );
}

const box = surface();
const { FormData, File, Request, Response } = box;

describe('a FormData body', () => {
    test('sets a multipart content type carrying the boundary', () => {
        const form = new FormData();

        form.append('a', 'x y');

        const request = new Request('https://example.com/', { method: 'POST', body: form });

        expect(request.headers.get('content-type')).toMatch(
            /^multipart\/form-data; boundary=----OpenWorkersFormBoundary/
        );
    });

    test('leaves a content type the caller set', async () => {
        const form = new FormData();

        form.append('a', '1');

        const request = new Request('https://example.com/', {
            method: 'POST',
            body: form,
            headers: { 'content-type': 'text/plain' },
        });

        expect(request.headers.get('content-type')).toBe('text/plain');
    });

    test('round-trips through a request', async () => {
        const form = new FormData();

        form.append('a', 'x y');
        form.append('b', 'z');
        form.append('a', 'again');

        const request = new Request('https://example.com/', { method: 'POST', body: form });
        const back = await request.formData();

        expect([...back]).toEqual([
            ['a', 'x y'],
            ['b', 'z'],
            ['a', 'again'],
        ]);
    });

    test('round-trips through a response', async () => {
        const form = new FormData();

        form.append('a', '1');

        const back = await new Response(form).formData();

        expect([...back]).toEqual([['a', '1']]);
    });

    test('carries a file part with its name and bytes', async () => {
        const form = new FormData();

        form.append('f', new File(['hello'], 'a.txt', { type: 'text/plain' }));

        const back = await new Response(form).formData();
        const file = back.get('f');

        expect(file.name).toBe('a.txt');
        expect(file.type).toBe('text/plain');
        expect(await file.text()).toBe('hello');
    });

    test('escapes a quote in a field name', async () => {
        const form = new FormData();

        form.append('a"b', '1');

        const back = await new Response(form).formData();

        expect([...back.keys()]).toEqual(['a%22b']);
    });
});
