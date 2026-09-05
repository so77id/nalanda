# ADR-0068: `user_secrets` are sealed with AES-256-GCM, bound to their triple

**Status:** Accepted
**Date:** 2026-09-04

## Context

Issue #271 (WP-1 of epic #270) needs the professor's **Canvas API token** on
the server: the roster import authenticates to Canvas as the professor, with
a token they generate in Canvas → Account → Settings → New Access Token.

That token is a credential, not a setting. Whoever holds it can read and
write anything the professor can in Canvas — every course they teach, every
grade, every student's record. Storing it as plaintext in the SQLite file
means storing it in every off-host backup as well, and `apps/server`'s
database is copied off the Jetson by the `backup` sidecar on a schedule
(ADR-0038).

The same problem was solved once already, in the sibling project
DocumentBuddy, whose bot stores per-user portal credentials. Its **ADR-012**
("`user_secrets` encryption: AES-256-GCM with AAD binding", 2026-04-30)
records the decision, and its `src/bot/internal/domain/secret/` holds ~150
lines of working, tested Go. Rewriting that from scratch here would be
inventing a second answer to a question already answered by someone with the
same threat model and the same constraints (pure Go, no CGO, SQLite).

The remaining question was not *which primitive* but *what to change on the
way in*, and what an operator has to do before the code lands.

## Decision

**Transplant DocumentBuddy's `secret` package**, with three deliberate
changes.

### 1. The primitive and the layout are carried over unchanged

- **AES-256-GCM**, Go standard library (`crypto/aes` + `crypto/cipher`).
- **On-disk layout:** `nonce(12) || ciphertext || gcm_tag(16)`, one BLOB per
  row.
- **Nonce:** 12 bytes from `crypto/rand`, fresh per `Seal`.
- **AAD** = `"user_id\x00namespace\x00key"`, binding every ciphertext to the
  triple it is stored under. This is the property worth the most: a row
  copied into another professor's `(user_id, namespace, key)` fails
  authentication instead of handing that professor someone else's Canvas
  token. The NUL separators are what make the encoding unambiguous —
  a plain concatenation gives `(7, "ca", "nvas")` and `(7, "canv", "as")`
  the same AAD.
- **Master key** from the environment, 32 bytes.

The layout is **locked**: changing it invalidates every ciphertext already
written, and nothing in this repository would notice before a professor's
token stopped decrypting.
`TestTheSealedBlobCarriesItsNonceAndTagAroundTheCiphertext` and
`TestAADSeparatesItsThreeFieldsUnambiguously` are what pin it.

### 2. The SQLite adapter moves out of the domain

DocumentBuddy keeps `sqlite_store.go` inside `internal/domain/secret/`,
beside `crypto.go`. Here it does not: `internal/domain/secret/` holds
`crypto.go` (pure) and `store.go` (the `Store` interface, declared where it
is consumed), and the implementation lives in
`internal/infra/storage/secretstore/` beside `authstore`, `controlstore` and
`jobstore`.

This is the repository's dependency rule (`backend-code-style.md` §The
dependency rule), and correcting on entry rather than importing the debt is
the posture #149 already took toward DocumentBuddy's ADR-005. The method set
also grows a `context.Context` first parameter on all three methods, per
§Database ("every query takes a `context.Context`").

### 3. The master key is OPTIONAL, and strictly validated when present

`NALANDA_SECRETS_MASTER_KEY` is base64 of exactly 32 bytes
(`openssl rand -base64 32`). Its posture is asymmetric:

| Value | Behaviour |
|---|---|
| absent, or empty | The server **boots**. `Config.SecretsConfigured()` is false and the Canvas integration renders "no configurada". Nothing can be sealed or opened |
| present, decodes to 32 bytes | Normal operation |
| present, not base64, or not 32 bytes | **Boot fails**, naming the variable and never echoing the value |

Issue #271's acceptance criterion originally asked for a boot panic on an
absent key. It was changed after looking at what a merge does: the CD
workflow rebuilds the image and Watchtower restarts the container on the
Jetson within five minutes (ADR-0038). A **required** new variable therefore
takes production down for the window between the merge and the moment the
operator edits the host's `.env` — a window nobody can stand in front of,
and which no test in this repository can see. A key that is present and
malformed keeps the hard failure, because a typo silently read as "not
configured" is a deployment that stores nothing while looking healthy.

The variable lives in all four homes
(`TestEveryVariableReachesAllFourHomes`).

## Alternatives considered

- **Plaintext in the column.** Rejected: it is the thing this ADR exists to
  prevent, and the backup sidecar copies the file off the host.
- **Write our own scheme rather than transplant.** Rejected. The threat
  model, the language, the storage engine and the no-CGO constraint are
  identical to DocumentBuddy's, and a second independent answer to a solved
  cryptographic question is how a subtle mistake gets introduced.
- **Encrypt without AAD.** Rejected: it costs one `fmt.Appendf` and closes
  row-substitution, which in a multi-professor backoffice is the realistic
  attack on a file an attacker can already write to.
