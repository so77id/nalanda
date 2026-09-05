# ADR-0070: the roster comes from Canvas, over GraphQL, on the professor's own token

**Status:** Accepted
**Date:** 2026-09-05

## Context

Epic #270 closes the loop from a corrected control to a student's inbox. It
cannot start without identity: the controls subsystem reads a RUT off a
sheet and has no idea whose it is — no name, no address, no class list.

The roster already exists, in Canvas, maintained by the university. So the
question was never "where do we get the data"; it was how to reach it, and
with what authority.

This ADR exists because the answer was taken and never written down. #271
shipped a Canvas GraphQL client, a domain port, a sealed per-professor
credential, two configuration variables and a human-run check procedure —
and the two ADRs it filed decide how the credential is STORED (ADR-0068) and
what the FIELDS mean (ADR-0069). Neither decides that Canvas is the source,
that GraphQL is the surface, or that a personal token is the auth mode. The
only trace was a parenthetical in a design narrative pointing at an off-repo
Discussion (#163) — which is not one of the homes `documentation.md` names.
Found by the review pipeline's ADR hunter (#271 Round B, ADR-1).

## Decision

### 1. Canvas is the system of record; Nalanda's roster is a pull-only cache

`course`, `student` and `enrollment` are populated from Canvas and edited
nowhere else. There is no route that creates a student, renames one, or
changes an enrolment by hand.

This is what makes the absence of a delete path a **design property rather
than an omission**: the roster is a projection, and the way to change it is
to change Canvas and re-import. (It does not make the absence harmless —
`docs/security-notes.md` §"The roster is personal data" records what is
still owed, and to which WP.)

### 2. GraphQL, not REST

Both surfaces are available on Canvas and both could have answered.
GraphQL was chosen for one query shape: `enrollmentsConnection` returns the
enrolment AND its user in one round trip, where REST needs a call per page
of enrolments plus a join on the client.

Two consequences, both already visible in the code:

- **Ids arrive Relay-shaped.** Canvas's GraphQL hands out opaque global ids
  alongside the numeric `_id`; migration 00014 stores `canvas_course_id`
  and `canvas_user_id` as TEXT for exactly that reason, so the client can
  change which one it reads without a migration.
- **Filtering is ours.** REST offers a server-side `enrollment_state`
  filter; GraphQL does not, so `enrolledStates` in
  `internal/infra/canvas/canvas.go` does it in Go. ADR-0069 §Decision 4
  records what that filter must admit and what it cost to get wrong.

### 3. A personal access token the professor generates, not an institutional integration

The alternative was a Canvas Developer Key (OAuth) or an LTI placement,
which is what an institution normally issues. Epic #270 §Constraints says
**zero dependencies on UDP IT**, and that is the whole reason: a Developer
Key needs a ticket, an approval and a relationship with a department that
does not know this project exists, and the epic would not have started.

The price is real and is accepted here rather than discovered later:

- **Every read runs with the professor's full Canvas permissions.** There is
  no scoping. A bug in this server that spent the token wrongly would spend
  it as them, on everything they can reach — which is why ADR-0068 seals it
  and why nothing may log it.
- **Revocation and expiry are silent.** Canvas gives no callback; the token
  simply starts failing, and the professor self-services a new one. That is
  what `ErrTokenRejected` and the profile page's replace form are for.
- **Canvas availability gates an import.** Not a grading operation — the
  controls flow is untouched — but the roster screens degrade when Canvas
  is down, and they say so rather than failing.
- **It is one professor's token doing everyone's reading.** With no
  isolation between professors today (`README.md` §"What is not here yet"),
  the person who pastes the token is the authority every import runs under.

### 4. Pull on demand, not a scheduled sync

The professor presses a button. No cron, no webhook, no background
reconciliation.

A roster changes a handful of times a semester and always for a reason the
professor knows about; a scheduled sync would spend the token continuously,
turn a Canvas outage into a recurring alert, and — with the withdraw
semantics of ADR-0069 §Decision 4 — let an unattended bad answer retire a
class at three in the morning. On demand keeps a human in front of every
change to the roster.

## Alternatives considered

- **A CSV the professor exports from Canvas and uploads.** Rejected: it
  works, and it makes the professor the integration. Every re-import is
  manual work at exactly the moment the semester is busiest, and a stale CSV
  is indistinguishable from a current one.
- **A Canvas Developer Key / OAuth.** Rejected for #270's constraint, not on
  the merits — it is strictly better security (scoped, revocable centrally,
  no personal credential at rest) and remains the upgrade path. If UDP IT
  ever approves one, only the acquisition changes: the storage (ADR-0068),
  the port and the client all stay.
- **LTI.** Rejected: it solves launching Nalanda from Canvas, which is not
  the problem, and brings a specification's worth of surface to read a list.
- **Scraping the Canvas UI.** Rejected without much thought, and recorded so
  nobody proposes it: it breaks on a redesign and carries the same
  credential risk with none of the contract.
- **Asking the registrar for a roster feed.** Same objection as the
  Developer Key, one department further away.

## Consequences

**Positive**

- The epic could start, which was the constraint that decided it.
- One query shape gets a course's whole roster; the client is ~300 lines and
  `go.mod` is untouched.
- The upgrade to OAuth is an acquisition change, not a rewrite.

**Negative**

- A full-permission personal credential lives at rest on the Jetson
  (ADR-0068 records its protection and its residual).
- Nalanda's roster is only as fresh as the last button press, and nothing
  tells the professor it is stale.
- The integration is coupled to Canvas's GraphQL schema, which no test in
  this repository reaches — `apps/server/CANVAS-CHECK.md` is the whole
  defence, and it is a human running commands.
- **What broke once already:** the enrolment-state contract. ADR-0069's
  first version was measured on ONE course and got the accepted state set
  wrong, in a way that would have withdrawn an entire past-term class. A
  third-party schema learned from a single sample is the standing risk of
  this decision.

## Review triggers

- UDP IT approves a Developer Key, or disables personal access tokens.
- A second institution, or a second Canvas instance.
- Canvas deprecates a GraphQL field this client reads — `sisId` above all.
- The first professor who is not the one who pasted the token.

## References

- Epic #270, issue #271. Discussion #163 is the historical source and is
  superseded by this ADR as a home.
- ADR-0068 — how the token is stored. ADR-0069 — what the fields mean.
- ADR-0030 (`Auto-Multiple-Choice` as the control engine) and ADR-0035 (a
  third-party frame as a content source) are the two prior third-party
  decisions this one sits beside.
- `docs/security-notes.md` §"The roster is personal data, unencrypted, and
  leaves the host nightly".
