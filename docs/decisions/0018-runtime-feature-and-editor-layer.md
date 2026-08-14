# ADR-0018: The runtime feature and the editor layer — one contract, and what ships in the entry chunk

**Status:** Accepted
**Amended by:** ADR-0024 (§4: nothing under `runtime/` may be reached before
first paint, so a descriptor may no longer travel in the entry chunk)
**Date:** 2026-08-11
**Decision-makers:** Miguel Rodriguez
**Covers:** the `RuntimeWorker` contract · lazy per-language runtime modules ·
CDN-loaded toolchains · CodeMirror 6 + lucide-react · lazy wrappers for heavy components
**Source:** Issue #74 (WP: in-browser code runtimes + CodeEditor); review pipeline Round B, ADR-hunter lens. Extends ADR-0001, ADR-0004 and ADR-0010/0014; relied on by ADR-0016 and ADR-0017.

## Context

ADR-0001 said expensive compute runs in the student's browser. Issue #74 built
it, and produced two ADRs about Java specifically — 0016 (may we use CheerpJ)
and 0017 (how Java executes). Both lean on a design neither of them decides:
0016 promises that "a later pivot to server-side Java changes one worker
implementation and nothing else", and 0017 says "`RuntimeWorker` is our own
narrow interface rather than `Worker`, which is what lets this sit behind the
same contract as the other two". That property is load-bearing and, until this
ADR, unrecorded — a future refactor could delete the escape hatch 0016 sells
without tripping anything.

`src/runtime/` is also the fifth feature folder and the only one without an
implementation ADR (`content` → 0012, `presentation` → 0013, `catalog` → 0014).
This is its missing sibling. It covers the execution contract and the editor
layer together, because they are one story: what ships in the entry chunk and
what is fetched only when a student asks to run something.

## Decision

**1. `src/runtime/` is a feature, with a one-way edge `components → runtime`.**
Execution is neither a content component nor a pure `lib/` utility — it owns
workers and lazy module loading. The runtime knows nothing about components;
`CodeEditor` reaches it through the feature seam. Recorded in
`frontend-code-style.md` and enforced by `FEATURE_EDGES` in
`src/architecture.test.ts`.

**2. The transport is our own narrow `RuntimeWorker` interface, never the DOM
`Worker` type.** Four methods: `postMessage`, `addEventListener`,
`removeEventListener`, `terminate`. This is the decision the other two ADRs rely
on. It buys three things at once: Java runs on the main thread behind the same
type (ADR-0017 §3); the jsdom suite drives every runtime with a fake, which is
how a critical output-crossing defect was caught before merge; and a
remote-backed runtime — the ADR-0016 pivot — implements the same four methods
and changes nothing else.

**3. The message protocol is `warm` · `started` · `result` · `error`.**
Two rules carry weight beyond their size:

- **A failed compile is a `result`, not an `error`** — `exitCode: null`, the
  compiler's own text in `compileLog`. `error` means our machinery broke. A
  student who writes bad code must see the compiler, never an apology.
- **`started` marks the boundary between waiting and running**, so the caller's
  deadline measures the program and not a cold CDN, a JVM boot or (for Java) a
  queue behind another editor. Two budgets follow from it: 180s to get started,
  60s to run.

**4. Runtimes are split in two halves: a cheap descriptor and a lazy module.**

> **Amended by ADR-0024.** Nothing under `runtime/` may be reached before first
> paint, whatever it costs on its own — importing any of it drags the registry.

The descriptor (id, label, file name, sample) is plain data and would be cheap
enough to ship eagerly on its own account — but since #85 **nothing under
`runtime/` may be reached before first paint** (the invariant in
`architecture.test.ts`), because importing any of it drags the registry behind
it. The picker gets its descriptors from the lazy editor chunk. A module the
shell reaches eagerly that needs only the _ids_ asks `lib/runtimeIds.ts`. The module (CodeMirror
grammar + worker factory) sits behind `loadRuntime`, written as a switch of
static `import()` calls so the bundler emits one chunk per language — a computed
specifier would collapse them into one.

