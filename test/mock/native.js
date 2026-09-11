// The native contract, answered in pure JavaScript, so the surface runs under
// Bun with no engine embedding.

export function nativeMock() {
    // `headers` asks for nothing; the first module with an op fills this in.
    return {};
}
