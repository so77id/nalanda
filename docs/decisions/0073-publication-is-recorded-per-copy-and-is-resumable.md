# ADR-0073: Publication is recorded per copy, and is therefore resumable

**Status:** Accepted — `apps/server/GMAIL-CHECK.md` §5c/§5d outstanding
**Date:** 2026-09-08
**Decision-makers:** Miguel Rodriguez
**Source:** #287, from the first real publication to students (2026-09-08, the
day #273 shipped). Every item below is a defect or a gap Miguel hit while using
it on a live class, not a review finding — except §4's rehearsal rule and §5's
retention note, which the WP's own review added (COR-1/SEC-1, SEC-2).
**Supersedes:** ADR-0072 §5 ("Publication is async, one-way, and stamped before
it sends"). §§1–4b and 6 of ADR-0072 stand unchanged.

## Context

#273 shipped the publication: the professor closes a correction, presses
**Publicar**, and every matched student receives their annotated PDF from
the professor's own Gmail. It worked. The first real class went out on
2026-09-08 — thirty-four seconds, zero send failures.

Then Miguel used it, and it turned out that the publication was recorded
about the **control**: a timestamp, a mode, and a COUNT of the messages that
went out. Not *who*. Everything below follows from that one gap.

1. **It could not be resumed.** If the process died mid-loop — the container
   restarts, the Jetson loses power — the control was already stamped (by
   design; see §"What ADR-0072 §5 got right" below), `published_sent` was
   NULL, and nobody knew who had received their correction. The only
   recovery was to unpublish and mail the whole class again, so everyone who
   already had theirs got a second copy.

2. **A per-copy failure was a manual chase.** The banner named the copy
   numbers that failed and the system's help stopped there. Publishing was
   one-shot (409) and the rehearsal sent the WHOLE batch to one address.

3. **A re-correction could not be re-sent.** A professor who fixes one
   student's grade after publishing had no way to send that student the
   corrected version. This is the case Miguel raised first, and it is
   routine rather than exceptional.

Underneath all three, a smaller defect: `PublishResult.Skipped` — copies with
no matched student, no defined grade, or no annotated PDF — was computed on
every run and surfaced nowhere. The professor's only signal that two people
got nothing was comparing "salieron N correos" against their own class list,
after the fact.

### What ADR-0072 §5 got right, and why it stops being right

§5's stamp-before-send rule was not a mistake. Given no per-copy record, the
choice is between two failures on a crash halfway through a batch:

- stamp after the loop → an unstamped control with twenty students already
  emailed, which the professor publishes again, and the twenty receive a
  second copy of a grade;
- stamp before the loop → a stamped control whose un-sent half nobody can
  reach through the app.

§5 chose the second, because a duplicate mailing cannot be recalled and a
missing one can be chased by hand. That reasoning is sound and it is
*entirely* about the absence of a per-copy record. Add one and the choice
disappears: a crash costs nothing, because the next Publicar sends exactly
what did not go out.

## Decision

### 1. The unit of publication is the COPY

Migration 00019 adds two nullable columns to `reading`:

```sql
ALTER TABLE reading ADD COLUMN published_at INTEGER;   -- unix seconds
ALTER TABLE reading ADD COLUMN published_grade TEXT;   -- the grade that WENT OUT
```

`reading` is the right home because the reading IS the copy: the row already
carries `UNIQUE (control_id, copy_number)`, which is the key a publication
addresses, and a side table would be a second row to keep in step with a
reading that is upserted on every re-read.

**The property the whole feature rests on is that these survive a
re-analysis.** `upsertReading`'s `ON CONFLICT DO UPDATE SET` names its
columns explicitly, so a column it does not name is left alone. If that ever
changed, one "re-leer con otra sensibilidad" would tell the professor nobody
had received anything and the next Publicar would mail the class a second
time. It is pinned by `TestUpsertingAReportPreservesThePerCopyPublication`
rather than left to a comment.

`published_grade` stores `FormatGrade`'s output verbatim — a string and not a
float, because the only question it answers is whether what would be sent
now equals what was sent then, and comparing two canonical strings is the
version of that question with one answer.

`control.published_at` and `publication_mode` STAY. They answer "when was
this class published, and for real or as a rehearsal", which no per-copy row
answers. `control.published_sent` is DROPPED (migration 00020): it was a
stored copy of a derivable number, and it could disagree with reality in
both directions — NULL over a class that had been mailed when a run died
before the bookkeeping write, and unmovable when one copy was re-sent
afterwards.

### 2. Four states per copy, derived and never stored

| State | Condition | What the professor sees |
|---|---|---|
| **No enviada** | `published_at IS NULL` | `no enviada` · "iría con un 5.7" |
| **Enviada** | stamped, and `published_grade` == the current grade | `enviada` · when it went out, and with what |
| **Enviada, desactualizada** | stamped, and the grade has changed since | `desactualizada` · "salió con un 4.0, ahora tiene un 7.0" |
| **Omitida** | not deliverable: no matched student, no defined grade, no annotated PDF | `omitida` · the reason |

There is **no per-state button**. The copies table is text; the only
per-copy send is the review page's "Enviar la corrección a esta persona",
which is offered on every state including **Enviada** — deliberately, since
that is the manual override §5 exists for. What the state changes is what
the batch does on the next Publicar, not what the professor is offered.

Derived, never stored: a fifth column holding the state would need
invalidating on every re-read, re-annotation, override and roster import,
and would be wrong for the whole window between the change and the
invalidation. The comparison costs one string equality and cannot go stale.

**Deliverability is asked first, but decides the answer only for a copy that
was never sent.** A copy that WAS sent and has since stopped being
deliverable — the student withdrew, an override turned their grade into a
dash — stays "enviada". None of that un-sends the mail they are holding, and
reporting it as skipped would tell the professor nobody wrote to somebody
who has the correction in their inbox.

**One function decides, and the one approximation of it is deliberate.**
`deliverableCopy` answers "can this copy be mailed, and with what grade";
the loop (`Service.messageFor`), the copies table (`CopyPublicationFor`) and
`PublishOne`'s refusal all go through it. A loop that skipped a copy the
table called ready would be two answers to one question — the shape #251's
cannot-disagree rule refuses.

The review page's button gate (`handler.copySendGate`) is the exception, and
it is bounded: it asks the same three questions **in the same order**, using
only what that page already holds, and leaves the fourth — a match the
roster no longer carries — to the domain. So the button CAN be live over a
refusal for a copy whose student left the course, and `PublishOne` then
answers with the same sentence from the same function (`copySkipMessage`).
Ordering it differently is what made one screen say "falta el PDF" while the
other said "sin nota" for one copy (#287 review, ARQ-3/COR-11).

### 3. Staleness is detected on the GRADE, not on the PDF

The alternative was `annotated_copy.generated_at > reading.published_at`,
which also catches a re-annotation that moved the marks without moving the
total. **Rejected:** `Reanalyze` calls `ClearAnnotated` and re-annotates
every clean copy, so one global re-read at a new sensitivity would mark the
whole class stale even where nothing a student can see changed. That is the
same false positive that ruled out comparing `read_at`.

Accepted limitation: a re-correction that changes a copy's marks but not its
total grade is **not** flagged. §5's per-student button covers it — the
professor knows whose marks they just fixed. Precise automatic detection,
manual override for the rest.

### 4. `Service.Publish` is resumable, and stamps each copy after its own send

The loop skips a copy whose state is **Enviada**, sends the rest, and stamps
each copy **immediately after its own send succeeds**.

**A COPY IS STAMPED ONLY BY A RUN THAT REACHED ITS STUDENT**, and that rule
is load-bearing rather than tidy. Three kinds of run put the message in the
professor's own mailbox instead: an "envío de prueba" to one typed address,
a publication in `staging` mode, and any run at all under a deployment-wide
redirecting transport (`NALANDA_EMAIL_MODE=staging`). None of them records
anything about the student, and all three send the WHOLE batch whatever
state each copy is in — they exist to put the real batch in front of the
professor, and filtering would rehearse something other than the thing being
rehearsed.

The first draft of this WP tested only the first of the three, and the
review measured what that costs: a publication in "mi propia dirección
(prueba)" stamped every copy, so the next REAL Publicar skipped the entire
class while the copies table said "enviada" and the list said "25/25". The
worst shape the verifier found is the one this WP exists for — a staging
rehearsal on an ALREADY published control consumes the single re-corrected
copy, so that student keeps the out-of-date PDF and **no screen says
"prueba"**, because `MarkPublished` only ever runs on the first
publication. This is #273's own PUB-2/DAC-8 defect class re-entering
through the door the per-copy stamp opened.

The predicate is deliberately SEPARATE from "is this a rehearsal": it gates
the per-copy stamp and the resume filter, and must NOT gate the
control-level `MarkPublished`, which is what records the EFFECTIVE mode and
is precisely the signal a redirecting deployment has to leave behind
(#273 review, DAC-8).

One consequence on the page: `publication_mode` is written once, on the
first publication, so a professor who rehearses in `staging` and then
publishes for real leaves it saying `staging` forever. `publishedLine`
therefore asks the COUNT first — a stamped copy proves a student was
written to, whatever the column says — and only falls through to the mode's
sentence when nothing is stamped.

`control.published_at` is still stamped once, on the first run. A resume
finds it set and leaves the date alone: re-dating it would move "Publicado
el 8 de septiembre" forward every time a professor re-sent one copy.

A test that only checks the end state cannot see this ordering — the loop
never returns early, so stamping everything afterwards ends in the same
place. The pin asks the dispatcher what the world looks like at the SECOND
send, by which time copy 1 must already be stamped. Same shape, and the same
scar, as ADR-0072 §5's own pin (#273 S9).

**`ErrAlreadyPublished` and the 409 are removed.** Pressing Publicar twice
is harmless by construction: every copy already holding the current
correction is skipped. `Service.Unpublish`, `Store.ClearPublished` and
`POST …/unpublish` go with them — the dead end they rescued the professor
from cannot happen any more.

### 5. Two ways to send outside the batch

**Per student, synchronous:** `POST /controls/{id}/copies/{n}/publish`, from
the review page — where the professor already is when they finish
re-correcting somebody. It stays synchronous under its own deadline because
**the shape of the WORK decides** (ADR-0050 as ADR-0072 amended it): one
Gmail call plus one PDF is a bounded third-party call the professor waits
on; forty of each is the loop nobody can wait on. It sends regardless of
state — that is the manual override §3 relies on.

**Per class, deliberate:** "Reenviar a todo el curso" takes the slot
"Deshacer la publicación" had, and the rename is the point: that button
never undid anything. It forgets every copy's stamp behind a confirmation
naming how many people would receive a second copy, and it does not send —
clearing and sending are two decisions, and a professor who has just been
told twenty-five people are affected should get to press the second button
themselves.

It is NOT redundant with §3. Stale covers "the grades changed"; this covers
**"the annotated PDFs were wrong and the grades were not"** — a real case
the grade comparison cannot see, and one that would otherwise cost one click
per student.

**Why it does NOT carry the destructive-confirm pair**
(`add-a-backend-endpoint.md` §"A pattern the archive/purge flow adds", whose
departure test this WP contributed). It destroys the record that a student
was mailed and when — real data, and the evidence for the one dispute this
feature creates ("nunca me llegó mi corrección"). Three reasons it is still
a `<details>` and a button rather than a typed name:

- Nothing a student holds is touched. The mail is in their inbox and in the
  professor's own **Sent** folder, which is the authoritative record of a
  delivery this server only ever observed second-hand — Gmail accepting a
  message was never proof it arrived (#287 §Non-goals: per-copy delivery
  confirmation is out of scope, because Gmail accepting a message is not the
  student reading it).
- The consequence needs a SECOND, separate press. Clearing sends nothing;
  the warning names how many people would receive a duplicate, and Publicar
  is where they say yes to it. The purge flow's typed name exists because
  its single press is the whole of the destruction.
- What is lost is recoverable in the direction that matters. Pressing
  Publicar re-sends and re-stamps; the cost of a mistaken clear is one
  duplicate message per student, which the warning quotes in advance.

A retention question this does NOT answer: the app keeps no history of
publications, only a last-wins pair per copy. If a future WP needs "who
received what, when, across every re-send", that is a table and not a
column, and this decision is the reason it does not exist yet.

**The per-student send is not serialised against the batch**, and that is
an accepted risk rather than an oversight (#287 review, SEC-3). It runs on
the request goroutine, outside the runner's single-goroutine ordering
(ADR-0050), so a professor pressing it while a Publicar job is mid-loop
could have both readers see the same unstamped row. The handler refuses
while a `publish` job is queued or running, which closes the window a
person can actually hit; the residual race — the job starting between that
check and the send — costs one duplicate message, and paying for it with a
lock across two goroutines and a job runner is more machinery than one
duplicate email is worth.

### 6. The skipped copies become visible, and the list shows progress

The copies table gains an "Envío" column rendering the four states, and a
skipped copy names its reason — the information `PublishResult.Skipped`
computed and threw away. Copy numbers, grades and reasons only; no name and
no address reaches those cells (`docs/security-notes.md` §"Logs and personal
data").

The controls list gains `23/25 enviadas`. It renders `State`, which stays
`graded` after a publication, so a published control was indistinguishable
from an unpublished one there. A checkmark would have answered "was this
published"; the pair answers the question a professor scanning the list
actually has — where is there still somebody pending. **The counts come from
ONE aggregate query for the whole page**, in the shape of
`coursestore.EnrollmentCounts`: a per-row count is the N+1 #271's review
already removed once from the course list.

What that one query can see — a matched student and an annotated record — is
a SUBSET of what §2 tests, so the denominator can only be too big and never
too small. That is the right direction to be wrong in: the list's job is to
send the professor to a control worth opening, and the copies table is where
the answer is exact.

## Alternatives considered

**A `published_copy` side table instead of two columns on `reading`.** It
would carry history — every send of every copy, not just the last — and it
would need its own cascade, its own index and its own join on every read of
a reading. Rejected because nothing asks the question history answers: the
professor wants to know what this student is holding NOW, and a
last-wins pair answers that in the row that is already loaded. History is
recoverable from the Gmail Sent folder, which is the professor's own.

**Keeping `published_sent` as a cache of the derived count.** Rejected on
#251's rule: the reason it existed was that nothing else could answer the
question, and something else can now. A stored copy of a derivable number is
a second place for it to disagree, and this one had already disagreed twice
in the shapes §1 lists.

**Making the per-student send asynchronous, like the batch.** It would have
been consistent with `publish` being a `jobs.Kind`, and wrong for the reason
ADR-0050 gives: async is for work nobody can wait on. A professor who has
just corrected somebody's copy and pressed "enviar" wants to know it went,
and a banner three seconds later that they have to refresh for is a worse
answer than a redirect.

**Automatically re-sending a copy whose annotated PDF changed.** This is the
`generated_at` comparison of §3, and it is rejected there: `Reanalyze`
re-annotates the whole class, so the rule would fire on every global re-read
and mail everybody a correction identical to the one they have.

## Consequences

### The stamp-before-send rule is gone, and its reasoning is not

`apps/server/CLAUDE.md`'s three bullets on publication are rewritten rather
than deleted. A future agent reading "stamp each copy after its send" needs
to know that the opposite rule was correct for a reason, and what changed —
otherwise the next person to reason about crash-safety re-derives the #273
trade-off and re-introduces it.

### A crash now costs nothing, and a failure costs one press

A run that dies leaves every sent copy on record. A copy whose send the
provider refused is left unstamped, so the next Publicar picks it up — which
also means the retry ADR-0050 deliberately does not automate is now one
button rather than a manual chase.

### The list's denominator is approximate, on purpose

See §6. A control can read `23/25` while the copies table shows the two
remaining as unsendable. The alternative was five joins and a Go-level grade
computation per row, or a per-row query — and the exact answer is one click
away.

### The synchronous send has its own deadline, below the write timeout

`copyPublishDeadline` is 25 s against `httpserver`'s 30 s `WriteTimeout`,
because `http.Server`'s write deadline neither aborts a handler nor cancels
`r.Context()` (`add-a-backend-endpoint.md` §"A pattern the Canvas import
adds"). The transports underneath are bounded — 60 s on the Gmail client,
10 s on the token refresh — so without it the worst case was ~70 s of work
writing into a socket abandoned at 30, with the copy stamped and the
professor told nothing: they press again and the student gets two identical
messages.

The cost of a number below the transport's: on a slow uplink the
per-student send can give up where the batch job would have succeeded. That
is the right trade, because the copy is left unstamped and the next press —
or the next Publicar — picks it up, while the other way round loses the
professor's answer entirely.

### What no test can see

The same boundary as #273: nothing here reaches Gmail. The resume case IS
verifiable in the suite (a dispatcher that fails mid-loop, and readings
stamped as a crashed run would have left them); what is not is whether a
real interrupted run leaves the mailbox in the state the columns claim.
That is `GMAIL-CHECK.md` §5c (the resume) and §5d (the per-student send),
and this ADR's decision is not verified while a human has not run them —
which is what its Status says.

### A live defect found on the way, and fixed here

Writing the resume cases surfaced a bug in #273's own message builder:
`Service.Publish` composed `FormatGrade(NumericGrade(…))`, and the two do
not compose. `NumericGrade` already returns the 1,0–7,0 grade; `FormatGrade`
maps a RAW TOTAL onto that scale. The second therefore re-scaled the true
grade as though it were a raw score out of the control's question count,
and **the direction of the error depends on how many questions the control
has**:

| Questions | true grade → grade emailed |
|---|---|
| 2 | 2,0 → **7,0** · 4,0 → **7,0** |
| 4 | 3,0 → **5,5** · 4,0 → **7,0** |
| 6 | 3,0 → **4,0** · 5,0 → **6,0** |
| 8 | 5,0 → **4,8** · 7,0 → **6,2** |
| 10 | 5,0 → **4,0** · 7,0 → **5,2** |
| 12 | 6,0 → **4,0** · 7,0 → **4,5** |

On a SHORT control the emailed grade is too high and saturates at 7,0 once
the true grade reaches the question count; on a LONG one it is too low, and
a student who passed can read a 4,0. Exactly one grade per control lands
right by accident — `g = Q/(Q−6)`, so 4,0 on an eight-question control —
and on a control of six questions or fewer, none does.

A copy with 1 of 2 correct read 4,0 in the readings table and was EMAILED
7,0. That is the case this WP measured first, and stating only it is how
two earlier versions of this paragraph went wrong: the first said "~28%",
a figure no control can produce, and the second described only the
saturating half. Both were corrected in the WP's own review (DAC-7), which
is the second reason the pin is `TestTheGradeAMessageCarriesIsTheOneThe
ReadingsTableShows` — it compares the two surfaces rather than either
against a number somebody wrote down. **That shipped in #273 and
went out to a real class on 2026-09-08.**

`controls.GradeFor` is now the one function both the table and the message
go through, which is what the comment above `rawTotal` already claimed. The
fix is recorded here rather than in its own ADR because it is not a
decision — it is the correction of one, and the decision it corrects
(ADR-0031's single-source rule, restated by #251) was already right.
