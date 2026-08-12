# ADR-0020: Java exercises ship despite the unrecoverable freeze, and the draft is what pays for it

**Status:** Accepted
**Date:** 2026-08-12
**Decision-makers:** Miguel Rodriguez
**Covers:** publishing student-authored Java that can hang the tab · reversing a documented prohibition ·
saving the editor before every run
**Source:** Issue #76 (WP: document 1 of the Java unit + the Exercise component).
Reverses a rule shipped with ADR-0017; constrains ADR-0019.

## Context

ADR-0017 put Java on the page's main thread, because CheerpJ's loader needs the
DOM. The consequence is recorded there: a program that never terminates freezes
the tab, no timeout can reach it, and the reader must close the tab. C++ and
Python run in workers and are cut off cleanly.

The guide shipped alongside it drew the obvious conclusion and wrote a
prohibition (`add-a-course-document.md`): *"never ship a Java example whose
termination depends on what the student types."*

Issue #76 is a Java course teaching Java, and an exercise is by definition an
example whose termination depends on what the student types. The prohibition
forbids the WP. Worse, it forbids it in the one case where the language is not
interchangeable: "use Python for anything about loops" is not advice a Java
class can take.

This is not a rare edge. *Write a loop and forget to advance the counter* is the
typical first-week mistake, and document 1's fourth exercise —
`cuentaDigitos`, whose natural solution is `while (n > 0) { ... n /= 10; }` — is
precisely where it happens.

## Decision

**1. Java exercises ship, and the prohibition becomes a warning with its
reasoning.** Raised as a hard dependency and overridden deliberately by the repo
owner (2026-08-12). The alternatives were each rejected on their own terms — see
below — and none of them was "this is fine".

**2. The editor is written to `localStorage` immediately before every run.**
Not after, and not on a timer: the freeze arrives during the run, so the instant
before it starts is the last moment the page is alive to save anything. This
does not fix the freeze. It changes its cost from *the reader loses everything
they had written* to *the reader loses a reload*, which is the difference
between abandoning the page and continuing.

Applied to `CodeEditor` as well as `Exercise`, because document 1 alone has
seven runnable Java editors and its own prose already promises the reader their
code is kept.

**3. The draft is keyed on page path plus a hash of the starting source**
(`src/lib/draft.ts`), not on a position in the document. Adding a paragraph
above an editor must not hand a student a different draft, and an author must
never have to invent an id for every editor they write.

**4. Storage failures are swallowed.** Safari private browsing and an exhausted
quota both throw. Losing a draft is bad; taking the page down over it is worse.

**5. What is saved is stated wherever the promise is made.** Only what was in
the editor at the last run: edits made and never run are lost exactly as before.
Both catalog entries and the authoring guide say this, because a half-true
promise about not losing work is worse than none.

**6. Output is capped, because a program that TERMINATES could kill the tab too.**
The freeze this ADR accepts is non-termination. The review found a second way to
lose the page and it is not covered by that acceptance: measured in Chromium, a
correct program printing 10k lines stalls the main thread ~1.2s and 20k crashes
the renderer. It was reachable from a shipped editor by changing the stdin panel
from `10` to `100000` — which the prose immediately above it invites the reader
to do. The launcher now caps `System.out` at 256KB and prints one truncation
marker. Unlike the freeze, this one is fixed rather than accepted.

## Consequences

- A student who writes an endless loop still loses the tab. This is the accepted
  cost, and it will happen to real students.
- `Reiniciar` clears the draft as well as the editor, or the draft would
  reappear on the next reload and the button would be a lie.
- Course authors carry a new obligation, recorded in the guide: warn in the
  prose where a loop is the point, keep runaway inputs out of examples, and
  never leave such an editor where an unattended reader cannot recover.
- The next document in the unit inherits a sharper version of this problem.
  Document 3 (#78) teaches that recursive Fibonacci is slow, which means its
  whole point is running something slow on the main thread; that issue already
  carries the mitigation (cap the live demo, show the measured curve beyond it).

## Alternatives considered

- **Run CheerpJ in a Web Worker.** Would remove the freeze outright rather than
  soften it. ADR-0017 records that the loader needs the DOM; whether CheerpJ 4
  can be driven from a worker was **not** tested for this WP and remains open.
  This is the alternative most worth revisiting, and the reason it was not taken
  now is scope, not evidence.
- **Compile and run Java on a server.** Solves the freeze and the licence
  question together, and is where the owner expects this to end up. It is v0.3
  work and abandons "browser-first" for the one language the course is taught
  in — too large a turn to make inside a content WP.
- **Exercises in Python or C++ only.** They are cut off cleanly, and they are
  not Java. Rejected on the obvious grounds.
- **Detect endless loops before running.** Undecidable in general, and the
  approximations that work in practice — bytecode instrumentation with a
  back-edge counter — mean rewriting the student's compiled code, which is far
  more machinery than this WP can carry and a new class of bug in the component
  whose whole job is reporting a verdict accurately.
- **Ship no exercises.** The honest option under the old rule, and the one the
  owner declined: an intro course whose students cannot practise is the problem
  the platform exists to fix.
