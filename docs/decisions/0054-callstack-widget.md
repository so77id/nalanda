# ADR-0054: `<CallStack>` widget for visualizing recursive execution

**Status:** Accepted
**Date:** 2026-08-27
**Decision-makers:** Miguel Rodriguez
**Covers:** the `<CallStack>` course-content component · the recipe-based
authoring surface · the two mechanisms for demonstrating StackOverflowError
(a dedicated `broken` recipe and a `maxDepth` prop on any recipe) · the
choice of code-left + stack-right layout and base-abajo orientation
**Source:** Issue #221 — "Complejidad · *Recursión y memoria*". Miguel's
pedagogical redesign 2026-08-27: the "memoria de la recursión" section of
Acto 2 (slides 2.4, 2.5, 2.6) needs a widget that makes each frame VISIBLE
as the JVM pushes it onto the stack, and that can DEMONSTRATE
StackOverflowError when the caso base is missing or the depth exceeds a
simulated limit.

## Context

Acto 2 of Peli 2 teaches how to design a recursion. It's not enough for the
student to see the RESULT of a recursive call — they need to see the
MEMORY of the recursion: each call is a frame, frames stack up LIFO as the
recursion descends, and each frame is a real cost in the machine that
runs the algorithm.

Two pedagogical moves fail without a live visualization:

1. **"Cada llamada ocupa un frame"** — abstract otherwise. Seeing `factorial(5)`
   push five frames, then unwind through five pops with return values
   bubbling up, makes concrete what a text description leaves as vocabulary.
2. **"El stack no es infinito"** — students who never see a StackOverflowError
   don't internalize why a missing caso base is a bug. A widget that
   simulates the limit and shows the frame that gatilla the error teaches
   the failure mode in a way that no bullet list does.

`<RecursionTree>` (existing widget) shows the CALL TREE — a global view of
all invocations. `<CallStack>` complements it with the LOCAL view: only the
frames currently alive on the stack, in the LIFO order the runtime keeps
them. For linear recursion the tree is a chain and the stack is meaningful;
for non-linear recursion (`fib`, `hanoi`) the stack has depth $$N$$ even
when the tree has $$2^N$$ nodes — the widget makes that distinction
visible.

## Decision

**1. Adopt `<CallStack>` as a new course-content component.** Documents
write `<CallStack recipe="factorial" arg={5} />`. The widget knows how to
generate the trace for each supported recipe.

**2. The trace is generated from a NAMED RECIPE — the widget does not run
Java in the browser.** Same principle as `<RecursionTree>` (ADR of that
widget): declarative recipes over live execution. The recipes reproduce the
canonical implementations by hand — `factorial`, `sum` (linear by
decrement), `fib` (non-linear), `hanoi` (non-linear with side-effecting
args), `power` (linear by division — `T(N) = T(N/2) + c`, the logarithmic
counter-example to `sum`), and `broken` (no base case, for the
StackOverflow demo). Extending to `custom` (arbitrary author-supplied
trace) is future work — the recipes cover every case the chapter needs.

**3. Layout — v4 (2026-08-27): two-column transversal.** The left column
(~75%) is split vertically — CodeStepper on top with the current line
highlighted, current-context frame directly below. The right column
(~25%) is the paused-stack column, running the full height of the left
side; it scrolls internally so the outer widget never grows as the stack
deepens. The paused stack anchors newest-first (the frame closest to the
current context sits at the top). A controls footer captions each event.
This shape was iterated in review to give the code the largest slot, keep
the current context readable, and keep the stack legible independent of
depth (earlier layouts either forced the stack to grow the widget or
buried the code).

**4. Playback is MANUAL by default; autoplay is available on demand.**
Controls: Play/Pausa (toggles), Paso adelante, Paso atrás, Reset. The
professor drives the walk in class; the autodidacta reader can autoplay.
Speed is a multiplier (0.5, 1, 2) applied to the internal delay between
events. Autoplay pauses automatically at the end of the trace.

**5. StackOverflowError has TWO demonstration mechanisms.** Both are
useful, both ship:

- The `broken` recipe (`static long broken(int n) { return 1 + broken(n - 1); }`)
  simulates a recursión mal diseñada. Every push adds a frame; the trace
  never returns. By default `broken` caps at depth 20 — the number the
  deck names ("20 llamadas y se llega al overflow") — so the demo lands
  the error the slide claims it will land.
