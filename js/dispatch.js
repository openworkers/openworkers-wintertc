// The dispatch between a host and the guest's handlers, the same for every
// engine.
//
// The script evaluates to a function that the host calls once per realm,
// before the guest script runs, with what only the engine knows, and with
// options ({ strict }, see listenerResponse):
//
//   streamBody(response, ended)  send the response body to the host, and
//                                call ended() once it is out
//   disconnect(response)         stop a body the client no longer reads
//
// The call installs addEventListener and removeEventListener, the only globals
// this module sets, and
// answers { fetch, task } for the host to keep. Each of these answers a
// handle for one event, whose promises always fulfil:
//
//   answer    the Response for a fetch, the task result for a task
//   done      the answer and every waitUntil promise are settled
//   streamed  the response body is out
//
// with `marks`, how a fetch listener answered (see listenerResponse),
// endDispatch(), which the host calls after the microtask checkpoint that
// follows its call, and disconnect() for a client that hung up.
//
// The handler is looked up when the event arrives, so a handler the script
// declares through `export default` wins over one it registers through
// addEventListener, whatever the order. Response is read when the host calls
// in, before the guest script runs, so a guest that replaces it changes
// nothing here.

(function installDispatch(engine, options) {
    'use strict';

    const Response = globalThis.Response;
    const DOMException = globalThis.DOMException;

    // Strict: respondWith as the Service Worker spec has it, only during the
    // dispatch. Lax, the default: also later, which the OpenWorkers docs
    // taught; the marks let the host count who does it.
    const strict = options?.strict === true;

    // Every listener per event type, in the order they were added.
    const listeners = Object.create(null);

    globalThis.addEventListener = function(type, handler) {
        if (typeof handler !== 'function' && typeof handler?.handleEvent !== 'function') {
            return;
        }

        const list = (listeners[type] ??= []);

        if (!list.includes(handler)) {
            list.push(handler);
        }
    };

    globalThis.removeEventListener = function(type, handler) {
        const list = listeners[type] ?? [];
        const index = list.indexOf(handler);

        if (index !== -1) {
            list.splice(index, 1);
        }
    };

    const invoke = (handler, event) =>
        typeof handler === 'function' ? handler.call(globalThis, event) : handler.handleEvent(event);

    const errorMessage = (error) => (error && error.message) || String(error);

    // The handler `export default` declares under `name`, called as a method
    // of the module object.
    function moduleHandler(name) {
        const module = globalThis.default;

        if (module === null || typeof module !== 'object' || typeof module[name] !== 'function') {
            return null;
        }

        return (...args) => module[name](...args);
    }

    // The promises an event passes to waitUntil, awaited after its answer.
    function lifetime() {
        const pending = [];

        return {
            waitUntil(promise) {
                pending.push(Promise.resolve(promise));
            },
            settled() {
                return Promise.all(pending);
            },
        };
    }

    // The response the fetch listeners give, called in order until one calls
    // respondWith, as an event dispatch does: the one passed to respondWith,
    // or else a Response a listener returns, directly or through a promise.
    // A listener that throws does not stop the next one.
    //
    // The dispatch lasts until the host calls endDispatch, after the
    // microtask checkpoint that follows the listeners: respondWith in a
    // microtask, an await on a settled promise included, is in time. Later,
    // from a task, the Service Worker spec and Cloudflare refuse it; with
    // `strict` it throws InvalidStateError, as they do. `marks`
    // records it for the host: `late` when respondWith runs after the
    // dispatch, `afterSettle` when the async listeners had also ended. A
    // second respondWith throws InvalidStateError and leaves the first
    // response.
    function listenerResponse(list, request, life, marks) {
        let answered = false;
        let dispatching = true;
        let settled = false;
        let stopped = false;
        let canceled = false;
        let answer;
        const response = new Promise((resolve) => {
            answer = (value) => {
                answered = true;
                resolve(value);
            };
        });

        const event = {
            type: 'fetch',
            request,
            waitUntil: life.waitUntil,
            get defaultPrevented() {
                return canceled;
            },
            preventDefault() {
                canceled = true;
            },
            stopPropagation() {
                stopped = true;
            },
            stopImmediatePropagation() {
                stopped = true;
            },
            respondWith(value) {
                if (answered) {
                    throw new DOMException('respondWith was already called', 'InvalidStateError');
                }

                if (strict && !dispatching) {
                    throw new DOMException('respondWith was called after the fetch event was dispatched', 'InvalidStateError');
                }

                marks.late = !dispatching;
                marks.afterSettle = settled;
                stopped = true;
                answer(value);
            },
        };

        const returned = [];
        let thrown;

        for (const handler of list.slice()) {
            try {
                returned.push(invoke(handler, event));
            } catch (error) {
                thrown ??= error;
                console.error('[fetch] Listener error:', error);
            }

            if (stopped) {
                break;
            }
        }

        if (thrown !== undefined && !answered) {
            answer(Promise.reject(thrown));
        }

        const pending = returned.filter((value) => typeof value?.then === 'function');

        Promise.allSettled(pending).then(() => {
            settled = pending.length > 0;
        });

        for (const value of returned) {
            Promise.resolve(value).then(
                (resolved) => {
                    if (!answered && !strict && resolved instanceof Response) {
                        answer(resolved);
                    }
                },
                (error) => {
                    if (answered) {
                        console.error('[fetch] Handler error after respondWith:', error);
                    } else {
                        answer(Promise.reject(error));
                    }
                }
            );
        }

        function endDispatch() {
            if (!dispatching) {
                return;
            }

            dispatching = false;

            // Strict: no answer by the end of the dispatch is no answer.
            if (strict && !answered) {
                answer(Promise.reject(new TypeError('the fetch listener did not call respondWith')));
            }
        }

        return { response, endDispatch };
    }

    // What answers a fetch, and how the host ends its dispatch. Runs the
    // handler now, within the host's call.
    function handlerResponse(request, life, marks) {
        const module = moduleHandler('fetch');
        const nothingToEnd = () => {};

        if (module) {
            const ctx = { waitUntil: life.waitUntil, passThroughOnException() {} };

            try {
                return { response: Promise.resolve(module(request, globalThis.env, ctx)), endDispatch: nothingToEnd };
            } catch (error) {
                return { response: Promise.reject(error), endDispatch: nothingToEnd };
            }
        }

        if (listeners.fetch?.length) {
            return listenerResponse(listeners.fetch, request, life, marks);
        }

        return {
            response: Promise.resolve(new Response('Worker does not implement fetch handler', { status: 501 })),
            endDispatch: nothingToEnd,
        };
    }

    function fetch(request) {
        const life = lifetime();
        const marks = { late: false, afterSettle: false };
        let ended;
        const streamed = new Promise((resolve) => {
            ended = resolve;
        });

        const handled = handlerResponse(request, life, marks);

        const answer = (async () => {
            let response;

            try {
                response = await handled.response;

                if (!(response instanceof Response)) {
                    throw new TypeError(
                        response === undefined
                            ? 'the fetch handler did not respond'
                            : 'the fetch handler did not answer with a Response'
                    );
                }

                if (response.bodyUsed) {
                    throw new TypeError('the response body was already used');
                }
            } catch (error) {
                console.error('[fetch] Handler error:', error);
                response = new Response('Handler exception: ' + errorMessage(error), { status: 500 });
            }

            engine.streamBody(response, ended);

            return response;
        })();

        const done = answer.then(async () => {
            try {
                await life.settled();
            } catch (error) {
                // The response is out; a background failure cannot change it.
                console.error('[fetch] waitUntil rejected:', error);
            }
        });

        let response = null;
        answer.then((value) => {
            response = value;
        });

        return {
            answer,
            done,
            streamed,
            marks,
            endDispatch: handled.endDispatch,
            disconnect: () => engine.disconnect(response),
        };
    }

    // A task result from what a task handler answers: an object with a
    // `success` field is the result, anything else is its data.
    function taskEnvelope(value) {
        if (value !== null && typeof value === 'object' && 'success' in value) {
            return { success: value.success !== false, data: value.data, error: value.error };
        }

        return { success: true, data: value };
    }

    // Runs the handler for a task and answers its result. A `task` handler
    // gets every task; without one, a `scheduled` handler gets them as cron
    // events and its return value is not a result.
    // Calls the listeners of `type` in order, until one answers, and waits
    // for what they return.
    async function dispatchTo(type, event, answered) {
        const returned = [];

        for (const handler of (listeners[type] ?? []).slice()) {
            returned.push(invoke(handler, event));

            if (answered()) {
                break;
            }
        }

        return Promise.all(returned);
    }

    async function runTask(event, life) {
        const moduleTask = moduleHandler('task');

        if (moduleTask || listeners.task?.length) {
            let responded = null;

            event.waitUntil = life.waitUntil;
            event.respondWith = (value) => {
                responded = taskEnvelope(value);
            };

            if (moduleTask) {
                const returned = await moduleTask(event, globalThis.env, { waitUntil: life.waitUntil });

                return responded ?? taskEnvelope(returned);
            }

            const returned = await dispatchTo('task', event, () => responded !== null);

            return responded ?? taskEnvelope(returned.find((value) => value !== undefined));
        }

        const moduleScheduled = moduleHandler('scheduled');

        if (moduleScheduled || listeners.scheduled?.length) {
            event.type = 'scheduled';
            // A host that never retries a scheduled event has nothing to turn off.
            event.noRetry = function() {};

            if (moduleScheduled) {
                await moduleScheduled(event, globalThis.env, { waitUntil: life.waitUntil });
            } else {
                event.waitUntil = life.waitUntil;
                await dispatchTo('scheduled', event, () => false);
            }

            return { success: true };
        }

        throw new Error(
            event.scheduledTime === undefined
                ? 'Worker does not implement task handler'
                : 'Worker does not implement scheduled handler'
        );
    }

    function task(event) {
        const life = lifetime();

        const done = (async () => {
            try {
                const result = await runTask(event, life);
                await life.settled();

                return result;
            } catch (error) {
                console.error('[task] Handler error:', error);

                return { success: false, error: errorMessage(error) };
            }
        })();

        return { answer: done, done, streamed: Promise.resolve(), marks: null, endDispatch() {}, disconnect() {} };
    }

    return { fetch, task };
})
