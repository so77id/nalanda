#!/bin/sh
# Health monitor for Nalanda. Polls /health on a schedule, alerts via
# Telegram after N consecutive failures, and posts a REMINDER every COOLDOWN
# seconds until the server recovers (#162).
#
# Shape from DocumentBuddy's scripts/monitor.sh, rewired to the Nalanda
# server URL and the Nalanda bot. Fresh file — never a reference.
set -eu
set -o pipefail 2>/dev/null || true

# The server's HEALTHY signal. `server:8081` (compose service DNS) plus the
# apps/server bind port. NOT the public https URL — the monitor lives on the
# same compose network as the server, and going out to the Funnel just to
# check ourselves would report on Funnel + network + server rather than the
# thing being watched. If Funnel dies but the server is up, Miguel wants to
# know Funnel died, not that "the server" is down.
HEALTH_URL="${HEALTH_URL:-http://server:8081/health}"

CHECK_INTERVAL="${CHECK_INTERVAL:-300}"  # 5 minutes
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"    # alert after 3 consecutive failures
COOLDOWN="${COOLDOWN:-1800}"             # 30 minutes between REPEAT alerts

PREFIX="🧭 Nalanda"

# shellcheck disable=SC1091
. /usr/local/bin/notify.sh

FAIL_COUNT=0
ALERTED=0
LAST_ALERT=0

# One boot message so an operator can see the monitor started at all — the
# most common "there is no alert" cause is not a healthy server, it is a
# monitor that never came up.
notify "🟢 Monitor started (polling ${HEALTH_URL} every ${CHECK_INTERVAL}s; alert after ${FAIL_THRESHOLD} failures; reminders every ${COOLDOWN}s)"

while true; do
  # wget --spider probes without downloading the body. -q keeps stderr
  # clean; -T caps the wait so a hanging server produces a failure rather
  # than a monitor stuck on one poll.
  if wget -q --spider -T 5 "${HEALTH_URL}" 2>/dev/null; then
    if [ "${ALERTED}" -eq 1 ]; then
      notify "✅ Server recovered (${HEALTH_URL})"
      ALERTED=0
    fi
    FAIL_COUNT=0
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))

    # Fire the alert once the threshold is reached, and again every COOLDOWN
    # seconds while the outage continues. The previous shape gated the whole
    # branch on `ALERTED -eq 0`, which made the cooldown variable dead code
    # — a 24-hour outage produced exactly one message, and a silent chat
    # after that message reads as "it probably recovered" on the ops chat
    # (#162 review, COR-3). This version restores the reminder cadence the
    # file header describes.
    if [ "${FAIL_COUNT}" -ge "${FAIL_THRESHOLD}" ]; then
      NOW=$(date +%s)
      ELAPSED=$((NOW - LAST_ALERT))

      if [ "${LAST_ALERT}" -eq 0 ] || [ "${ELAPSED}" -ge "${COOLDOWN}" ]; then
        if [ "${ALERTED}" -eq 0 ]; then
          notify "❌ Server unhealthy (${FAIL_COUNT} consecutive failures on ${HEALTH_URL})"
        else
          # A reminder line so the ops chat can distinguish "outage still on"
          # from "outage forgotten by monitor". Same recipient, different
          # verb, easy to filter on when the outage ends.
          notify "⏳ Still unhealthy (${FAIL_COUNT} consecutive failures on ${HEALTH_URL})"
        fi
        ALERTED=1
        LAST_ALERT=${NOW}
      fi
    fi
  fi

  sleep "${CHECK_INTERVAL}"
done
