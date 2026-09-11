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

/// Streams Standard, the tier that stands on the host's `ReadableStream`.
pub const STREAMS: Module = Module {
    name: "streams",
    source: include_str!("../js/streams.js"),
    required_ops: &[],
};

/// URL Standard, the `URL` and `URLSearchParams` interfaces.
pub const URL: Module = Module {
    name: "url",
    source: include_str!("../js/url.js"),
    required_ops: &["urlParse", "urlUpdate"],
};

/// Fetch Standard, the `Headers` interface. Asks nothing of its host.
pub const HEADERS: Module = Module {
    name: "headers",
    source: include_str!("../js/headers.js"),
    required_ops: &[],
};

/// Every module, in the order a host has to evaluate them.
pub const SURFACE: &[Module] = &[EVENTS, ABORT, STREAMS, URL, HEADERS];

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
