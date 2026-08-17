# Deploying apps/server to the Jetson

The Jetson Nano hosts `apps/server` for the first real tests of the
professor login and the entrance-controls backoffice (issue #162, ADR-0037).
This document is the operating procedure. The design decisions live in the
WP body and the ADR; this one is what an operator opens.

**Scope of this deploy.** `apps/server` only. `apps/amc-worker` is a separate
question (1.04 GB image with LaTeX and OpenCV on a 4 GB Nano) that belongs
to WP-E, and is deliberately left out — so the professor can log in, and
control generation returns an amc-worker connection error until that WP
decides otherwise.

## Prerequisites — the account-level pieces Miguel provisions off-box

Each of these is a one-time action Miguel performs from his own accounts.
The repo carries the script or the exact place to click, never the
credentials themselves.

1. **AWS bucket + IAM user** for daily backups.
   - Repo tool: [`infra/deploy/jetson/provision-jetson-iam.sh`](../deploy/jetson/provision-jetson-iam.sh).
   - Miguel runs it with AWS admin credentials in the shell, from a laptop:
     ```bash
     NALANDA_S3_BUCKET=nalanda-backups-<something> \
     AWS_REGION=us-east-1 \
       ./infra/deploy/jetson/provision-jetson-iam.sh
     ```
   - It creates the bucket (with public access blocked and SSE-S3 at rest),
     sets a 30-day lifecycle policy on the `backups/` prefix, creates the
     `nalanda-jetson` user with `s3:PutObject` on that prefix only, and
     prints the access key ONCE.
2. **Telegram bot** for backup/monitor notifications.
   - Message [`@BotFather`](https://t.me/BotFather) on Telegram: `/newbot` →
     name it (suggestion: `nalanda_ops_bot`), copy the token.
   - Add the bot to the ops chat, then find that chat's numeric id via
     [`@getidsbot`](https://t.me/getidsbot).
3. **Second Google OAuth redirect URI.**
   - In the [Google Cloud console](https://console.cloud.google.com/) →
     APIs & Services → Credentials → the existing Nalanda OAuth client →
     Authorised redirect URIs, add exactly:
     ```
     https://<host>.<tailnet>.ts.net:8443/login/google/callback
     ```
   - Character for character (Google refuses `localhost` where you wrote
     `127.0.0.1`, and a trailing slash). The existing
     `http://127.0.0.1:8081/login/google/callback` stays — development keeps
     working.

Once each is done, keep the outputs handy for the `.env` step below.

## The Funnel — port 8443, not 443

DocumentBuddy already holds port 443 on the same Jetson via its own Funnel
(its ADR-014). A Tailscale-issued name has ONE hostname, so Nalanda takes
Funnel's second allowed port, **8443**, and gets its own origin at the same
host (issue #162 §Design):

```bash
# On the Jetson, once per box. Requires `tailscale` already logged in.
sudo tailscale serve  --bg --https=8443 http://127.0.0.1:8081
sudo tailscale funnel --bg --https=8443 on
```

Verify from the box:

```
tailscale funnel status
# expected: https://<host>.<tailnet>.ts.net:8443 (Funnel on)
#             |-- proxy http://127.0.0.1:8081
```

The alternative — a path prefix on 443 — was rejected because
`config.Load` refuses a `NALANDA_PUBLIC_URL` carrying a path (the routes
mount at the origin root; a base with a path would build a redirect URI
these routes do not serve).

**Why `--bg`**: the process ends immediately and Tailscale keeps the
listener on across reboots. Without it, closing the ssh session takes the
Funnel down.

**To take it down** (for a rollback, or during maintenance):
```bash
sudo tailscale funnel --https=8443 off
sudo tailscale serve  --https=8443 off
```

## The `.env` on the Jetson

The compose file is env-driven. From `apps/server/.env.example`, copy to
`infra/local/.env` on the Jetson and fill in the values above:

```ini
# The Funnel-served URL. Its scheme is what makes the session cookie
# carry `Secure` — first observation of the flag on the wire happens
# because this line has `https://`.
NALANDA_PUBLIC_URL=https://<host>.<tailnet>.ts.net:8443

# The Google OAuth client (existing, dev and prod share it).
NALANDA_GOOGLE_CLIENT_ID=<the client id>
NALANDA_GOOGLE_CLIENT_SECRET=<the client secret>
NALANDA_BOOTSTRAP_PROFESSOR_EMAIL=<Miguel's address>

# Backups (S7, S8): from provision-jetson-iam.sh's output.
NALANDA_S3_BUCKET=<the bucket name it created>
AWS_REGION=<the region>
AWS_ACCESS_KEY_ID=<the printed key id>
AWS_SECRET_ACCESS_KEY=<the printed secret>

# Notifications (S8, S9): from @BotFather + @getidsbot.
INFRA_TELEGRAM_TOKEN=<bot token from BotFather>
ALLOWED_CHAT_IDS=<numeric chat id from getidsbot>
```

`infra/local/.env` is gitignored via the root `.gitignore` for `.env`.

## Bringing it up

From `infra/local/` on the Jetson, first time or after a `git pull`:

```bash
docker compose up -d --build --wait server
# --build is not optional: `up` reuses the tagged image without it, so a
#   fresh git pull runs the OLD binary and every check below passes for the
#   wrong reason (see infra/local/docker-compose.yml server section).
# --wait blocks until the healthcheck reports the database is reachable.

# Verify BOTH surfaces from outside the tailnet — a phone on mobile data,
# or any browser off Wi-Fi:
curl -fsS https://<host>.<tailnet>.ts.net:8443/health
curl -fsS https://<host>.<tailnet>.ts.net:8443/api/health
```

Then go through [`apps/server/GOOGLE-CHECK.md`](../../apps/server/GOOGLE-CHECK.md)
end to end against the same URL. That run is the one that finally verifies
the `Secure` cookie flag on the wire — the section §"What this check has NOT
verified" defers to it.

## The proxy-trust measurement

Behind Tailscale Funnel `RemoteAddr` becomes `127.0.0.1` for every visitor —
the tunnel completes on loopback. Without `NALANDA_TRUST_PROXY_HEADERS=true`
the sessions table records `127.0.0.1` for every session, which is legible
but useless. With it, the column carries the first hop of `X-Forwarded-For`,
which is what the outermost proxy saw when the visitor arrived.

**Before flipping the switch, measure once**, so the assumption "the Funnel
owns this header" is verified rather than trusted. From any browser off the
tailnet, complete a login. Then on the Jetson:

```bash
docker compose logs server | grep 'X-Forwarded-For\|professor signed in'
```

The `professor signed in` line does not itself carry the address, but the
sessions row does. Read it back:

```bash
docker compose exec server /server -health   # just to prove liveness
# no shell in the scratch image — read the row from the host:
sqlite3 <path to the mounted volume>/nalanda.db \
  'SELECT ip_address, user_agent FROM user_sessions ORDER BY created_at DESC LIMIT 1'
```

Expected: with `NALANDA_TRUST_PROXY_HEADERS=false` (default) the row holds
`127.0.0.1`. Set it to `true` in `.env`, restart the server, log in again,
and the same query holds the visitor's public IP.

If it does not — the header is empty, or the row is still `127.0.0.1` — the
Funnel is not writing what this switch assumes, and the safe answer is to
leave the flag off and record the finding as a new deferral in
`docs/security-notes.md`.

## Restart, logs, rollback

- **Restart** (no config change): `docker compose restart server`
- **Logs**: `docker compose logs -f server`
- **Rollback** to the previously-tagged image:
  1. `git log --oneline` — find the commit before the bad one.
  2. `git checkout <that sha>`
  3. `docker compose up -d --build --wait server`
- **Take the site offline** (Funnel disabled, container down):
  ```bash
  sudo tailscale funnel --https=8443 off
  docker compose stop server
  ```

The compose services carry `restart: unless-stopped` (see the file), so a
reboot brings them back on their own and `docker compose stop` still means
"stay stopped".
