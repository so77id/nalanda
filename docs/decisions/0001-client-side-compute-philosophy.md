# ADR-0001: Client-side compute philosophy

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (`docs/design/2026-08-redesign.md`, vision + D5/D9)

## Context

Nalanda's ambition is a live-class teaching platform that must stay cheap to run
while serving potentially many students executing code, running visualizations, and
following synchronized presentations. Server-side execution of student code (the
online-judge model) scales cost linearly with usage.

## Decision

**Expensive computation runs in the user's browser; the server carries the minimum
load possible.** This is a transversal principle, not a per-feature choice:

- Code compilation/execution: in-browser via WASM toolchains (C++ `browsercc`+WASI
  and Python/Pyodide proven in the POC; Java per ADR pending at its spec).
- Visualizations and animations: pure frontend.
- Live sessions: the server is a dumb event relay (see ADR-0008), never a renderer
  or state machine for content.
- Every future feature must justify any server-side compute it introduces.

## Alternatives considered

- **Server-side execution sandbox** (judge model): simpler client, but per-execution
  cost, latency, and sandbox/queueing complexity. Rejected as default; may appear
  later for narrow needs (e.g., high-stakes grading integrity).
- **Hybrid by default**: complexity of both worlds without need at current scale.

## Consequences

- Hosting stays near-free (static frontend + tiny relay/auth backend).
- First page load can be heavy for runtime downloads (WASM toolchains) — mitigated
  by lazy loading and caching.
- Client hardware becomes the performance floor; acceptable for a university course
  context.
