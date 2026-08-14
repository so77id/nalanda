# ADR-0026: The memory diagram draws from an execution trace, not from a description

**Status:** Accepted
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Covers:** the `trace` fence and its `// foto` markers · the generated `NalandaTrace` class ·
the `library` compilation unit the runtime contract grew · what the drawing shows and why
**Source:** Issue #116, promoted from Discussion #48 ("Ejecución Paso a Paso").
Extends ADR-0019 (annotated fences as an authoring surface) and ADR-0010/0014
(component contract and catalog); relies on ADR-0016/0017 (Java in the browser)
and is constrained by ADR-0018 (what may reach the entry chunk).

## Context

Half a data structures course rests on one idea a student cannot see: a variable
does not hold an object, it holds a reference to one. The audience arrives from a
C++ course where `Punto a;` *is* the object, so the difference is invisible in the
code. Prose does not fix it — the student nods, and still writes `==` where they
meant `.equals()`.

A drawing does fix it. The question was where the drawing's values come from.

An authored drawing — the author describes variables, objects and arrows, the
component renders them — is the cheap answer, and it has two defects that are not
cosmetic. It can be **wrong**, and nothing can tell: no build gate and no test can
compare a hand-written figure against the snippet beside it, exactly as ADR-0019
§8 records for exercise fences. And it goes **stale**, because these snippets are
editable on purpose: the reader is invited to change them and run them again, at
which point the figure describes a program that no longer exists.

Before committing to the alternative, the mechanism was measured rather than
assumed. In Chromium against `vite preview` on 2026-08-13, under CheerpJ:
`System.identityHashCode` distinguishes an alias from a distinct object,
`getDeclaredFields` with `setAccessible(true)` reads private fields by name,
cycles resolve by identity, and `java.lang.reflect.Array` reads arrays. Every
piece a tracer needs was already there.

## Decision

**1. The values come from running the snippet.** A `NalandaTrace` class is
compiled beside the author's program and photographs named variables at marked
lines, printing the heap as `[nalanda] T ` lines that the component reads back
(`components/interactive/trace.ts`). The drawing therefore cannot drift from the
code, and it follows the reader's own edits when they run it again.

**2. The authoring surface is an annotated fence, per ADR-0019 §2.** A
` ```java trace ` fence, with markers in comments:

```java
Punto a = new Punto(1, 2);   // foto a
Punto b = a;                 // foto a, b
```

`// foto marco: p, q` opens a second frame and `// foto-fin marco` closes it.

**Naming the variables is what removes the need for a Java parser** — the tracer
never has to work out what is in scope. It is also the better pedagogy: the author
picks the four moments and the four names that teach, where an automatic stepper
would also show every step that does not. The cost is a marker in the source,
which is stripped from what the reader sees.

Markers are replaced **in place**, never on a line of their own, because the
tracer reports line numbers against the original and an injected line would offset
every highlight after it.

**3. `var` is overloaded per primitive type, not taken as `Object`.** Overload
resolution happens at compile time against the *static* type, so an `int` arrives
as an `int` and is drawn as a value inside its box, while a `Punto` arrives as an
`Object` and is drawn as an arrow. A single `Object` parameter would autobox the
`int` and make every primitive a heap object — erasing the exact distinction
document 2 §2 exists to teach. This mirrors `check` in `harness.ts`.

**4. Identity, never equality.** Object ids come from `System.identityHashCode`
through an `IdentityHashMap`. Two `String`s holding `"hola"` therefore get two
boxes, which is what makes `new String("hola") == new String("hola")` visible
instead of claimed; `equals` would merge them and the drawing would refute the
lesson it is there to teach. A `String` is drawn as its text rather than its
internal `char[]` for the same reason: the box has to be recognisable as the value.

**5. A step shows every open frame, not only the one photographed.** `swap`
records its own two variables and says nothing about `main`'s, so the caller is
carried forward until the author closes it. Without this the swap that does not
work cannot be drawn at all — the whole point is four variables and two objects on
screen at once.

**6. The runtime contract grew a `library` unit.** `harness` compiles a second
unit and makes it the entry point, which a tracer cannot be: it has no `main`, and
the snippet must keep it. Swapping the two — tracer as `source` — trips the
reserved-name guard on the platform's own class. `library` compiles beside
`source` and is never run. The guard stays on `source` alone, deliberately: it
exists to stop a *student* shadowing a platform class, and the platform's own unit
arriving as a library is the intended use.

**7. `NalandaTrace` is the third reserved class name**, beside `NalandaLauncher`
and `NalandaCheck` (ADR-0019 §3b). The runtime refuses it as an entry class, and
the instrumenter additionally refuses a snippet that declares it as a *secondary*
class — which the runtime guard cannot see, since it inspects only the entry.

**8. Bounded: 40 photographs, 24 objects each.** Java runs on the page's main
thread (ADR-0017) and reachability is transitive, so a `// foto` inside a loop
would otherwise emit a state per iteration through a launcher whose own output
budget is 48kB. Over either cap the component says so rather than presenting a
partial trace as complete.

**9. Nothing is fetched until the reader asks.** A diagram that ran on mount would
pull the toolchain from the CDN on page load, once per diagram.

## Consequences

- **Documents 3 to 6 inherit the machinery.** Linked lists, trees and graphs are
  boxes with arrows; the tracer already resolves cycles by identity. Discussion
  #49 (call stack visualiser) reuses this trace rather than growing its own.
- **Java only.** The tracer is a Java class using Java reflection. C++ and Python
  get a refusal, not an empty drawing.
- **Java 8 only**, like everything else that compiles here
  (`runtime/java/runtime.ts`): no `var`, no `List.of`, no records — in the
  generated class and in every snippet written for it.
- **A wrong marker is the author's error and is reported as one**: a missing
  fence, a malformed marker, and a snippet with no markers are all caught before
  running. One failure can only be caught *after* — markers inside a branch that
  never executes produce a green run and no photographs, and the component says
  that too.
- **What it does not verify** is that a named variable exists; that needs a parser
  and a scope table. The compiler catches it, and its message reaches the reader
  through the same diagnostics panel as any other compile error.
- **The listing is not syntax-coloured.** It is rendered by the player rather than
  by `CodeEditor`, to drive the line highlight and to avoid pulling ~162 kB gzip
  of CodeMirror (ADR-0018) for a listing nobody can edit.
- **Entry chunk cost: +0.98 kB gzip** — the lazy wrapper and the catalog entry's
  own text. The component itself is a 6.93 kB gzip chunk nobody downloads until a
  page has one, guarded by its own case in `src/architecture.test.ts`.
- **Stacked, not side by side.** Two columns measured wrong: inside a document the
  component gets ~700px, so the drawing scaled to about two thirds and its 11px
  labels landed near 7px. A media query cannot fix that — what is narrow is the
  container, not the viewport.
- **The accessible description names cross-frame aliasing explicitly**
  ("Apuntan al mismo objeto: main.a y intercambia.q"). Grouping per frame alone
  described the swap as four references to indistinguishable objects, which is the
  lesson removed rather than translated.