**5. Toolchains are loaded from a CDN, not bundled; their npm packages stay as
devDependencies for types.** browsercc and Pyodide address their own assets with
`new URL(…, import.meta.url)`, so a bundled import makes their WASM a build
output — measured 2026-08-11: `dist/` went from ~1MB to 113MB, against 109MB of
`node_modules/browsercc` on disk. Importing the module _from_
jsDelivr points that URL at the CDN instead. Versions are pinned exactly, with a
test tying the downloaded build to the typed one. The exception is what must be
self-hosted: the Java compiler jar, which CheerpJ reads through our own origin
(ADR-0017 §1).

**6. CodeMirror 6 is the editor, and `lucide-react` the icon set.** Via
`@uiw/react-codemirror`, one grammar per runtime exposed through
`RuntimeModule.codeMirrorLanguage()`. It is THE editor and THE highlighter for
documents, in the sense ADR-0004 makes framer-motion THE animation library; this
extends ADR-0004's stack enumeration as ADR-0011 did for the router. ADR-0014's seventh decision
kept catalog examples on plain `<pre>` "until a real need appears" — this is
that need, and it resolves the deferral for documents while leaving catalog
example snippets on `<pre>`. `lucide-react` is likewise the only icon library
(usage rules in `frontend-code-style.md` §Icons).

**7. Heavy components register through a lazy wrapper — extends ADR-0010/0014.**
The shell builds the MDX map and `catalogEntries` eagerly, so any static import
of a heavy component from a module the shell reaches pays its full weight in the
entry chunk: measured 478.41kB → 893.69kB for CodeMirror (2026-08-12,
vite 8.2.0; the widely-quoted "478 → 891" is the same delta measured a day
earlier). Such a component ships a
`lazy<Name>.tsx` wrapper, and **both** the MDX map and the component's own
catalog entry import the wrapper. This changes catalog mechanics, which
ADR-0014's fifth decision reserves for an ADR extending ADR-0010; `/catalog/governance` and
`guides/add-a-content-component.md` carry the operational form.

## Alternatives considered

- **Type the transport as the DOM `Worker`** and special-case Java — would have
  made Java a permanent exception instead of an implementation, and left the
  jsdom suite unable to exercise any runtime.
- **Bundle the toolchains** — self-contained, offline-capable, no third-party
  origin. Rejected at 113MB per deploy; the exposure it avoids is recorded as an
  accepted risk in `docs/security-notes.md` instead.
- **Monaco** — heavier, worker-based, VS Code fidelity we do not need.
  **Prism/Shiki + `<textarea>`** — highlighting only, no editing. **Plain
  `<pre>`** — what ADR-0014's seventh decision chose, and still right for
  catalog examples.
- **One shared worker per language per page** instead of one per editor —
  listed as a non-goal in issue #74; revisit when a document actually ships two
  runnable editors of the same language (per-worker cost measured in
  Consequences).
- **Manual chunking in `vite.config.ts`** instead of the lazy wrapper — moves a
  component-level concern into a confirmation-gated build file, and does not
  stop the next contributor from importing the component directly.

## Consequences

- **Adding a language is bounded**: descriptor, module, worker, one `case` —
  `docs/standards/guides/add-a-language-runtime.md` is the checklist, and the
  registry's own tests gate every entry the moment it is registered.
- **The pivot ADR-0016 promises is real**: a server-backed Java runtime
  implements four methods.
- **Execution depends on origins we do not control** (accepted risk, with review
  triggers, in `docs/security-notes.md`).
- **Every future language owes a CodeMirror grammar** — a real constraint on
  adding a language whose grammar does not exist.
