# ADR-0078: surveys are an anonymous sibling of the controls, not a mode of them

**Status:** Accepted
**Date:** 2026-10-05
**Decision-makers:** Miguel Rodriguez
**Source:** epic #308 (interview-me + mockups, 2026-10-05), WP-1 #309

## Context

Nalanda prints and reads bubble sheets for one purpose today: the entrance
controls (`internal/domain/controls`, ADR-0030/0031). A control is graded
(every question has a correct answer and a weight), identified (the sheet
carries a RUT grid, ADR-0069, and a copy is matched to a student, ADR-0071)
and delivered (the corrected PDF is mailed to that student, ADR-0072/0073).

Miguel also wants paper **surveys**: feedback, periodic check-ins with the
group, research questionnaires. They reuse the expensive half of the chain —
LaTeX, the AMC worker, the scan reader, the review idiom — and invert the
other half on every axis:

| | Control | Survey |
|---|---|---|
| Correct answer | yes, scored | none |
| Identity | RUT grid, matched to a student | none, by design |
| Output | a grade per student, mailed | statistics per question |
| Repetition | each control is one sitting | the same bank is applied again (runs) to see what moved |

The question this ADR settles is where that lives, before the first table
exists.

## Decision

### 1. A sibling package, with the boundary enforced

`internal/domain/survey` is a new domain package parallel to
`internal/domain/controls`. It **never imports `controls`**, directly or
transitively — `TestTheSurveyDomainDoesNotImportControls` in
`internal/architecture_test.go` fails the build if it does. The two share
the worker and the paper, never a type: when surveys need the worker
(WP-2), they declare their own ports and `internal/infra/amcworker` grows
methods that implement them.

Its tables are prefixed `survey_*`, its store is
`internal/infra/storage/surveystore`, its routes live under `/surveys` and
`/courses/{id}/surveys`. Together these make a later extraction into its own
app a mechanical cut — designed for, not done (#313).

### 2. Anonymous by construction

No survey table references `student` or `enrollment`, now or in the run and
reading tables WP-2/WP-3 add. The sheet prints no name field and no ID
grid. The only person a survey records is the professor who created it
(`created_by`), the same audit column `control` has. Identified surveys are
a separate decision with its own epic if they are ever wanted (#313).

A survey belongs to **one course** (`survey.course_id`, RESTRICT like
`control.course_id`), and any logged-in professor sees it — the same
visibility every course and control already has; there is no ownership
model in the system to follow.

### 3. Three question kinds, and only one of them is averaged

- `single` — one answer among 2–10 alternatives. **Nominal**: its
  alternatives are names, so results count them and never average them.
- `scale` — an ordered scale of **3 to 7 points** with editable labels;
  point *k* is worth *k*. The only kind results average. It replaces the
  issue's first draft, "Likert 1-5": a 4-point "ritmo: lento · adecuado ·
  rápido · muy rápido" is a scale too, and modelling it as a single-choice
  question made the mockup average a nominal answer.
- `multi` — any number of 2–10 alternatives, with an optional min/max that
  is **printed as guidance and enforced by nothing**: paper cannot refuse a
  fourth mark, and a guard that pretended otherwise would discard what the
  student actually marked.

A context question (used by WP-4 to filter results by one of its answers)
must be `single`. The domain and the schema's CHECKs refuse the same
shapes, so a caller that bypasses one meets the other.

### 4. Section is a label, not an entity

Questions carry a free-text `section`; consecutive questions sharing it
are shown and printed under one heading. A `survey_section` table — rename
and reorder groups independently of their questions — is deferred (#313):
three mockups need grouping, none needs a group to be edited on its own.

### 5. The backoffice surface, like every professor screen

Survey screens are server-rendered pages on `internal/app/web`, behind the
fail-closed professor gate and CSRF on every POST. Nothing is mounted on
`internal/app/api`, which is anonymous by construction (§C12), and nothing
changes in `apps/web`. The forms work without JavaScript: a fixed set of ten
alternative inputs (blank rows ignored) and ↑/↓ buttons for order.

## Alternatives considered

- **A survey mode inside `controls`** (a flag on `control`, nullable correct
  answers, a "do not match" switch). Rejected: every controls rule — the
  RUT match, the grade, publication, the per-copy mail record — would grow
  a branch saying "unless this is a survey", in the most review-scarred
  package of the server, and the anonymity guarantee would rest on every one
  of those branches being right.
- **A separate app (`apps/surveys`) now.** Rejected for v1: it would need
  its own deploy, its own auth wiring and a decision on how `course` is
  shared, all before the subsystem has been used once. The boundary in §1
  keeps that door open at no cost.
- **Section as an entity from the start.** Rejected as above (§4).

## Consequences

- One more domain package and store, and one more architecture rule. The
  rule is per-package — the existing guards forbid `domain → app/infra`,
  not `domain → domain` — so it lives as its own test rather than as a
  widening of an existing one.
- A survey's numbers are only as anonymous as its distribution: AMC prints
  each copy's number on the sheet, so copies handed out in roster order are
  linkable. That is an operating note for the professor, not code.
- The run model, the worker integration and the job queue those need are
  WP-2's (#310) decisions and get their own ADR there.
