# ADR-0030: Auto-Multiple-Choice as the control engine, behind a worker container

**Status:** Accepted — one verification outstanding, see §Not yet proven
**Date:** 2026-08-15
**Decision-makers:** Miguel Rodriguez
**Source:** #138 (the spike), design `docs/design/2026-08-controles.md` §C8, §C9

## Context

The entrance-controls subsystem needs an engine that prints multiple-choice
sheets and reads them back from scans (`2026-08-controles.md`). Auto-Multiple-
Choice supplies the three expensive pieces — per-copy shuffling with printed
copy identity, a digit-grid reader for the student ID, and the annotated
correction PDF — but it is a Perl + GTK + LaTeX + OpenCV application built to be
driven from its desktop GUI, by a human, one project at a time.

We intend to drive it headless from a Go server with our own review UI on top.
Nothing about that is what AMC was built for, and if it could not do it, three
downstream WPs would have been specified against an engine we would not use.
#138 answered that before anything was built on the assumption.

## Decision

**Auto-Multiple-Choice 1.6.0 is the engine**, packaged as `apps/amc-worker`: a
separate container that speaks a small HTTP contract and exchanges work over a
volume shared with its caller.

Nine of the ten acceptance criteria are met, each by a committed, re-runnable
verification script (133 checks across six scripts):

| Criterion | Result |
|---|---|
| Runs headless, never opening the GUI | Whole pipeline runs with `DISPLAY=` empty and no X socket |
| N copies from a `.tex` we generate, shuffled per copy, printed identifier | 5 copies each drawing 4 of 10 questions, alternatives shuffled, `+1/1/60+` per page |
| 8-digit code grid printed and read back | Planned `20123456` reads `20123456` |
| One multi-page PDF, pages out of order | 10/10 captured from a deliberately scrambled batch |
| Ambiguous and unreadable reported separately, machine-readably | Distinct statuses; neither is resolved by guessing |
| Association injected from outside, no GUI | `association --set --student N --copy 1 --id RUT` |
| Annotated PDF, separable per copy | One named PDF per student, marks and per-question scores drawn on it |
| Measurements | Below |
| One real print → mark → scan cycle | **Outstanding** — see §Not yet proven |
| This ADR | Here |

**The worker is its own container, not part of `apps/server`.** AMC drags Perl,
LaTeX and OpenCV; the Go server is a small static binary. Merging them would put
a gigabyte-scale toolchain on the deploy path of every server change, and would
make replacing AMC a rewrite rather than a container swap.

**The contract crosses a volume, not the wire.** Requests name paths under
`/work`; responses name paths under `/work`. A scan batch is forty pages of
images and an HTTP body buys nothing.

**The wrapper is Python.** `python3` is already in the image via AMC's
dependency tree, the wrapper is standard-library only, and a Go binary would
mean adding a toolchain layer to the build in order to wrap a Perl program.
ADR-0006's "backend in Go" governs the backend service, which this is not.
`docs/standards/python-code-style.md` is born with it.

## Measurements

Apple Silicon (arm64), Docker Desktop 24.0.5, 5 CPUs, 8 GB. Synthetic batch.

| | |
|---|---|
| Image | **1.04 GB** |
| Generate 40 copies | **4.3 s** |
| Read 80 pages (40 duplex sheets) | **52.9 s** — 0.66 s/page |
| Batch PDF, 40 sheets at 300 dpi | 7.1 MB |

**There is no emulation.** `auto-multiple-choice` ships for arm64 in Debian
bookworm, so the image runs native on Apple Silicon. #138 was written expecting
amd64 under arm64 and the batch timing to be the number that decided the engine;
at 53 seconds for a full class, it is not a constraint at all.

**One package was 56% of the image.** `texlive-fonts-extra` is 1.38 GB and
`auto-multiple-choice-common` declares it as a hard dependency, so apt cannot be
talked out of it; it is purged with `--force-depends` in the install's own RUN
layer, taking the image from 2.56 GB to 1.04 GB. Nothing we compile uses it —
the full suite passes with it gone. The purge was done deliberately after every
AMC code path had been exercised, so that a font needed only by the annotated
PDF could not surface later.

**Alpine is not available.** Neither `auto-multiple-choice` nor `perl-opencv`
exists in Alpine's repositories. A musl build would mean compiling and
maintaining our own fork of AMC and redoing it at every upstream release.
DocumentBuddy can be Alpine because a static Go binary depends on nothing; here
the toolchain *is* the runtime.

## Alternatives considered

- **Our own PDF generation plus OMRChecker.** The standing fallback, and what
  #138 would have chosen had any criterion failed. Full control over the sheet
  and a stack we already know, against writing per-copy shuffling, code-grid
  reading and annotated corrections ourselves — the three things AMC gives free
  and the three that are hardest to get right.