- **The entry chunk stays flat**: 483.26kB against 478.41kB on `main`, i.e.
  **+4.85kB** (measured 2026-08-12, vite 8.2.0). The editor is a 111.58kB chunk;
  the languages are 44.78kB (python), 45.63kB (java) and 104.12kB (cpp), all
  lazy. **The case that does not hold**: this number tracks content, not only
  code — a catalog entry's prose ships in the entry chunk because
  `catalogEntries` is built eagerly, so writing documentation moves it. The
  claim to defend is "no CodeMirror, no compiler, no runtime in the entry
  chunk". **`grep` was said to prove it and does not** — #85 breached it without
  naming CodeEditor or Exercise: a component reached eagerly by the shell's MDX
  map imported the runtime seam for a list of language ids, and brought the
  registry, the descriptors and the Java launcher with it. Both name-based
  guards stayed green while the eager graph went from 1 chunk / 503,623 B to 9 /
  542,194 B, and the home page — which has no code at all — lost 236 ms of LCP
  on slow 4G.

  **Those totals are two breaches, not one**, and the first draft of this
  correction charged both to the runtime import — measured afterwards by
  building each cause in isolation (2026-08-13). The runtime import is what
  turned 1 chunk into 9, but it cost **+10,790 B and +88 ms**. The other
  **+27,781 B and +160 ms** came from a single `export { remarkPlugins }` on the
  content seam, which pulled the build-time MDX compiler and a TOML parser into
  the browser. That one is the _better_ illustration of the claim being made
  here: `grep` for CodeMirror finds nothing in it, `grep` for `runtime/` finds
  nothing in it, and it is 72% of the bytes. The invariant is now a
  reachability walk from `app/main.tsx` (`architecture.test.ts`, "what the shell
  reaches eagerly") that asks an allowlist question of every bare package, which
  is what catches the second one; the kilobytes are still a symptom, and `grep`
  is still worth running, but it is not the proof.

- **Who pays the lazy chunks changed with #85** (2026-08-13). This section was
  written when only a document with an authored `<CodeEditor>` loaded them. Now
  every document with a fence in a runnable language does, because a fence IS
  the component — and the grammar is not optional chrome, it is the
  highlighter. Measured from a network trace of `03-busqueda-binaria.mdx`, prose
  plus a single 10-line Java listing: **160.7 → 323.7 kB gz, +163.0 kB (+101%)**.
  Of that, **161.2 is five lazy chunks** — 95.6 core + 36.4 wrapper + 17.7 java
  grammar + 8.6 `@lezer/lr` + 2.9 the editor chunk itself — and the remaining
  1.7 is the entry chunk's own growth. (Two earlier drafts got this wrong in the
  same way and it is worth saying how: the first quoted ~153 kB from three terms
  that summed to 149.8, the second quoted 162.4 against five that summed to
  161.2. A breakdown that does not add up to its own headline is the defect this
  very section was written to correct. The two omitted terms are what makes
  "roughly doubling" exactly right.) The entry payload it doubles is **162.5 kB
  gz** across two eagerly loaded chunks — the entry plus the `jsx-runtime` it
  modulepreloads — measured 2026-08-13 **on this branch**, which is `main` at
  #97 with #85's fixes applied. `main` itself reads **168.2** at that commit,
  because it still carries the `remarkPlugins` regression removed here. Treat
  either as a reading of a date, not a constant.
  Accepted in #85 with the numbers in hand; the alternative that would remove
  it is highlighting without an editor, and the record here is thinner than it
  looked: the Alternatives below reject **Prism/Shiki + `<textarea>`** on the
  grounds of "highlighting only, no editing" — which is a reason about an
  _editing_ component and says nothing about build time. A build-time Shiki
  render, which costs zero client JS, was never weighed for a pure listing.
  **That thread is now pulled and tied off in ADR-0024**, which decides for a
  listing on palette coherence rather than on cost, and writes the price down so
  a future reader can reopen it with numbers in hand.
- **One live worker costs a few hundred MB of RSS** — 681MB peak measured for a
  single C++ worker on Apple Silicon (2026-08-11, Chromium via Playwright),
  against a 152MB idle baseline. Discarding it reclaims the live heap and all
  the CPU, not the whole footprint.
- **A green jsdom suite says nothing about execution**: every runtime is faked
  there. Browser verification is mandatory for changes under `src/runtime/**` or
  to `CodeEditor` (`docs/standards/testing-strategy.md`).

## References

- ADR-0001 (client-side compute) · ADR-0004 (frontend stack) · ADR-0010 (component contract) · ADR-0014 (catalog) · ADR-0015 (base path)
- ADR-0016 and ADR-0017 — both depend on Decision 2
- Issue #74 · `docs/standards/guides/add-a-language-runtime.md` · `docs/security-notes.md`
