# ADR-0042: Control sheets are printed on US Letter paper

**Status:** Superseded by ADR-0043
**Date:** 2026-08-20
**Decision-makers:** Miguel Rodriguez
**Source:** #206, incident 2026-08-19 (Jetson, control WNME7QU6SZD26KFM5CBJD3QM4E,
44 pages / 22 copies).

## Context

The generator has emitted `\documentclass[a4paper,11pt]` from its first
commit — the AMC-in-a-container spike (ADR-0030) was written against A4,
and every synthetic batch since has been fine. Real print on paper had
never happened at the professor's desk until 2026-08-19.

On that date, control 2 was printed on the professor's default printer
and scanned back through DocumentBuddy. Every one of the 44 pages came
back `+0/0/0+` — AMC's shorthand for "none of the four corner fiducials
found" — and the worker returned exit 1 with "44 scans are not
recognized". The professor saw the flash "El motor de lectura rechazó el
archivo." and fell to manual grading for the whole batch.

The chain, reconstructed:

- Expected paint area at 300 DPI: **A4 = 2480×3508 px**.
- Actual paint area on the scan: **US Letter = 2550×3300 px**.
- The delta is not on the scanner (a scanner reports what the paper
  under it measures). It is on the **printer**. The printer accepted an
  A4 PDF, its default was Letter, and it scaled A4 down to Letter — which
  clips ~18 mm off the bottom edge. AMC's two bottom fiducials sit in
  that band. No bottom marks → no four-corner fix → `+0/0/0+`.

Chile's printer default is Letter. It is the operating context of the
one deployment there is (`docs/decisions/0038-the-jetson-is-the-first-test-bed.md`),
and it is what every subsequent generate will meet. ADR-0030 recorded
the paper as A4 because that is what was measured for it (§Partial
evidence — 2026-08-17: "four sheets, printed at 100% on A4"); the
choice was default-inherited, never argued. This ADR argues it.

## Decision

**The generator emits `\documentclass[letterpaper,11pt]` for every
control source.** One line in `apps/server/internal/domain/controls/tex/tex.go`
`preambleHead`; AMC's `prepare` and layout tables encode Letter geometry
from the class option, and the printed PDF then matches the Chilean
printer without scaling.

The change is pinned by
`TestPreambleDeclaresLetterPaperNotA4` in `tex_test.go`, which asserts
both directions: the exact preamble line is present, and no `a4paper`
token survives. The existing suite did not touch the paper option at
all, so a silent revert would ship unnoticed — the L8 print check that
would catch it belongs to Miguel, and it does not run per PR.

Amc-worker's three test fixtures (`control-demo.tex`,
`control-paper-min.tex`, `control-tres.tex`) also declare
`letterpaper`. They are static test data — no golden compares the
preamble — so the switch is documentary: they are the closest thing a
reader of the worker has to "what a real control source looks like",
and leaving them on A4 would tell a future contributor A4 was the
default that mattered.

Both `apps/amc-worker/PAPER-CHECK.md` and `PAPER-CHECK-MIN.md` say
"Plain white US Letter" in their §1 print instruction and point at this
ADR. The MIN variant was updated in the same PR — same paragraph shape,
same fact, the "sweep every surface asserting the fact" rule.

Already-printed A4 controls in manual grading (the 22 copies of control
2, in progress at the time of the switch) are not regenerated. They
were graded by hand and their reads are preserved; the switch applies
to future generates only.

## Alternatives considered

- **Keep A4 and instruct professors to change their printer default to
  A4.** Rejected. The printer default is the reality of the deployment
  and is not ours to change; a chain of instructions that professors
  must remember before every print is exactly what the fiducials were
  supposed to make unnecessary. It also leaves a trap for the next
  professor who forgets. The technical reality here is that A4 and
  Letter are equally valid to AMC (`\documentclass` takes both,
  geometry follows the option); the choice is operational, not
  technical.
- **Make the paper size configurable per-control (a form field, a
  server flag).** Rejected. There is one printer context per deploy;
  a variable buys nothing today but invites future controls printed
  with the wrong size for their site. If a deployment outside Chile
  ever needs A4, that is a reopening of this decision, not a
  parameter — the failure mode ("professor picks the wrong option")
  is worse than "no option exists".
- **Add wildcards / auto-detection to the reader so both papers scan
  correctly** (AMC's `analyse` given some tolerance for either
  geometry). Rejected as scope. The reader is not the failure surface;
  the printer is. Reading tolerance would let an A4 PDF that got
  printed Letter-scaled succeed, which is the exact "silently ship
  the wrong thing" the four-corner fiducial check exists to forbid.

## Consequences

- Every subsequent `POST /controls/{id}/generate` produces a Letter
  source; AMC computes the layout from that; the printed PDF matches
  the printer default; the four fiducials land where the scanner
  expects them.
- ADR-0030 gains an `Amended by:` line. Its §Partial evidence —
  2026-08-17 stays intact as the historical record of what was measured
  then (A4, four sheets, blue marker); §Not yet proven still points at
  `PAPER-CHECK.md`, which now says Letter.
- **A deployment outside Chile reopens this ADR.** The choice is
  Chilean-printer-facing; there is no branch of the code that decides
  paper size at runtime, so a US-East-of-Europe deploy would meet the
  same shape of failure with the letters swapped.
- **The L8 paper check gains its own reason to run first.** Any change
  to the preamble touches this decision, and PAPER-CHECK.md is the
  only place it is verified against ink.

## Not yet proven

**No sheet has been through the professor's printer with the new
generator.** ADR-0030 §Not yet proven's whole point — "everything on
paper is L8, and L8 belongs to the professor" — carries over unchanged:
a real Letter batch has to be printed, marked, scanned and read before
this decision is verified. The procedure is `apps/amc-worker/PAPER-CHECK.md`
(now saying Letter in §1), and its outcome is recorded here on the next
real cycle, alongside ADR-0030's own pending amendment.

Until then, the incident above stands as evidence of the failure mode
and this decision as its argued fix; the automated suite pins the
generator's output and says nothing about paper.
