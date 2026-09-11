// `btoa`, `atob`, `TextEncoder` and `TextDecoder`.

import { describe, expect, test } from 'bun:test';

import { evaluate, intrinsics, sandbox } from './support/surface.js';

// base64 reports its refusals as a DOMException, which `abort` installs.
const box = evaluate(sandbox(), 'events', 'abort', 'text-encoding', 'base64');
const { btoa, atob, TextEncoder, TextDecoder, DOMException } = box;
const { Uint8Array } = intrinsics(box);

describe('btoa', () => {
    test('encodes ascii', () => {
        expect(btoa('hello')).toBe('aGVsbG8=');
    });

    test('coerces a non-string argument', () => {
        expect(btoa(12)).toBe('MTI=');
    });

    test('refuses a character outside latin-1', () => {
        expect(() => btoa('\u00e9\u4e2d')).toThrow(DOMException);
    });
});

describe('atob', () => {
    test('decodes ascii', () => {
        expect(atob('aGVsbG8=')).toBe('hello');
    });

    test('refuses a character outside the alphabet', () => {
        expect(() => atob('a*b=')).toThrow(DOMException);
    });

    test('refuses a length of one modulo four', () => {
        expect(() => atob('aGVsbG8=a')).toThrow(DOMException);
    });

    test('refuses misplaced padding', () => {
        expect(() => atob('a=aa')).toThrow(DOMException);
    });

    test('what it refuses with is an InvalidCharacterError', () => {
        try {
            atob('*');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(DOMException);
            expect(error.name).toBe('InvalidCharacterError');
        }
    });

    test('ignores whitespace', () => {
        expect(atob('aGVs bG8=')).toBe('hello');
    });
});

describe('TextEncoder', () => {
    test('encodes nothing as nothing', () => {
        expect(new TextEncoder().encode().length).toBe(0);
    });

    test('encodeInto reports what it read and wrote', () => {
        const target = new Uint8Array(8);
        const result = new TextEncoder().encodeInto('ab', target);

        expect(result).toEqual({ read: 2, written: 2 });
        expect(target[0]).toBe(97);
    });

    test('encodeInto writes no half sequence', () => {
        const result = new TextEncoder().encodeInto('\u00e9', new Uint8Array(1));

        expect(result).toEqual({ read: 0, written: 0 });
    });

    test('encodeInto fills what it can of a longer source', () => {
        const target = new Uint8Array(3);
        const result = new TextEncoder().encodeInto('ab\u00e9', target);

        expect(result).toEqual({ read: 2, written: 2 });
        expect(target[2]).toBe(0);
    });
});

describe('TextDecoder', () => {
    test('normalizes an alias label', () => {
        expect(new TextDecoder('utf8').encoding).toBe('utf-8');
    });

    test('normalizes an uppercase label', () => {
        expect(new TextDecoder('UTF-8').encoding).toBe('utf-8');
    });

    test('refuses an unknown label', () => {
        // The refusal comes from the host, so it carries the host's realm: the
        // name is what crosses, not the constructor.
        expect(() => new TextDecoder('nope')).toThrow('Unsupported encoding label');
    });

    test('strips a byte order mark by default', () => {
        expect(new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 97]))).toBe('a');
    });

    test('keeps the byte order mark when told to', () => {
        const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

        expect(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 97]))).toBe('\ufeffa');
    });

    test('joins a sequence split across chunks', () => {
        const decoder = new TextDecoder();
        const head = decoder.decode(new Uint8Array([0xc3]), { stream: true });
        const tail = decoder.decode(new Uint8Array([0xa9]));

        expect(head + tail).toBe('\u00e9');
    });

    test('decodes nothing as the empty string', () => {
        expect(new TextDecoder().decode()).toBe('');
    });
});
