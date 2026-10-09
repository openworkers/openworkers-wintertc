// AsyncContext and AsyncLocalStorage, on a host that only holds the current
// frame. Carrying it across await is the host's part, tested in each runtime.

import { describe, expect, test } from 'bun:test';

import { intrinsics, load } from './support/surface.js';

const box = load('async-context');
const { AsyncContext, AsyncLocalStorage } = box;
const { TypeError } = intrinsics(box);

describe('AsyncContext.Variable', () => {
    test('answers its default value outside run', () => {
        const variable = new AsyncContext.Variable({ name: 'request', defaultValue: 'none' });

        expect(variable.name).toBe('request');
        expect(variable.get()).toBe('none');
    });

    test('answers the value of the run around it, and its default after', () => {
        const variable = new AsyncContext.Variable();

        expect(variable.run('inner', () => variable.get())).toBe('inner');
        expect(variable.get()).toBeUndefined();
    });

    test('a nested run hides the outer value and gives it back', () => {
        const variable = new AsyncContext.Variable();

        const seen = variable.run('outer', () => {
            const inner = variable.run('inner', () => variable.get());

            return [inner, variable.get()];
        });

        expect(seen).toEqual(['inner', 'outer']);
    });

    test('a throwing run still gives the outer value back', () => {
        const variable = new AsyncContext.Variable();

        variable.run('outer', () => {
            expect(() =>
                variable.run('inner', () => {
                    throw new Error('boom');
                })
            ).toThrow('boom');
            expect(variable.get()).toBe('outer');
        });
    });

    test('two variables do not see each other', () => {
        const a = new AsyncContext.Variable();
        const b = new AsyncContext.Variable();

        expect(a.run(1, () => b.run(2, () => [a.get(), b.get()]))).toEqual([1, 2]);
    });

    test('run passes its extra arguments', () => {
        const variable = new AsyncContext.Variable();

        expect(variable.run('v', (x, y) => [variable.get(), x + y], 2, 3)).toEqual(['v', 5]);
    });
});

describe('AsyncContext.Snapshot', () => {
    test('runs a function in the frame it captured', () => {
        const variable = new AsyncContext.Variable();
        const snapshot = variable.run('captured', () => new AsyncContext.Snapshot());

        expect(variable.run('now', () => snapshot.run(() => variable.get()))).toBe('captured');
    });

    test('wrap keeps this and the arguments', () => {
        const variable = new AsyncContext.Variable();
        const wrapped = variable.run('captured', () =>
            AsyncContext.Snapshot.wrap(function (x) {
                return [this.name, x, variable.get()];
            })
        );

        expect(wrapped.call({ name: 'self' }, 7)).toEqual(['self', 7, 'captured']);
    });

    test('wrap refuses what is not a function', () => {
        expect(() => AsyncContext.Snapshot.wrap(1)).toThrow(TypeError);
    });
});

describe('AsyncLocalStorage', () => {
    test('getStore answers the store of the run around it', () => {
        const als = new AsyncLocalStorage();

        expect(als.getStore()).toBeUndefined();
        expect(als.run({ id: 1 }, () => als.getStore())).toEqual({ id: 1 });
        expect(als.getStore()).toBeUndefined();
    });

    test('a nested run gives the outer store back', () => {
        const als = new AsyncLocalStorage();

        expect(als.run('outer', () => [als.run('inner', () => als.getStore()), als.getStore()])).toEqual([
            'inner',
            'outer',
        ]);
    });

    test('exit runs without the store', () => {
        const als = new AsyncLocalStorage();

        expect(als.run('store', () => als.exit(() => als.getStore()))).toBeUndefined();
    });

    test('enterWith sets the store for the rest of the run', () => {
        const als = new AsyncLocalStorage();

        const seen = als.run('first', () => {
            als.enterWith('second');

            return als.getStore();
        });

        expect(seen).toBe('second');
        expect(als.getStore()).toBeUndefined();
    });

    test('bind and snapshot carry the store to a later call', () => {
        const als = new AsyncLocalStorage();
        const bound = als.run('bound', () => AsyncLocalStorage.bind(() => als.getStore()));
        const snapshot = als.run('snap', () => AsyncLocalStorage.snapshot());

        expect(bound()).toBe('bound');
        expect(snapshot(() => als.getStore())).toBe('snap');
    });

    test('two storages do not see each other', () => {
        const a = new AsyncLocalStorage();
        const b = new AsyncLocalStorage();

        expect(a.run('a', () => b.getStore())).toBeUndefined();
    });
});
