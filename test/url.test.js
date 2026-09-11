// `URL` and `URLSearchParams`, against the URL Standard.
//
// Parsing belongs to the host, so what is measured here is what the module
// itself owns: the urlencoded rules, the link between a URL and its
// searchParams, and that the module keeps asking its host at all.

import { describe, expect, test } from 'bun:test';

import { load } from './support/surface.js';

const { URL, URLSearchParams } = load('url');

describe('URL', () => {
    test('exposes the components of its input', () => {
        const url = new URL('https://user:pw@example.com:8443/a/b?x=1#frag');

        expect(url.protocol).toBe('https:');
        expect(url.username).toBe('user');
        expect(url.password).toBe('pw');
        expect(url.host).toBe('example.com:8443');
        expect(url.hostname).toBe('example.com');
        expect(url.port).toBe('8443');
        expect(url.pathname).toBe('/a/b');
        expect(url.search).toBe('?x=1');
        expect(url.hash).toBe('#frag');
    });

    test('resolves against a base', () => {
        expect(new URL('../c', 'https://example.com/a/b').href).toBe('https://example.com/c');
    });

    test('throws on an input that does not parse', () => {
        expect(() => new URL('not a url')).toThrow(TypeError);
    });

    test('canParse answers without throwing', () => {
        expect(URL.canParse('https://example.com')).toBe(true);
        expect(URL.canParse('not a url')).toBe(false);
    });

    test('parse returns null instead of throwing', () => {
        expect(URL.parse('not a url')).toBeNull();
        expect(URL.parse('https://example.com').href).toBe('https://example.com/');
    });

    test('a setter goes back through the host', () => {
        const url = new URL('https://example.com/a');
        url.pathname = '/b';

        expect(url.href).toBe('https://example.com/b');
    });

    test('toString and toJSON are the href', () => {
        const url = new URL('https://example.com/a');

        expect(url.toString()).toBe(url.href);
        expect(url.toJSON()).toBe(url.href);
    });
});

describe('searchParams, linked to its URL', () => {
    test('reads the query of the URL it came from', () => {
        expect(new URL('https://example.com/?a=1&b=2').searchParams.get('b')).toBe('2');
    });

    test('appending writes through to the href', () => {
        const url = new URL('https://example.com/');
        url.searchParams.append('a', '1');

        expect(url.search).toBe('?a=1');
        expect(url.href).toBe('https://example.com/?a=1');
    });

    test('setting the search re-reads the pairs', () => {
        const url = new URL('https://example.com/?a=1');
        const params = url.searchParams;
        url.search = '?b=2';

        expect(params.get('a')).toBeNull();
        expect(params.get('b')).toBe('2');
    });

    test('setting the href re-reads the pairs', () => {
        const url = new URL('https://example.com/?a=1');
        const params = url.searchParams;
        url.href = 'https://example.com/?c=3';

        expect([...params.keys()]).toEqual(['c']);
    });

    test('the same object comes back every time', () => {
        const url = new URL('https://example.com/');

        expect(url.searchParams).toBe(url.searchParams);
    });
});

describe('URLSearchParams', () => {
    test('accepts a string, an iterable and a record', () => {
        expect(new URLSearchParams('a=1').get('a')).toBe('1');
        expect(new URLSearchParams([['a', '1']]).get('a')).toBe('1');
        expect(new URLSearchParams({ a: '1' }).get('a')).toBe('1');
    });

    test('rejects an entry that is not a pair', () => {
        expect(() => new URLSearchParams([['a']])).toThrow(TypeError);
    });

    test('keeps every value of a name', () => {
        const params = new URLSearchParams('a=1&a=2');

        expect(params.getAll('a')).toEqual(['1', '2']);
        expect(params.get('a')).toBe('1');
        expect(params.size).toBe(2);
    });

    test('set replaces every value and keeps the position', () => {
        const params = new URLSearchParams('a=1&b=2&a=3');
        params.set('a', '9');

        expect(params.toString()).toBe('a=9&b=2');
    });

    test('delete takes an optional value', () => {
        const params = new URLSearchParams('a=1&a=2');
        params.delete('a', '1');

        expect(params.getAll('a')).toEqual(['2']);
    });

    test('has takes an optional value', () => {
        const params = new URLSearchParams('a=1');

        expect(params.has('a', '1')).toBe(true);
        expect(params.has('a', '2')).toBe(false);
    });

    test('sort is stable across names', () => {
        const params = new URLSearchParams('c=3&a=1&b=2');
        params.sort();

        expect(params.toString()).toBe('a=1&b=2&c=3');
    });

    test('a plus in the input is a space', () => {
        expect(new URLSearchParams('a=one+two').get('a')).toBe('one two');
    });

    test('a space serializes as a plus', () => {
        expect(new URLSearchParams([['a', 'one two']]).toString()).toBe('a=one+two');
    });

    test('the urlencoded safe set is narrower than encodeURIComponent', () => {
        expect(new URLSearchParams([['a', "!'()~"]]).toString()).toBe('a=%21%27%28%29%7E');
    });

    test('a malformed percent escape decodes byte by byte', () => {
        expect(new URLSearchParams('a=%zz').get('a')).toBe('%zz');
    });

    test('a pair without an equals sign has an empty value', () => {
        expect(new URLSearchParams('a').get('a')).toBe('');
    });

    test('forEach passes value, name and the params', () => {
        const params = new URLSearchParams('a=1');
        const seen = [];
        params.forEach((value, name, self) => seen.push([name, value, self === params]));

        expect(seen).toEqual([['a', '1', true]]);
    });

    test('is iterable', () => {
        expect([...new URLSearchParams('a=1&b=2')]).toEqual([
            ['a', '1'],
            ['b', '2'],
        ]);
    });
});

describe('the host contract', () => {
    test('parsing is the host s, not the module s', () => {
        const sandbox = load('url');
        new sandbox.URL('https://example.com/a');

        expect(sandbox.__ow.calls.map((call) => call.name)).toEqual(['urlParse']);
    });

    test('a setter asks the host to apply the part', () => {
        const sandbox = load('url');
        const url = new sandbox.URL('https://example.com/a');
        sandbox.__ow.calls.length = 0;
        url.pathname = '/b';

        expect(sandbox.__ow.calls).toEqual([
            { name: 'urlUpdate', args: ['https://example.com/a', 'pathname', '/b'] },
        ]);
    });
});
