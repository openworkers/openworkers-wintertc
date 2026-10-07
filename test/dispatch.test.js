// The dispatch between a host and the guest's handlers, with a stand-in for
// the engine's body streaming.

import { readFileSync } from 'node:fs';
import { runInContext } from 'node:vm';

import { describe, expect, test } from 'bun:test';

import { evaluate, sandbox } from './support/surface.js';

const DISPATCH = readFileSync(new URL('../js/dispatch.js', import.meta.url), 'utf8');

// The surface a host evaluates before the dispatch.
function surface() {
    return evaluate(
        sandbox({
            TextEncoder,
            TextDecoder,
            Blob,
            File,
            FormData,
            console: { error() {}, log() {} },
        }),
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

// A realm as a host builds one: the surface, then the dispatch, then the
// guest script. The engine stand-in ends every body at once.
function realm(script) {
    const box = surface();

    const engine = {
        streamed: [],
        disconnected: [],
        streamBody(response, ended) {
            engine.streamed.push(response);
            ended();
        },
        disconnect(response) {
            engine.disconnected.push(response);
        },
    };

    const dispatch = runInContext(DISPATCH, box, { filename: 'js/dispatch.js' })(engine);
    runInContext(script, box, { filename: 'guest.js' });

    return { box, dispatch, engine };
}

// Serves one request and answers the status and the body text.
async function fetch(script) {
    const { box, dispatch } = realm(script);
    const handle = dispatch.fetch(new box.Request('http://localhost/'));
    const response = await handle.answer;

    await handle.done;

    return [response.status, await response.text()];
}

async function task(script, event = {}) {
    const { dispatch } = realm(script);

    return dispatch.task(event).done;
}

describe('fetch through addEventListener', () => {
    test('respondWith a Response', async () => {
        expect(await fetch("addEventListener('fetch', e => e.respondWith(new Response('ok', { status: 201 })));")).toEqual([201, 'ok']);
    });

    test('respondWith a promise', async () => {
        expect(await fetch("addEventListener('fetch', e => e.respondWith(Promise.resolve(new Response('later'))));")).toEqual([200, 'later']);
    });

    test('a returned Response answers', async () => {
        expect(await fetch("addEventListener('fetch', () => new Response('returned'));")).toEqual([200, 'returned']);
    });

    test('a returned promise answers', async () => {
        expect(await fetch("addEventListener('fetch', async () => new Response('async'));")).toEqual([200, 'async']);
    });

    test('respondWith wins over a returned Response', async () => {
        const script = "addEventListener('fetch', e => { e.respondWith(new Response('respondWith')); return new Response('returned'); });";

        expect(await fetch(script)).toEqual([200, 'respondWith']);
    });

    test('respondWith from a timer answers', async () => {
        const script = "addEventListener('fetch', e => { setTimeout(() => e.respondWith(new Response('late')), 5); });";

        expect(await fetch(script)).toEqual([200, 'late']);
    });

    test('a second respondWith keeps the first response', async () => {
        const script = "addEventListener('fetch', e => { e.respondWith(new Response('first')); e.respondWith(new Response('second')); });";

        expect(await fetch(script)).toEqual([200, 'first']);
    });

    test('a thrown error answers 500', async () => {
        expect(await fetch("addEventListener('fetch', () => { throw new Error('boom'); });")).toEqual([500, 'Handler exception: boom']);
    });

    test('a rejected respondWith answers 500', async () => {
        expect(await fetch("addEventListener('fetch', e => e.respondWith(Promise.reject(new Error('boom'))));")).toEqual([500, 'Handler exception: boom']);
    });

    test('something else than a Response answers 500', async () => {
        expect(await fetch("addEventListener('fetch', e => e.respondWith('text'));")).toEqual([
            500,
            'Handler exception: the fetch handler did not answer with a Response',
        ]);
    });

    test('no handler answers 501', async () => {
        expect(await fetch('globalThis.nothing = 1;')).toEqual([501, 'Worker does not implement fetch handler']);
    });
});

describe('fetch through export default', () => {
    test('gets the request, env and ctx', async () => {
        const script = `
            globalThis.env = { NAME: 'x' };
            globalThis.default = {
                fetch(request, env, ctx) {
                    ctx.passThroughOnException();
                    return new Response([request.url, env.NAME, typeof ctx.waitUntil].join(' '));
                },
            };
        `;

        expect(await fetch(script)).toEqual([200, 'http://localhost/ x function']);
    });

    test('is called as a method of the module', async () => {
        const script = "globalThis.default = { name: 'mod', fetch() { return new Response(this.name); } };";

        expect(await fetch(script)).toEqual([200, 'mod']);
    });

    test('wins over a listener, whatever the order', async () => {
        const script = `
            globalThis.default = { fetch: () => new Response('module') };
            addEventListener('fetch', e => e.respondWith(new Response('listener')));
        `;

        expect(await fetch(script)).toEqual([200, 'module']);
    });

    test('returning nothing answers 500', async () => {
        expect(await fetch('globalThis.default = { fetch() {} };')).toEqual([500, 'Handler exception: the fetch handler did not respond']);
    });

    test('a module without fetch answers 501', async () => {
        expect(await fetch('globalThis.default = { scheduled() {} };')).toEqual([501, 'Worker does not implement fetch handler']);
    });
});

describe('the fetch handle', () => {
    test('done waits for waitUntil, after the answer', async () => {
        const { box, dispatch } = realm(`
            globalThis.later = 0;
            addEventListener('fetch', e => {
                e.waitUntil(new Promise(r => setTimeout(() => { globalThis.later = 1; r(); }, 5)));
                e.respondWith(new Response('now'));
            });
        `);
        const handle = dispatch.fetch(new box.Request('http://localhost/'));

        await handle.answer;
        expect(box.later).toBe(0);

        await handle.done;
        expect(box.later).toBe(1);
    });

    test('a rejected waitUntil keeps the response and fulfils done', async () => {
        const { box, dispatch } = realm(`
            addEventListener('fetch', e => {
                e.waitUntil(Promise.reject(new Error('background')));
                e.respondWith(new Response('kept'));
            });
        `);
        const handle = dispatch.fetch(new box.Request('http://localhost/'));

        expect(await (await handle.answer).text()).toBe('kept');
        await handle.done;
    });

    test('streamed follows the engine, and disconnect reaches it with the response', async () => {
        const { box, dispatch, engine } = realm("addEventListener('fetch', e => e.respondWith(new Response('body')));");
        const handle = dispatch.fetch(new box.Request('http://localhost/'));
        const response = await handle.answer;

        await handle.streamed;
        handle.disconnect();

        expect(engine.streamed).toEqual([response]);
        expect(engine.disconnected).toEqual([response]);
    });

    test('a guest that replaces Response does not change the check', async () => {
        const script = `
            const Real = Response;
            addEventListener('fetch', e => {
                globalThis.Response = class Fake {};
                e.respondWith(new Real('real'));
            });
        `;

        expect(await fetch(script)).toEqual([200, 'real']);
    });

    test('addEventListener is the only global the dispatch sets', () => {
        const box = surface();
        const before = Object.getOwnPropertyNames(box);

        runInContext(DISPATCH, box)({ streamBody() {}, disconnect() {} });

        expect(Object.getOwnPropertyNames(box).filter((name) => !before.includes(name))).toEqual(['addEventListener']);
    });
});

describe('tasks', () => {
    test('a listener answers with respondWith', async () => {
        expect(await task("addEventListener('task', e => e.respondWith({ success: true, data: e.payload.n * 2 }));", { payload: { n: 21 } })).toEqual({
            success: true,
            data: 42,
            error: undefined,
        });
    });

    test('a listener answers with its value', async () => {
        expect(await task("addEventListener('task', e => e.payload + 1);", { payload: 1 })).toEqual({ success: true, data: 2 });
    });

    test('respondWith keeps plain data', async () => {
        expect(await task("addEventListener('task', e => e.respondWith({ rows: 3 }));")).toEqual({ success: true, data: { rows: 3 } });
    });

    test('a result can report a failure', async () => {
        expect(await task("addEventListener('task', () => ({ success: false, error: 'refused' }));")).toEqual({
            success: false,
            data: undefined,
            error: 'refused',
        });
    });

    test('a thrown error fails the task', async () => {
        expect(await task("addEventListener('task', () => { throw new Error('boom'); });")).toEqual({ success: false, error: 'boom' });
    });

    test('a rejected waitUntil fails the task', async () => {
        expect(await task("addEventListener('task', e => { e.waitUntil(Promise.reject(new Error('later'))); return 1; });")).toEqual({
            success: false,
            error: 'later',
        });
    });

    test('a module task gets env and ctx', async () => {
        const script = "globalThis.env = { K: 3 }; globalThis.default = { task(event, env, ctx) { return env.K + typeof ctx.waitUntil; } };";

        expect(await task(script)).toEqual({ success: true, data: '3function' });
    });

    test('a scheduled handler serves a cron event, with type and noRetry', async () => {
        const script = `
            addEventListener('scheduled', e => {
                e.noRetry();
                globalThis.seen = [e.type, e.scheduledTime, e.cron].join(' ');
            });
        `;
        const { box, dispatch } = realm(script);
        const result = await dispatch.task({ scheduledTime: 1000, cron: '* * * * *' }).done;

        expect(result).toEqual({ success: true });
        expect(box.seen).toBe('scheduled 1000 * * * * *');
    });

    test('a task handler wins over a scheduled one', async () => {
        const script = "addEventListener('scheduled', () => {}); addEventListener('task', () => 'task');";

        expect(await task(script, { scheduledTime: 1 })).toEqual({ success: true, data: 'task' });
    });

    test('no handler fails at once, named for the event', async () => {
        expect(await task("addEventListener('fetch', () => new Response('x'));")).toEqual({
            success: false,
            error: 'Worker does not implement task handler',
        });
        expect(await task('globalThis.default = { fetch() {} };', { scheduledTime: 1 })).toEqual({
            success: false,
            error: 'Worker does not implement scheduled handler',
        });
    });
});
