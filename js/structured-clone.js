// HTML Standard, `structuredClone`.
// https://html.spec.whatwg.org/multipage/structured-data.html

globalThis.structuredClone = function structuredClone(value, options) {
    const transfer = options?.transfer || [];

    // A transferred buffer is detached from the caller rather than copied, so
    // the clone is the only side holding the memory afterwards.
    const taken = new Map();

    for (const item of transfer) {
        if (item instanceof ArrayBuffer && typeof item.transfer === 'function') {
            taken.set(item, item.transfer());
        }
    }

    function clone(obj, seen = new Map()) {
        if (typeof obj === 'function' || typeof obj === 'symbol') {
            throw new DOMException(typeof obj + ' could not be cloned', 'DataCloneError');
        }

        // Primitives
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (taken.has(obj)) {
            return taken.get(obj);
        }

        // Check for circular references
        if (seen.has(obj)) {
            return seen.get(obj);
        }

        // Date
        if (obj instanceof Date) {
            return new Date(obj.getTime());
        }

        // Error
        if (obj instanceof Error) {
            const copy = new obj.constructor(obj.message);

            copy.name = obj.name;
            copy.stack = obj.stack;

            return copy;
        }

        // RegExp
        if (obj instanceof RegExp) {
            return new RegExp(obj.source, obj.flags);
        }

        // ArrayBuffer
        if (obj instanceof ArrayBuffer) {
            const copy = new ArrayBuffer(obj.byteLength);
            new Uint8Array(copy).set(new Uint8Array(obj));
            return copy;
        }

        // TypedArrays
        if (ArrayBuffer.isView(obj)) {
            const TypedArrayConstructor = obj.constructor;
            return new TypedArrayConstructor(clone(obj.buffer, seen), obj.byteOffset, obj.length);
        }

        // Map
        if (obj instanceof Map) {
            const copy = new Map();
            seen.set(obj, copy);
            for (const [key, val] of obj) {
                copy.set(clone(key, seen), clone(val, seen));
            }
            return copy;
        }

        // Set
        if (obj instanceof Set) {
            const copy = new Set();
            seen.set(obj, copy);
            for (const val of obj) {
                copy.add(clone(val, seen));
            }
            return copy;
        }

        // Array
        if (Array.isArray(obj)) {
            const copy = [];
            seen.set(obj, copy);
            for (let i = 0; i < obj.length; i++) {
                copy[i] = clone(obj[i], seen);
            }
            return copy;
        }

        // Plain object
        const copy = {};
        seen.set(obj, copy);
        for (const key of Object.keys(obj)) {
            copy[key] = clone(obj[key], seen);
        }
        return copy;
    }

    return clone(value);
};
