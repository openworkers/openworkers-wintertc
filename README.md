# openworkers-wintertc

One web surface, shared by every OpenWorkers runtime, written against a native
contract and nothing else.

Before this repo the surface existed in five diverging copies, one per runtime,
as JavaScript inlined in Rust string literals. `openworkers-conformance`
measured what that costs: of the 95 [WinterTC Minimum Common
API](https://min-common-api.proposal.wintertc.org/) tests the v8 backend fails,
**77 fail on all four JavaScript backends**. Five copies mean five corrections
for one gap.

## The three pieces

**`js/`** is the surface, one classic script per API, assigning onto
`globalThis`. It is written against the contract, the engine intrinsics and the
rest of the surface, never against an embedding: nothing in a module knows which
runtime is running it.

**`src/`** is the contract. Each module carries the ops it reads out of the
native namespace, and the crate hands a host both the script and that list
through `include_str!`, so a host cannot pick up a module without picking up what
it needs.

**`test/`** is the inner loop: the contract mocked in pure JavaScript, so the
whole surface runs under Bun with no engine embedding at all. Each sandbox is a
real `node:vm` context, so a bare `new Headers()` inside a module finds the one
this surface installed rather than Bun's, and a module that asks for a global
the host never installs fails here instead of in production. The cost is a realm
boundary: an assertion about what the surface built compares against the
sandbox's constructors, which `intrinsics()` hands back.

`openworkers-conformance` stays the integration judge, with 448 tests and a
streaming battery through a real runtime, but it is not where you want to find
out that a signature is wrong.

## Running

```bash
bun test      # the surface against the mocked contract, no engine
cargo test    # the crate
```

## The modules

| module     | ops it asks of its host |
| ---------- | ----------------------- |
| `events`   | none                    |
| `abort`    | none                    |
| `streams`  | none                    |
| `url`      | `urlParse`, `urlUpdate` |
| `url-pattern` | `urlPatternParse`, `urlPatternProcessInput` |
| `headers`  | none                    |
| `request`  | none                    |
| `response` | none                    |

A module may build on another, and on what the host installs around them
(`setTimeout`, `console`, `queueMicrotask`, `ReadableStream`); `SURFACE` is the
order that makes that true. `required_ops` covers the native namespace alone.

`streams` extends the prototype of the host's `ReadableStream` rather than
replacing it: the host backs that one with its own channel, and the streaming
battery in `openworkers-conformance` measures what happens on it.

## Why a module reads its ops late

A module never captures a host function; it reads it out of the namespace at call
time, every time. Native functions cannot be serialised into a V8 startup
snapshot, so a snapshotting host installs the JavaScript once at build time and
the native functions again per context at run time. A class body that captured an
op while being snapshotted would capture nothing, and every later context would
call into the hole. Reading late is the only shape that serves a snapshotting
host and an eval-at-boot host at once.

The cost is that the namespace stays reachable from guest code. A host installs
it non-enumerable, neither writable nor configurable, and freezes it once every
op is registered, so a guest can neither find it by enumeration nor replace the
namespace or an op under the surface's feet.

A module reads it as `globalThis.__ow.<op>`, never as a bare `__ow`. The global
belongs to the guest, and a guest's top-level `let __ow` would be a global
lexical binding that shadows the global-object property for every bare lookup
that follows, this surface's included.

## A module may not declare at top level

A module is evaluated as a classic script in the guest's own global, where a
top-level `const` becomes a global lexical binding: readable by guest code, and a
duplicate-declaration `SyntaxError` for any guest that declares the same name at
its own top level. A module that needs a private helper wraps itself in an IIFE
and touches nothing but `globalThis`.

## Where the line between the module and its host falls

`url-pattern` is the clearest case. The pattern syntax is a grammar with a
tokenizer, a parser and a compilation step, and the conformance suite has two
tests for it: an implementation written here could be wrong in a dozen ways and
still pass both. So the grammar crosses to the host, which answers with the
eight components, each carrying a matcher and a regexp source in ECMAScript
syntax, and the matching stays here on the engine's own `RegExp`.

Nothing is held on the host side between calls: both ops are pure functions, and
a compiled pattern is plain data the guest owns. A resource table would have
been a leak waiting for a guest that builds patterns in a loop.

## An engine may still go native

A host is free to answer any op with a native fast path, and encouraged to: the
v8 backend took `URL` from 46 to 68 of 68 by handing parsing to the `url` crate.
The contract is what makes that safe, since a fast path has to honour the same
signature and the conformance suite says whether it does. What the contract ends
is five engines each reimplementing `Headers`.
