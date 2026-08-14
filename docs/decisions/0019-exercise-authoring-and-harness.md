# ADR-0019: Exercises — annotated fences as the authoring surface, a generated harness as the checker

**Status:** Accepted
**Date:** 2026-08-12
**Decision-makers:** Miguel Rodriguez
**Covers:** fence info-string meta surviving the MDX pipeline · `<Exercise>` reading its own body ·
the generated harness class · what the runtime contract had to grow
**Source:** Issue #76 (WP: document 1 of the Java unit + the Exercise component).
Extends ADR-0012 (content pipeline) and ADR-0010/0014 (component contract and catalog);
relies on ADR-0017 (Java execution) and is constrained by ADR-0020.

## Context

The Java unit (issues #76–#81) asks students to write code, not only read it,
and to be told whether it works. That is a new shape of content component: one
whose body carries three different things — a statement to render, code to seed
an editor with, and cases that must never appear in the editor at all.

Two problems had no precedent in the repo. Authoring: an author writes hundreds
of these, so the syntax has to be markdown a professor can type, not JSX with
Java escaped inside template literals. Checking: what makes an exercise worth
doing is that the verdict is about the student's _method_, and the obvious
approach — compare what the program printed — fails anyone who formats their
output differently, which is a bad lesson to teach in week one.

## Decision

**1. A fence's info-string meta survives the pipeline as `data-meta`.**
` ```java starter ` parses with `lang: 'java'` and `meta: 'starter'`, and the
default mdast→hast conversion keeps the language and drops the meta.
`remarkCodeMeta` (`src/content/codeMeta.ts`) preserves it as an attribute on the
`<code>` element. Fences without meta are untouched, so every code block already
written renders exactly as before. Registered in `vite.config.ts` beside
`remarkWikiLinks`, which established the pattern.

**2. A component reads its own fences; it does not take code through props.**
`fencesByMeta` and `withoutFences` (`src/lib/codeFences.ts`) let a component
pick labelled fences out of its rendered children and render the rest. This is
what makes the authoring surface ordinary markdown:

````mdx
<Exercise title="¿Es par?">

Escribe `esPar`, que devuelve `true` si el número es par.

```java starter
class Solution { static boolean esPar(int n) { return false; } }
```

```java test
check(Solution.esPar(4), true);
```

</Exercise>
````

**3. The cases are compiled into a separate class, not into the student's file.**
`buildHarness` (`components/interactive/harness.ts`) wraps the author's
`check(...)` calls in a generated `NalandaCheck` with overloads for `int`,
`long`, `double`, `boolean`, `char`, `Object` and the primitive arrays (`int[]`,
`long[]`, `char[]`, `boolean[]`). The authoring surface — argument order, what
may go in the fence — is documented once, in
`guides/add-a-course-document.md` §5b; this list is here only to say what shape
the generated class has. It owns `main`; the author's cases are inlined as its
body, and the student's class becomes a library it calls. The point is that the verdict is
about the method rather than about what the program printed, and that the checker
is not sitting in the buffer a stuck student is editing — the first thing they
change is whatever says they are wrong.

It is **not** a tamper control. An earlier draft of this ADR said the code
deciding the verdict "is not in a file the student can edit", which the review
falsified twice; see §7.

**3b. Two class names are reserved.** Both units compile into one output
directory, so a student class named `NalandaLauncher` or `NalandaCheck`
overwrites a platform one. Demonstrated 2026-08-12 in Chromium, before the guard
existed: a unit
declaring `public class NalandaLauncher` replaced the launcher built at warm-up
and, because that build is memoised, every editor on the page then ran the
student's `main` — exercises nobody had touched reported a full pass. The runtime
refuses both names before compiling anything (`RESERVED_CLASSES`).

**4. The runtime contract grew one optional field, and the runtimes that cannot
honour it refuse.** `RunRequest.harness?: string` is a second compilation unit
that takes over the entry point. ECJ already accepted a file list, so Java needed
only to write both units and derive the entry class from the harness. Python and
C++ **throw** on a harness rather than ignoring it: running `source` alone would
report a passing exercise that verified nothing, which is the worst failure this
feature could have.

**5. The harness reports over stdout with a marked line per case.** Lines are
`[nalanda] PASS <n>` or `[nalanda] FAIL <n> :: <esperado> :: <obtuvo>`, read back
by `readRun`. Everything unmarked is the student's own printing and stays
visible in its own panel, because adding a `println` is how people debug. The
generated `main` catches `Throwable`, so a method that blows up on case 3 does
not erase the verdicts for 1 and 2.

**6. Cases are hidden until the first run, and the wording never calls it
protection.** Everything under `content/` is published
(`docs/security-notes.md` §Accepted invariants), so the page source reveals them
to anyone who looks. Hiding is pacing. The component, the catalog entry and the
authoring guide all say so, and each states that an exercise whose cases must stay
private cannot exist here.

**7. A verdict is feedback, not evidence — stated here because the first draft
of this ADR claimed the opposite.** The review demonstrated two forgeries in a
real browser. A student who prints `[nalanda] PASS n` themselves and calls
`System.exit(0)` before any real case runs gets a clean green board; and, before
§3b existed, a student class named after the launcher forged a pass for every
exercise on the page including ones they never opened.

The first is inherent: the JVM, the marker and the parser all live inside the
student's own page, so there is no control to buy while checking happens there.
It is accepted because the failure is self-inflicted — same browser, same
student, nothing submitted, nothing graded, no other user reachable.

What follows is a hard boundary, not a caveat: **nothing produced by `<Exercise>`
may ever back a mark, a check-off or a record.** The day it needs to, checking
moves off the student's machine. Recorded with its review trigger in
`docs/security-notes.md`.

## Consequences

- Authors write markdown; nothing about an exercise requires JSX.
- The class named in `starter` and the one the cases call must agree. When a
  student renames their class the harness stops resolving it, which surfaces as
  an ordinary compile error — a result, not a broken runtime (ADR-0017 §the
  failed-compile rule). This is documented in the catalog entry rather than
  worked around, because rewriting a student's class name would be worse.
- Only Java validates today. A Python or C++ exercise is a runtime error at the
  moment it runs, by design.
- `data-meta` is now a general seam: a future component can label its own fences
  without touching the pipeline again.
- The marker protocol is readable if parsing ever breaks, which was chosen over
  control characters precisely so a failure degrades to legible output.

## Alternatives considered

- **Code through props** (`starter={\`...\`}`). No pipeline change at all, and
  rejected on authoring cost: Java inside a JSX template literal is where escape
  bugs live, and this syntax gets written hundreds of times.
- **Fence order instead of labels** (first fence is the starter, second the
  cases). No plugin needed, and silently wrong the moment an author adds a third
  block or reorders two.
- **`lang`-encoded labels** (` ```java-starter `). Also needs no plugin, and
  loses syntax highlighting and the language a runtime is chosen by.
- **Comparing stdout.** No harness, no contract change — and it fails a correct
  method for printing `4` instead of `4.0`, which is the failure mode this whole
  design exists to avoid.
- **JUnit in the browser.** Real assertions and real reporting, at the cost of
  shipping the jars into CheerpJ's filesystem and teaching first-years an API
  they will not meet for two courses.
