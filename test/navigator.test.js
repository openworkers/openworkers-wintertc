// `navigator`, whose one member only the host can fill in.

import { describe, expect, test } from 'bun:test';

import { evaluate, load, sandbox } from './support/surface.js';

describe('userAgent', () => {
    test('is what the host declared', () => {
        expect(load('navigator').navigator.userAgent).toBe('OpenWorkers/test (mock)');
    });

    test('says so when the host declared nothing', () => {
        const box = sandbox();
        delete box.__ow.userAgent;

        expect(evaluate(box, 'navigator').navigator.userAgent).toBe('OpenWorkers/unknown');
    });

    test('is read at access time, not at evaluation', () => {
        const box = evaluate(sandbox(), 'navigator');
        box.__ow.userAgent = 'OpenWorkers/later (mock)';

        expect(box.navigator.userAgent).toBe('OpenWorkers/later (mock)');
    });
});
