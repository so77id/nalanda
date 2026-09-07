# ADR-0071: The RUT-to-student association is derived, course-scoped, and annotates

**Status:** Accepted
**Date:** 2026-09-07

## Context

A `reading` holds eight digits that AMC read off a printed sheet. A
`student` (migration `00014`, ADR-0069) is a person with a name, an
address and a RUT. Epic #270 needs the join between them: WP-3 (#273)
cannot email a corrected copy to anybody until the copy knows whose it is.

The join is not obvious, and the ways of getting it wrong are not
symmetric. A copy that matches **nobody** is a copy a professor looks at —
the reconciliation queue already exists for exactly that, and has since
WP-F. A copy that matches the **wrong person** is a grade delivered to
somebody it does not belong to, and nothing downstream would notice: the
control page would show a name, the matrix would show a number, and WP-3
would send an email. Every decision below is chosen on that asymmetry.

Two constraints shape the rest. `student.rut` is globally UNIQUE, so a RUT
identifies a person unambiguously across the whole database — which makes
the tempting design (match on the RUT alone) available and wrong. And
`control` shipped in `00004` with no course at all ("V1 has one implicit
course, so no curso_id column: WP-D adds it"), so every control that
predates this WP belongs to nothing.

## Decision

**1. A new domain package, `internal/domain/matching`, owns the join.**

It is the seam BETWEEN `roster` and `controls`, and it is its own package
because both alternatives put knowledge where it does not belong: in
`roster` it would make the roster know about readings, in `controls` it
would make the controls domain know how a RUT is spelled — which is
genuinely intricate (§2 below). `controls` declares its own one-method
`Matcher` port and never imports `matching`; the wiring happens in
`cmd/server`. Same shape as `health.Prober`.

**2. The scope is the control's course, and it is strict.**

`MatchByRUT` resolves a RUT only to a student who has an enrolment on
**this control's course**. A student enrolled on a different course does not
match — even though the RUT identifies them unambiguously.

**Either enrolment state.** A student who WITHDREW from this course still
matches, because they still sat the controls they sat. #271 keeps their
`enrollment` row for precisely that reason ("their grades hang off the RUT
match WP-2 adds"), and an enrolled-only filter falsified it: a re-import
that stamped somebody withdrawn erased the association of a control they had
already handed in, on the next rematch. Measured in this WP's own review
before it shipped (#272 Round B, DCO-3). The screens mark them "Retirado",
so the row reads as history rather than as a current enrolment.

The global match is rejected because "these eight digits belong to this
person" and "this person sat this control" are different claims, and only
the second is one a grade may be delivered on. A copy filed under somebody
who was never on the course is a grade delivered on the strength of a
coincidence nobody checked.

**3. The association is DERIVED and AUTHORITATIVE.**

`reading.student_id` is computed from the copy's *effective* RUT — the
professor's override if any, else what AMC read — and recomputed after
every event that can change it: `/analyse`, `Reanalyze`, a manual RUT edit,
and assigning a course to a control.

Authoritative means the recomputation writes whatever the current RUT
resolves to, **including NULL**. A reading that stops matching has its
student cleared. The alternative — only ever adding links — leaves a copy
filed under the person an *earlier* reading named, which is how a grade
reaches the wrong person after a re-read nobody thought had changed
anything.

The corollary is the repair path: a wrong association is fixed by
**correcting the RUT**, never by editing the link. There is no UI that
edits `student_id`, and there should not be.

**4. An unaskable lookup writes nothing, and is counted apart.**

A failed query means the answer is **unknown**, which is not the same as
"nobody". On a lookup error the row is left exactly as it is: an unmatched
copy stays unmatched, a matched one keeps the association a working lookup
established. Writing NULL there would un-file a whole control because a
database blinked.

The distinction survives into what a professor reads: `RematchResult`
counts `Matched`, `Unmatched` and `Errored` separately, and `Errored`
never merges into `Unmatched`. `ControlsFailed` is a fourth count, in a
different unit, for a control that could not be walked at all.

**5. The association ANNOTATES; it does not GATE.**

`estadoFor`, `summarise` and `closeGate` are deliberately untouched by this
WP. An unmatched copy is **not** a copy that needs review: it does not
change the "N requieren revisión" count and does not block *Cerrar
corrección*. The control page carries a separate "Asociación" column
(`asociado` / `reconciliar`), and that column is hidden entirely on a
control with no course.

The correction flow was working before this WP and keeps exactly the
meaning it had. Matching is an enrichment on top of it — which is also why
every matching failure is best-effort and logged rather than propagated:
the readings are already committed by the time it runs, and they are the
artefact a professor cannot reproduce without re-scanning.

**6. A control belongs to a course, and that is now required at creation.**

`control.course_id` is nullable, because every control that predates
migration `00015` has none and no value can be invented for them. New
controls get one from a required `<select>` on the create form; the ones
that predate this get one from an "Asignar curso" form on their detail
page. Matching **skips** a control with no course rather than failing on
it — with no course there is no roster to match against, and the copies
keep reading exactly as they did.

Assigning a course **rematches** as part of the write. Last-wins is only
safe if the consequences move with it: a control reassigned from course A
to course B would otherwise keep every reading pointing at a person
enrolled on A, which is the §2 failure by another route.

## Alternatives considered

**Match on the globally-unique RUT, ignoring the course.** Simpler, one
fewer join, and it would resolve every copy whose RUT is on file anywhere.
Rejected on §2: it converts "I know who owns these digits" into "I know
who sat this control", and WP-3 turns that into an email.

**Additive-only association** (never clear a link once set). Rejected on
§3: it makes a stale link outlive the reading that produced it, and the
professor has no way to see that the link no longer follows from the RUT.

**Gate *Cerrar corrección* on every copy being matched.** Attractive —
it would guarantee WP-3 has a complete class. Rejected on §5: it changes
the meaning of a flow that predates this WP, and it would block closing a
control whose roster simply has not been imported yet. WP-3 can refuse to
publish an unmatched copy on its own terms, where the professor is
already looking at publication.

**Store the association at read time only** (no retroactive pass).
Rejected: the controls corrected before this WP are exactly the ones
Miguel has, and a roster imported after a control was corrected is the
ordinary case rather than a migration one.

**A CLI subcommand for the retroactive pass.** Rejected on an already
accepted constraint rather than a new one: the production image is
`FROM scratch` (ADR-0034 §Consequences, "`scratch` has no shell to run one
with"), and the person who reads the counts is holding a browser.
`POST /admin/rematch` follows the shape `/admin/bank/refresh` (#230)
established.

## Consequences

- **WP-3 inherits "no match" as a first-class state.** A copy can be
  graded, correct, and belong to nobody the server can name. Publication
  has to say what it does with those rather than assume they do not exist.
- **A control with no course silently matches nothing.** This is the
  compatibility path for everything on the Jetson today, and the signal is
  on the control's own page ("Sin curso asignado" + the assign form), not
  in the results table.
- **The repair path is the RUT.** Any future feature tempted to offer
  "reassign this copy to student X" is fighting §3 and should change the
  RUT instead.
- **`matching.NormalizeRUT` and `canvas.SplitSISID` make deliberately
  OPPOSITE calls on the same-looking string** — eight bare digits are the
  body here and a body-plus-verifier there (ADR-0069 §Decision 2 records
  the Canvas half). The two live two packages apart and the wrong one is
  one import away; `TestEightDigitsAreTheBodyUnlikeCanvasSISIDs` exists so
  that a future deduplication of the two says what it costs.
- **The retroactive pass is idempotent and reports `Changed`**, which is
  the only reading of "idempotent" a professor can perform without a
  database client.
- **No per-professor scoping** on any of the screens this WP adds. That is
  inherited from the existing model rather than decided here, and is
  recorded where the standard puts it — `docs/security-notes.md` §"The
  roster is personal data", whose review trigger this WP moves forward.
