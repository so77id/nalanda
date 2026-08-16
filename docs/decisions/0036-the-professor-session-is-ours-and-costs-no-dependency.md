# ADR-0036: The professor session is ours, server-side, and costs no dependency

**Status:** Accepted
**Date:** 2026-08-16
**Decision-makers:** Miguel Rodriguez
**Source:** #150 (WP-C2), ADR-0009, design `docs/design/2026-08-controles.md` §C12, §C13

## Context

ADR-0009 decided that a professor user system ships with the backend: Google
OAuth, a user table, a first professor who arrives without a screen, and a CRUD
for friends-and-family accounts. ADR-0034 built the app that would hold it and
drew the layers. §C13 decided the domain would be **ported from DocumentBuddy
rather than rewritten**, on the grounds that roughly 1 900 tested lines of
exactly this problem already run in production on the same stack.

What the port could not decide in advance was how much of the source's design
survives contact with this repository's rules. Two measurements taken before
starting shaped everything else:

1. **DocumentBuddy's Google provider is standard library only.** It fetches the
   published JWKS and verifies RS256 by hand — no `golang.org/x/oauth2`, no
   `coreos/go-oidc`. Its whole `domain/auth` tree imports zero third-party
   packages.
2. **Its layout violates the dependency rule this repo enforces.**
   `domain/auth/sqlite_store.go` imports `infra/storage`, and the domain imports
   `infra/clock` — two of the three edges `internal/architecture_test.go` fails
   on. DocumentBuddy's own ADR-005 records the same debt at scale: the rule
   violated in 13 files, 18 SQLite stores in `domain/`, 308 lines of OIDC inside
   the domain.

And one thing ADR-0009 said that could not be done as written: *"Miguel's user
arrives via seeds."* A seed migration cannot know a Google `subject`, which does
not exist until the first login, and it would freeze a personal email address in
permanent schema history.

## Decision

**Sessions are ours: opaque, server-side, and stored as a hash.** The cookie
carries 32 bytes of randomness, hex-encoded; `user_sessions` holds its SHA-256
and never the token. Expiry is the row's, so a restart logs nobody out and
revoking a session is a `DELETE` rather than a wait. No JWT, no signed cookie:
this server has one instance (§C15), a database it already talks to, and no
reason to trade revocability for statelessness.

**CSRF is a per-session token, verified in constant time on every
state-changing request.** It is stored beside the session, so verification needs
no second store and no server-side state of its own.

**The OIDC client is ours, and stays in `internal/infra/oidc`.** The port keeps
DocumentBuddy's stdlib verifier — signature against the published JWKS, then
`aud`, issuer, `exp`, `email_verified` — and each of those checks has a test that
fails when that check alone is removed. **The consequence is the headline: the
entire professor auth system adds no dependency.** `go.mod`'s direct block is
still exactly `modernc.org/sqlite` and `github.com/pressly/goose/v3`.

**The layout is corrected on entry**, as ADR-0034 said it would be. The domain
declares `UserStore`, `IdentityStore`, `SessionStore` and `OAuthProvider`;
`internal/infra/storage/authstore` implements the first three and
`internal/infra/oidc` the fourth. There is no clock package: time enters as a
parameter, or as a `func() time.Time` handed down from `cmd/server`.

**The login resolver lives in the domain, not in the handler.** DocumentBuddy
puts that orchestration in its HTTP layer; here that would leave the domain
declaring four interfaces it never calls, and `backend-code-style.md` declares an
interface where it is *consumed*.

**There are exactly three ways in**, and the middle one replaces a subsystem the
port deliberately left behind:

1. The Google identity is already linked — the ordinary login.
2. No identity, but a professor exists with that **verified** address: their
   first login, and the identity is linked on the way through.
3. No identity, no professor, **no professors at all**, and the address matches
   `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL`: the first professor of a new server.

Everything else is refused. Path 2 is what makes WP-C3's CRUD work — that screen
knows an email and cannot know a Google subject — and it is why DocumentBuddy's
invitation flow (its ADR-011) is not ported.

**The bootstrap replaces ADR-0009's "seeds", deliberately.** It closes behind
itself: once any professor exists the configured address is inert, so a variable
left set is not a standing door.

