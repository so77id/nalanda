# ADR-0016: Java in the browser via CheerpJ — licence gate outcome

**Status:** Accepted
**Condition:** publication of the Java runtime is a separate decision taken at merge; publication terms pending written confirmation from Leaning Technologies
**Amended by:** ADR-0017 (findings F6 and the tools.jar consequence — see the notes inline)
**Date:** 2026-08-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #74 S1; design decision D24 (`docs/design/2026-08-redesign.md` §6); archived `proof-of-concept/decisions/0003-java-runtime-cheerpj-with-pivot-path.md`

## Context

v0.2 "El contenido vivo" needs Java execution: the pilot course is _Estructuras
de Datos en Java_, and ADR-0001 requires that compilation and execution happen in
the student's browser. The archived ADR-0003 selected CheerpJ but left an explicit
acceptance gate — verify that CheerpJ's free tier covers a university course —
which D24 promoted to the mandatory first task of this WP.

The gate had to answer three questions: (a) does the free licence cover this use;
(b) may the runtime be self-hosted under `/nalanda/`; (c) is compiling _student_
source code at runtime actually feasible.

## Findings

All findings gathered 2026-08-11 from vendor sources.

**F1 — The free tier is "Community Edition", and its qualifying uses are narrow.**
Per <https://cheerpj.com/licensing/>, Community Edition covers "Personal projects
and FOSS", with "Commercial use allowed for individuals and one-person companies".
Paid tiers start at £100/developer/month (Small Business, ≤10 developers).

**F2 — Self-hosting is prohibited on Community Edition.**
The same page lists "Self-Hosting not allowed" and "OEM/Redistribution not
allowed" for Community; <https://cheerpj.com/docs/licensing> grants "unlimited,
unmetered use of CheerpJ from the `cjrtnc.leaningtech.com` domain". Self-hosting
requires a commercial licence. This is a licence restriction, not a technical one:
the vendor states the runtime is "delivered as static WebAssembly and JavaScript
assets, can be hosted on any web server or CDN".

**F3 — Academic use is a "contact us" tier, not an automatic entitlement.**
The licensing page lists academic institutions, public sector, and non-profits
under discounted/custom pricing ("free or heavily discounted for classroom use"),
separate from the Community tier. Nothing states that a university course is
free by default.

**F4 — Nalanda cannot currently claim the FOSS route.**
The repository is public but carries **no `LICENSE` file**, so it is legally "all
rights reserved" rather than open source. The "FOSS" qualifier in F1 does not
apply as things stand. This is fixable in a day by adding an OSI licence, and the
design already states the intent to be "open-source and self-hostable for free"
(`docs/design/2026-08-redesign.md`, vision).

**F5 — The stated commercial ambition would exit Community Edition later.**
The vision records an eventual product with plans and billing. That is a
multi-person commercial deployment, outside Community Edition — a future licence
cost, not a present blocker, but it must be a known one.

**F6 — Technically, compiling student code in the browser works, with one
unverified step.**

> **Amended by ADR-0017.** The vendor's claim below did not survive contact: a
> browser spike found `com.sun.tools.javac.Main` absent from CheerpJ's Java 8,
> 11 and 17 runtimes alike. The compiler ships as an application asset, and it
> is ECJ, not `javac`.

