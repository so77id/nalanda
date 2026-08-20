# ADR-0043: Paper size is a per-control preference, defaulted to Letter

**Status:** Accepted — one verification outstanding, see §Not yet proven
**Date:** 2026-08-20
**Decision-makers:** Miguel Rodriguez
**Source:** #208, decided in the hilo del #206 (same day ADR-0042 landed).
**Supersedes:** ADR-0042.

## Context

ADR-0042 hardcoded `letterpaper` in `preambleHead` and rejected making the
paper size configurable, with a single argument in §Alternatives: "a variable
buys nothing today but invites future controls printed with the wrong site
for their site". The Chilean printer default was the whole context and one
default fit it.

The next day Miguel decided to reverse. Two reasons:

1. **Simetría con el resto del formulario.** `DuplexPadding` (#185,
   ADR-0039) is already a per-control preference that travels from a form
   checkbox to the generator's `\clearpage` vs `\AMCcleardoublepage`
   decision. Paper size is of the same shape: an operational choice by
   the professor, not an architectural one. Leaving it as a global
   constant is asymmetric, and the asymmetry was arbitrary — nothing
   inherently distinguishes paper from padding except that one had a
   real incident behind it and the other did not.
2. **Opcionalidad genuina existe.** A colleague printing on A4, a demo
   at another institution, a future setup change — any of these is a
   preamble regeneration under ADR-0042 (with a code change to the const),
   and a form radio under ADR-0043. The frequency does not matter; the
   difference between "make Miguel edit `tex.go`" and "make Miguel
   click a radio" is what a configuration flag exists to bridge.

The wrong-option trap ADR-0042 named remains real. On 2026-08-19 the
professor did NOT choose the wrong paper — there was no choice, and the
printer's own default clipped 18 mm off the bottom, losing AMC's two
bottom fiducials on all 44 pages of the batch (ADR-0042 §Context). Under
this ADR the same failure mode reappears if a professor with prisa
picks A4 while their printer is Letter. **This ADR does not eliminate
that trap; it accepts it and mitigates it by UI.**

## Decision

**Paper size is a per-control field, defaulted to Letter, with A4
available under `<details> Opciones avanzadas`.**

- **Domain.** `type Paper string` with two enumerated values
  (`PaperLetter = "letter"`, `PaperA4 = "a4"`), `DefaultPaper =
  PaperLetter`, `ValidPaper(p) bool`. `Control.Paper Paper`. The tex
  package sits under `internal/domain/controls/tex` and cannot import
  controls without a cycle; it takes a plain `string` and defaults
  empty/unknown to letterpaper — same guard as the domain, mirrored so
  a caller landing at `tex.Compile` with a bug earlier in the chain
  still gets a legal source.
- **Persistence.** Migration `00009_paper.sql` adds
  `paper TEXT NOT NULL DEFAULT 'letter' CHECK (paper IN ('letter','a4'))`.
  Default covers pre-migration rows and any INSERT that omits the column
  (test data, future JSON callers, bugs); CHECK refuses invented values
  as the last gate.
- **UI mitigation.** The form radios live inside
  `<details><summary>Opciones avanzadas</summary>`, closed by default.
  A professor who never opens it never picks — the default is Letter
  and the friction is opening the block. The `<small>` inside the
  block warns explicitly about the wrong-option trap and cites the
  2026-08-19 incident. Chosen over two alternatives (see below).
- **Handler validation.** `validateCreate` resolves empty → default,
  refuses anything outside `{"letter","a4"}` with a per-field error
  message. The schema CHECK would refuse the same value one layer
  down, but by then the project directory would exist and the error
  would name a sqlite constraint (leaks storage into the flash).
- **Generator.** `Input.Paper` is a plain string; `preambleHead` is
  split into a `\documentclass[%s,11pt]{article}` format string and
  the stable rest, and `paperClassOption(paper)` maps
  `"letter"`→`"letterpaper"`, `"a4"`→`"a4paper"`, empty/unknown →
  `"letterpaper"`.
- **PAPER-CHECK.** Both `PAPER-CHECK.md` and `PAPER-CHECK-MIN.md` say
  "usa el papel que elegiste al crear el control (por defecto Letter;
  A4 si lo cambiaste en Opciones avanzadas)" in §1 instead of naming
  Letter fixed.
- **ADR-0042 stays as history**, with `Status: Superseded by ADR-0043`
  in its header. The reasoning it captured is intact — this ADR shows
  what changed and why, not by editing 0042 but by writing 0043 on
  top.

## Alternatives considered

### UI mitigation — chose `<details>` avanzadas