- The `maxDepth` prop on any recipe simulates a finite stack for a
  normally-terminating recursion. `<CallStack recipe="factorial" arg={20}
  maxDepth={5} />` shows that even a well-formed recursion can overflow
  when data is deep enough.

When the overflow triggers: the top frame flashes red (`bg-flag-soft`),
a banner reads `StackOverflowError` with the depth reached, and the trace
stops advancing forward. Reset and Paso atrás remain available so the
reader can rewind.

**6. Frame content — name and args + current line + return value.** Each
frame renders as one row:
- **Header line**: the label (e.g. `factorial(3)`, `fib(2)`, `hanoi(3, A, C, B)`).
- **Right column**: the source line the frame is currently paused at
  (`L3`), or its return value once the pop event fires (`→ 6`).

No local variables, no register state — the arguments are the observable
state of the frame for the algorithms in scope. If a future recipe needs
mutable locals (e.g. an accumulator), the frame shape extends.

## Alternatives considered

**Author declares the trace explicitly** (declarative per-event array).
Rejected as the primary API: too verbose for the deck's actual uses
(`factorial(5)` alone is 12 events). Reserved as a future escape (recipe
`custom`) for irregular problems.

**A single widget covering both the tree and the stack** (embed
`<RecursionTree>` inside `<CallStack>`). Rejected: the two views answer
different pedagogical questions — the tree shows RECOMPUTATION (which is
the point of `<RecursionTree>`); the stack shows MEMORY (which is the
point of `<CallStack>`). Two clear widgets beat one that tries to be both
and ends up confusing at both.

**Use `<StepShow>` + a `CallStackVisual` component per step** (mirror of
the `<StepShow>` + `<MemoryVisual>` pattern). Rejected: `<StepShow>`
requires the author to write each step. For a `factorial(5)` walk with 12
events, that would be 12 `<Step>` blocks with the whole stack state in
each — twelve times the verbosity for the same output. Recipes generate
the trace once; the author writes one line.

**Real JVM execution via `<CodeEditor>` running a snippet that prints the
stack**. Rejected: the pedagogical target is showing the LIFO STRUCTURE in
its native visual form, not the printed output of a program that
introspects it. Also: the JVM's actual stack is not observable from Java
code without JNI, so the "simulated" stack would be a manually-crafted
print anyway.

## Consequences

**Fifth widget in the interactive family that ships behind lazy loading.**
`<LazyCallStack>` follows the same shape as the other lazy wrappers. The
component composes `<CodeStepper>` (which pulls CodeMirror + the java
grammar) and lucide icons for the controls, so eager registration would put
CodeMirror in the entry chunk of every reader. Guarded by
`apps/web/src/architecture.test.ts` per-component case for `callstack`.

**Adds six recipe names** the author can call by (`factorial`, `sum`,
`fib`, `hanoi`, `power`, `broken`). The recipe set is a BOUNDED authoring
surface: adding a new recipe is a code change (test + catalog entry),
not a document change. That is the cost of the declarative model,
deliberately.

**Frame count grows with the size of the trace — no automatic sampling.**
For fib(N) the trace has $$O(\varphi^N)$$ events; the widget caps at 3000
events with an authoring error and asks the author to reduce `arg`. This
matches `<RecursionTree>`'s node cap. The cap is generous enough for every
use in the chapter (`fib(10)` is 177 events, `hanoi(5)` is 62 events) and
strict enough that a typo in the fence does not freeze the tab.

**Test coverage covers the state machine directly.** Push, pop, back,
reset, StackOverflow (both mechanisms — `broken` at the default cap of
20 and `factorial` with a low `maxDepth`), and the label shapes of every
recipe (factorial, sum, fib, hanoi, power) are asserted in the component
test suite. Autoplay is not asserted (jsdom doesn't advance timers
legibly and the behavior is a thin timeout).

**Future extension paths without breaking the API**:
- Recipe `custom` accepting an author-supplied trace array.
- Frame extension for local variables when a recipe needs them.
- Optional side panel showing the recursive call being executed (for
  Hanoi and similar) — this is the direction the `<HanoiPlayground>`
  widget (ADR-0055) took as a dedicated component, but a future
  `showRecursiveCall` prop could bring the pattern back into
  `<CallStack>`.

**No package.json change.** The widget uses `lucide-react` (already
present) for the control icons and standard React state for the trace
playback.
