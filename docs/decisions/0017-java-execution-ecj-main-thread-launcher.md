# ADR-0017: Java execution — ECJ under CheerpJ 8, on the main thread, behind a generated launcher

**Status:** Accepted
**Amended by:** ADR-0020 (the freeze is accepted for exercises, reversing a rule shipped here; and a third failure mode measured — see Decision 3)
**Date:** 2026-08-11
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #74 S5; browser spikes run 2026-08-11; builds on ADR-0016 (licence) and ADR-0001 (client-side compute)

## Context

ADR-0016 settled _whether_ we may run CheerpJ. This one settles _how_ Java
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
Maven Central during `prebuild`/`predev`, verifies it against a SHA-256 pinned
in the script — fetching the digest from the same origin as the artifact would
detect corruption and nothing else — and
writes `public/java-compiler.jar`, which is gitignored: it is a build input, not
source.

**2. The Java runtime version is 8, and nothing we control can raise it.**
CheerpJ's Java 11 and 17 images do not ship `jrt-fs.jar`
(`java.io.IOException: /lt/11/lib/jrt-fs.jar not exist`). Since Java 9 the
classic `rt.jar` is gone and every compiler locates `java.lang.*` through that
module filesystem — so on those runtimes **no compiler can compile at all**,
regardless of its version: ECJ 3.21 and 3.33+ fail identically, and `javac`
would too. The JVM itself runs 11 and 17 bytecode fine; what is impossible is
_producing_ bytecode in the browser. Sources are therefore compiled with `-1.8`
on the Java 8 runtime, where the classic classpath model still applies.

Raising the ceiling needs CheerpJ to ship a complete Java 9+ image — the vendor
has signalled Java 17 for a future major version, with no dated commitment
verifiable from their public pages as of 2026-08-11 — at which point this is
a constant. Supplying the module images ourselves is not a workaround: they are
not a jar, and CheerpJ does not expose them through its virtual filesystem.

**3. Java runs on the main thread, behind the `RuntimeWorker` interface.**
CheerpJ delivers a console program's stdout by writing into a DOM element, and a
Web Worker has no DOM — so unlike C++ and Python, Java cannot live in a worker.
The main thread is acceptable, but with a limit that must be stated precisely,
because the first version of this ADR overstated it. A Java program that
_waits_ — blocked on `System.in`, sleeping — yields the event loop, and the page
stays fully responsive: timers keep firing, measured at 107 fps during a cold
compile. A Java program that _spins_ does not. A `while (true)` holds the main
thread outright: measured 2026-08-11, a probe issued 30s into such a loop was
still blocked at 105s, with the renderer pinned at 101% CPU. Nothing recovers
it — not the run deadline in `useRuntime`, which is a `setTimeout` on the very
thread being held — so a student who writes an infinite loop in Java must close
the tab. C++ and Python, being real workers, are bounded normally.

