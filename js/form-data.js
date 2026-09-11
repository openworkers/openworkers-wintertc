// XMLHttpRequest Standard, the `FormData` interface.
// https://xhr.spec.whatwg.org/#interface-formdata

globalThis.FormData = class FormData {
    constructor() {
        this._entries = [];
    }

    append(name, value, filename) {
        if (value instanceof Blob && filename === undefined && value instanceof File) {
            filename = value.name;
        }
        this._entries.push([String(name), value instanceof Blob ? value : String(value), filename]);
    }

    delete(name) {
        const strName = String(name);
        this._entries = this._entries.filter(([k]) => k !== strName);
    }

    get(name) {
        const strName = String(name);
        const entry = this._entries.find(([k]) => k === strName);
        return entry ? entry[1] : null;
    }

    getAll(name) {
        const strName = String(name);
        return this._entries.filter(([k]) => k === strName).map(([, v]) => v);
    }

    has(name) {
        const strName = String(name);
        return this._entries.some(([k]) => k === strName);
    }

    set(name, value, filename) {
        const strName = String(name);
        if (value instanceof Blob && filename === undefined && value instanceof File) {
            filename = value.name;
        }
        // Remove all existing entries with this name
        this._entries = this._entries.filter(([k]) => k !== strName);
        // Add the new entry
        this._entries.push([strName, value instanceof Blob ? value : String(value), filename]);
    }

    *entries() {
        for (const [name, value] of this._entries) {
            yield [name, value];
        }
    }

    *keys() {
        for (const [name] of this._entries) {
            yield name;
        }
    }

    *values() {
        for (const [, value] of this._entries) {
            yield value;
        }
    }

    forEach(callback, thisArg) {
        for (const [name, value] of this._entries) {
            callback.call(thisArg, value, name, this);
        }
    }

    [Symbol.iterator]() {
        return this.entries();
    }
};
