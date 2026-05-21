# ADR-0003: Java runtime via CheerpJ in browser only, with documented pivot path to server-side

**Status:** Accepted (pending license verification at E3/S3.1)
**Date:** 2026-05-20
**Decision-makers:** Miguel Rodriguez

## Context

The pilot course is "Estructuras de Datos en Java". The existing CodeEditor widget supports C++ (via `browsercc` + WASI) and Python (via Pyodide), both compiling and executing entirely in the browser. Java is the new requirement.

Three architectural paths exist for running Java student code:

1. **In-browser via CheerpJ 3.0** (Leaning Technologies): full JVM + std lib compiled to WebAssembly. ~20MB lazy-load. Free for educational/non-commercial use.
2. **Server-side compilation in sandbox** (`javac` + `java` in container, what most online judges do): students POST code, backend compiles and runs, returns output. ~1-3s round-trip per execution. Backend complexity (JDK + sandbox + queueing).
3. **Hybrid** (CheerpJ for interactive in-class use, server-side for canonical autograder validation).

Other Java-to-browser tools (TeaVM, Bytecoder, GraalVM Native Image WASM) compile ahead-of-time and cannot compile *student* code at runtime — they're tools for *shipping* Java apps to the browser, not for *running arbitrary* Java code there. DoppioJVM is abandoned.

## Decision

**Use CheerpJ in the browser only, with NO server-side Java compilation.**

This matches the existing `useRuntime` pattern (cpp.worker, python.worker) by adding a `java.worker` that lazy-loads CheerpJ.

Acceptance gate at the E3/S3.1 spec:
- **License verification**: CheerpJ's "free for non-commercial/educational use" must be confirmed to cover a Chilean university course context.
- If license check **fails**, this ADR is superseded by a follow-up ADR introducing server-side Java compilation. The frontend interface (`useRuntime`, `<CodeEditor language="java">`) stays unchanged; only the worker implementation changes.

## Alternatives considered

- **Server-side compilation only**: license-free (OpenJDK) but adds latency, backend cost, and sandbox complexity. Not chosen for MVP because the educational UX is better when iterations are fast (CheerpJ once warm).
- **Hybrid (in-browser + server validation)**: deferred — keeps complexity high upfront. We can add server-side validation later for tasks that count for grade if integrity matters, without changing the in-browser flow.

## Consequences

**Positive**:
- Zero backend cost for Java execution (no compute on Fly.io free tier consumed by `javac`).
- Fast iteration UX after first warm load (~5s warm-up, sub-second for subsequent runs).
- Works offline once cached.
- Same architectural pattern as existing C++/Python runtimes (no exception).

**Negative**:
- Initial bundle load is ~20MB (lazy, only when Java is selected; cached after first download).
- **Autograder integrity risk**: a sufficiently motivated student can modify their local JS to fake passing outputs to the backend. For educational/practice context this is acceptable; for high-stakes grading (final exams), the hybrid mitigation (server-side re-run) is documented as the upgrade path.
- License dependency on Leaning Technologies. If they change terms or sunset CheerpJ, we need to pivot to server-side. ADR documents this so the pivot is not a surprise.

## Implementation notes

- New files in E3/S3.2: `apps/frontend/src/widgets/code-editor/runtimes/java.js`, `java.worker.js`.
- Lazy-load via dynamic import inside the worker.
- Extend `LanguageContext` to include `'java'`.
- Smoke test: `smoke-test-java.mjs` covers compile, run, stdin.
- Phase B refactor (post-junio) introduces a `RemoteRuntime` abstraction so the same worker contract can be backed by either local WASM (CheerpJ) or remote HTTP (server-side fallback).

## References

- Plan file: decisions K (Java runtime) and L (worker pattern).
- POC reference: `src/widgets/code-editor/runtimes/cpp.worker.js`, `python.worker.js`.
