// `Headers`, against the Fetch Standard.

import { describe, expect, test } from 'bun:test';

import { intrinsics, load } from './support/surface.js';

const surface = load('headers');
const { Headers } = surface;
const { Map, TypeError } = intrinsics(surface);

describe('construction', () => {
    test('is a constructor', () => {
        expect(typeof Headers).toBe('function');
    });

    test('starts empty', () => {
        expect([...new Headers().keys()]).toEqual([]);
    });

    test('accepts a record', () => {
        expect(new Headers({ 'X-A': '1' }).get('X-A')).toBe('1');
    });

    test('accepts a sequence of pairs', () => {
        expect(new Headers([['x-a', '1']]).get('x-a')).toBe('1');
    });

    test('accepts another Headers', () => {
        expect(new Headers(new Headers({ 'x-a': '1' })).get('x-a')).toBe('1');
    });

    test('takes every value when copying a Headers with repeats', () => {
        const source = new Headers();
        source.append('x-a', '1');
        source.append('x-a', '2');

        expect(new Headers(source).get('x-a')).toBe('1, 2');
    });
});

describe('lookup', () => {
    test('get combines every value of a name kept apart', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');

        expect(headers.get('set-cookie')).toBe('a=1, b=2');
    });

    test('get is case-insensitive', () => {
        const headers = new Headers({ 'Content-Type': 'text/plain' });

        expect(headers.get('content-type')).toBe('text/plain');
        expect(headers.get('CONTENT-TYPE')).toBe('text/plain');
    });

    test('get returns null when absent', () => {
        expect(new Headers().get('x-missing')).toBeNull();
    });

    test('has is case-insensitive', () => {
        expect(new Headers({ 'X-A': '1' }).has('x-a')).toBe(true);
    });
});

describe('mutation', () => {
    test('set overwrites', () => {
        const headers = new Headers({ 'x-a': '1' });
        headers.set('X-A', '2');

        expect(headers.get('x-a')).toBe('2');
    });

    test('append joins with a comma and a space', () => {
        const headers = new Headers();
        headers.append('x-a', '1');
        headers.append('x-a', '2');

        expect(headers.get('x-a')).toBe('1, 2');
    });

    test('append is case-insensitive', () => {
        const headers = new Headers({ 'x-a': '1' });
        headers.append('X-A', '2');

        expect(headers.get('x-a')).toBe('1, 2');
    });

    test('delete removes the entry', () => {
        const headers = new Headers({ 'x-a': '1' });
        headers.delete('X-A');

        expect(headers.has('x-a')).toBe(false);
    });

    test('delete of an absent name is a no-op', () => {
        const headers = new Headers({ 'x-a': '1' });
        headers.delete('x-b');

        expect(headers.get('x-a')).toBe('1');
    });

    test('coerces a non-string value', () => {
        const headers = new Headers();
        headers.set('x-a', 1);

        expect(headers.get('x-a')).toBe('1');
    });
});

describe('validation', () => {
    test('trims surrounding whitespace from a value', () => {
        expect(new Headers({ 'x-a': '  1  ' }).get('x-a')).toBe('1');
    });

    test('rejects an invalid name', () => {
        expect(() => new Headers().set('x a', '1')).toThrow(TypeError);
    });

    test('rejects a name on every entry point', () => {
        const headers = new Headers();

        expect(() => headers.append('x a', '1')).toThrow(TypeError);
        expect(() => headers.get('x a')).toThrow(TypeError);
        expect(() => headers.has('x a')).toThrow(TypeError);
        expect(() => headers.delete('x a')).toThrow(TypeError);
    });

    test('rejects a value with a newline', () => {
        expect(() => new Headers().set('x-a', 'a\nb')).toThrow(TypeError);
    });

    test('rejects a value with a NUL', () => {
        expect(() => new Headers().set('x-a', 'a\0b')).toThrow(TypeError);
    });

    test('accepts the punctuation a token allows', () => {
        expect(new Headers({ "x-a!#$%&'*+.^_`|~1": '1' }).get("X-A!#$%&'*+.^_`|~1")).toBe('1');
    });
});

describe('iteration', () => {
    test('lowercases names', () => {
        expect([...new Headers({ 'X-Ab': '1' }).keys()]).toEqual(['x-ab']);
    });

    test('is sorted by name', () => {
        const headers = new Headers({ 'x-c': '3', 'x-a': '1', 'x-b': '2' });

        expect([...headers.keys()]).toEqual(['x-a', 'x-b', 'x-c']);
    });

    test('entries yields name and value', () => {
        expect(new Headers({ 'x-a': '1' }).entries().next().value).toEqual(['x-a', '1']);
    });

    test('values yields values', () => {
        expect([...new Headers({ 'x-a': '1', 'x-b': '2' }).values()]).toEqual(['1', '2']);
    });

    test('forEach passes value, name and the headers', () => {
        const headers = new Headers({ 'x-a': '1' });
        const seen = [];
        headers.forEach((value, name, self) => seen.push([name, value, self === headers]));

        expect(seen).toEqual([['x-a', '1', true]]);
    });

    test('is iterable', () => {
        expect([...new Headers({ 'x-a': '1' })]).toEqual([['x-a', '1']]);
    });
});

describe('set-cookie', () => {
    test('keeps two values apart', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');

        expect(headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    });

    test('iterates once per value', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');

        expect([...headers].map((pair) => pair[1])).toEqual(['a=1', 'b=2']);
    });

    test('getSetCookie is empty without a cookie', () => {
        expect(new Headers({ 'x-a': '1' }).getSetCookie()).toEqual([]);
    });

    test('set replaces every value', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');
        headers.set('Set-Cookie', 'c=3');

        expect(headers.getSetCookie()).toEqual(['c=3']);
    });

    test('keys yields the name once per value', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');

        expect([...headers.keys()]).toEqual(['set-cookie', 'set-cookie']);
    });
});

describe('the host contract', () => {
    test('_map is a Map keyed by the lowercased name', () => {
        const headers = new Headers({ 'X-A': '1' });

        expect(headers._map).toBeInstanceOf(Map);
        expect(headers._map.get('x-a')).toBe('1');
    });

    test('_map holds an array for a header that must not be comma-joined', () => {
        const headers = new Headers();
        headers.append('Set-Cookie', 'a=1');
        headers.append('Set-Cookie', 'b=2');

        expect(headers._map.get('set-cookie')).toEqual(['a=1', 'b=2']);
    });
});

describe('the Headers init', () => {
    test('takes any iterable of pairs', () => {
        const headers = new Headers(new Map([['x-a', '1'], ['x-b', '2']]));

        expect(headers.get('x-a')).toBe('1');
        expect(headers.get('x-b')).toBe('2');
    });

    test('refuses an entry that is not a pair', () => {
        expect(() => new Headers([['x-a']])).toThrow(TypeError);
        expect(() => new Headers([['x-a', '1', '2']])).toThrow(TypeError);
        expect(() => new Headers([null])).toThrow(TypeError);
    });

    test('reads an object with an iterator as a sequence', () => {
        expect(
            () =>
                new Headers({
                    [Symbol.iterator]() {
                        throw new TypeError('nope');
                    },
                })
        ).toThrow('nope');
    });
});
