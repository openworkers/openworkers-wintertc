// `Request` and `Response`, against the Fetch Standard.

import { describe, expect, test } from 'bun:test';

import { evaluate, intrinsics, sandbox } from './support/surface.js';

// These two stand on most of the surface, and on what the host installs around
// it: a readable stream, the encoders, and the blob types.
function surface() {
    return evaluate(
        sandbox({
            TextEncoder,
            TextDecoder,
            Blob,
            File,
            FormData,
            console: { error() {} },
        }),
        'events',
        'abort',
        'readable-stream',
        'url',
        'headers',
        'request',
        'response'
    );
}

const box = surface();
const { Request, Response, Headers, AbortController, AbortSignal, URLSearchParams } = box;
const { TypeError, RangeError, Uint8Array } = intrinsics(box);

describe('Response status', () => {
    test('defaults to 200', () => {
        expect(new Response('hi').status).toBe(200);
    });

    test('refuses a status below 200', () => {
        expect(() => new Response(null, { status: 199 })).toThrow(RangeError);
    });

    test('refuses a status above 599', () => {
        expect(() => new Response(null, { status: 600 })).toThrow(RangeError);
    });

    test('refuses a body with a null body status', () => {
        expect(() => new Response('hi', { status: 204 })).toThrow(TypeError);
        expect(() => new Response('hi', { status: 304 })).toThrow(TypeError);
    });

    test('accepts a null body status without a body', () => {
        expect(new Response(null, { status: 204 }).status).toBe(204);
    });

    test('error is a network error, and keeps its status of zero', () => {
        const response = Response.error();

        expect(response.status).toBe(0);
        expect(response.ok).toBe(false);
        expect(response.type).toBe('error');
    });

    test('redirect refuses a status that is not a redirect', () => {
        expect(() => Response.redirect('https://example.com/', 200)).toThrow(RangeError);
    });

    test('an accepted upgrade carries 101 and its socket', () => {
        const socket = { send() {} };
        const response = new Response(null, { status: 101, webSocket: socket });

        expect(response.status).toBe(101);
        expect(response.webSocket).toBe(socket);
    });

    test('101 without a socket is still outside the range', () => {
        expect(() => new Response(null, { status: 101 })).toThrow(RangeError);
    });

    test('an upgrade still refuses a body', () => {
        const socket = { send() {} };

        expect(() => new Response('hi', { status: 101, webSocket: socket })).toThrow(TypeError);
    });
});

describe('the content type a body implies', () => {
    test('a string is text/plain', () => {
        expect(new Response('hi').headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    });

    test('URLSearchParams is urlencoded', () => {
        const response = new Response(new URLSearchParams('a=1'));

        expect(response.headers.get('content-type')).toBe(
            'application/x-www-form-urlencoded;charset=UTF-8'
        );
    });

    test('a named type wins over the implied one', () => {
        const response = new Response('hi', { headers: { 'content-type': 'text/html' } });

        expect(response.headers.get('content-type')).toBe('text/html');
    });

    test('bytes imply nothing', () => {
        expect(new Response(new Uint8Array([1])).headers.get('content-type')).toBeNull();
    });

    test('a Request infers it too', () => {
        const request = new Request('https://example.com/', { method: 'POST', body: 'hi' });

        expect(request.headers.get('content-type')).toBe('text/plain;charset=UTF-8');
    });
});

describe('reading a body', () => {
    test('an absent body reads as the empty string', async () => {
        expect(await new Response(null).text()).toBe('');
    });

    test('an absent body reads as an empty buffer', async () => {
        expect((await new Response(null).arrayBuffer()).byteLength).toBe(0);
    });

    test('bytes come back as a Uint8Array', async () => {
        const bytes = await new Response('hi').bytes();

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect([...bytes]).toEqual([104, 105]);
    });

    test('blob carries the content type', async () => {
        const blob = await new Response('hi').blob();

        expect(blob.type.toLowerCase()).toBe('text/plain;charset=utf-8');
        expect(await blob.text()).toBe('hi');
    });

    test('a body reads only once', async () => {
        const response = new Response('hi');
        await response.text();

        expect(response.text()).rejects.toBeInstanceOf(TypeError);
    });
});

describe('Request', () => {
    test('refuses a body on GET and on HEAD', () => {
        expect(() => new Request('https://example.com/', { body: 'hi' })).toThrow(TypeError);
        expect(
            () => new Request('https://example.com/', { method: 'HEAD', body: 'hi' })
        ).toThrow(TypeError);
    });

    test('lets the host build one with a body on any method', () => {
        const request = new Request('https://example.com/', { body: 'hi', _fromHost: true });

        expect(request.method).toBe('GET');
    });

    test('exposes an AbortSignal', () => {
        expect(new Request('https://example.com/').signal).toBeInstanceOf(AbortSignal);
    });

    test('takes a signal from init', () => {
        const controller = new AbortController();
        const request = new Request('https://example.com/', { signal: controller.signal });

        expect(request.signal.aborted).toBe(false);
        controller.abort();
        expect(request.signal.aborted).toBe(true);
    });

    test('defaults keepalive to false', () => {
        expect(new Request('https://example.com/').keepalive).toBe(false);
    });

    test('refuses a relative url', () => {
        expect(() => new Request('/relative')).toThrow(TypeError);
    });

    test('carries its headers as a Headers', () => {
        const request = new Request('https://example.com/', { headers: { 'X-A': '1' } });

        expect(request.headers).toBeInstanceOf(Headers);
        expect(request.headers.get('x-a')).toBe('1');
    });
});
