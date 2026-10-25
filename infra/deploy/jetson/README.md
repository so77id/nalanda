# infra/deploy/jetson

Host-specific production images, off-box provisioning artifacts, and the
compose overlay for the Jetson deploy of `apps/server` and `apps/amc-worker`
(#162, #175, ADR-0038). The runbook that stitches these files together lives
at [`../../local/DEPLOY-JETSON.md`](../../local/DEPLOY-JETSON.md) — read it
first if you are here to actually deploy. The images that ship from this
deploy land in **GHCR** as
`ghcr.io/so77id/nalanda-{server,backup,monitor}:latest` (built from this
directory by `.github/workflows/server-cd.yml`) and
`ghcr.io/so77id/nalanda-amc-worker:latest` (built from `apps/amc-worker/`
by `.github/workflows/amc-worker-cd.yml`) — each plus a `:sha-<sha>` tag.
Watchtower on the Jetson (the one in DocumentBuddy's compose) pulls them
within ≤5 minutes.

The placement rule these files sit under is
[`docs/standards/repository-structure.md`](../../../docs/standards/repository-structure.md)
§Placement criteria — the row "Host-specific production service DEFINITIONS
(backup, monitor)...". Service definitions live in the overlay
`docker-compose.jetson.yml` in this directory, merged on top of
`infra/local/docker-compose.yml` via the `COMPOSE_FILE=…` line in the
Jetson's `.env` (DEPLOY-JETSON.md §"The `.env` on the Jetson"). The
images they build from and the scripts they run live here too.

## Files

| File | Purpose | Who runs it |
|---|---|---|
| `docker-compose.jetson.yml` | Production overlay merged on top of `infra/local/docker-compose.yml`. Swaps `build:` for `image: ghcr.io/…:latest` on server + amc-worker, adds the `backup` + `monitor` services, and puts `com.centurylinklabs.watchtower.enable=true` on every prod container | `docker compose` on the Jetson (via `COMPOSE_FILE` in `infra/local/.env`) |
| `Dockerfile.backup` + `backup.sh` + `notify.sh` | Daily `sqlite3 .backup` → gzip → S3, with a `🧭 Nalanda` Telegram line on success or failure. Built into `ghcr.io/so77id/nalanda-backup:latest` by `.github/workflows/server-cd.yml` | `crond` inside the `backup` compose service on the Jetson |
| `Dockerfile.monitor` + `monitor.sh` + `notify.sh` | Poll `http://server:8081/health` every 5 minutes, alert after 3 failures with a 30-minute reminder cadence, post recovery when the server answers again. Built into `ghcr.io/so77id/nalanda-monitor:latest` | The `monitor` compose service on the Jetson |
| `notify.sh` | Shared Telegram POST helper; sourced by both scripts so their `notify()` cannot drift (#162 review, ARQ-2) | Sourced, never invoked directly |
| `provision-jetson-iam.sh` | Creates the bucket (public-access blocked, SSE-S3, 30-day lifecycle on `backups/`), the `nalanda-jetson` IAM user (least-privilege `PutObject`+`GetObject`+`ListBucket` on `backups/` only) and, since #338, the server's own `nalanda-jetson-server` user (`GetObject`+`PutObject`+`DeleteObject`+`ListBucket` on `work/` only, TLS only), and an access key for each; verifies every safety after applying it (SEC-5), and since #338 that versioning is off and that no lifecycle rule reaches `work/` — the primary copy of the scans | Miguel, from a laptop with AWS admin credentials, ONCE (or when rotating keys) |
| `nalanda-jetson-user-policy.json` | The backup user's inline IAM policy; the script substitutes `${NALANDA_S3_BUCKET}` into it | The script; not applied by hand |
| `nalanda-jetson-server-policy.json` | The server user's inline IAM policy (#338): the work files under `work/`, nothing of `backups/`, and a deny on any request that is not TLS | The script; not applied by hand |
| `docker-compose.drill.yml` | The disk-loss drill (#338 AC-16): a third `-f` that mounts a FRESH, empty work volume on server and amc-worker instead of the real one, so S3 alone must bring every file back | By hand on the Jetson, per `infra/local/DEPLOY-JETSON.md` §"The drill" |
| `nalanda-jetson-bucket-lifecycle.json` | The 30-day lifecycle configuration on `backups/`, with 1-day cleanup of noncurrent versions and incomplete multipart uploads | The script |

## Copy the SHAPE, not the file

The three scripts and their two Dockerfiles started as copies of
DocumentBuddy's `scripts/{backup.sh, monitor.sh, provision-jetson-iam.sh,
Dockerfile.backup, Dockerfile.monitor}`. **They are not references and not
symlinks.** An edit here must never silently touch DocumentBuddy, and the
reverse. If a future Miguel-owned repo borrows the same shape, that repo
copies these files rather than importing them.

## Bringing the containers up

First-time bring-up only (subsequent deploys are automatic via CI + Watchtower —
`git push origin main` does the whole loop):

```bash
# From infra/local/ on the Jetson, with the COMPOSE_FILE line already in .env
# (see DEPLOY-JETSON.md §"The `.env` on the Jetson"):
docker login ghcr.io   # once, so Watchtower has creds cached for future private images
docker compose pull    # ~1 GB for amc-worker the first time — patience
docker compose up -d --wait server
docker compose up -d amc-worker backup monitor
docker compose logs -f server amc-worker backup monitor
```

The full sequence (Funnel, `.env`, verification, test-restore, adversarial
proxy-trust probe, rollback) lives in
[`infra/local/DEPLOY-JETSON.md`](../../local/DEPLOY-JETSON.md).
