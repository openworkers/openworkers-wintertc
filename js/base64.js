// HTML Standard, `btoa` and `atob`.
// https://html.spec.whatwg.org/multipage/webappapis.html#atob
//
// Each character of the string these two exchange is one byte, latin-1, never
// UTF-8: encoding text means running it through TextEncoder first.

(() => {
    'use strict';

    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    // Character code to its six bits. 255 marks a character the alphabet has no
    // room for, which never survives the check below.
    const CODES = new Uint8Array(256).fill(255);

    for (let i = 0; i < CHARS.length; i++) {
        CODES[CHARS.charCodeAt(i)] = i;
    }

    const ASCII_WHITESPACE = /[\t\n\f\r ]/g;
    const OUTSIDE_ALPHABET = /[^A-Za-z0-9+/]/;

    const refuse = (why) => new globalThis.DOMException(why, 'InvalidCharacterError');

    globalThis.btoa = function btoa(input) {
        const str = String(input);
        const len = str.length;
        let result = '';

        for (let i = 0; i < len; i += 3) {
            const b1 = str.charCodeAt(i);
            const b2 = i + 1 < len ? str.charCodeAt(i + 1) : 0;
            const b3 = i + 2 < len ? str.charCodeAt(i + 2) : 0;

            if (b1 > 255 || b2 > 255 || b3 > 255) {
                throw refuse('The string holds a character outside the latin-1 range');
            }

            result +=
                CHARS[b1 >> 2] +
                CHARS[((b1 & 3) << 4) | (b2 >> 4)] +
                CHARS[((b2 & 15) << 2) | (b3 >> 6)] +
                CHARS[b3 & 63];
        }

        if (len % 3 === 2) {
            return result.substring(0, result.length - 1) + '=';
        }

        if (len % 3 === 1) {
            return result.substring(0, result.length - 2) + '==';
        }

        return result;
    };

    globalThis.atob = function atob(input) {
        let data = String(input).replace(ASCII_WHITESPACE, '');

        // Padding is only padding at the end of a whole number of quadruplets;
        // anywhere else it is a character outside the alphabet.
        if (data.length % 4 === 0) {
            data = data.replace(/={1,2}$/, '');
        }

        if (data.length % 4 === 1) {
            throw refuse('The string is one character longer than base64 allows');
        }

        if (OUTSIDE_ALPHABET.test(data)) {
            throw refuse('The string holds a character outside the base64 alphabet');
        }

        const outLen = (data.length * 3) >>> 2;
        let result = '';

        for (let i = 0, j = 0; j < outLen; i += 4) {
            const a = CODES[data.charCodeAt(i)];
            const b = CODES[data.charCodeAt(i + 1)];
            const c = CODES[data.charCodeAt(i + 2)];
            const d = CODES[data.charCodeAt(i + 3)];

            result += String.fromCharCode((a << 2) | (b >> 4));

            if (++j < outLen) {
                result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
            }

            if (++j < outLen) {
                result += String.fromCharCode(((c & 3) << 6) | (d & 63));
            }

            j++;
        }

        return result;
    };
})();
