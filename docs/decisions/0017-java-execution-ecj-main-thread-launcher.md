# ADR-0017: Java execution — ECJ under CheerpJ 8, on the main thread, behind a generated launcher

**Status:** Accepted
**Date:** 2026-08-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #74 S5; browser spikes run 2026-08-11; builds on ADR-0016 (licence) and ADR-0001 (client-side compute)

## Context

ADR-0016 settled *whether* we may run CheerpJ. This one settles *how* Java
actually executes, and it is not the shape the WP assumed.

CheerpJ is a JVM: it runs bytecode. Students write source. Something has to
compile, and a browser spike showed the runtime does not carry a compiler —
`com.sun.tools.javac.Main` is absent from CheerpJ's Java 8, 11 and 17 runtimes
alike (`ClassNotFoundException` in all three). The compiler must therefore be an
asset the site serves, and everything else follows from measuring what actually
works in a browser.

## Decision

**1. The compiler is ECJ 3.21.0, downloaded at build time into `public/`.**
2.9MB rather than the JDK's 18.3MB `tools.jar` (which is what the vendor's own
JavaFiddle commits to git). `scripts/fetch-java-compiler.mjs` fetches it from
Maven Central during `prebuild`/`predev`, verifies the published SHA-1, and
writes `public/java-compiler.jar`, which is gitignored: it is a build input, not
source.

**2. The Java runtime version is 8, and it is pinned by the compiler, not by
preference.** ECJ releases from 3.33 onward fail under CheerpJ on Java 11 and 17:
they resolve system libraries through a `jrt` filesystem
(`JrtFileSystem`, `/lt/11/release`) that the JVM-in-the-browser does not expose.
3.21.0 is the last line using the classic classpath model. Sources are compiled
with `-1.8`.

**3. Java runs on the main thread, behind the `RuntimeWorker` interface.**
CheerpJ delivers a console program's stdout by writing into a DOM element, and a
Web Worker has no DOM — so unlike C++ and Python, Java cannot live in a worker.
Measured: the page stays responsive anyway (timers keep firing while a Java
program blocks), so the main thread is acceptable. `RuntimeWorker` is our own
narrow interface rather than `Worker`, which is what lets this sit behind the
same contract as the other two.

**4. A generated launcher class runs the student's `main`.**
A CheerpJ console program gets neither input nor EOF on `System.in`: anything
reading a `Scanner` hangs forever (measured: no return after 30s). The launcher
points `System.in` at a file written per run, invokes the student's `main` by
reflection, and trims the reflection frames out of any stack trace so a student
sees their own error and not our plumbing. It takes the entry class as an
argument, so it is compiled once during warm-up and reused.

**5. Warm-up compiles the launcher.** The first compilation of a session costs
~24s (loading and JIT-ing the compiler); every later one costs ~1.3s. Compiling
the launcher at warm-up spends that cost before the student presses Run.

## Alternatives considered

- **Commit `tools.jar` (18.3MB)** — the reference implementation's approach:
  proven, no build step, offline. Rejected for 6× the weight in the repository
  and in every deploy.
- **Fetch `tools.jar` from JavaFiddle's repo via jsDelivr** — no binary in git,
  proven compiler, but makes our build depend on another project's repository.
- **Java 11 or 17 with a modern ECJ** — desirable for the language level;
  does not work (see Decision 2). Revisit when CheerpJ 5 ships stable Java 17.
- **Java in a Web Worker like the other runtimes** — no DOM, so no output. A
  bridge through `cheerpjInit`'s `natives` option could redirect `System.out` to
  JS; more machinery than the main thread needs, and unproven.

## Consequences

**Measured, in-browser (2026-08-11):** JVM boot 1.2s · warm-up compile 24s ·
subsequent compile 1.3s · run 0.3–0.9s · compile error surfaces with ECJ's own
diagnostic and a non-zero exit.

- **Students are limited to Java 8 language features** — no `var`, no records, no
  switch expressions. Acceptable for a data-structures course; a real ceiling to
  revisit with CheerpJ 5.
- **The first Run of a session is slow unless the editor warms up early.** The
  component decides when to warm; the runtime only offers `warmUp()`.
- **One JVM per page.** CheerpJ initialises once and cannot be unloaded, so the
  boot is a module-level singleton and runs are serialised — two editors on one
  document share the machine, and `terminate()` detaches rather than tears down.
- **The build needs network access** to Maven Central. CI and the deploy workflow
  both run `prebuild`; an outage breaks the build rather than shipping a broken
  runtime, which is the safer failure.
- **ECJ is EPL-2.0** — redistribution is permitted; the jar ships as a build
  artefact of a public site.

## References

- ADR-0016 (CheerpJ licence gate) · ADR-0001 (client-side compute) · ADR-0015 (base path)
- Issue #74 S5 · spike harnesses recorded in the PR
- <https://github.com/leaningtech/javafiddle> (Apache-2.0; source of the compile-then-run sequence)
