# GOOGLE-CHECK — the one check no agent can run

The suite proves the login **code**. It cannot prove the **integration**: nothing
in `go test`, in the pre-PR protocol or in CI ever reaches Google. The tests
drive a mock provider against an `httptest` server holding a real RSA key, which
verifies the verifier and says nothing about whether a real OAuth client, a real
redirect URI and a real Google account produce a session.

So this document exists for the same reason `apps/amc-worker/PAPER-CHECK.md`
does: **a synthetic green run is not evidence until a human has done the thing
once.** Run it when the login path changes — the OIDC adapter, the callback, the
cookie, `NALANDA_PUBLIC_URL` — and after the first deploy, whenever §C15 stops
being deferred.

Budget about fifteen minutes the first time, five afterwards.

---

## 1. Create the OAuth client (once)

In [Google Cloud console](https://console.cloud.google.com/) →
**APIs & Services** → **Credentials**:

1. **Create credentials** → **OAuth client ID**.
   - If asked, configure the consent screen first: **External**, app name
     *Nalanda*, your own address as support and developer contact. Publishing
     status **Testing** is enough, and it is the safer setting: only the accounts
     you list under **Test users** can complete the flow at all.
2. Application type: **Web application**.
3. **Authorised redirect URIs** — add exactly:

   ```
   http://127.0.0.1:8081/login/google/callback
   ```

   Character for character. Google matches this string against what the server
   sends and refuses anything else, including `localhost` where you wrote
   `127.0.0.1`, and including a trailing slash.

   **On the Jetson deploy (#162), add a SECOND URI to the same client** —
   the ONE OAuth client is shared between dev and prod, so both URIs coexist:

   ```
   https://<host>.<tailnet>.ts.net:8443/login/google/callback
   ```

   With the port. `<host>` and `<tailnet>` are the Jetson's Tailscale-issued
   names; `infra/local/DEPLOY-JETSON.md` §Prerequisites walks it through.

4. Copy the **client ID** and **client secret**.

> **Add a second Google account under Test users**, or have one to hand. Step 5
> needs an account that is *not* a professor, and that is half of what this check
> verifies.

## 2. Configure the server

From `apps/server/`:

```bash
cp .env.example .env
```

Edit `.env`:

```ini
NALANDA_ADDR=127.0.0.1:8081
NALANDA_DATABASE_URL=./nalanda.db
NALANDA_PUBLIC_URL=http://127.0.0.1:8081
NALANDA_GOOGLE_CLIENT_ID=<the client ID>
NALANDA_GOOGLE_CLIENT_SECRET=<the client secret>
NALANDA_BOOTSTRAP_PROFESSOR_EMAIL=<your own Google address>
```

`.env` is never committed (root `CLAUDE.md`). `nalanda.db` and its `-wal`/`-shm`
siblings are gitignored.

Then start it. **The setup is a target, not a command list** — a prose copy of
these three lines is what drifts and fails after you have already created the
OAuth client:

```bash
make login-check
```

`login-check` is `reset` then `run`: it discards the local database first,
deliberately, because the bootstrap only adopts a server with no professors at
all and a leftover file from an earlier run makes step 3 fail for the right
reason and look like a bug.

## 3. Sign in — the professor gets in

1. Open <http://127.0.0.1:8081/login>. You should see *Nalanda · administración*
   and a button reading **Entrar con Google**.
2. Press it. Google shows its account chooser (`prompt=select_account`, so it
   asks even if you are already signed in somewhere).
3. Choose the account whose address is in `NALANDA_BOOTSTRAP_PROFESSOR_EMAIL`.
4. You land back on `/login`, which now says **Sesión iniciada como
   \<your address\>** and offers **Cerrar sesión**.

The server log carries one line: `professor signed in`.

- [ ] The page shows the address you signed in with.

## 4. The session is real, and survives a restart

Sessions are server-side (ADR-0036), so restarting the process must not log you
out:

1. Stop the server (Ctrl-C) and start it again with **`make run`** — not
   `make login-check`, which would discard the database and with it the session
   this step exists to find still alive.
2. Reload `/login` **without** signing in again.
3. It still says *Sesión iniciada como …*.

- [ ] The session survived a restart of the process.

## 5. Sign in with a second account — the stranger is refused

This is the half that is easy to skip and is the whole point of "professor-only".

1. Press **Cerrar sesión**.
2. Press **Entrar con Google** again, and this time choose a **different** Google
   account (the second Test user).
3. You land on `/login` showing: *Esa cuenta de Google no pertenece a ningún
   profesor de este curso.*
4. No session is opened, and the log carries `refusing an account that belongs to
   no professor`.

If this account gets in, stop and read `internal/domain/auth/login.go`: either
the bootstrap did not close, or the address matched something it should not have.

- [ ] The second account was refused, by name, on the page.

## 6. Sign out means signed out

1. Sign back in with the professor account.
2. Press **Cerrar sesión**. You land on `/login` with *Has cerrado la sesión.*
3. Reload `/login`. It offers the Google button again, not the signed-in state.

- [ ] The old cookie no longer signs anyone in.

## 7. Only on the https re-run — the `Secure` cookie flag is observed on the wire

**Skip this section when running against `http://127.0.0.1:8081`.** It applies
only when `NALANDA_PUBLIC_URL` starts with `https://` — the Jetson deploy
(#162) or any future deploy. This is the run that closes
[the `security-notes.md` entry](../../docs/security-notes.md#the-session-cookie-has-no-secure-flag-in-development-accepted-2026-08-16-150)
for the `Secure` flag.

Sign in normally (steps 1–6). Then, from any terminal:

```bash
curl -sSI -c /tmp/nalanda-cookies https://<host>.<tailnet>.ts.net:8443/login \
  | grep -i '^set-cookie:'
# Nothing there until the login is completed; the observation is on the
# callback response, not on /login itself.
```

The evidence is easier from a browser. In DevTools → Application → Cookies →
the `<host>.<tailnet>.ts.net` origin, the session cookie's row shows the
`Secure` and `HttpOnly` columns both checked, and `SameSite=Lax`. And, since
the Jetson deploy takes the `__Host-` prefix, the cookie NAME reads
`__Host-nalanda_session` (dev is still plain `nalanda_session`, on purpose —
see `security-notes.md` §"The session cookie has no Secure flag" and
§"The login's state cookie is a double-submit cookie").

- [ ] The session cookie has `Secure` checked in DevTools.
- [ ] Its name begins with `__Host-`.

---

## What may be recorded, and where

This procedure handles a real Google account and a real client secret, so what
leaves your machine matters — the repo is public and
`docs/security-notes.md` classifies this material under Ley 21.719.

**In the PR, the issue or a commit**: the outcome only — which steps passed, on
what date, and anything that behaved unexpectedly, described without the values.

**Never**: the client secret, the `.env` file, the address you signed in with,
the raw log lines (they carry the professor id and, on a refusal, the email), the
database file, or a screenshot of the signed-in page. `nalanda.db*` and `.env`
are gitignored; that stops a commit, not a paste.

---

## What this check has NOT verified

Say so out loud rather than let the green ticks imply it:

- **Anything over https, from the local run.** `NALANDA_PUBLIC_URL` is `http://`
  in the local `.env`, so the session cookie carries no `Secure` attribute
  (`config.SecureCookie()` derives it from the scheme). The Jetson deploy (#162)
  is the first https run of this document, and its §7 is what verifies the flag
  on the wire.
- **Consent-screen behaviour for accounts outside your Test users list.** In
  **Testing** status Google refuses them before this server is involved.
- **Key rotation.** Google rotates its signing keys on its own schedule; the
  refetch path is covered by `TestAnUnknownKeyIdRefetchesTheKeySet` and cannot be
  triggered by hand.
