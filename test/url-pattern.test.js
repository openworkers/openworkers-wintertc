// `URLPattern`, against the URL Pattern Standard.
//
// The grammar is the host's, so what is measured here is the matching: what the
// module does with the components the host hands back.

import { describe, expect, test } from 'bun:test';

import { intrinsics, load } from './support/surface.js';

const box = load('url-pattern');
const { URLPattern } = box;
const { TypeError } = intrinsics(box);

describe('matching', () => {
    test('a literal component matches itself', () => {
        expect(new URLPattern({ pathname: '/books' }).test('https://example.com/books')).toBe(true);
    });

    test('a literal component refuses anything else', () => {
        expect(new URLPattern({ pathname: '/books' }).test('https://example.com/films')).toBe(false);
    });

    test('a wildcard component matches anything', () => {
        expect(new URLPattern({}).test('https://example.com/anything')).toBe(true);
    });

    test('a named group captures its segment', () => {
        const found = new URLPattern({ pathname: '/books/:id' }).exec('https://example.com/books/42');

        expect(found.pathname.groups.id).toBe('42');
        expect(found.pathname.input).toBe('/books/42');
    });

    test('a named group does not cross a slash', () => {
        const pattern = new URLPattern({ pathname: '/books/:id' });

        expect(pattern.test('https://example.com/books/42/pages')).toBe(false);
    });

    test('every component has to match', () => {
        const pattern = new URLPattern({ hostname: 'example.com', pathname: '/books' });

        expect(pattern.test('https://example.com/books')).toBe(true);
        expect(pattern.test('https://elsewhere.com/books')).toBe(false);
    });

    test('exec returns null when nothing matches', () => {
        expect(new URLPattern({ pathname: '/books' }).exec('https://example.com/films')).toBeNull();
    });

    test('exec carries its inputs back', () => {
        const found = new URLPattern({}).exec('https://example.com/');

        expect(found.inputs).toEqual(['https://example.com/']);
    });

    test('an input that is not a url matches nothing', () => {
        expect(new URLPattern({}).test('not a url')).toBe(false);
    });
});

describe('the pattern it was given', () => {
    test('reads its components back', () => {
        const pattern = new URLPattern({ pathname: '/books/:id' });

        expect(pattern.pathname).toBe('/books/:id');
        expect(pattern.hostname).toBe('*');
    });

    test('refuses a pattern the host will not parse', () => {
        expect(() => new URLPattern('https://example.com/books')).toThrow(TypeError);
    });
});

describe('the host contract', () => {
    test('the grammar is the host s, not the module s', () => {
        const sandbox = load('url-pattern');
        new sandbox.URLPattern({ pathname: '/books' });

        expect(sandbox.__ow.calls.map((call) => call.name)).toEqual(['urlPatternParse']);
    });

    test('matching asks the host to canonicalise the input', () => {
        const sandbox = load('url-pattern');
        const pattern = new sandbox.URLPattern({ pathname: '/books' });
        sandbox.__ow.calls.length = 0;
        pattern.test('https://example.com/books');

        expect(sandbox.__ow.calls.map((call) => call.name)).toEqual(['urlPatternProcessInput']);
    });
});
