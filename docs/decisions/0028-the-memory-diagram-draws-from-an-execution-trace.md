# ADR-0028: The memory diagram draws from an execution trace, not from a description

**Status:** Superseded by ADR-0049
**Superseded by:** ADR-0049 (#209, 2026-08-19) — the pattern was reversed: the
memory diagram now consumes author-written state through the more general
`<StepShow>` primitive, and every piece of runtime this ADR added (the tracer
class, the `library` compilation unit, the reserved-name entry) was retired
with the widget. The body below is preserved unchanged per
`docs/standards/documentation.md` §"When review falsifies a claim"; read it
alongside ADR-0049 §Context, which explains what stopped being worth the cost.
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Covers:** the `trace` fence and its `// foto` markers · the generated `NalandaTrace` class ·
the `library` compilation unit the runtime contract grew · what the drawing shows and why
**Source:** Issue #116, promoted from Discussion #48 ("Ejecución Paso a Paso").
Extends ADR-0019 (annotated fences as an authoring surface) and ADR-0010/0014
(component contract and catalog); relies on ADR-0016/0017 (Java in the browser)
and is constrained by ADR-0018 (what may reach the entry chunk).
**Amended by:** #122 (2026-08-16) — §9's mounting cost re-measured once the
CodeMirror grammar left the runtime module, and the revisit trigger §Consequences
set is answered there; #123 (2026-08-16) — §6 and §7 stated the guard's reach
wrong; it now reads every top-level declaration in `source` and `harness` (after
decoding what the compiler decodes), and the instrumenter shares it instead of
restating it (see the notes inline)

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
compare a hand-written figure against the snippet beside it — the same blind spot
ADR-0019 §Consequences records for exercise fences, where a mistyped fence label
ships with a green build and a green suite. And it goes **stale**: the figure
describes whatever the snippet said the last time somebody looked at both.

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
code. It is not a laboratory: the listing is read-only, because the line
highlight belongs to the player and driving CodeMirror's decorations from outside
it costs more than it buys here. A document that wants the reader experimenting
puts a `<CodeEditor>` with the same program beside the diagram.

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
the planned document 2 (#77, "Referencias, null e igualdad") exists to teach. This mirrors `check` in `harness.ts`.

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

> **Amended by #123 (2026-08-16).** "On `source` alone" was the wrong half of the
> rule to write down. What is deliberate is the **`library` exemption**, and it
> stands unchanged. The guard now also reads `harness` — every reserved name
> except the one that unit owns, since `buildHarness` generates `public class
> NalandaCheck` and scanning for that name would refuse every exercise on the
> site. `library` is still not read at all: it is reachable only from a module
> constant.
>
> What the harness half actually catches is narrower than that reads, and the
> review of #123 measured it: `buildHarness` splices the author's `test` fence
> into the body of `NalandaCheck.main`, so a reserved name an author writes there
> is a LOCAL class — `NalandaCheck$1NalandaLauncher.class` — which shadows
> nothing and is correctly not refused. The scan fires on the one fence that
> unbalances braces and escapes the method into the compilation unit. That is the
> case the author-facing refusal message exists for, and it is the honest form of
> the claim.

**7. `NalandaTrace` is the third reserved class name**, beside `NalandaLauncher`
and `NalandaCheck` (ADR-0019 §3b). The runtime refuses it as an entry class, and
the instrumenter additionally refuses a snippet that declares it as a *secondary*
class — which the runtime guard cannot see, since it inspects only the entry.

> **Amended by #123 (2026-08-16).** The runtime guard sees it now: it reads every
> top-level declaration, so the secondary case was never the instrumenter's to
> catch. The instrumenter keeps refusing it — a `trace` fence is authored content
> and `<MemoryDiagram>` reports the mistake as an `<AuthoringError>` without
> booting a JVM — but it now calls the runtime's `reservedDeclarations` instead
> of carrying a regex of its own. That regex was worse than the rule it copied in
> three ways: it knew one of the three names, it read raw source so a comment
> naming the rule refused the diagram explaining it, and it flagged a *nested*
> declaration, which compiles to `Demo$NalandaTrace.class` and collides with
> nothing.
>
> **That last one is only two-thirds true, and the review of #123 measured which
> third is not.** A nested `NalandaLauncher` or `NalandaCheck` is inert. A nested
> `NalandaTrace` is not: this function INJECTS `NalandaTrace.inicio(…)` into the
> author's own class, where a member type of that simple name captures the calls
> and the diagram draws whatever it printed — compiled with the pinned ECJ 3.21.0
> and run, 2026-08-16, output `TRAZA FALSIFICADA POR EL AUTOR`. It stays allowed
> because a `trace` fence is repo-authored content, so the only person it can
> mislead is the author writing it. `trace.ts` carries the warning at the call
> site, `security-notes.md` holds the disposition.

**8. Bounded, and the bound is on what is DRAWN.** Java runs on the page's main
thread (ADR-0017) and reachability is transitive, so a `// foto` inside a loop
would otherwise emit a state per iteration through a launcher whose own output
budget is 48kB. Three caps: 40 photographs, 12 objects in the drawing, 32
elements or fields per box.

The middle one is the one that had to be learnt. It was first written as "24
objects *per photograph*", enforced inside the tracer — which bounds the wrong
thing, because objects accumulate across steps. A loop allocating one object per
iteration passed every per-photograph check and still drew forty boxes: measured
in Chromium at 1440px, a 466×3296 viewBox rendered **48px wide with the frame
label 1px tall**, and no cap fired. The cap now lives in `readTrace`, over the
accumulated set.

**8b. One signal for "this is not the whole run".** Four walls truncate a trace —
the photograph cap, the object cap, the per-box element cap, and the launcher's
48kB output budget — producing three messages, because the element cap borrows
the object one's wording. Each produces the same lie if unreported, because the
player says `paso N de N`, which is an active claim of completeness. Measured
before this was one signal: a 30-node list drew 24 boxes in silence, and a
40-photograph run cut by the byte budget announced "paso 21 de 21". The bytes
case is the subtle one: the launcher's sentinel does not carry the trace mark, so
it arrives as ordinary program output and has to be recognised deliberately.

The steps that survive a cut are always whole — a photograph interrupted
mid-flight never receives its `FINPASO` and is discarded — so the drawing is
short, never wrong. Only the count was ever the lie.

**9. The CDN toolchain waits for the button.** A diagram that ran on mount would
pull the compiler on page load, once per diagram.

Mounting is *not* free, and the first version of this ADR said it was. Measured on
the branch build: mounting pulled the java runtime module and, through its
`@codemirror/lang-java` import, the CodeMirror core with it — 17.7 kB grammar +
8.6 kB `@lezer/lr` + 95.4 kB core = **~121.7 kB gzip**, none of which this
component uses, because it draws its own listing. Returning that was #122.

**#122 returned it (2026-08-16).** The grammar left `RuntimeModule` for
`loadGrammar(id)` (ADR-0018 §4 as amended), so a consumer that mounts no editor
now asks for no grammar and drags no CodeMirror core behind it. Re-measured on
the built site: mounting one diagram costs **33.95 kB raw / 13.12 kB gzip across
four lazy chunks** — the component, the runtime seam, the runtime hook and the
java module — verified in Chromium against `npm run build && npm run preview`,
where `/catalog/c/MemoryDiagram` fetches exactly those four and **zero grammar
chunks**. The ~121.7 kB figure is kept above rather than deleted because the
correction is the point: this section was wrong three times, and each version
looked authoritative.

Recorded three times now, because it was got wrong three times: first as "nothing
is fetched", then as "~16 kB of grammar", which undercounted by the two chunks
the grammar drags with it, and then as ~121.7 kB, which was true only while the
grammar was inside the runtime module.

## Alternatives considered

**An authored drawing** — the author describes variables, objects and arrows in
props, the component renders them. Cheapest by far, and rejected for the two
defects in §Context: it can be wrong with nothing able to tell, and it goes
stale. Everything below assumes that rejection.

**A real stepper: instrument every line automatically.** What Discussion #48 asked
for. Rejected because it needs a Java parser and a scope table to know what is
live at each line — more machinery than the whole component — and because it is
worse pedagogy: it shows every step, including the ones that teach nothing, where
an author picks the four that do. The marker is the price of not having a parser.

**A per-photograph object cap**, enforced inside the tracer. Shipped, then
withdrawn: it bounds the wrong thing, because objects accumulate across steps.
Kept as a second line of defence, with the real cap in `readTrace` (§8).

**Scaling the drawing to fit a fixed box**, the way a slide is scaled to its
stage. Rejected on measurement: a linked list rendered 48px wide with 1px labels.
Scaling suits a stage, whose whole content must be visible at once; a document
scrolls, and so should this.

**Naming frames automatically** rather than in the marker. Would have made
recursion work — the limitation in §Consequences — but there is nothing to read
the name from without the parser this ADR declines to build.

## Consequences

- **The planned documents 3 to 6 (#78-#81) inherit the machinery.** Linked lists, trees and graphs are
  boxes with arrows; the tracer already resolves cycles by identity. Discussion
  #49 (call stack visualiser) reuses this trace rather than growing its own.
- **Java only.** The tracer is a Java class using Java reflection. C++ and Python
  get a refusal, not an empty drawing — enforced in `rejectHarness`, which the
  two workers already call as their sole gate. That guard covers the *shape* of a
  second compilation unit rather than one field name, because the first version
  of this ADR made the promise while only `harness` was checked, and `library`
  would have sailed through to run the snippet bare.

- **It cannot draw recursion.** Frames are keyed by the name the author writes in
  the marker, so N nested activations of one method collapse into one frame
  showing the innermost values — depth 1 for a depth-N stack. This is the single
  case where the drawing can teach the opposite of the truth, which is why it is
  stated in the guide rather than left to be discovered. It also means Discussion
  #49 (call stack visualiser) needs more than this trace, not less: an activation
  identity the marker cannot express today.
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
  by `CodeEditor`, primarily to drive the line highlight.

  The weight argument is weaker than it first looked, and is recorded honestly:
  ADR-0018's ~162 kB gzip is the cost against a page with no runtime at all, but
  a mounted diagram already loads the CodeMirror core (§9), so the editor would
  add only ~37 kB gzip on top — `CodeEditor` 2.95 + `useRunShortcut` 21.89 + its
  vendor chunk 12.32. If #122 splits the grammar out of the runtime module, that
  number changes again and this trade is worth revisiting.

  **#122 did, and the ~37 kB is void (2026-08-16).** It rested on "a mounted
  diagram already loads the CodeMirror core", which is exactly what stopped being
  true: the diagram now loads no grammar and no core, so giving it an editor would
  cost the core as well — the trade is *worse* than this paragraph concluded, not
  better. Not re-measured here, because nothing depends on it yet; reopen it with
  a fresh measurement, not with this number.
- **Entry cost: +0.98 kB gzip of JS and +0.39 kB gzip of CSS.** The lazy wrapper
  and the catalog entry's own text, plus the Tailwind classes — which are *not*
  lazy: one stylesheet is emitted eagerly for the whole app, so a lazy
  component's styles still reach every page. Measured against `main` at the final
  commit: 161.12 → 162.12 kB gzip JS, 8.55 → 8.94 kB gzip CSS. The component
  itself is a 7.3 kB gzip chunk nobody downloads until a page has one, guarded by
  its own case in `src/architecture.test.ts`.
- **Stacked, not side by side.** Two columns measured wrong: inside a document the
  component gets ~700px, so the drawing scaled to about two thirds and its 11px
  labels landed near 7px. A media query cannot fix that — what is narrow is the
  container, not the viewport.

- **Natural size with a scrollbar, never scaled to fit.** Fitting the drawing
  into a fixed-height box is what turned twelve boxes into confetti: measured at
  1440px, a linked list rendered 80px wide with 1px labels, and the same list now
  renders at 450px with 164×56px boxes. A code listing solves this by scrolling
  and so does this. The cap and the scrollbar do different jobs: the cap keeps
  the drawing worth looking at, the scrollbar keeps it readable.
- **The accessible description names cross-frame aliasing explicitly**
  ("Apuntan al mismo objeto: main.a y intercambia.q"). Grouping per frame alone
  described the swap as four references to indistinguishable objects, which is the
  lesson removed rather than translated.
