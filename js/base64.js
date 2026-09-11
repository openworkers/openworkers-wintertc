// HTML Standard, `btoa` and `atob`.
// https://html.spec.whatwg.org/multipage/webappapis.html#atob

// Base64 encoding/decoding (atob/btoa)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Lookup table for decoding: charCode → 6-bit value (supports base64url too)
const B64_CODES = new Uint8Array(256);
for (let i = 0; i < BASE64_CHARS.length; i++) {
    B64_CODES[BASE64_CHARS.charCodeAt(i)] = i;
}
B64_CODES[0x2d] = 62; // '-' (base64url)
B64_CODES[0x5f] = 63; // '_' (base64url)

// btoa: binary string → base64
// Each char is treated as a single byte (charCodeAt), NOT UTF-8.
globalThis.btoa = function(str) {
    const len = str.length;
    let result = '';

    for (let i = 0; i < len; i += 3) {
        const b1 = str.charCodeAt(i);
        const b2 = i + 1 < len ? str.charCodeAt(i + 1) : 0;
        const b3 = i + 2 < len ? str.charCodeAt(i + 2) : 0;

        if (b1 > 255 || b2 > 255 || b3 > 255) {
            throw new DOMException('Invalid character', 'InvalidCharacterError');
        }

        result +=
            BASE64_CHARS[b1 >> 2] +
            BASE64_CHARS[((b1 & 3) << 4) | (b2 >> 4)] +
            BASE64_CHARS[((b2 & 15) << 2) | (b3 >> 6)] +
            BASE64_CHARS[b3 & 63];
    }

    if (len % 3 === 2) {
        result = result.substring(0, result.length - 1) + '=';
    } else if (len % 3 === 1) {
        result = result.substring(0, result.length - 2) + '==';
    }

    return result;
};

// atob: base64 → binary string
// Returns a string where each char is one byte (latin-1), NOT UTF-8.
globalThis.atob = function(base64) {
    base64 = base64.replace(/[\s=]/g, '');
    const len = base64.length;
    const outLen = (len * 3) >>> 2;
    let result = '';

    for (let i = 0, j = 0; j < outLen; i += 4) {
        const a = B64_CODES[base64.charCodeAt(i)];
        const b = B64_CODES[base64.charCodeAt(i + 1)];
        const c = B64_CODES[base64.charCodeAt(i + 2)];
        const d = B64_CODES[base64.charCodeAt(i + 3)];

        result += String.fromCharCode((a << 2) | (b >> 4));
        if (++j < outLen) result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
        if (++j < outLen) result += String.fromCharCode(((c & 3) << 6) | (d & 63));
        j++;
    }

    return result;
};
