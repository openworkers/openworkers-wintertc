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

pub const HEADERS: Module = Module {
    name: "headers",
    source: include_str!("../js/headers.js"),
    required_ops: &[],
};

/// Every module, in the order a host has to evaluate them.
pub const SURFACE: &[Module] = &[HEADERS];
