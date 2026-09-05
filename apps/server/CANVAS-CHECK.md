# CANVAS-CHECK — the Canvas integration against the real UDP instance

Nothing in this repository can test Canvas. The suite drives a fake
(`internal/infra/canvas`'s `httptest` servers), exactly as it drives
`oidctest.Provider` for Google — so the same rule applies as in
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md) and
[`../amc-worker/PAPER-CHECK.md`](../amc-worker/PAPER-CHECK.md):

> **A change to the Canvas path is unfinished while a human has not run this
> document against the real instance.**

"The Canvas path" means: the GraphQL queries in
`internal/infra/canvas/canvas.go`, the normalisation in
`internal/domain/canvas/roster.go`, **the import — `handler.ImportCanvas`,
`roster.Service.Import` and `coursestore.SaveRoster`** — the token round trip
on `/profile`, or `NALANDA_CANVAS_GRAPHQL_URL`.

The import was NOT in this list when the procedure was written at S4, and
that omission had a cost: the enrolment-state defect the review found — a
past-term course importing as an empty roster, which withdraws the whole
class — sat outside the declared scope by construction, and the fake-driven
suite cannot see it either (#271 review, DCO-4).

Last run: **2026-09-04**, issue #271 S4, at commit `3bc0090`, against a live
course of 29 enrolments. Results in ADR-0069. §6, §7 and §8 were ADDED after
that run by the #271 review and have not been executed yet — the attestation
names a commit precisely so a procedure written at one slice cannot keep a
green mark through later changes to the path it covers.

## 0 · What you need

- A Canvas access token of your own: Canvas → *Cuenta* → *Configuración* →
  *Nuevo token de acceso*. It carries all your permissions, so treat it like
  a password and revoke it from the same screen when you are done testing.
- The token in `apps/server/.env` as `NALANDA_CANVAS_TOKEN_DEV=…` for the
  command-line steps, and/or pasted into `/profile` for the browser steps.
- A course id you teach. Step 2 tells you how to find it.

The token never goes in a shell command — put it in `.env` and let the
commands read it from there, so it stays out of your shell history.

```bash
cd apps/server
set -a && . ./.env && set +a
```

## 1 · The token authenticates

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST "${NALANDA_CANVAS_GRAPHQL_URL:-https://udp.instructure.com/api/graphql}" \
  -H "Authorization: Bearer $NALANDA_CANVAS_TOKEN_DEV" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { __typename }"}'
```

**Expect `200`.** A `401` means the token is wrong or revoked. This is the
exact probe `Client.Verify` uses, so a `200` here and a rejection in the
backoffice would mean the client, not the token.

## 2 · Your courses come back, with terms

```bash
curl -sS -X POST "${NALANDA_CANVAS_GRAPHQL_URL:-https://udp.instructure.com/api/graphql}" \
  -H "Authorization: Bearer $NALANDA_CANVAS_TOKEN_DEV" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { allCourses { _id name courseCode term { name startAt } } }"}' \
  | python3 -m json.tool | head -40
```

**Expect** every course you are enrolled in, in any role — including ones
you attend rather than teach, and including old terms. Note the `_id` of the
course you want to import; that is what step 3 uses and what the picker
stores as `course.canvas_course_id`.

**A course in Canvas's default term has `startAt: null`.** That is normal
(2 of 16 in the 2026-09-04 run) and is why the picker sorts those last
instead of crashing.

## 3 · The roster, and where the RUT is

Replace `<COURSE_ID>` with the id from step 2.

```bash
curl -sS -X POST "${NALANDA_CANVAS_GRAPHQL_URL:-https://udp.instructure.com/api/graphql}" \
  -H "Authorization: Bearer $NALANDA_CANVAS_TOKEN_DEV" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { course(id: \"<COURSE_ID>\") { enrollmentsConnection(first: 3) { nodes { _id type state user { _id sortableName email sisId } } } } }"}' \
  | python3 -m json.tool
```

**Expect**, per ADR-0069:

- `user.sisId` carries the RUT **with its verifier and no separators** —
  `112223335`, `11222444K`. Not `loginId`, which is the email address.
- `user.sortableName` is `"APELLIDOS, NOMBRES"`, with the comma.
- `type` is one of `StudentEnrollment`, `TeacherEnrollment`,
  `TaEnrollment`. Only the first becomes a student.

**If `sisId` comes back `null`**, this token cannot read SIS ids on this
course, and every student would import without a RUT. Stop: that is a
permissions problem, not a code one.

## 4 · The token round trip in the backoffice

With the server running (`README.md` §Commands) and signed in:

1. Open `/profile`. **Expect** the Canvas section with an empty token field
   and the instructions for generating one.
   - If it says the integration is not configured and names
     `NALANDA_SECRETS_MASTER_KEY`, set that variable first
     (`openssl rand -base64 32`) and restart.
2. Paste a **wrong** token (e.g. `1234~noSirve`) and save.
   **Expect** the page to come back with "Canvas rechazó este token", and
   the HTTP status to be **422**, not 200.
3. Paste the real token and save. **Expect** a redirect, the flash "Token de
   Canvas guardado.", and the page to say "Token configurado".
4. **Look at the page source.** The token must not appear anywhere in it,
   and the replacement field must be empty.
5. **Look at the server's log output** for the whole session above. The
   token must not appear in any line — not in a warning, not in an error.
6. Click *Eliminar el token*. **Expect** the flash, and the empty form back.

## 5 · The sensitive-value sweep

Set the two paths once — `<…>` in a command is a shell redirect, not a
placeholder, so a pasted `grep … <the log file` fails with "no such file or
directory: the" rather than telling you to substitute (#271 review, DAC-10):

```bash
LOG=/path/to/the/server.log      # where you captured stderr in step 4
DB=/data/nalanda.db              # the compose volume's path inside the container
```

With the server's stderr captured during step 4:

```bash
grep -c "$NALANDA_CANVAS_TOKEN_DEV" "$LOG"   # expect 0
```

And against the database, which is where a bug would put it in the clear —
written per ROW, because `user_secrets` holds one per professor per secret
and ADR-0068 anticipates a second namespace for WP-3's Resend key. The
single-row version concatenated two hex lines and died on
`binascii.Error: Odd-length string` (#271 review, DAC-9):

```bash
sqlite3 "$DB" "SELECT user_id, namespace, key, hex(ciphertext) FROM user_secrets;" \
  | python3 -c 'import sys, binascii
for line in sys.stdin:
    *meta, blob = line.strip().split("|")
    print(meta, binascii.unhexlify(blob))'
```

**Expect bytes that are not your token.** A readable token here means the
sealing is not happening, whatever the tests say.

## 6 · The import, end to end

The step the procedure did not have, and the one that covers the path the
review found a class-wiping defect in.

1. On `/profile`, with the token saved, pick the current course and press
   **Agregar a Nalanda**. You land on `/courses/{id}`, empty, with **Cargar
   desde Canvas** as the whole page.
2. Press it. **Expect** the roster: surnames sorted with accents in their
   right place (`ÁVILA` before `BRAVO`, not after `ZUNIGA`), RUTs written
   `11.222.333-5`, and a count that matches what step 3's `curl` returned.
3. **Press Reimportar.** Expect the same count, `0` withdrawn, and no
   duplicate rows. That is the idempotence the store's tests assert against
   fixtures and this asserts against Canvas.
4. **Check the "sin RUT" line.** If Canvas gave any student no readable
   `sisId`, the page says how many. Those students will never match a
   control — worth knowing before the semester, not after.

## 7 · A past-term course (the case that found the bug)

If you have a course from a finished semester, import it too. **Expect a
full roster, not an empty one.** Every enrolment of a past course is
`completed`, and an earlier filter excluded that state — which made the
import return zero students and mark the entire class as withdrawn
(ADR-0069 §Decision 4). Nothing in the suite can see this: the fixtures say
`active` because that is what the one measured course said.

## 8 · How long it took

The synchronous-import decision and the 20-second deadline rest on a
duration nobody had measured. Add `-w '\n%{time_total}s\n'` to the `curl`s
in §2 and §3 and record both, plus the wall clock of the full import from
§6, against the number of students:

```bash
curl -sS -w '\n%{time_total}s\n' -X POST "${NALANDA_CANVAS_GRAPHQL_URL:-https://udp.instructure.com/api/graphql}" \
  -H "Authorization: Bearer $NALANDA_CANVAS_TOKEN_DEV" \
  -H 'Content-Type: application/json' \
  -d '{"query":"query { __typename }"}' -o /dev/null
```

Write the numbers into `importDeadline`'s comment in
`internal/app/web/handler/courses.go` with their date and the class size, so
the constant carries the measurement it came from rather than only its
relationship to `WriteTimeout` (#271 review, DCO-5).

## Notes

- **Revoke the test token** in Canvas when you are done, especially if you
  pasted a wrong one anywhere it could have been logged.
- **A course id is not a secret**, but a roster is: the JSON from step 3
  carries real students' names, addresses and national identifiers. Do not
  paste it into an issue, a PR, or a chat.
- **And do not commit it.** Every example in this document and in the
  repository's tests is SYNTHETIC — the right shape, nobody's data. That is
  a rule bought the hard way: #271 measured against a real course and wrote
  four students' RUTs, surnames and addresses into an ADR, into this file
  and into forty test fixtures, in a public repository, fifty lines below
  the paragraph above. `docs/security-notes.md` §"Real student identifiers
  were committed to this public repository" carries the incident and the
  rule. When you measure something here, keep the shape and change the
  values.
