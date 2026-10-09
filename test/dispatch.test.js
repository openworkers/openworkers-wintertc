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
function realm(script, options = {}) {
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

    const dispatch = runInContext(DISPATCH, box, { filename: 'js/dispatch.js' })(engine, options);
    runInContext(script, box, { filename: 'guest.js' });

    return { box, dispatch, engine };
}

// Sends a fetch as a host does: the call, the microtask checkpoint after
// it, then the end of the dispatch.
async function dispatchFetch(box, dispatch, url = 'http://localhost/') {
    const handle = dispatch.fetch(new box.Request(url));

    await new Promise((resolve) => setTimeout(resolve, 0));
    handle.endDispatch();

    return handle;
}

// Serves one request and answers the status and the body text.
async function fetch(script, options) {
    const { box, dispatch } = realm(script, options);
    const handle = await dispatchFetch(box, dispatch);
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

    test('a plain listener answers with respondWith from a timer', async () => {
        const script = "addEventListener('fetch', e => { setTimeout(() => e.respondWith(new Response('late')), 5); });";

        expect(await fetch(script)).toEqual([200, 'late']);
    });

    test('an async listener answers with respondWith after an await', async () => {
        const script = `
            addEventListener('fetch', async (e) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                e.respondWith(new Response('after await'));
            });
        `;

        expect(await fetch(script)).toEqual([200, 'after await']);
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

// The marks a fetch leaves on its handle once it has answered.
async function marks(script) {
    const { box, dispatch } = realm(script);
    const handle = await dispatchFetch(box, dispatch);
    const response = await handle.answer;

    await handle.done;

    return [response.status, { ...handle.marks }];
}

describe('several fetch listeners', () => {
    test('run in order until one calls respondWith', async () => {
        const script = `
            globalThis.calls = [];
            addEventListener('fetch', () => calls.push('first'));
            addEventListener('fetch', e => { calls.push('second'); e.respondWith(new Response(calls.join(','))); });
            addEventListener('fetch', () => calls.push('third'));
        `;

        expect(await fetch(script)).toEqual([200, 'first,second']);
    });

    test('a listener that throws does not stop the next one', async () => {
        const script = `
            addEventListener('fetch', () => { throw new Error('first fails'); });
            addEventListener('fetch', e => e.respondWith(new Response('second answers')));
        `;

        expect(await fetch(script)).toEqual([200, 'second answers']);
    });

    test('preventDefault is there, and a later listener still answers', async () => {
        const script = `
            addEventListener('fetch', e => e.preventDefault());
            addEventListener('fetch', e => e.respondWith(new Response(String(e.defaultPrevented))));
        `;

        expect(await fetch(script)).toEqual([200, 'true']);
    });

    test('removeEventListener takes a listener out', async () => {
        const script = `
            const gone = e => e.respondWith(new Response('removed listener'));
            addEventListener('fetch', gone);
            removeEventListener('fetch', gone);
            addEventListener('fetch', e => e.respondWith(new Response('kept listener')));
        `;

        expect(await fetch(script)).toEqual([200, 'kept listener']);
    });

    test('a Response whose body was used answers 500', async () => {
        const script = "addEventListener('fetch', e => { const res = new Response('body'); res.text(); e.respondWith(res); });";

        expect(await fetch(script)).toEqual([500, 'Handler exception: the response body was already used']);
    });
});

describe('respondWith errors', () => {
    test('a second respondWith throws InvalidStateError', async () => {
        const script = `
            addEventListener('fetch', e => {
                e.respondWith(new Response('first'));
                try {
                    e.respondWith(new Response('second'));
                } catch (error) {
                    globalThis.second = error.name;
                }
            });
        `;
        const { box, dispatch } = realm(script);
        const handle = await dispatchFetch(box, dispatch);

        expect(await (await handle.answer).text()).toBe('first');
        expect(box.second).toBe('InvalidStateError');
    });
});

const strict = { strict: true };

describe('strict respondWith', () => {
    test('respondWith while the listener runs answers', async () => {
        expect(await fetch("addEventListener('fetch', e => e.respondWith(new Response('now')));", strict)).toEqual([200, 'now']);
    });

    test('respondWith with a promise answers when it settles', async () => {
        const script = `
            addEventListener('fetch', e => e.respondWith(new Promise((resolve) =>
                setTimeout(() => resolve(new Response('later')), 5))));
        `;

        expect(await fetch(script, strict)).toEqual([200, 'later']);
    });

    test('respondWith after an await on a settled promise is in time', async () => {
        const script = "addEventListener('fetch', async (e) => { await null; e.respondWith(new Response('microtask')); });";

        expect(await fetch(script, strict)).toEqual([200, 'microtask']);
    });

    test('respondWith from a task throws InvalidStateError, and the request fails at once', async () => {
        const script = `
            addEventListener('fetch', (e) => {
                setTimeout(() => {
                    try {
                        e.respondWith(new Response('late'));
                    } catch (error) {
                        globalThis.late = error.name;
                    }
                }, 5);
            });
        `;
        const { box, dispatch } = realm(script, strict);
        const handle = await dispatchFetch(box, dispatch);
        const response = await handle.answer;

        expect([response.status, await response.text()]).toEqual([
            500,
            'Handler exception: the fetch listener did not call respondWith',
        ]);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(box.late).toBe('InvalidStateError');
    });

    test('a returned Response does not answer', async () => {
        expect(await fetch("addEventListener('fetch', () => new Response('returned'));", strict)).toEqual([
            500,
            'Handler exception: the fetch listener did not call respondWith',
        ]);
    });

    test('a listener that throws answers with its error', async () => {
        expect(await fetch("addEventListener('fetch', () => { throw new Error('boom'); });", strict)).toEqual([
            500,
            'Handler exception: boom',
        ]);
    });

    test('export default is the same in both modes', async () => {
        expect(await fetch('globalThis.default = { async fetch() { return new Response("module"); } };', strict)).toEqual([
            200,
            'module',
        ]);
    });
});

describe('listener marks', () => {
    test('respondWith during the listener leaves no mark', async () => {
        expect(await marks("addEventListener('fetch', e => e.respondWith(new Response('now')));")).toEqual([
            200,
            { late: false, afterSettle: false },
        ]);
    });

    test('respondWith after an await is late', async () => {
        const script = `
            addEventListener('fetch', async (e) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                e.respondWith(new Response('after await'));
            });
        `;

        expect(await marks(script)).toEqual([200, { late: true, afterSettle: false }]);
    });

    test('respondWith from a timer in a plain listener is late', async () => {
        const script = "addEventListener('fetch', e => { setTimeout(() => e.respondWith(new Response('timer')), 5); });";

        expect(await marks(script)).toEqual([200, { late: true, afterSettle: false }]);
    });

    test('respondWith after an async listener ended is late and after settle', async () => {
        const script = `
            addEventListener('fetch', async (e) => {
                new Promise((resolve) => setTimeout(resolve, 5)).then(() => e.respondWith(new Response('later')));
            });
        `;

        expect(await marks(script)).toEqual([200, { late: true, afterSettle: true }]);
    });

    test('export default leaves no mark', async () => {
        expect(await marks('globalThis.default = { async fetch() { return new Response("module"); } };')).toEqual([
            200,
            { late: false, afterSettle: false },
        ]);
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
        const handle = await dispatchFetch(box, dispatch);

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
        const handle = await dispatchFetch(box, dispatch);

        expect(await (await handle.answer).text()).toBe('kept');
        await handle.done;
    });

    test('streamed follows the engine, and disconnect reaches it with the response', async () => {
        const { box, dispatch, engine } = realm("addEventListener('fetch', e => e.respondWith(new Response('body')));");
        const handle = await dispatchFetch(box, dispatch);
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

    test('addEventListener and removeEventListener are the only globals the dispatch sets', () => {
        const box = surface();
        const before = Object.getOwnPropertyNames(box);

        runInContext(DISPATCH, box)({ streamBody() {}, disconnect() {} });

        expect(Object.getOwnPropertyNames(box).filter((name) => !before.includes(name))).toEqual([
            'addEventListener',
            'removeEventListener',
        ]);
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
