// The dispatch between a host and the guest's handlers, the same for every
// engine.
//
// The script evaluates to a function that the host calls once per realm,
// before the guest script runs, with what only the engine knows:
//
//   streamBody(response, ended)  send the response body to the host, and
//                                call ended() once it is out
//   disconnect(response)         stop a body the client no longer reads
//
// The call installs addEventListener, the only global this module sets, and
// answers { fetch, task } for the host to keep. Each of these answers a
// handle for one event, whose promises always fulfil:
//
//   answer    the Response for a fetch, the task result for a task
//   done      the answer and every waitUntil promise are settled
//   streamed  the response body is out
//
// and disconnect() for a client that hung up.
//
// The handler is looked up when the event arrives, so a handler the script
// declares through `export default` wins over one it registers through
// addEventListener, whatever the order. Response is read when the host calls
// in, before the guest script runs, so a guest that replaces it changes
// nothing here.

(function installDispatch(engine) {
    'use strict';

    const Response = globalThis.Response;

    const listeners = Object.create(null);

    globalThis.addEventListener = function(type, handler) {
        listeners[type] = handler;
    };

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

    // The response a fetch listener gives: the one it passes to respondWith,
    // or else a Response it returns, directly or through a promise.
    // respondWith may run at any time, from a timer or a callback included,
    // so a listener that returns without either still has time to answer. A
    // second respondWith throws and leaves the first response.
    function listenerResponse(listener, request, life) {
        let answered = false;
        let answer;
        const response = new Promise((resolve) => {
            answer = (value) => {
                answered = true;
                resolve(value);
            };
        });

        const event = {
            request,
            waitUntil: life.waitUntil,
            respondWith(value) {
                if (answered) {
                    throw new TypeError('respondWith was already called');
                }

                answer(value);
            },
        };

        let returned;

        try {
            returned = listener(event);
        } catch (error) {
            returned = Promise.reject(error);
        }

        Promise.resolve(returned).then(
            (value) => {
                if (!answered && value instanceof Response) {
                    answer(value);
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

        return response;
    }

    async function handlerResponse(request, life) {
        const module = moduleHandler('fetch');

        if (module) {
            const ctx = { waitUntil: life.waitUntil, passThroughOnException() {} };

            return module(request, globalThis.env, ctx);
        }

        if (listeners.fetch) {
            return listenerResponse(listeners.fetch, request, life);
        }

        return new Response('Worker does not implement fetch handler', { status: 501 });
    }

    function fetch(request) {
        const life = lifetime();
        let ended;
        const streamed = new Promise((resolve) => {
            ended = resolve;
        });

        const answer = (async () => {
            let response;

            try {
                response = await handlerResponse(request, life);

                if (!(response instanceof Response)) {
                    throw new TypeError(
                        response === undefined
                            ? 'the fetch handler did not respond'
                            : 'the fetch handler did not answer with a Response'
                    );
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

        return { answer, done, streamed, disconnect: () => engine.disconnect(response) };
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
    async function runTask(event, life) {
        const moduleTask = moduleHandler('task');
        const task = moduleTask ?? listeners.task;

        if (task) {
            let responded = null;

            event.waitUntil = life.waitUntil;
            event.respondWith = (value) => {
                responded = taskEnvelope(value);
            };

            const returned = moduleTask
                ? await moduleTask(event, globalThis.env, { waitUntil: life.waitUntil })
                : await task(event);

            return responded ?? taskEnvelope(returned);
        }

        const moduleScheduled = moduleHandler('scheduled');
        const scheduled = moduleScheduled ?? listeners.scheduled;

        if (scheduled) {
            event.type = 'scheduled';
            // A host that never retries a scheduled event has nothing to turn off.
            event.noRetry = function() {};

            if (moduleScheduled) {
                await moduleScheduled(event, globalThis.env, { waitUntil: life.waitUntil });
            } else {
                event.waitUntil = life.waitUntil;
                await scheduled(event);
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

        return { answer: done, done, streamed: Promise.resolve(), disconnect() {} };
    }

    return { fetch, task };
})
