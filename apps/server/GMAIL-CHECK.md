# GMAIL-CHECK — the publication path against a real Google account

**Run this whenever the publication path changes**: the Gmail authorization
adapter (`internal/infra/oidc/gmail.go`), the `/profile` connect flow, the
transports in `internal/infra/email/`, the message builder,
`NALANDA_EMAIL_MODE` — or, since #287, the publication
loop and the per-copy record: `internal/domain/controls/publish_service.go`,
`publication_state.go`, `internal/infra/storage/controlstore/readings.go`'s
publication columns, and the publication routes in
`internal/app/web/handler/publish.go`. §5c and §5d are their steps.

It is an L8 manual procedure, in the same family and for the same reason as
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md), [`CANVAS-CHECK.md`](CANVAS-CHECK.md)
and `apps/amc-worker/PAPER-CHECK.md`: **nothing in the suite reaches
Google.** The tests drive an `httptest` provider and an `httptest` stand-in
for Gmail's send endpoint, which verifies the verifier and says nothing
about whether a real consent screen grants the scope, whether the redirect
URI matches character for character, or whether a message this server
considers well-formed arrives readable in a real inbox.

**Last run: PARTIAL, 2026-09-07, at `599690c` (#284 on the Jetson).** §1
connect and a §4 send to Miguel's own address both passed — the grant, the
refresh token, the From, the attachment and the Sent copy are real. §4's
BODY checks below were rewritten afterwards (the whole name, no footer),
so they have not been read against a delivered message, and §§2, 3, 5, 6
and 7 have not run at all.

The commit is the load-bearing half of this line: without it a procedure
keeps its green mark through every later change to the path it covers.

Everything below runs against the **https** URL, never `localhost`. The
state cookie carries the `__Host-` prefix in production and the OAuth
redirect URI is matched by Google exactly — both are things only the
deployed URL exercises.

---

## 0. One-time console setup

Neither of these is code, and the button fails with
`redirect_uri_mismatch` or `invalid_scope` without them.

In Google Cloud Console, on **the same OAuth client the login uses**:

- [ ] Add `https://www.googleapis.com/auth/gmail.send` to the consent
      screen's scopes.
- [ ] Register the redirect URI `<NALANDA_PUBLIC_URL>/profile/gmail/callback`.
- [ ] Note the app's **publishing status** (Testing / In production). It
      decides the seven-day question in §6.

Also confirm `NALANDA_SECRETS_MASTER_KEY` is set on the host: the refresh
token is sealed, and without a key the profile page will say the
integration is unavailable rather than offering the button.

---

## 1. Connect

- [ ] Sign in at `<NALANDA_PUBLIC_URL>` and open `/profile`.
- [ ] The section **"Envío de correcciones"** offers **Conectar Gmail**.
- [ ] Press it. Google shows a consent screen that says, in words, that the
      app wants to **send email on your behalf**, plus your identity
      (`openid`, `email`) so Nalanda learns which account you picked — and
      nothing more. **If it asks to READ mail, stop: the scope is wrong.**
- [ ] Approve. You land back on `/profile`.
- [ ] The page now names the connected account
      (`Conectado como <dirección>`) and offers **Desconectar**.
- [ ] **Deliberately connect an account that is NOT your login address** if
      you have one. The page must name the account you chose, not the one
      you signed in with — that difference is the thing this WP is built to
      allow.

## 2. The refusals

- [ ] Press **Conectar Gmail** and, on Google's screen, **untick the
      "Enviar correo electrónico en tu nombre" checkbox** while still
      approving everything else. Google returns a refresh token either way,
      so this is the failure that used to complete silently and surface
      weeks later as a wrong diagnosis. Nalanda must refuse it and say the
      send permission was left unmarked. **No account is connected.**
- [ ] Press **Conectar Gmail** and then **Cancelar** on Google's screen.
      Back on `/profile`, the message says no account was connected. No
      account is shown as connected.
- [ ] **Desconectar**. The page returns to the invitation, and says you
      will not be able to publish until you connect one.

## How to switch modes

Every section below that names a mode means these three commands on the
Jetson, stated once here rather than reconstructed at each step:

```bash
ssh jetson
cd /opt/nalanda/repo/infra/local
sed -i 's/^NALANDA_EMAIL_MODE=.*/NALANDA_EMAIL_MODE=<mode>/' .env
docker-compose up -d server            # v1, hyphenated — not `docker compose`
docker-compose logs server | grep 'email dispatcher'
```

The last line is the confirmation: `email dispatcher mode=<mode>`. If it
says anything else, the container did not restart on the new `.env`.

## 3. A rehearsal that sends nothing

In `dryrun`:

- [ ] Open a control whose correction is **closed** and which has a course.
- [ ] Under **Enviar las correcciones → Envío de prueba**, type your own
      address and send.
- [ ] Nothing arrives. The container log carries one
      `dryrun: would send` line per deliverable copy, each naming a
      **masked** recipient (`m…z@udp.cl`), the subject, and a non-zero
      `attachment_bytes`.
- [ ] **No student address appears in the log in full.** If one does, that
      is a defect, not a nuisance.

## 4. A rehearsal that really sends

In `real`.

- [ ] On the same control, **Envío de prueba** to your own address.
- [ ] Every deliverable copy arrives in **your** inbox, one message per
      copy.
- [ ] Open one and check all of it:
      - [ ] The **From is your connected Gmail address**, not `no-reply@`
            anything.
      - [ ] The subject reads `[<código>] Corrección <control> — nota <X>`,
            with the accents intact and the grade written with a **comma**
            (`5,7`). Mojibake here means the header encoding is broken.
      - [ ] The body greets the student by their **whole** name — given
            names AND both surnames — written the way a person writes it
            (`Benjamin Matias Perez Gonzalez`, never the CAPITALS Canvas
            stores). Half a name here means the roster query lost a
            column.
      - [ ] It states the grade, invites a reply to that same message,
            and is signed with your name. There is **no footer**: no
            joke, and no line about a machine having written it.
      - [ ] **The PDF is attached, opens, and is the annotated copy** —
            marks drawn, correct answers, per-question score.
- [ ] **Open the readings table beside these messages and compare the
      grade.** For at least three copies, including one below 4,0, the
      number in the subject and body must equal the "Nota" column. This is
      the cheap guard for the #287 grade defect — it needs no students, and
      §4 was green over that defect on 2026-09-07 precisely because it only
      checked the grade's FORMAT.
- [ ] Check your **Sent** folder: the messages are there.
- [ ] Reply to one of them from another account. The reply reaches your
      inbox with no reply-to trick.
- [ ] The control is still **not** marked published — a rehearsal changes
      nothing.

## 5. The real publication

**Only on a control Miguel has nominated.** The mail cannot be recalled;
since #287 the app itself is no longer a dead end.

> ⚠️ **The mode dropdown resets to "los estudiantes" on every page load.**
> It has no `selected` attribute, so the first option wins. Every step below
> that says "prueba" means: re-open the select and pick **"mi propia
> dirección (prueba)"** again, immediately before pressing. Pressing
> Publicar without doing that mails the real class.

- [ ] Pick **"mi propia dirección (prueba)"** and press **Publicar**.
      Everything goes to you, and the CONTROL is stamped — the copies are
      not.
- [ ] The page now shows `Publicado el … en modo prueba: esa primera
      publicación fue a tu propia dirección. Ninguna copia figura como
      enviada…`
- [ ] **The copies table says `no enviada` for every copy.** A rehearsal
      records nothing about a student, which is what stops it from
      consuming the real publication (ADR-0073 §4). **If any copy reads
      `enviada` here, STOP** — the next real Publicar will skip that person,
      and that is the defect #287's own review found.
- [ ] **Publicar** is still on the page beside that line, and **Envío de
      prueba** is too. Since #287 the button is how you finish a run that
      died half way or send a re-corrected copy — it is not "already done".
- [ ] Re-pick **"mi propia dirección (prueba)"** and press **Publicar**
      again. It answers **303**, not 409, and you receive the WHOLE batch a
      second time — because a rehearsal stamped nothing, so there is nothing
      to skip. That is the point of the check above, not a bug.
- [ ] Open **Reenviar a todo el curso**. After a rehearsal it reads
      `Ninguna copia figura como enviada, así que esto no cambia nada` —
      the count only appears once a REAL run has written to somebody.

Then, on a second nominated control, for real:

- [ ] Mode **"los estudiantes"** → **Publicar**.
- [ ] The banner shows the job running, then done.
- [ ] Ask **three students** to confirm they received it, and that the PDF
      is theirs. Not one — one arrival proves the path, three prove the
      addressing.
- [ ] **Ask one of them what grade the message says**, and compare it to
      the readings table. They must be the same number. This is the #273
      defect #287 fixed: the message re-scaled the grade, saturating at 7,0
      as soon as the real grade reached the control's QUESTION COUNT — a
      sixth of the answers right on a two-question control, a third on a
      three-question one, half on a four-question one.
- [ ] The page shows `Publicado el …: N copias figuran como enviadas a los
      estudiantes.` (or `1 copia figura como enviada al estudiante.`)
- [ ] The **controls list** shows `N/M enviadas` on that row, and nothing on
      a control you have not published.
- [ ] Open **Reenviar a todo el curso** NOW, on this control: it names how
      many people already have their correction. Do NOT use it here unless
      you mean to mail the class again.

## 5b. The mode gate

- [ ] In `stub`. On a graded control,
      **Publicar** is disabled and says this server is not configured to
      send. Pressing the URL by hand answers **422** naming the variable,
      and **the control is not stamped**.
- [ ] **Envío de prueba** still works under `stub` — a rehearsal on a
      server that delivers nothing is a coherent thing to do.
- [ ] Put the mode back to `real`.

## 5bb. What the deploy does to the class already published

**Read this before pressing anything on the control published on
2026-09-08.** Migration `00019` adds the per-copy columns with **no
backfill**, and there is nothing to backfill from — `control.published_sent`
was a count, not a list. So that control comes up with every copy
`no enviada` and `0/N enviadas` on the list, although twenty-five students
are holding mail.

- [ ] Confirm that is what you see, rather than assuming the deploy failed.
- [ ] **Pressing Publicar on it mails the whole class again.** For THAT
      control that is very likely what you want — #273 mailed the wrong
      grade (see §5's grade step) — but it is a decision, not a resume, and
      nothing in the app will warn you.

## 5c. The resume (issue #287)

The case no test can see: a real interrupted run leaving the mailbox in the
state the columns claim. Everything below is on a nominated control with at
least four deliverable copies.

- [ ] Press **Publicar**, and while the job is running,
      `docker compose stop server` on the Jetson (or `docker stop` the
      container). Do it within the first few seconds — the whole class took
      thirty-four seconds on 2026-09-08, so a class of thirty gives you
      about one second per student.
- [ ] Start it again. The banner reports the job as failed or stuck; that is
      the runner's no-retry rule (ADR-0050) and is expected.
- [ ] Open the control. The copies table shows some copies `enviada` **with
      a date and a grade**, and the rest `no enviada`. Write down which.
- [ ] **Count the messages in your Sent folder.** Note the count BEFORE
      pressing Publicar and again after: the DIFFERENCE must equal the
      number of copies now marked `enviada`. An absolute count will not do
      — §4 and §5 put whole batches in the same folder. (Or search Sent by
      the control's name.) This is the whole check: the columns claim a fact
      about a mailbox nothing in the suite can see.
- [ ] Press **Publicar** again.
- [ ] The copies that were already `enviada` **receive nothing**. Verify by
      asking one of those students — **not** by publishing in `staging`
      mode, which sends you the WHOLE batch on purpose and tells you
      nothing about who the real run skipped.
- [ ] The `Publicado el …` line still carries the FIRST publication's date,
      not the resume's.

## 5d. The per-student send (issue #287)

- [ ] Open one copy's **revisar** page on a graded control. It offers
      **Enviar la corrección a esta persona**.
- [ ] Change that copy's grade (mark an answer differently) and press it.
      The student receives the corrected version, and the review page says
      `Enviada el …, con un <the new grade>`.
- [ ] Back on the control page, that copy reads `enviada` with the new
      grade — not `desactualizada`.
- [ ] Press the same button again. It sends again: it is the manual
      override, and it does not refuse on state.
- [ ] On a copy matched to nobody the button is **disabled**, with the
      reason beside it ("no está asociada a nadie del curso"). You cannot
      reach the refusal by clicking; a hand-typed POST answers **303** back
      to this page and says the same sentence as a flash.

## 5e. Staleness and the skip reasons (issue #287)

The two behaviours §5c and §5d do not reach. Both on a nominated control
that has been published for real.

- [ ] Open one student's copy, change an answer so the GRADE moves, save.
- [ ] The copies table now reads `desactualizada` for that copy, with both
      numbers: `salió con un X, ahora tiene un Y`.
- [ ] Press **Publicar**. **That student receives a second message with the
      new grade, and nobody else receives anything** — ask two others to
      confirm they got nothing. That is the half no test can see: the suite
      can prove the loop skipped them, not that their inbox stayed quiet.
- [ ] The copy is back to `enviada`, with the new grade.
- [ ] On a control with an unmatched copy and a copy with no corrected PDF,
      the table names the reason per copy (`no está asociada a nadie del
      curso`, `no tiene su PDF corregido`) — this is the information that
      was computed and thrown away for the whole of #273's life.

## 6. The seven-day question

ADR-0072 records that Google's own documentation and a third-party source
disagree about whether refresh tokens issued by an **unverified** app
expire after seven days, or only while the app's publishing status is
**Testing**. Nothing in the code bets on either answer. This is how the
answer gets found:

- [ ] Note the date you connected in §1, and the app's publishing status.
- [ ] **Eight days later**, run one **Envío de prueba** to your own
      address.
      - It sends → the token survived; record the publishing status it
        survived under in ADR-0072.
      - The banner says the connection was lost and `/profile` shows no
        connected account → the seven-day clock applies. Reconnect, and
        the fix is Google's sensitive-scope verification (3–5 business
        days; no security assessment for `gmail.send`).

Either outcome is a result. Write it into ADR-0072 §Consequences, replacing
the open question with the measurement.

## 7. Nothing leaked

- [ ] Grep the container log for the connected account's refresh token
      prefix (`1//`) and for `ya29.` — an access token. Neither appears.
- [ ] Grep it for a student's full address. It does not appear.

---

## Notes — what may be written down

**Nothing from §5 goes into this file, into a commit, or into an issue.**
That section has you standing in front of three students' names, addresses
and grades. Record the OUTCOME as counts — "3 de 3 confirmaron, PDF
correcto" — and never the people.

Same rule and the same reason as `docs/security-notes.md` §"Real student
identifiers were committed to this public repository". Every example in this
document is synthetic (`m…z@udp.cl`, `profesora@gmail.com`) and the ones you
add should be too.

The one thing that IS worth writing down, in ADR-0072 rather than here, is
§6's measurement — it is the answer to a question the ADR could not settle.