- The vendor confirms `javac` itself runs under CheerpJ: "The `javac` compiler is
  itself written in Java and can run with CheerpJ. We showcase this in our
  JavaFiddle playground"
  (<https://labs.leaningtech.com/blog/cheerpj-3-deep-dive>).
- JavaFiddle is **Apache-2.0 open source**
  (<https://github.com/leaningtech/javafiddle>) and is a direct reference
  implementation: it writes sources with `cheerpjAddStringFile('/str/…')`, then
  `cheerpjRunMain('com.sun.tools.javac.Main', '/app/tools.jar:/files/', …)`, then
  runs the compiled main class. It therefore requires shipping a JDK `tools.jar`
  as an application asset.
- CheerpJ 3+ **can run inside a Web Worker** (`importScripts` on the loader; the
  `CheerpJWorker` class of CheerpJ 2 was removed), which preserves the worker
  contract used by the C++ and Python runtimes — but "anything that requires DOM
  access is not supported in a worker".
- **Unverified**: how program output is captured in a worker. JavaFiddle reads
  `System.out` off DOM nodes (`#console`, `cheerpjCreateDisplay`) with a
  `MutationObserver`, which is unavailable in a worker, and `cheerpjInit` exposes
  no documented `stdout`/`stderr` callback. A spike must confirm one of: output
  arrives via `console.log` in worker context; the `natives` option can bridge a
  Java-side `System.setOut` shim to JS; or Java runs on the main thread with a
  hidden display, as JavaFiddle does.

**F7 — There is no viable alternative for in-browser Java.**
TeaVM, Bytecoder, J2CL, GWT and GraalVM Native Image all compile _ahead of time_:
they ship a Java program to the browser but cannot compile arbitrary student
source at runtime. Webswing renders a server-side JVM. DoppioJVM is abandoned.
For client-side Java, CheerpJ is the only option; the only true alternative is
server-side compilation, which needs `apps/server` (v0.3).

## Decision

**Build all three runtimes now, Java included, under Community Edition. The
publication question is decided separately, at merge time** (Miguel, 2026-08-11).

The gate fired _ambiguous_, not negative, and the ambiguity is about publishing,
not about building. Community Edition explicitly covers "technical evaluations —
applications not yet in production or public", which is unambiguously what
development is. The licence question therefore does not bind implementation; it
binds the moment the work reaches <https://so77id.github.io/nalanda/>.

That moment is well-defined in this repo: merging to `main` deploys
(ADR-0015). So:

1. **Implementation proceeds** on all of issue #74, Java runtime included.
2. **Merging the Java runtime to `main` is an explicit decision by Miguel**, taken
   at PR review, with or without the vendor's answer in hand. The rest of the WP
   (engine, C++, Python, `CodeEditor`) carries no licence question and can merge
   regardless.
3. **Ask Leaning Technologies for the academic programme, explicitly including
   self-hosting rights** — not merely whether Community Edition covers us. State
   the case plainly: an individual professor's non-commercial, publicly readable
   teaching platform for a Chilean university course. Self-hosting is the only
   measure that removes the mid-class availability risk (see Consequences), and
   it is precisely what Community Edition forbids; the academic tier is the one
   path that grants it. Their own pricing page offers academic use "free or
   heavily discounted for classroom use".
4. **Add an OSI licence to the repository** (separate change). It matches the
   intent already recorded in the design, and it makes Community Edition's "FOSS"
   qualifier available instead of resting on "personal project" alone.

If the answer is negative, this ADR is superseded by one adopting server-side
compilation, which pulls Java execution out of v0.2 and into v0.3 alongside
`apps/server` — a roadmap change, not an implementation detail. The
language-agnostic worker contract (see Consequences) is what keeps that pivot
cheap: one worker implementation changes, nothing else.

## Alternatives considered

- **Self-host the CheerpJ runtime under `/nalanda/`** — technically supported,
  licence-prohibited on Community (F2); requires a commercial or academic
  licence. It would remove the dependency on _this vendor's_ CDN, but no longer
  buys offline use: C++ and Python are served from jsDelivr too (ADR-0018).
- **Server-side compilation** (`javac` in a container, the online-judge model) —
  licence-free (OpenJDK), but contradicts ADR-0001, adds per-execution cost and
  latency, and requires a backend that does not exist until v0.3.
- **AOT toolchains** (TeaVM, J2CL, GWT, GraalVM) — cannot compile student code at
  runtime (F7). Not applicable.
- **Drop Java, teach the course in C++ or Python** — both already work in the
  browser. Rejected: the course language is a pedagogical decision, not a
  technical one.

## Consequences

- **Development is unblocked; publication of the Java runtime is a deliberate,
  separately-taken decision.** The rest of v0.2's runtime work carries no such
  condition.
- **A hard dependency on `cjrtnc.leaningtech.com` at runtime** if CheerpJ is
  adopted under Community: no offline use, availability tied to the vendor's CDN,
  students' browsers make requests to a third-party host. The last point belongs
  in `docs/security-notes.md`, and any future CSP must allow that origin.
- **The vendor can technically disable the runtime, independently of any legal
  step.** Community Edition serves the runtime from their domain and
  `cheerpjInit` accepts a `licenseKey`, so origin-level restriction or key
  enforcement is available to them at any time — the failure mode is a class
  breaking mid-session, not a lawsuit. Self-hosting is the only mitigation, and
  it requires the academic or a commercial licence (Decision §3). Until then the
  exposure is accepted knowingly.
- ~~**A JDK `tools.jar` becomes an application asset** (F6), with its own
  OpenJDK GPLv2+CE redistribution terms to respect.~~ **Amended by ADR-0017**:
  the shipped compiler is ECJ 3.21 under EPL-2.0, so no OpenJDK terms apply.
- **The runtime contract stays language-agnostic**, so a later pivot to
  server-side Java changes one worker implementation and nothing else — the
  property archived ADR-0003 asked for, preserved deliberately.
- **A future commercial Nalanda pays for CheerpJ** (F5), or pivots then.

## References

- <https://cheerpj.com/licensing/> · <https://cheerpj.com/docs/licensing> (2026-08-11)
- <https://labs.leaningtech.com/blog/cheerpj-3-deep-dive> · <https://cheerpj.com/docs/migrating-from-cheerpj2>
- <https://github.com/leaningtech/javafiddle> (Apache-2.0 reference implementation)
- ADR-0001 (client-side compute) · archived `proof-of-concept/decisions/0003-java-runtime-cheerpj-with-pivot-path.md`
- Issue #74 · design D24
