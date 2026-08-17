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
# The `jetson` profile brings the backup + monitor services along with the
# server; on a developer laptop `docker compose up -d server` runs the server
# alone and leaves them off. See infra/local/docker-compose.yml.
docker compose --profile jetson up -d --build --wait server
docker compose --profile jetson up -d --build backup monitor
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

## Backups

The `backup` compose service (built from `infra/deploy/jetson/Dockerfile.backup`
+ `backup.sh`) runs `crond -f` inside an alpine container. **03:00 UTC every
day** it calls `sqlite3 /data/nalanda.db ".backup /tmp/backup-<ts>.db"`
against the mounted server volume (read-only from the container's side),
gzips the file, uploads it to `s3://<bucket>/backups/nalanda-<ts>.db.gz` and
posts a `🧭 Nalanda ✅ Backup complete` line to the Nalanda Telegram bot.
A failure at any step posts a `🧭 Nalanda ❌ Backup failed: <reason>` line.

**Retention: 30 days, on S3, via the bucket's lifecycle policy** (installed
by `provision-jetson-iam.sh`). The script never deletes; the credentials do
not carry `s3:DeleteObject`.

**Trigger a backup by hand** (for verification, or for an on-demand snapshot
before a risky migration):

```bash
docker compose exec backup /usr/local/bin/backup.sh
```

**Test-restore into a scratch container** (never overwrites the live volume):

```bash
# Pull the most recent object into a scratch dir on the Jetson host.
mkdir -p /tmp/nalanda-restore && cd /tmp/nalanda-restore
LATEST=$(aws s3 ls "s3://${NALANDA_S3_BUCKET}/backups/" --region "${AWS_REGION}" \
  | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://${NALANDA_S3_BUCKET}/backups/${LATEST}" .
gunzip "${LATEST}"

# Read it back: schema query, and a quick sanity SELECT.
sqlite3 "${LATEST%.gz}" '.schema users'
sqlite3 "${LATEST%.gz}" 'SELECT COUNT(*) FROM users;'
```

If either command errors, the backup did not round-trip and the ADR-0037 AC
for backups has failed — do not delete the scratch copy, and open an issue.

## Health monitor

The `monitor` compose service (built from `infra/deploy/jetson/Dockerfile.monitor`
+ `monitor.sh`) polls `http://server:8081/health` on the compose network every
5 minutes, alerts the Nalanda Telegram bot after 3 consecutive failures, and
posts a recovery line when the server answers again. There is a 30-minute
cooldown between failure alerts, so a long outage is one message per cycle
rather than one per poll.

**It does NOT go through Funnel.** The whole point is to distinguish "the
server is down" from "the Funnel is down" — a monitor polling the public
https URL reports on Funnel + network + server, which is the wrong scope
when Miguel needs to know which of the three to look at.

**Verify it end-to-end after the first deploy** — this is AC-7b:

```bash
# On the Jetson, in one shell:
docker compose stop server
# Wait ≤15 minutes (3 failures × 5-minute poll). The Telegram bot posts:
#   🧭 Nalanda ❌ Server unhealthy (3 consecutive failures on http://server:8081/health)

# Then bring it back:
docker compose start server
# Within one poll interval (≤5 min) the bot posts:
#   🧭 Nalanda ✅ Server recovered (http://server:8081/health)
```

If either message never lands and the container is running (`docker compose
logs monitor`), the bot token or chat id is wrong — check them against the
values Miguel put in `.env`.

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
