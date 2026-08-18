# Deploying apps/server to the Jetson

The Jetson Nano hosts `apps/server` for the first real tests of the
professor login and the entrance-controls backoffice (issue #162, ADR-0038).
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
     `nalanda-jetson` user with `s3:PutObject` + `s3:GetObject` + `s3:ListBucket` on that prefix only (Put for the daily backup, Get for the test-restore below, List for the lookup — no `DeleteObject`, so the lifecycle policy is the only thing that removes), and
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

# Load the production overlay by default. Every `docker compose <cmd>` in
# this directory merges docker-compose.yml + the overlay below, which
# switches server/backup/monitor from build-local to pull-from-GHCR and
# adds the Watchtower labels. Paths are relative to this directory.
COMPOSE_FILE=docker-compose.yml:../deploy/jetson/docker-compose.jetson.yml
```

`infra/local/.env` is gitignored via the root `.gitignore` for `.env`.

## Bringing it up — the first time

**After this WP lands, the box needs to be primed exactly once.** Everything
after "day 2" is `git push origin main` and Watchtower does the rest — see
§"Auto-update via Watchtower" below.

From `infra/local/` on the Jetson, first-time bring-up:

```bash
# 1. Log the local Docker daemon into GHCR so Watchtower has credentials.
#    Nalanda's images are public today, so this is not required for the
#    pull itself — but Watchtower reads /root/.docker/config.json (via the
#    mount in DocumentBuddy's watchtower service) to authenticate; keeping
#    an entry there is what makes the pipeline resilient to the images
#    going private later.
#
#    PAT SCOPE: create it at github.com/settings/tokens with `read:packages`
#    ONLY — do NOT tick `write:packages`. `~/.docker/config.json` holds the
#    token base64-encoded (not encrypted), and Watchtower's mount exposes
#    that file to any container that gains access to it; a broader scope
#    silently promotes the credential the mount reveals. SET AN
#    EXPIRATION (90 days is a reasonable default); the docs sidebar
#    reminds you to rotate.
docker login ghcr.io   # username: your GitHub handle; password: PAT (read:packages only, expires ≤90d)

# 2. Pull the three prod images from GHCR (server, backup, monitor). The
#    COMPOSE_FILE line in .env is what makes this reach the overlay.
docker compose pull

# 3. Bring them up. `--wait` blocks until the server's healthcheck reports
#    the database is reachable; the sidecars start after it.
docker compose up -d --wait server
docker compose up -d backup monitor

# 4. Verify BOTH surfaces from outside the tailnet — a phone on mobile data,
#    or any browser off Wi-Fi:
curl -fsS https://<host>.<tailnet>.ts.net:8443/health
curl -fsS https://<host>.<tailnet>.ts.net:8443/api/health
```

Then go through [`apps/server/GOOGLE-CHECK.md`](../../apps/server/GOOGLE-CHECK.md)
end to end against the same URL. That run is the one that finally verifies
the `Secure` cookie flag on the wire — the section §"What this check has NOT
verified" defers to it.

## Auto-update via Watchtower

After the first-time bring-up above, the deploy loop is:

1. Merge a PR to `main`. The `.github/workflows/server-cd.yml` workflow
   fires on any push touching `apps/server/**` or the three Jetson-sidecar
   files, cross-compiles `linux/arm64` images, pushes them to
   `ghcr.io/so77id/nalanda-{server,backup,monitor}:latest` (plus a
   `:sha-<sha>` tag), and posts a Telegram line via the Nalanda bot.
2. On the Jetson, the Watchtower container **that runs inside
   DocumentBuddy's compose** (`docbuddy-watchtower`) polls GHCR every 5
   minutes and pulls any `:latest` whose digest changed. It restarts the
   container in place, keeping the volumes attached.
3. The `monitor` sidecar posts `🧭 Nalanda 🟢 Monitor started (…)` after
   the restart — that is the ops-chat signal that a deploy landed.

**Watchtower is not Nalanda's — it is a dependency.** If DocumentBuddy's
compose is stopped, Nalanda's images stop being updated (they keep
running the last-pulled version indefinitely). Recovery: start
DocumentBuddy's compose, or add a Watchtower service to Nalanda's
overlay (`containrrr/watchtower` with `--label-enable`,
`WATCHTOWER_POLL_INTERVAL=300`, and the same `/var/run/docker.sock`
mount — DocumentBuddy's `docker-compose.prod.yml` is the worked case).
Two Watchtowers on one daemon both observing the same labels is
idempotent and wastes a poll each; do it only if DocumentBuddy is
retired and Nalanda outlives it.

**What Watchtower does NOT do**: it does not run migrations, it does not
re-provision AWS, it does not update `.env`. Config changes and schema
migrations still need a git push (the migration runs at container boot,
so restarting is enough) or a `docker compose up -d --force-recreate`
after editing `.env`.

## Rollback

- **Preferred**: `git revert <bad-sha> && git push origin main`. CI
  rebuilds against the reverted code, tags `:latest`, Watchtower pulls
  within its poll interval. Same shape as merging any other PR.
- **Emergency pin to a specific past image, without a git push**:
  ```bash
  # On the Jetson:
  docker pull ghcr.io/so77id/nalanda-server:sha-<good-sha>
  docker tag  ghcr.io/so77id/nalanda-server:sha-<good-sha> \
              ghcr.io/so77id/nalanda-server:latest
  docker compose up -d --pull=never --force-recreate server
  ```
  `docker pull` (not `docker compose pull` — the latter takes SERVICE
  names, not image references) fetches the SHA-pinned image. `--pull=never`
  is not optional: `pull_policy: always` on the service would otherwise
  re-fetch `ghcr.io/so77id/nalanda-server:latest` from GHCR before creating
  the container, immediately undoing the local `:latest` tag we just set —
  the rollback would live for one command and unwind itself.
  Watchtower will still unpin this on its next poll if a new `:latest`
  reaches GHCR. Use only during an active incident, and follow with the
  `git revert` path above.
- **Take the site offline** (Funnel disabled, containers down):
  ```bash
  sudo tailscale funnel --https=8443 off
  docker compose stop server backup monitor
  ```

`restart: unless-stopped` on every service means a reboot brings them
back on their own, and `docker compose stop` still means "stay stopped".

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

If either command errors, the backup did not round-trip and the ADR-0038 AC
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

**Before flipping the switch, TWO measurements**, so the assumption "the Funnel
owns this header" is verified rather than trusted. The first (benign) is what
proves the switch works at all; the second (adversarial) is what proves the
switch is SAFE — that Tailscale Funnel strips or replaces a client-supplied
`X-Forwarded-For` rather than appending to it. Skip the adversarial half and
an attacker sending `curl -H 'X-Forwarded-For: 6.6.6.6' https://<host>:8443/…`
writes `6.6.6.6` to `user_sessions.ip_address` — the failure
`TestTheSessionIPIgnoresAForgeableHeader` was written to guard against,
reintroduced through the `true` branch. #162 review, SEC-1.

### 1. Benign — the switch works

From any browser off the tailnet, complete a login. On the Jetson, read the
row back (the scratch image has no shell, so this runs from the host):

```bash
sqlite3 /var/lib/docker/volumes/local_server-data/_data/nalanda.db \
  'SELECT ip_address, user_agent FROM user_sessions ORDER BY created_at DESC LIMIT 1'
```

Expected: with `NALANDA_TRUST_PROXY_HEADERS=false` (default) the row holds
`127.0.0.1`. Set it to `true` in `.env`, restart the server, log in again,
and the same query holds the visitor's public IP.

### 2. Adversarial — the switch is safe

From a machine **off the tailnet** (a phone on mobile data, or any laptop
not signed into Tailscale), while `NALANDA_TRUST_PROXY_HEADERS=true`:

```bash
# Send an attacker-chosen header at the LOGIN CALLBACK path (any path that
# opens a session works, but the callback is what an exploit would target).
curl -sS -H 'X-Forwarded-For: 6.6.6.6' \
  "https://<host>.<tailnet>.ts.net:8443/health"
```

Then log in normally in a browser and re-run the SQL above. What the row
shows decides everything:

- **The row holds the browser's real public IP** (not `6.6.6.6` and not
  `127.0.0.1`): Funnel strips or replaces inbound `X-Forwarded-For`. The
  `true` branch is safe. Record the measurement under the closed
  `security-notes.md` entry so future readers do not have to redo it.
- **The row holds `6.6.6.6`**: Funnel APPENDS rather than replaces, and this
  server takes the leftmost — which is the attacker's value. **Set
  `NALANDA_TRUST_PROXY_HEADERS=false` immediately** and record the finding
  as a new deferral in `security-notes.md`. Do not flip the flag back on
  until Funnel's behaviour changes or the code takes the rightmost hop
  instead.
- **The row holds `127.0.0.1`**: the header did not reach the server at
  all (Funnel dropped it). Same as "strips", the switch is safe.

`handler.Auth.clientIP` also refuses a leftmost hop that does not parse as
an IP (`net.ParseIP`), so a header like `X-Forwarded-For: <script>alert(1)</script>`
falls through to `RemoteAddr` rather than reaching the sessions row (#162
review, SEC-2).

## Day-to-day operations

- **Restart** (no config change): `docker compose restart server`
- **Logs**: `docker compose logs -f server backup monitor`
- **Config change** (edit `.env`, no code change): `docker compose up -d --pull=never --force-recreate` — re-reads env and recreates the containers. `--pull=never` is not optional; the overlay carries `pull_policy: always`, so a plain `up` would also fetch the current `:latest` from GHCR mid-config-change. Pass it to keep the config change and any pending image swap separate.
- **Skip a Watchtower cycle** (deploy immediately, without waiting the 5-min poll):
  ```bash
  docker compose pull
  docker compose up -d
  ```
  Same result as waiting for Watchtower, minus the wait.
- Rollback recipes are in §Rollback above.
