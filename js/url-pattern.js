// URL Pattern Standard, the `URLPattern` interface.
// https://urlpattern.spec.whatwg.org/
//
// The grammar belongs to the host: a pattern comes back as eight components,
// each carrying a matcher and, where the matcher is not enough, a regexp source
// in ECMAScript syntax. What is left here is the matching itself, which runs on
// the engine's own RegExp.

(() => {
    'use strict';

    const COMPONENTS = [
        'protocol',
        'username',
        'password',
        'hostname',
        'port',
        'pathname',
        'search',
        'hash',
    ];

    const PARTS = Symbol('parts');

    // A component matches through its matcher when it can, and falls back to
    // the regexp the host compiled for it.
    const match = (component, value) => {
        const { prefix, suffix, kind } = component.matcher;

        if (kind === 'literal') {
            return value === component.matcher.literal ? [] : null;
        }

        if (kind === 'singleCapture' && !prefix && !suffix) {
            const { filter, allowEmpty } = component.matcher;

            if (!allowEmpty && value === '') {
                return null;
            }

            if (filter && value.includes(filter)) {
                return null;
            }

            return [value];
        }

        const found = new RegExp(component.regexpString, 'u').exec(value);

        return found === null ? null : [...found].slice(1);
    };

    const groupsOf = (component, captured) => {
        const groups = {};

        component.groupNameList.forEach((name, at) => {
            groups[name] = captured[at];
        });

        return groups;
    };

    globalThis.URLPattern = class URLPattern {
        constructor(input = {}, base) {
            const parsed = globalThis.__ow.urlPatternParse(input, base === undefined ? null : base);

            if (parsed === null) {
                throw new TypeError('The pattern could not be parsed');
            }

            this[PARTS] = parsed;
        }

        get protocol() {
            return this[PARTS].protocol.patternString;
        }

        get username() {
            return this[PARTS].username.patternString;
        }

        get password() {
            return this[PARTS].password.patternString;
        }

        get hostname() {
            return this[PARTS].hostname.patternString;
        }

        get port() {
            return this[PARTS].port.patternString;
        }

        get pathname() {
            return this[PARTS].pathname.patternString;
        }

        get search() {
            return this[PARTS].search.patternString;
        }

        get hash() {
            return this[PARTS].hash.patternString;
        }

        get hasRegExpGroups() {
            return this[PARTS].hasRegexpGroups;
        }

        test(input = {}, base) {
            return this.exec(input, base) !== null;
        }

        exec(input = {}, base) {
            const target = globalThis.__ow.urlPatternProcessInput(
                input,
                base === undefined ? null : base
            );

            if (target === null) {
                return null;
            }

            const result = { inputs: base === undefined ? [input] : [input, base] };

            for (const name of COMPONENTS) {
                const component = this[PARTS][name];
                const captured = match(component, target[name]);

                if (captured === null) {
                    return null;
                }

                result[name] = { input: target[name], groups: groupsOf(component, captured) };
            }

            return result;
        }
    };
})();