Three UI shapes were considered for the wrong-option trap.

- **Two radios visible in the main form, no friction.** Simplest. Most
  faithful to the DuplexPadding pattern (a single checkbox in the main
  flow). Rejected: DuplexPadding has no failure mode when misclicked
  — a professor printing simplex a control padded for duplex wastes a
  sheet. Paper has the ADR-0042 §Context failure mode: a wrong pick
  kills the whole batch. A visible radio with no friction treats the
  two the same and would ship the trap raw.
- **Radio + amarilla warning banner when A4 is picked.** More friction
  than the naked radio; the warning is contextual. Rejected as the
  chosen path only because `<details>` is a smaller UI addition (no
  banner, no styling for the warning state), and the fricción para
  el caso raro is what the trap needs — not more copy for the caso
  default. Reopen if the `<details>` proves too hidden for the rare
  legitimate A4 case.
- **A4 detrás de `<details> Opciones avanzadas`. Chosen.** The default
  case is the default form; a professor who never opens `<details>`
  never picks; the warning `<small>` lives inside so it is only shown
  to a professor already considering A4. Fricción proporcional al
  riesgo.

### Whether to configure at all — chose Yes

- **Keep ADR-0042's hardcoded Letter.** Rejected by Miguel's decision
  the day after ADR-0042 landed; the argument in §Context stands.
- **Server flag (env var) for the deploy default, no per-control
  choice.** Rejected: the case Miguel described is a per-control
  variability ("un colega imprime en A4", "una demo"), not a whole
  Jetson pivot. A per-deploy flag would need every generate to remember
  which deployment it is on, which is exactly the trap ADR-0042 named.

### Whether to also change the reader — chose No, out of scope

- **Auto-detect paper from the scanned image geometry.** Rejected by
  ADR-0042 §Alternatives and inherited here. The reader is not the
  failure surface; the printer is. Reading tolerance would let a
  mismatched batch succeed, defeating the four-corner fiducial check
  the printer→scanner contract depends on. Reopen if a real scenario
  argues otherwise.

## Consequences

- **A form radio decides which `\documentclass` the source emits.**
  The value persists on the row and travels through every re-emit
  (WP-G regenerate honours it, when WP-G lands).
- **Wrong-option trap is now a shared responsibility.** The system
  defaults to Letter and warns explicitly when A4 is chosen; the
  professor owns the pick-vs-printer match. Same failure mode as
  the 2026-08-19 incident is possible under this ADR — just requires
  a deliberate act (opening `<details>` and clicking A4 with the
  wrong printer). The mitigation is UI, not correctness; whether the
  friction is enough is measured in the next PAPER-CHECK cycles.
- **ADR-0042 stays legible.** A future reader sees Letter argued as
  the operational default (0042) then argued as the default of a
  configurable choice (0043). Neither is deleted; the split is the
  history of the decision.
- **PAPER-CHECK.md instructions now reference the created control**
  rather than naming a paper size. Fixtures under `apps/amc-worker/tests/
  fixtures/` stay Letter (the default) and are documentary of the
  default case, not the whole space.
- **The three surfaces that assert paper size stay in sync — at the
  schema, and by convention at the two others.** Domain enum, schema
  CHECK, generator switch. The schema CHECK refuses any value it does
  not recognise (`TestControlPaperCheckRefusesUnknownValue`), so a
  domain enum that grows a value the schema does not know goes red at
  the first INSERT. The generator's `paperClassOption` and the
  handler's `ValidPaper` are NOT covered by an iteration over the
  enum today; adding a third value would silently fall back to
  letterpaper in the generator until a test is written for it. If
  the enum ever grows, add a table-driven L1 iteration; today the
  two-value case is pinned exhaustively by
  `TestPreamble*Paper*` and the handler tests.

## Not yet proven

**A real Letter batch printed with `paper=letter` and a real A4 batch
printed with `paper=a4` have not both been through the professor's
printer.** ADR-0042 §Not yet proven inherits here: the automated suite
pins tokens and shape, and says nothing about ink. The A4 case is the
one that most needs the check — the Letter case is what ADR-0042 was
already awaiting.

Procedure: two cycles of `apps/amc-worker/PAPER-CHECK.md`, one with a
control created at `paper=letter` and one at `paper=a4`. Both are
Miguel's L8 responsibility, scheduled for the next real control
cycles; their outcomes get recorded here in the shape ADR-0030 §
Partial evidence — 2026-08-17 uses today. Same rule and same reason
as ADR-0042 §Not yet proven and ADR-0030 §Not yet proven.