**The two surfaces do not share an auth gate (§C12), and that is asserted rather
than promised.** All of this is mounted inside `internal/app/web` and none of it
on `internal/app/api`; `/health` stays open, because the container healthcheck is
the binary itself and carries no cookie. `cmd/server/main_test.go` proves both
directions from the composed handler.

## Alternatives considered

- **A JWT or a signed cookie instead of a session row.** Rejected: it buys
  statelessness this server has no use for — one instance, one SQLite file — and
  pays with a token that cannot be revoked before it expires. Logging a
  compromised professor out would mean rotating a signing key and logging
  everyone out.

- **An OIDC library** (`coreos/go-oidc` + `golang.org/x/oauth2`). Rejected, and
  this is the closest call in the ADR. It would be the conventional choice and it
  is well-maintained. But the code it replaces already exists, is tested, and
  runs in production; adopting it would add two direct dependencies and their
  transitive set to a binary whose entire supply chain is currently two packages,
  in exchange for code we would still have to read. The rule that made this easy
  to decide is the repo's own: a dependency is a PR discussion, and the argument
  for this one is "everybody does it".

- **A `nonce` claim in the ID token.** Not implemented. The callback is tied to
  the attempt by a single-use state nonce held server-side, which is also its
  CSRF defence. Revisit if the flow ever spans more than one instance.

- **Porting invitations and impersonation.** Rejected (#150 §Non-goals): ADR-0009
  asks for neither, and path 2 above covers what an invitation would have been
  for at this scale. An invitation flow arrives the day adding a colleague by
  hand becomes the annoying part.

- **An audit table.** Rejected for now. At friends-and-family scale the `slog`
  line for each login, refusal and logout is the record; a table arrives with the
  screen that reads it.

- **A seed migration for the first professor**, as ADR-0009 worded it. Rejected
  on two counts: it cannot know the Google subject, and it would put a personal
  address in schema history that migrations are never allowed to edit.

## Consequences

- **Auth costs no dependency**, and that property is now something to defend: the
  next person tempted to add an OIDC library is arguing against this ADR.

- **`internal/infra/oidc` is cryptographic code this project owns.** It is small
  and heavily tested, but it is ours to keep correct — the review trigger is any
  change to Google's OIDC contract, and the standing guard is the per-claim
  table in `google_test.go`.

- **The suite cannot verify the integration.** Nothing in `go test` or the pre-PR
  protocol reaches Google, so `apps/server/GOOGLE-CHECK.md` is a manual check in
  the spirit of `apps/amc-worker/PAPER-CHECK.md`: the WP does not close until a
  human has logged in with a real OAuth client at least once.

- **Five configuration variables** now exist, three of them required, and the
  four-homes rule of `apps/server/CLAUDE.md` applies to each. A required variable
  missing from the compose file or the CI probe stops the container from
  starting, and compose sits outside CI's path filters.

- **The state nonce store is in memory.** A restart mid-login costs a click. It
  is also the first thing that has to move the day there is a second instance —
  recorded in the package comment, since nothing else would say so.

- **Trusting a verified email for path 2 means trusting the provider's
  `email_verified` claim.** That is checked, and the check has its own test. If a
  second provider is ever added, this is the assumption to re-examine first.

- **`users.is_active` is read but never written** in this WP. The middleware and
  the resolver both honour it; the screen that flips it is WP-C3 (#151).

- **WP-C3 is unblocked**, and inherits a worked example rather than a blank page:
  `docs/standards/guides/add-a-backend-endpoint.md` walks the chain this WP
  built.

## References

- ADR-0009 (professor-only auth, the decision this implements) · ADR-0034 (the
  layered layout) · ADR-0007 (SQLite) · ADR-0026 (the design system the backoffice
  deliberately does not follow, §C13).
- `docs/design/2026-08-controles.md` §C12, §C13, §C15.
- DocumentBuddy ADR-005 (the layout debt corrected on entry), ADR-011 (the
  invitation and impersonation subsystems not ported).
- `apps/server/GOOGLE-CHECK.md` · `docs/standards/guides/add-a-backend-endpoint.md`.