- **AMC inside the Go server's image.** Rejected: ~2 GB of Perl and LaTeX on the
  deploy path of every backend change, and no seam at which to replace it.
- **Driving AMC through its GTK GUI.** Rejected outright; it is the thing this
  ADR exists to avoid.

## Consequences

### Three silent traps the caller must never hit

Each was measured, each is silent, and each yields a system that looks like it
works while losing a student's grade. The wrapper neutralises all three and
`tests/06-http.sh` asks it to do the wrong thing in each case:

1. **`association --set` without `--copy`** exits 0, prints nothing, and writes
   a row AMC's own listing ignores. A review queue built on that call reports
   success to the professor and never attributes the grade. `/associate/set`
   sends `--copy` and reads the association back before answering.
2. **`annotate` writes but never cleans.** Re-annotating into a used directory
   leaves orphans beside the new files and anything walking it sends both.
   `/annotate` refuses a non-empty directory.
3. **`prepare --mode b` must run after `analyse`.** The other order leaves the
   scoring table empty and every association silently matches nothing — which
   looks exactly like a wrong roster. `/analyse` owns the ordering.

And in the dispatcher itself: `auto-multiple-choice <anything>` hands an
unrecognised subcommand to the GTK GUI, which dies on `cannot open display`. So
headless is a property of calling only subcommands that exist, not of the
binary. `worker.py` picks from a fixed set.

### What AMC decides and what we decide

AMC finds the page, identifies which copy it is from the printed marker, locates
every box from the layout, and counts black pixels per box. **It stores darkness,
not a verdict** — deciding "ticked" is our threshold, in `read_capture.py`. That
is a feature (it can be tuned per batch) and a responsibility (a synthetic fill
lands at 0.63 against 0.0 for an empty box, so any threshold passes the suite).

### A damaged identifier fails closed

A blank RUT column is **omitted** from the assembled code rather than guessed at,
so the value comes out short and matches nobody; AMC refuses it by name. This was
verified rather than assumed, because the alternative would be catastrophic and
invisible: had a blank column been padded with `0`, a sheet could be attributed
to whichever real student that fabricated RUT belonged to. A narrow residual
remains — a dropped column shortens the code, so a 7-digit result could collide
with a 7-digit roster entry — and our own per-column reading flags the copy
before association regardless.

### The two failure kinds stay separate

*Who is this* (unreadable identifier) and *what did they mark* (ambiguous or
blank answer) are reported apart, all the way through. A sheet can be unreadable
about the first and perfectly clear about the second, and when it is, typing
eight digits is the entire repair. That is what makes the review queue of WP-F
cheap, and it is a property of our reporting layer rather than of AMC.

### Operational

- **Each copy is two PDF pages**, padded to an even count. Printed duplex that
  is one physical sheet per student and costs no paper; it does mean the scan
  batch has a back side for every sheet.
- **An unassociated copy still gets an annotated PDF**, named with the literal
  `_ID_` placeholder. Counting files is not a completeness check; the
  association table is.
- **The worker has no authentication and never will.** It is reachable only by
  `apps/server` over the compose network. Paths in a request are resolved and
  refused if they escape `/work`.
- **`--force-depends` leaves the package database knowingly inconsistent.** Fine
  for an immutable image, not fine if anything ever runs `apt-get install`
  inside it.

## Not yet proven

**No sheet has been through a printer, a pencil and a scanner.** Every batch so
far was filled synthetically — boxes blackened at the exact coordinates AMC's
own layout reports — which proves the plumbing and says nothing about paper. A
real mark is off-centre, grey, and sometimes half-erased; a real page goes into
the feeder rotated a degree or two; a real scanner has its own contrast curve.
The measured timings are therefore a **lower bound**, not an estimate.

That cycle is the one check that can still disqualify AMC, and it needs the
professor. Until it runs, this ADR records a decision that is verified in every
respect that can be verified without paper.

**Review trigger.** If the real cycle fails — corner marks not found, codes
misread, thresholds unusable — reopen this decision and record which criterion
broke. The fallback is unchanged (our own PDF generation plus OMRChecker) and
the container boundary is what makes it a swap rather than a rewrite.

## References

- `docs/design/2026-08-controles.md` — the subsystem's decisions (C8, C9).
- `apps/amc-worker/README.md` — the contract, the traps, how to drive it.
- ADR-0006 (backend in Go), ADR-0007 (SQLite first) — what this worker sits
  beside rather than inside.
- `docs/standards/python-code-style.md` — born with this worker.
