# ADR-0069: the RUT comes from Canvas's `sisId`, and is stored split

**Status:** Accepted
**Date:** 2026-09-04

## Context

Issue #271 imports the course roster from Canvas so that WP-2 (#272) can
match each `reading.rut_read` to a person. The issue could not say where the
RUT actually lives in Canvas — `sis_user_id`, `login_id`, or a custom field
— and reserved a **spike slice** to find out against the real UDP instance.

This ADR records what the spike measured, on 2026-09-04, with the
professor's own access token against `https://udp.instructure.com/api/graphql`
and the live course `44779` (`CIT2006_CA01`, term `2026-2`, 29 enrolments).

Everything below is measured, not inferred from documentation. Where a
number is evidence rather than a guarantee, it says so.

## What the spike found

### The endpoint and the verification probe

`POST https://udp.instructure.com/api/graphql` with
`Authorization: Bearer <token>` answers `200` and
`{"data":{"__typename":"Query"}}` to the `query { __typename }` probe the
S3 client already used. The probe is confirmed against the real instance:
it asks nothing of Canvas's own types, so it cannot break when Canvas
changes them.

### The RUT is `user.sisId`, WITH its verifier

Not `loginId`, which is the email address (identical to `user.email` for
25 of 25 students), and not a custom field.

`sisId` carries the RUT with **no separators and the verifier digit
attached**: `112223335`, `115556667`, `11222444K`.

Measured over the 25 `StudentEnrollment` rows of course 44779:

| Property | Result |
|---|---|
| `sisId` null or empty | 0 of 25 |
| Length | 9 characters, 25 of 25 |
| Matches `[0-9]{8}[0-9K]` | 25 of 25 |
| Verifier is `K` | 4 of 25 |
| Duplicate `sisId` | none |

### The printed sheet reads eight digits and no verifier

`internal/domain/controls/tex/tex.go` emits `\AMCcode{rut}{8}`. A reading
therefore holds an **eight-digit** value, and AMC's code field is
fixed-width, so a seven-digit RUT reaches the sheet zero-padded.

This is the collision the spike existed to find: Canvas's nine characters
and the sheet's eight are not the same string, and a naive
`student.rut = sisId` would join nothing in WP-2 while looking correct in
every screen that shows a roster.

### The rest of the contract

- **Names.** `user.sortableName` is `"APELLIDOS, NOMBRES"` for 25 of 25 —
  a comma split is reliable. `user.name` is a single run of words and
  is not: Chilean names carry two surnames, so no positional rule over
  `name` can find the boundary.
- **Everything is uppercase**, names and email addresses alike.
- **Enrolment types** on the course: `StudentEnrollment` (25),
  `TeacherEnrollment` (2), `TaEnrollment` (2). All `state: active`.
- **Relay pagination works and is required.** Paging
  `enrollmentsConnection(first: 2, after:)` produced 15 pages and 29 unique
  ids, matching the 29 a single unpaged call returns. Measured rather than
  assumed, because a paginator that silently stops after one page is a
  roster that silently loses everyone after the hundredth student.
- **`allCourses`** returns every course the token's owner is enrolled in,
  in any role — 16 for this professor, back to 2020. Canvas offers no
  role filter on that query; `Course.enrollments` does not exist (only
  `enrollmentsConnection`), so filtering to "courses I teach" would cost
  one extra query per course.

## Decision

### 1. `student.rut` is the eight-digit body; `student.rut_dv` is the verifier

Two columns, both nullable, constrained to be null together.

```sql
rut    TEXT UNIQUE CHECK (rut IS NULL OR rut GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
rut_dv TEXT        CHECK (rut_dv IS NULL OR rut_dv GLOB '[0-9K]'),
CHECK ((rut IS NULL) = (rut_dv IS NULL))
```

The body is the join key, in exactly the shape a reading holds it, so
WP-2's match is an equality and not an expression. The verifier is kept
because Canvas hands it over for free and it is what a person needs to see
a RUT written correctly — WP-2's screens and WP-3's emails both want
`11.222.333-5`, and recovering a discarded verifier later would mean a
migration and a re-import.