- **SQLCipher / transparent database encryption.** Rejected for the reason
  DocumentBuddy rejected it: `modernc.org/sqlite` does not support it
  without CGO, and `CGO_ENABLED=0` is what puts this binary on `scratch`
  (ADR-0007, ADR-0034).
- **A KMS or an external secret manager.** Rejected: one professor, one
  host, and epic #270 §Constraints says zero dependencies on UDP IT.
- **Deriving the key from an existing secret** (the OAuth client secret, say).
  Rejected: it couples the rotation of one credential to the readability of
  another, and rotating the OAuth client would make every stored token
  unopenable with no message saying why.
- **Requiring the master key at boot** (what AC-4 asked for). Rejected for
  the deployment reason in §Decision 3; the strict validation of a *present*
  key keeps the half of the guarantee that catches mistakes.

## Consequences

**Positive**

- A stolen database file — including an off-host backup — yields no usable
  Canvas token without the key, which lives only in the host's `.env` and
  the professor's password manager.
- AAD binding makes row substitution fail closed, verified end-to-end
  against the real schema in
  `TestARowMovedToAnotherTripleNoLongerDecrypts`.
- ~150 lines with no new dependency; `go.mod` is untouched.
- The table is generic (`namespace`, `key`), so epic #270's WP-3 (Resend)
  stores its API key here without a migration.

**Negative**

- **Physical access to the Jetson means access to the key.** Inherited from
  DocumentBuddy's ADR-012 §Consequences and accepted for the same reason.
- **Key rotation is manual and undocumented.** Rotating requires re-pasting
  every stored token. Declared debt, same posture as DocumentBuddy; a
  runbook is future work, not part of #271.

  The mitigation is at least REACHABLE, which it was not in the first
  revision of this WP: a ciphertext that no longer decrypts used to make
  `/profile` a 500, and `/profile` is the only page carrying the
  "Reemplazar" form and the "Eliminar el token" button — so the fix this
  bullet prescribes could not be applied through the interface at all
  (#271 review, SEC-1). The page now renders with both forms and says the
  stored token cannot be read.
  `TestAStoredTokenThatNoLongerDecryptsLeavesBothWaysOutOnScreen` and
  `TestPastingANewTokenRecoversFromARotatedKey` are what keep it that way.
- **Losing the key loses every stored secret**, silently until a professor
  next uses the integration. Mitigated only by the "keep it in your password
  manager" instruction in `.env.example` and the README.
- **The rest of the roster is not encrypted, and it leaves the host.**
  Student names, RUTs and email addresses land in `student` in the clear.
  That much is deliberate: they are the working data of every query WP-2 and
  WP-3 run, and encrypting a join key would end the feature. It is the same
  gap DocumentBuddy's ADR-012 records for its own PII.

  What the first version of this bullet left out is the consequence
  §Context spends itself establishing about the token (#271 review, SEC-4).
  **The same nightly backup reaches the roster.**
  `infra/deploy/jetson/backup.sh` runs `sqlite3 .backup` over the whole
  database and `aws s3 cp`s it off-host at 03:00, so from this WP onward
  Nalanda collects Chilean **national identifiers** for every student of
  every imported course — 25 on the first real import — and ships them to a
  third-party cloud every night. Framing that as "in `student`" rather than
  "in every off-host backup" was exactly the framing this ADR refused one
  bullet earlier for the token.

  Three things are true about it, and a reader deserves all three:

  1. **It is covered at the backup layer**, which the first version failed
     to cross-reference: `infra/deploy/jetson/provision-jetson-iam.sh` sets
     SSE-S3 encryption at rest, blocks public access in all four dimensions
     and grants least-privilege IAM;
     `infra/deploy/jetson/nalanda-jetson-bucket-lifecycle.json` expires
     everything under `backups/` after 30 days.
  2. **It is NOT covered at the application layer.** There is no route, and
     no store method, that deletes a course, a student or an enrolment —
     `withdrawn` is a state, not a deletion (ADR-0069 §Decision 4 explains
     why the enrolment must survive). A student who asks to be removed
     cannot be, today.
  3. **The deletion path is owed by a named WP.** Epic #270's WP-3 is the
     one that starts emailing these people, and it is the natural place for
     "remove a student" to arrive with it. Until then this paragraph is the
     honest statement of where the data is and what does and does not
     protect it.
- **An operator can run a deploy that silently cannot store secrets**, which
  is the price of the optional key. The profile page saying "integración no
  configurada" is what makes that state visible instead of mysterious.

## References

- DocumentBuddy `docs/decisions/012-aes-gcm-aad-user-secrets.md` — the
  source decision, and `src/bot/internal/domain/secret/` the source code.
- ADR-0038 — the Jetson deploy, and the five-minute Watchtower window that
  the optional-key decision turns on.
- ADR-0007, ADR-0034 — SQLite and `CGO_ENABLED=0`, which rule out SQLCipher.
- `docs/standards/backend-code-style.md` §The dependency rule, §Database.
- Issue #271, epic #270.
