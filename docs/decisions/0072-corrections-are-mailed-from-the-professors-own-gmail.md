# ADR-0072: Corrections are mailed from the professor's own Gmail

**Status:** Accepted; **§5 superseded by ADR-0073**
**Date:** 2026-09-07
**Decision-makers:** Miguel Rodriguez
**Source:** #273 (WP-3 of epic #270); the refinement conversation that reversed
the Resend design before any code was written; and the WP's own review — findings
PUB-1/2/3, SCOPE-1, SEC-1/2, and the NEW-1/2/3 regressions the fixes introduced

## Context

Issue #273 is WP-3 of epic #270 and the step the epic exists for: a
professor closes a correction and every matched student receives their
annotated PDF. WP-1 (#271) brought the roster, WP-2 (#272) the
`reading → student` association, #190 the annotated PDF per copy. Nothing
distributed them.

The WP was first refined around **Resend**, a transactional mail API, with
a synchronous `POST /api/controls/{id}/publish`. All three of those — the
provider, the dispatch model and the surface — were reversed before any
code was written. This ADR records why, because the reasoning is the design
rather than a footnote to it.

### What was wrong with the first design

**The provider.** Resend, like every transactional mail API, will only send
from a domain the account has verified in DNS. The issue's own Non-goals
conceded the consequence: *"UDP does not verify udp.cl for external
senders. From is `no-reply@<nalanda-verified-domain>`; reply-to is the
professor's email so replies land in his inbox."* So the design already
knew the From would be a machine address on a domain no student recognises,
with a reply-to trick behind it, and it needed a domain and DNS records
nobody had yet.

**The dispatch model.** `httpserver.writeTimeout` is 30 s. A forty-copy
course is forty provider calls plus forty PDFs read off the shared volume
and base64-encoded. A synchronous publish can cross that, and the failure
mode is the worst one available: emails partially sent, a truncated
response, and no record of which students got theirs.

**The surface.** `internal/app/api` is anonymous by construction (§C12,
pinned in both directions by `cmd/server/main_test.go`). A publish endpoint
there is a mass-mail trigger any unauthenticated caller on the internet can
pull.

## Decision

### 1. The transport is the professor's own Gmail account

Each professor authorises this server to send **as them**, through Gmail's
API, and the messages carry their real address.

What that buys, in the order it matters:

- **No domain verification.** The problem the first design routed around
  disappears rather than being worked around.
- **The From is the professor.** Replies reach their inbox with no reply-to
  trick, and a student who recognises the sender is a student who opens the
  mail.
- **A copy in their Sent folder.** The professor has their own record of
  what went out, in a place they already look.
- **Per-professor by construction.** The first design listed
  "per-professor Resend API key" as future work; here it is the only shape
  available.
- **No account, no cost, no third party.** The OAuth client already exists
  for the login.

The only GMAIL permission is `https://www.googleapis.com/auth/gmail.send`;
the flow also asks for `openid email` so the exchange names WHICH account
was connected. Nothing wider. It permits sending and nothing else — it cannot read a message, list
a thread, or change a setting.

**Verified 2026-09-07, and this is the fact the decision turns on:**
`gmail.send` is a **sensitive** scope, not a **restricted** one.
Sensitive-scope verification is app review only (3–5 business days: privacy
policy on the homepage's domain, public homepage, unlisted demo video,
scope justification, domain-ownership check). The **CASA third-party
security assessment — thousands of USD, repeated annually — applies to
restricted scopes and does not apply here.** Had it applied, this option
would have been rejected.

### 2. It is a SECOND authorization, never the login's scopes

The login (ADR-0009, ADR-0036) keeps asking Google for
`openid email profile` and nothing more. The Gmail grant is opt-in, from
`/profile`, with its own consent screen, its own nonce store and its own
double-submit state cookie.

Widening the login was considered and rejected: every professor would meet
a "send email on your behalf" consent screen merely to enter, and this
server would hold a mail-sending credential for people who never asked to
send mail.

The two flows cannot complete each other. Separate cookie names
(`handler.GmailStateCookieName` vs `handler.StateCookieName`) and separate
`oauthstate.Store` instances are what enforce it; both directions are
pinned. Sharing either half would let a nonce issued for one grant be spent
on the other, and the two grants carry different scopes.

One difference from the login callback is worth stating: the Gmail callback
is **gated**. The login callback is how a session begins and cannot require
one; this one attaches a credential to a session that already exists, and
identifies the professor from it rather than from the token it is about to
receive.

### 3. The credential's two halves are stored apart

- The **refresh token** is sealed in `user_secrets` (ADR-0068), beside the
  Canvas token, and never leaves `secret.Store` as plaintext.
- The **connected address** sits in the clear on `users.gmail_address`. It
  is what the profile page prints and what every message's From is built
  from; sealing it would mean decrypting on every render to display a
  string the professor is looking at, and would put a non-secret inside the
  master key's blast radius.
- **Access tokens are never stored.** They live about an hour; a stored one
  would be stale more often than not.

The address is the **authoritative** "is this professor connected" signal,
and `gmail.Service.Complete` writes it LAST for exactly that reason — the
observable signal is never true over a credential that was never stored.

### 4. Four dispatch modes, selected once at boot

`NALANDA_EMAIL_MODE` ∈ `real | staging | dryrun | stub`, read at boot,
logged in one line. The "select don't describe" shape of DocumentBuddy's
ADR-021: nothing downstream branches on the mode, so no caller can be in
one mode while its neighbour is in another.

| mode | network | recipient |
|---|---|---|
| `real` | yes | the per-publication choice the professor made |
| `staging` | yes | always the professor's own `users.email` |
| `dryrun` | refreshes the credential, withholds the send | none |
| `stub` | none | none |

**The default is `stub`.** It is the only optional variable in `config`
whose default is not what production wants, and the asymmetry is the point:
the two mistakes do not cost the same. An operator who deploys without
choosing and gets `stub` is told so; one who got `real` finds out when a
class receives mail that cannot be recalled. You opt IN to sending.

That defence was originally written as "finds out when a publication sends
nothing", and the review falsified it (#273, PUB-2): the publication ran,
counted every suppressed message as a success, stamped the control and
showed a green banner. It is true now because §5 refuses a publication
outright under a transport that does not deliver — the default is safe
because the gate makes it loud, not because it was ever self-announcing.

`dryrun` holds `Credentials` rather than wrapping a transport. There is
nothing meaningful left to suppress a send *after*: the interesting half of
a real send is the credential, and a rehearsal that skipped it would report
success for a professor whose authorisation was revoked last week.

`staging` refuses rather than falling through to the student when it has no
address to redirect to. Falling through would deliver to the student in the
mode selected to make that impossible, on the run where somebody was being
careful.

### 4b. The consent's GRANTED scope is checked, not just requested

Google presents `gmail.send` as a granular checkbox beside the identity
scopes, and a professor can approve the consent screen with it unticked.
The response still carries a refresh token and an ID token, so without an
explicit check the connection completes, `/profile` reports the account as
connected, and the failure surfaces only at the first publication — as a
Gmail 403 that the transport reads as a message refusal and words as "puede
ser la cuota diaria", pointing at a quota that is not the problem.

So `Exchange` reads the `scope` the response actually granted and refuses
with `ErrScopeNotGranted` when the send permission is not in it. It is the
fourth parameter of that flow which fails silently when wrong, beside
`access_type`, `prompt` and the scopes requested — and it was missed in the
first implementation (#273 review, SCOPE-1).

### 5. Publication is async, one-way, and stamped before it sends

> **SUPERSEDED BY [ADR-0073](0073-publication-is-recorded-per-copy-and-is-resumable.md)
> (2026-09-08, issue #287).** Two of the three claims in this heading are no
> longer true: publication is **resumable** rather than one-way, and each
> COPY is stamped **after its own send** rather than the control before the
> loop. It is still async.
>
> The reasoning below is not wrong; it is conditional on something that
> changed. Everything in this section follows from there being no per-copy
> record, which made a crash halfway through a batch a choice between losing
> the un-sent half and mailing half a class twice. Migration 00019 gives
> each copy its own `published_at` and `published_grade`, and the choice
> disappears. Read it for WHY the rule existed; read ADR-0073 for what
> replaced it.
>
> `control.published_sent`, described at the end of this section, is dropped
> by migration 00020: the count is the stamped readings.
>
> §§1–4b and 6 of this ADR stand unchanged.

It is a fifth `jobs.Kind` (ADR-0050, amended), for the timeout reason
above. One Kind covers both a real publication and an "envío de prueba":
they differ only in the recipient and in whether state moved, and a second
Kind would duplicate the loop.

**The control is stamped published BEFORE the sending loop.** An unstamped
control with twenty students already emailed is a control the professor
publishes again, and the twenty receive a second copy of a grade. Stamping
first makes a crash cost the un-sent half, which the failure list names.

Publication is one-way: a second publish answers 409. There is no automatic
republish and no bulk unpublish.

**But it is not a dead end, and the first implementation made it one
(#273 review, PUB-1/2/3).** The stamp fired whether or not anybody received
anything, so three situations left a class permanently unreachable through
the app: every send failing (a refresh token Google revoked after seven
days is the case §Consequences names), a transport that delivers nothing,
and a `staging` run used as a rehearsal. Two changes:

- **A publication is REFUSED under a transport that does not deliver.**
  `Dispatcher` answers `Delivers()`, and the domain will not stamp what
  cannot be sent. This is what makes the `publication_mode` CHECK's own
  comment true. It was the critical one, because `stub` is the default and
  `DEPLOY-JETSON.md` did not list the variable — so the documented deploy
  path produced a green banner over an empty mailbox.
- **An UNPUBLISH the professor can reach**, which is what covers all three
  shapes. "Do not stamp when nothing was sent" was the tempting single rule
  and it fixes only the first: under `stub` and `staging` every send
  succeeds. The stamp-first ordering is untouched — a compensating clear
  placed after the loop simply never runs on the crash it defends against —
  and the one judgement a machine cannot make goes to the professor:
  whether the people who ALREADY have their correction may receive it
  twice.

`control.published_sent` (migration 00018) is what lets that confirmation
tell the truth. It is nullable, and NULL is not zero: telling somebody
nobody received a correction that forty people are holding is the mistake
the column exists to prevent.

`published_at` is a timestamp and NOT a fourth `control.state` value.
`state` is a position in the *correction* lifecycle, and every reader of it
— the close gate, the stats panel, the review page — means the correction
rather than the distribution.

### 6. No new dependency

Gmail's send is one authenticated POST of a MIME blob; `net/http`,
`mime/multipart` and `encoding/base64` cover it. The same judgement, for
the same reason, as ADR-0036 (own OIDC, no library) and #271's hand-written
Canvas client. `go.mod`'s direct block stays at `modernc.org/sqlite` and
`pressly/goose`.

The **media** upload endpoint is used rather than the metadata one: the
latter takes the whole message base64url'd inside a JSON `raw` field and
caps the request at 5 MB, and base64 inflates by a third — a 3.8 MB
annotated PDF becomes a 5.1 MB request refused with a message about the
request rather than the attachment. The media endpoint takes the RFC 5322
message as the body, reaches 35 MB (same source, same date), and skips a base64 pass over the
whole envelope.

## Alternatives considered

**Resend (or any transactional API).** Rejected for the domain-verification
problem above, which the first design had already conceded and worked
around with a `no-reply@` From plus reply-to.

**Gmail SMTP with an App Password.** Dramatically less code — `net/smtp`,
a 16-character credential pasted into `/profile` exactly like the Canvas
token, no OAuth, no verification, no seven-day question. Rejected because
Google has ANNOUNCED the retirement of App Passwords during 2026
(announcement consulted 2026-09-07), so it is building on an
announced end date; and because an app password is a long-lived credential
with no scope, where `gmail.send` is scoped to sending.

**Widening the login's scopes.** Rejected — see §2.

**Synchronous dispatch.** Rejected — see §Context.

**A `/api/` route.** Rejected — see §Context.

**A second `jobs.Kind` for the rehearsal.** Rejected: it would duplicate
the loop, which is the part worth having one of.

## Consequences

### The seven-day question is unresolved, and the design does not bet on it

Google revokes refresh tokens issued while the OAuth app's publishing
status is **Testing** after 7 days. Google's own documentation says the
clock does not apply once the app is **In production**; a third-party
source claims it follows "unverified" regardless of publishing status.
**The two disagree and documentation did not settle it** (both consulted
2026-09-07).

> **Measurement to fill in (owner: Miguel Rodriguez, deadline: eight days
> after the first real connection, tracked in the issue GMAIL-CHECK §6
> opens):** does a refresh token issued at publishing status
> `<Testing | In production>` still send on day eight, and under which
> status? `apps/server/GMAIL-CHECK.md` §6 is the procedure; the answer
> replaces this paragraph's uncertainty with a number.
>
> Written as a block rather than as prose because documentation.md requires
> it: "without the block, 'measure later' degrades into no measurement at
> all, and the decision stays hypothesis-shaped forever." This ADR shipped
> the prose version first.

The WP therefore degrades honestly rather than assuming either reading. A
refresh that comes back `invalid_grant` is neither a 500 nor a silent
no-op: it clears the stored credential, marks the professor disconnected,
and the pages say *"vuelve a conectar Gmail"*. Whichever reading is true is
answered empirically by use, at the cost of one button press.

The asymmetry that makes this safe: **only `invalid_grant` clears a
credential.** A 5xx, a transport failure, a 400 that is not
`invalid_grant`, and a secret that will not unseal all leave it alone.
Clearing on any of those would make a professor reconnect every time Google
hiccups, and it is unrecoverable in the direction that matters — the server
cannot re-consent on their behalf. A Gmail **403** is likewise not a
rejection, although it covers "insufficient permission" as well as "daily
limit exceeded": Google spells both 403 and separates them only inside an
error `reason` whose vocabulary is not contractual, and between deleting a
working credential over a quota and leaving a broken one for the professor
to reconnect by hand, the second is the recoverable mistake.

### Operational obligations on the deployment

- The OAuth client's consent screen must declare `gmail.send`, and the new
  callback's redirect URI must be registered. Both are Google Cloud Console
  actions; without them the button answers `redirect_uri_mismatch`.
- Sending needs `NALANDA_SECRETS_MASTER_KEY` set, since the refresh token
  is sealed. Without it the profile page says so and the server still boots
  — the same state, and the same handling, as the Canvas integration
  (ADR-0068 §Decision 3).
- A personal Gmail account sends to roughly 500 recipients a day (Google
  Workspace sending-limits documentation, consulted 2026-09-07). A class
  of forty is not close; several courses in one day are not either.

### The header sink is at the encoder, not at the source

`buildMIME` refuses any address carrying a control character and serialises
through `mail.Address`. Both halves matter and both were missing: a CR/LF in
a `To` injected a `Bcc:` that Gmail's `message/rfc822` upload honours —
sending a student's grade and corrected PDF out of the professor's own
mailbox — and `net/mail.ParseAddress` un-quotes `"a@evil.com,b"@x.com`, so
writing a parsed address raw put two recipients in a header somebody typed
one into (#273 review, SEC-1, SEC-2; the attack was executed).

The refusal lives at the ENCODER rather than at the roster, deliberately.
`student.email` reaches the header verbatim from Canvas's GraphQL with no
validation in any layer between, and every future source of an address —
another LMS, a CSV, a form — would need its own guard. One sink needs one.

### What no test can see

Nothing in `go test`, in either protocol, or in CI reaches Google. The
suite drives an `httptest` provider the way `oidctest.Provider` drives the
login, and an `httptest` stand-in for Gmail's send endpoint. What it cannot
see: whether the real consent screen grants the scope, whether the redirect
URI matches, whether a real refresh token survives a week, and whether a
message this server considers well-formed arrives readable in a real inbox.

The procedure is [`apps/server/GMAIL-CHECK.md`](../../apps/server/GMAIL-CHECK.md)
and it is **required whenever the publication path changes**. Same rule,
and the same reason, as `GOOGLE-CHECK.md`, `CANVAS-CHECK.md` and
`PAPER-CHECK.md`.

### Deferred

- Retry / dead-letter for failed sends. v1 records them on the job row and
  the banner shows them; a future WP retries.
- Per-student resend, and correction of a publication.
- HTML email. v1 is plaintext.
- Sensitive-scope verification, if the seven-day clock turns out to bite.
