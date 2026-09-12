//! One web surface, written against a native contract, for every OpenWorkers
//! runtime to install instead of its own copy.
//!
//! A host evaluates [`Module::source`] as a classic script in a fresh global, in
//! [`SURFACE`] order, and installs [`NATIVE_NAMESPACE`] before any of it runs.
//!
//! A module reads its ops out of that namespace at call time and never captures
//! one: a native function cannot be serialised into a V8 startup snapshot, so a
//! host that snapshots its surface has nothing to capture at build time.

/// The single global through which a module reaches its host.
pub const NATIVE_NAMESPACE: &str = "__ow";

/// One JavaScript module of the surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Module {
    pub name: &'static str,
    pub source: &'static str,
    /// Ops the module reads out of [`NATIVE_NAMESPACE`], sorted.
    pub required_ops: &'static [&'static str],
}

/// Encoding Standard, `TextEncoder` and `TextDecoder`.
pub const TEXT_ENCODING: Module = Module {
    name: "text-encoding",
    source: include_str!("../js/text-encoding.js"),
    required_ops: &["textDecode", "textEncode"],
};

/// File API, the `Blob` and `File` interfaces.
pub const BLOB: Module = Module {
    name: "blob",
    source: include_str!("../js/blob.js"),
    required_ops: &[],
};

/// XMLHttpRequest Standard, the `FormData` interface.
pub const FORM_DATA: Module = Module {
    name: "form-data",
    source: include_str!("../js/form-data.js"),
    required_ops: &[],
};

/// HTML Standard, `structuredClone`.
pub const STRUCTURED_CLONE: Module = Module {
    name: "structured-clone",
    source: include_str!("../js/structured-clone.js"),
    required_ops: &[],
};

/// HTML Standard, `btoa` and `atob`.
pub const BASE64: Module = Module {
    name: "base64",
    source: include_str!("../js/base64.js"),
    required_ops: &[],
};

/// DOM Standard, the event core and the message channel that carries it.
pub const EVENTS: Module = Module {
    name: "events",
    source: include_str!("../js/events.js"),
    required_ops: &[],
};

/// DOM Standard, `AbortController`, `AbortSignal` and `DOMException`. Extends
/// the `EventTarget` of [`EVENTS`], so it comes after it.
pub const ABORT: Module = Module {
    name: "abort",
    source: include_str!("../js/abort.js"),
    required_ops: &[],
};

/// Streams Standard, the readable stream the other tiers stand on. It reads
/// `AbortController`, so it comes after [`ABORT`].
pub const READABLE_STREAM: Module = Module {
    name: "readable-stream",
    source: include_str!("../js/readable-stream.js"),
    required_ops: &[],
};

/// Streams Standard, the byte tier. It patches [`READABLE_STREAM`], so it comes
/// after it.
pub const BYTE_STREAM: Module = Module {
    name: "byte-stream",
    source: include_str!("../js/byte-stream.js"),
    required_ops: &[],
};

/// Streams Standard, the tier that stands on [`READABLE_STREAM`].
pub const STREAMS: Module = Module {
    name: "streams",
    source: include_str!("../js/streams.js"),
    required_ops: &[],
};

/// Compression Streams, the `CompressionStream` and `DecompressionStream`
/// interfaces. It stands on the `TransformStream` of [`STREAMS`].
pub const COMPRESSION: Module = Module {
    name: "compression",
    source: include_str!("../js/compression.js"),
    required_ops: &[
        "compressionDrop",
        "compressionFinish",
        "compressionPush",
        "compressionStart",
    ],
};

/// High Resolution Time, the `Performance` interface.
pub const PERFORMANCE: Module = Module {
    name: "performance",
    source: include_str!("../js/performance.js"),
    required_ops: &["performanceNow", "timeOrigin"],
};

/// WebAssembly Web API, the entry points that compile from a `Response`.
pub const WASM_STREAMING: Module = Module {
    name: "wasm-streaming",
    source: include_str!("../js/wasm-streaming.js"),
    required_ops: &[],
};

/// URL Standard, the `URL` and `URLSearchParams` interfaces.
pub const URL: Module = Module {
    name: "url",
    source: include_str!("../js/url.js"),
    required_ops: &["urlParse", "urlUpdate"],
};

/// WinterTC Minimum Common API, `navigator`. The host is the only side that
/// knows which runtime this is.
pub const NAVIGATOR: Module = Module {
    name: "navigator",
    source: include_str!("../js/navigator.js"),
    required_ops: &["userAgent"],
};

/// URL Pattern Standard, the `URLPattern` interface. The grammar is the host's;
/// what is here is the matching.
pub const URL_PATTERN: Module = Module {
    name: "url-pattern",
    source: include_str!("../js/url-pattern.js"),
    required_ops: &["urlPatternParse", "urlPatternProcessInput"],
};

/// Fetch Standard, the `Request` interface.
pub const REQUEST: Module = Module {
    name: "request",
    source: include_str!("../js/request.js"),
    required_ops: &[],
};

/// Fetch Standard, the `Response` interface.
pub const RESPONSE: Module = Module {
    name: "response",
    source: include_str!("../js/response.js"),
    required_ops: &[],
};

/// Fetch Standard, the `Headers` interface. Asks nothing of its host.
pub const HEADERS: Module = Module {
    name: "headers",
    source: include_str!("../js/headers.js"),
    required_ops: &[],
};

/// Every module, in the order a host has to evaluate them.
pub const SURFACE: &[Module] = &[
    TEXT_ENCODING,
    BLOB,
    FORM_DATA,
    NAVIGATOR,
    PERFORMANCE,
    EVENTS,
    ABORT,
    READABLE_STREAM,
    BYTE_STREAM,
    STREAMS,
    COMPRESSION,
    STRUCTURED_CLONE,
    BASE64,
    URL,
    URL_PATTERN,
    HEADERS,
    REQUEST,
    RESPONSE,
    WASM_STREAMING,
];

#[cfg(test)]
mod tests {
    use super::NATIVE_NAMESPACE;
    use super::SURFACE;

    /// What a module reads out of the namespace, in source order.
    fn ops_read(source: &str) -> Vec<&str> {
        let prefix = format!("globalThis.{NATIVE_NAMESPACE}.");

        source
            .match_indices(&prefix)
            .map(|(at, _)| {
                let rest = &source[at + prefix.len()..];
                let end = rest
                    .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                    .unwrap_or(rest.len());

                &rest[..end]
            })
            .collect()
    }

    #[test]
    fn a_declared_op_is_an_op_the_module_reads() {
        for module in SURFACE {
            let read = ops_read(module.source);

            for op in module.required_ops {
                assert!(
                    read.contains(op),
                    "module {} declares {op} and never reads it",
                    module.name
                );
            }
        }
    }

    #[test]
    fn an_op_the_module_reads_is_a_declared_op() {
        for module in SURFACE {
            for op in ops_read(module.source) {
                assert!(
                    module.required_ops.contains(&op),
                    "module {} reads {op} without declaring it",
                    module.name
                );
            }
        }
    }
}