**A third case, measured 2026-08-12 (#76), which this two-case model missed.** A
program that neither waits nor spins — one that _terminates, correctly_, and
prints a great deal — also costs the tab: 10k lines stall the main thread for
~1.2s, 20k crash the renderer. Reaching it takes no infinite loop, only a
`for` and a large number, which the stdin panel of a shipped example invites.
Capping the launcher's `System.out` bounds how far the console element grows but
does **not** make such a program finish: at 48KB a 60 000-`println` loop had
still not returned after 300s, because the cost is the JVM executing under
WebAssembly, not the writes (ADR-0020 §6).

`RuntimeWorker` is our own narrow interface rather than `Worker`, which is what
lets this sit behind the same contract as the other two — and what would let
Java move into a worker later, if CheerpJ ever delivers output without the DOM.

**4. A generated launcher class runs the student's `main`.**
A CheerpJ console program gets neither input nor EOF on `System.in`: anything
reading a `Scanner` hangs forever (measured: no return after 30s). The launcher
points `System.in` at a file written per run, invokes the student's `main` by
reflection, and trims the reflection frames out of any stack trace so a student
sees their own error and not our plumbing. It takes the entry class as an
argument, so it is compiled once during warm-up and reused.

**5. Warm-up compiles the launcher.** The first compilation of a session costs
~12s on a warm CDN and ~29s on a cold one (booting the JVM, then loading and
JIT-ing the compiler); every later one costs ~1.3s. Compiling the launcher at
warm-up spends that cost before the student presses Run.

## Alternatives considered

- **Commit `tools.jar` (18.3MB)** — the reference implementation's approach:
  proven, no build step, offline. Rejected for 6× the weight in the repository
  and in every deploy.
- **Fetch `tools.jar` from JavaFiddle's repo via jsDelivr** — no binary in git,
  proven compiler, but makes our build depend on another project's repository.
- **Java 11 or 17, with any compiler** — desirable for the language level;
  impossible today, and not for a reason we can route around (see Decision 2).
  Measured 2026-08-11: CheerpJ 11 and 17 both fail on the missing `jrt-fs.jar`
  with ECJ 3.21 and with 3.33+ alike. Revisit at CheerpJ 5.
- **Java in a Web Worker like the other runtimes** — no DOM, so no output. A
  bridge through `cheerpjInit`'s `natives` option could redirect `System.out` to
  JS; more machinery than the main thread needs, and unproven.

## Consequences

**Measured, in-browser, Apple Silicon:** JVM boot + launcher compile ~12s
together on a warm CDN, and **~29s on a genuinely cold one** — 28.7s on a first
visit with cold DNS, 12.7s and 11.2s on the two after it (2026-08-12, three
Chromium contexts). That is what the warm chip reports as `jvm …ms`, and it is
the number a student pays on their first visit of the day. An earlier figure of
24s in this ADR was not reproducible at either end. Subsequent compile
~1.3s · run 0.3–0.9s · a compile error surfaces with ECJ's own diagnostic, no
output and NO exit code — a failed compile is a result with `exitCode: null`,
not an error.

- **Students are limited to Java 8 language features** — no `var`, no records,
  no `List.of`, no switch expressions, no text blocks. Acceptable for a
  data-structures course, and not a choice: it is the ceiling CheerpJ imposes
  until it ships a complete Java 9+ image.
- **The first Run of a session is slow unless the editor warms up early.** The
  component decides when to warm; the runtime only offers `warmUp()`.
- **One JVM per page.** CheerpJ initialises once and cannot be unloaded, so the
  boot, the launcher and the run queue are module-level state — two editors on
  one document share the machine, and `terminate()` detaches rather than tears
  down. Runs are serialised for that reason: concurrent runs would cross their
  output through the one `#console` element and the one `/files/`.
- **An infinite loop in Java costs the tab** (see Decision 3). The runtime marks
  itself wedged when a run is abandoned while the JVM is busy, so later runs say
  so at once instead of queueing behind a program that will never finish — but a
  CPU-bound loop never reaches even that, because it holds the thread. This is
  the sharpest edge of running Java on the main thread, and it goes away only
  when Java can live in a worker. Narrowed by #76: a run that _reaches_ the end
  of `execute` clears the flag, because a finished run proves the JVM is free —
  before that, navigating away during the 12s boot disabled Java for the whole
  session with nothing actually stuck.
- **The build needs network access** to Maven Central. CI and the deploy workflow
  both run `prebuild`; an outage breaks the build rather than shipping a broken
  runtime, which is the safer failure.
- **ECJ is EPL-2.0** — redistribution is permitted; the jar ships as a build
  artefact of a public site.

## References

- ADR-0016 (CheerpJ licence gate) · ADR-0001 (client-side compute) · ADR-0015 (base path)
- Issue #74 S5 · spike harnesses recorded in the PR
- <https://github.com/leaningtech/javafiddle> (Apache-2.0; source of the compile-then-run sequence)
