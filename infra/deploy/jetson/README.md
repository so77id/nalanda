# infra/deploy/jetson

Host-specific production images and off-box provisioning artifacts for the
Jetson deploy of `apps/server` (#162, ADR-0037). The runbook that stitches
these files together lives at
[`../../local/DEPLOY-JETSON.md`](../../local/DEPLOY-JETSON.md) — read it
first if you are here to actually deploy.

The placement rule these files sit under is
[`docs/standards/repository-structure.md`](../../../docs/standards/repository-structure.md)
§Placement criteria — the row "Host-specific production service DEFINITIONS
(backup, monitor)...". Service definitions themselves live in
`infra/local/docker-compose.yml` behind `profiles: [jetson]`; the images
they build from and the scripts they run live here.

## Files

| File | Purpose | Who runs it |
|---|---|---|
| `Dockerfile.backup` + `backup.sh` + `notify.sh` | Daily `sqlite3 .backup` → gzip → S3, with a `🧭 Nalanda` Telegram line on success or failure | `crond` inside the `backup` compose service on the Jetson |
| `Dockerfile.monitor` + `monitor.sh` + `notify.sh` | Poll `http://server:8081/health` every 5 minutes, alert after 3 failures with a 30-minute reminder cadence, post recovery when the server answers again | The `monitor` compose service on the Jetson |
| `notify.sh` | Shared Telegram POST helper; sourced by both scripts so their `notify()` cannot drift (#162 review, ARQ-2) | Sourced, never invoked directly |
| `provision-jetson-iam.sh` | Creates the backups bucket (public-access blocked, SSE-S3, 30-day lifecycle on `backups/`), the `nalanda-jetson` IAM user (least-privilege `PutObject`+`ListBucket`+`GetObject` on that prefix only), and its access key; verifies every safety after applying it (SEC-5) | Miguel, from a laptop with AWS admin credentials, ONCE (or when rotating keys) |
| `nalanda-jetson-user-policy.json` | The inline IAM policy the script substitutes `${NALANDA_S3_BUCKET}` into and attaches to the IAM user | The script; not applied by hand |
| `nalanda-jetson-bucket-lifecycle.json` | The 30-day lifecycle configuration on `backups/`, with 1-day cleanup of noncurrent versions and incomplete multipart uploads | The script |

## Copy the SHAPE, not the file

The three scripts and their two Dockerfiles started as copies of
DocumentBuddy's `scripts/{backup.sh, monitor.sh, provision-jetson-iam.sh,
Dockerfile.backup, Dockerfile.monitor}`. **They are not references and not
symlinks.** An edit here must never silently touch DocumentBuddy, and the
reverse. If a future Miguel-owned repo borrows the same shape, that repo
copies these files rather than importing them.

## Bringing the containers up

```bash
# From infra/local/ on the Jetson, after `git pull`:
docker compose --profile jetson up -d --build backup monitor
docker compose --profile jetson logs -f backup monitor
```

The full sequence (Funnel, `.env`, verification, test-restore, adversarial
proxy-trust probe, rollback) lives in
[`infra/local/DEPLOY-JETSON.md`](../../local/DEPLOY-JETSON.md).
