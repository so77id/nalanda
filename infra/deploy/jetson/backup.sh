#!/bin/sh
# Backup Nalanda's SQLite database to S3.
# Runs daily via cron inside the `backup` compose service (#162).
#
# Shape copied from DocumentBuddy's scripts/backup.sh, rewired to Nalanda's
# bucket, its IAM user, and its own Telegram bot. NOT a symlink and NOT a
# reference: an edit here must never silently touch DocumentBuddy, and the
# reverse.
#
# Under SQLite's WAL mode, `.backup` is safe against a live server — the API
# holds a shared lock and copies pages, so a professor logging in while this
# runs sees no interruption.

# pipefail is not in POSIX sh but busybox ash (alpine) supports it; without
# it `SIZE=$(du -h "${BACKUP_GZ}" | cut -f1)` would silently keep going if
# `du` failed, and the Telegram line would land as `✅ Backup complete: … ()`
# with no signal that anything was odd (#162 review, COR-4).
set -eu
set -o pipefail 2>/dev/null || true

DB_PATH="/data/nalanda.db"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="/tmp/backup-${TIMESTAMP}.db"
BACKUP_GZ="${BACKUP_FILE}.gz"
S3_KEY="backups/nalanda-${TIMESTAMP}.db.gz"

# The Telegram prefix is a distinctive header, not decoration: Miguel points
# both DocumentBuddy's and Nalanda's bots at the same ops chat, so the eye
# reads "🧭 Nalanda" versus DocumentBuddy's own without parsing the sentence.
PREFIX="🧭 Nalanda"

# notify() is sourced from a shared file so backup.sh and monitor.sh cannot
# drift (#162 review, ARQ-2). Uses PREFIX above.
# shellcheck disable=SC1091
. /usr/local/bin/notify.sh

if [ ! -f "${DB_PATH}" ]; then
  notify "❌ Backup skipped: ${DB_PATH} does not exist. Is the server volume mounted?"
  exit 1
fi

if ! sqlite3 "${DB_PATH}" ".backup ${BACKUP_FILE}"; then
  notify "❌ Backup failed: sqlite3 .backup error on ${DB_PATH}"
  rm -f "${BACKUP_FILE}"
  exit 1
fi

if ! gzip "${BACKUP_FILE}"; then
  notify "❌ Backup failed: gzip error on ${BACKUP_FILE}"
  rm -f "${BACKUP_FILE}" "${BACKUP_GZ}"
  exit 1
fi

SIZE=$(du -h "${BACKUP_GZ}" | cut -f1)

if ! aws s3 cp "${BACKUP_GZ}" "s3://${NALANDA_S3_BUCKET}/${S3_KEY}" --region "${AWS_REGION}"; then
  notify "❌ Backup failed: S3 upload error to s3://${NALANDA_S3_BUCKET}/${S3_KEY}"
  rm -f "${BACKUP_GZ}"
  exit 1
fi

rm -f "${BACKUP_GZ}"

notify "✅ Backup complete: ${S3_KEY} (${SIZE})"
