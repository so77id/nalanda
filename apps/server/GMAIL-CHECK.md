# GMAIL-CHECK — the publication path against a real Google account

**Run this whenever the publication path changes**: the Gmail authorization
adapter (`internal/infra/oidc/gmail.go`), the `/profile` connect flow, the
transports in `internal/infra/email/`, the message builder, or
`NALANDA_EMAIL_MODE`.

It is an L8 manual procedure, in the same family and for the same reason as
[`GOOGLE-CHECK.md`](GOOGLE-CHECK.md), [`CANVAS-CHECK.md`](CANVAS-CHECK.md)
and `apps/amc-worker/PAPER-CHECK.md`: **nothing in the suite reaches
Google.** The tests drive an `httptest` provider and an `httptest` stand-in
for Gmail's send endpoint, which verifies the verifier and says nothing
about whether a real consent screen grants the scope, whether the redirect
URI matches character for character, or whether a message this server
considers well-formed arrives readable in a real inbox.

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
      app wants to **send email on your behalf** — and asks for nothing
      else. If it asks to READ mail, stop: the scope is wrong.
- [ ] Approve. You land back on `/profile`.
- [ ] The page now names the connected account
      (`Conectado como <dirección>`) and offers **Desconectar**.
- [ ] **Deliberately connect an account that is NOT your login address** if
      you have one. The page must name the account you chose, not the one
      you signed in with — that difference is the thing this WP is built to
      allow.

## 2. The refusals

- [ ] Press **Conectar Gmail** and then **Cancelar** on Google's screen.
      Back on `/profile`, the message says no account was connected. No
      account is shown as connected.
- [ ] **Desconectar**. The page returns to the invitation, and says you
      will not be able to publish until you connect one.

## 3. A rehearsal that sends nothing

With `NALANDA_EMAIL_MODE=dryrun` on the host:

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

Set `NALANDA_EMAIL_MODE=real` and restart. The boot log carries
`email dispatcher mode=real`.

- [ ] On the same control, **Envío de prueba** to your own address.
- [ ] Every deliverable copy arrives in **your** inbox, one message per
      copy.
- [ ] Open one and check all of it:
      - [ ] The **From is your connected Gmail address**, not `no-reply@`
            anything.
      - [ ] The subject reads `[<código>] Corrección <control> — nota <X>`,
            with the accents intact and the grade written with a **comma**
            (`5,7`). Mojibake here means the header encoding is broken.
      - [ ] The body greets by name, states the grade, and is signed with
            your name.
      - [ ] The footer carries a joke and the line saying the message was
            generated automatically.
      - [ ] **The PDF is attached, opens, and is the annotated copy** —
            marks drawn, correct answers, per-question score.
- [ ] Check your **Sent** folder: the messages are there.
- [ ] Reply to one of them from another account. The reply reaches your
      inbox with no reply-to trick.
- [ ] The control is still **not** marked published — a rehearsal changes
      nothing.

## 5. The real publication

**Only on a control Miguel has nominated.** This one cannot be undone.

- [ ] Choose the mode **"mi propia dirección (prueba)"** first and press
      **Publicar**. Everything goes to you, and the control IS stamped —
      this is the last rehearsal, and it is one-way.
- [ ] The page now shows `Publicado el … en modo prueba: los correos fueron
      a tu propia dirección, no a los estudiantes.`
- [ ] **Publicar** is gone from the page; **Envío de prueba** is still
      there.
- [ ] Pressing the same URL again by hand answers **409**.

Then, on a second nominated control, for real:

- [ ] Mode **"los estudiantes"** → **Publicar**.
- [ ] The banner shows the job running, then done.
- [ ] Ask **three students** to confirm they received it, and that the PDF
      is theirs. Not one — one arrival proves the path, three prove the
      addressing.
- [ ] The page shows `Publicado el …: las correcciones se enviaron a los
      estudiantes.`

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