**The eight-digit `GLOB` is a real guard, not decoration.** It forces the
importer to zero-pad a short RUT rather than store `9876543`, which could
never match the `09876543` a reading holds and would surface as one student
who mysteriously never matches.

**The verifier is stored uppercase**, folded by the importer, so the column
cannot hold two spellings of one RUT.

### 2. The importer derives both from `sisId`

`sisId` → strip the last character as the verifier, uppercase it, left-pad
the remainder to eight digits. Anything that does not fit the shape leaves
BOTH columns NULL: an unmatchable student is a visible gap, and a guessed
RUT would be a wrong match on a real person's grades.

### 3. Names come from `sortableName`, not `name`

Split on the first `", "`: what precedes it is `last_name`, what follows is
`first_name`. A `sortableName` without a comma leaves the whole string as
`last_name` and `first_name` empty — wrong-but-visible beats a guessed
boundary between two surnames.

### 4. Only `StudentEnrollment` rows become students

`TeacherEnrollment` and `TaEnrollment` are skipped. The professor and their
TAs are not people whose entrance controls get graded, and importing them
would put them in the roster and, later, in the mailing.

### 5. The course picker shows the most recent term first, not all sixteen

The professor's stated need is one course: the current CIT2006. Courses are
ordered by their term's `startAt` descending (a term with no `startAt` sorts
last), the most recent term's courses are shown, and the remaining ones sit
behind a collapsed disclosure so nothing is unreachable.

Rejected: filtering to "courses I teach", which Canvas cannot answer in one
query and which would cost one round trip per course on every page load.
The two courses this professor attends rather than teaches are noise a
human resolves at a glance, and adding one by mistake imports a roster
rather than doing damage.

## Alternatives considered

- **Store `sisId` whole and match on a prefix in WP-2.** Rejected: it puts a
  string operation in every join, and AC-2 wants `student.rut` to BE the
  unique join key rather than something a query derives.
- **Store only the eight digits and discard the verifier.** What the issue
  asked for literally. Rejected: it throws away data already in hand, and
  the first screen or email that needs to print a RUT would need a
  migration and a re-import to get it back.
- **Compute the verifier instead of storing it** (module 11 is deterministic
  from the body). Rejected as a false economy: it is a second source of
  truth for a value Canvas already gave us, and it would silently paper over
  a genuinely wrong RUT in Canvas by producing a plausible verifier for it.
- **`loginId` as the RUT.** Refuted by measurement: it is the email address
  for 25 of 25.
- **A custom Canvas field.** Not needed — `sisId` is populated for every
  student measured.
- **Splitting `user.name` for the surnames.** Rejected: Chilean names carry
  two surnames and no positional rule works. `sortableName` states the
  boundary that `name` only implies.

## Consequences

**Positive**

- WP-2's match is a plain equality between `reading.rut_read` and
  `student.rut`, with no normalisation at query time.
- A malformed or absent RUT costs exactly one unmatchable student, never a
  failed import and never a wrong match.
- Screens and emails can render a complete RUT from day one.
- The pagination is verified against the real instance, so a course larger
  than one page is not a latent bug waiting for a bigger class.

**Negative**

- **The measurement is one course.** 25 students on `CIT2006_CA01` in
  `2026-2` all had a well-formed `sisId`. That is evidence about UDP's
  data, not a guarantee about every course or every future student — an
  exchange student on a passport is the obvious case that could differ.
  The nullable columns are what keeps that from being an outage.
- **`sisId` requires permission to read.** This professor's token can see it
  for their own students. A future role that cannot would import every
  student with a NULL RUT and match nobody — visible in the roster table,
  but only to someone who looks.
- **The picker can offer a course the professor merely attends.** Accepted
  in §Decision 5.
- **Uppercase names are stored as Canvas has them.** Presentation is a
  later concern; normalising on the way in would lose what Canvas actually
  holds.

## References

- Issue #271 S4 (this spike), epic #270.
- ADR-0068 — how the token that made this measurement possible is stored.
- `internal/domain/controls/tex/tex.go`, `\AMCcode{rut}{8}` — the eight
  digits that decide the shape of `student.rut`.
- ADR-0031 — what a reading holds, and the rule that a wrong value must
  never be inferred where none was read.
