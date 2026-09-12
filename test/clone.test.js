// `structuredClone`, `Blob`, `File` and `FormData`.

import { describe, expect, test } from 'bun:test';

import { evaluate, intrinsics, sandbox } from './support/surface.js';

const box = evaluate(
    sandbox({ TextEncoder, TextDecoder }),
    'events',
    'abort',
    'readable-stream',
    'blob',
    'form-data',
    'structured-clone'
);
const { structuredClone, Blob, File, FormData, DOMException } = box;
const { ArrayBuffer, Uint8Array, Map, Set, Error, TypeError } = intrinsics(box);

describe('structuredClone', () => {
    test('copies a plain object deeply', () => {
        const source = { a: { b: 1 } };
        const copy = structuredClone(source);

        expect(copy).toEqual(source);
        expect(copy.a).not.toBe(source.a);
    });

    test('keeps a circular reference', () => {
        const source = {};
        source.self = source;

        const copy = structuredClone(source);

        expect(copy.self).toBe(copy);
        expect(copy).not.toBe(source);
    });

    test('copies a Map and a Set', () => {
        expect(structuredClone(new Map([['a', 1]])).get('a')).toBe(1);
        expect(structuredClone(new Set(['a'])).has('a')).toBe(true);
    });

    test('copies an Error', () => {
        const copy = structuredClone(new TypeError('boom'));

        expect(copy).toBeInstanceOf(Error);
        expect(copy.name).toBe('TypeError');
        expect(copy.message).toBe('boom');
    });

    test('refuses a function', () => {
        expect(() => structuredClone(() => {})).toThrow(DOMException);
    });

    test('refuses a symbol', () => {
        expect(() => structuredClone(Symbol('a'))).toThrow(DOMException);
    });

    test('what it refuses with is a DataCloneError', () => {
        try {
            structuredClone(() => {});
            expect.unreachable();
        } catch (error) {
            expect(error.name).toBe('DataCloneError');
        }
    });

    test('refuses a function nested in an object', () => {
        expect(() => structuredClone({ a: () => {} })).toThrow(DOMException);
    });

    test('transfers an ArrayBuffer away from the caller', () => {
        const source = new Uint8Array([1, 2, 3]).buffer;
        const copy = structuredClone(source, { transfer: [source] });

        expect(copy.byteLength).toBe(3);
        expect(source.byteLength).toBe(0);
    });

    test('copies an ArrayBuffer that is not transferred', () => {
        const source = new Uint8Array([1, 2, 3]).buffer;
        const copy = structuredClone(source);

        expect(copy.byteLength).toBe(3);
        expect(source.byteLength).toBe(3);
    });
});

describe('Blob', () => {
    test('lowercases the type from options', () => {
        expect(new Blob(['a'], { type: 'Text/Plain' }).type).toBe('text/plain');
    });

    test('has no type by default', () => {
        expect(new Blob(['a']).type).toBe('');
    });

    test('reads as bytes', async () => {
        const bytes = await new Blob(['hi']).bytes();

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect([...bytes]).toEqual([104, 105]);
    });

    test('reads as text', async () => {
        expect(await new Blob(['hi']).text()).toBe('hi');
    });

    test('a File is a Blob with a name', () => {
        const file = new File(['a'], 'note.txt', { type: 'text/plain' });

        expect(file).toBeInstanceOf(Blob);
        expect(file.name).toBe('note.txt');
    });
});

describe('FormData', () => {
    test('coerces a non-string value', () => {
        const form = new FormData();
        form.append('a', 1);

        expect(form.get('a')).toBe('1');
    });

    test('set coerces too', () => {
        const form = new FormData();
        form.set('a', true);

        expect(form.get('a')).toBe('true');
    });

    test('keeps a Blob as it is', () => {
        const form = new FormData();
        const blob = new Blob(['a']);
        form.append('a', blob);

        expect(form.get('a')).toBe(blob);
    });

    test('append keeps every value of a name', () => {
        const form = new FormData();
        form.append('a', 1);
        form.append('a', 2);

        expect(form.getAll('a')).toEqual(['1', '2']);
    });
});
