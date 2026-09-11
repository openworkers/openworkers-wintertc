// HTML Standard, `structuredClone`.
// https://html.spec.whatwg.org/multipage/structured-data.html

globalThis.structuredClone = function(value, options) {
    // Handle transferables (simplified - just ignore them for now)
    const transfer = options?.transfer || [];

    // Use JSON for simple cases, but handle more types
    function clone(obj, seen = new Map()) {
        // Primitives
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        // Check for circular references
        if (seen.has(obj)) {
            return seen.get(obj);
        }

        // Date
        if (obj instanceof Date) {
            return new Date(obj.getTime());
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
