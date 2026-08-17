#!/bin/sh
# Health monitor for Nalanda. Polls /health on a schedule and alerts via
# Telegram after N consecutive failures, with a cooldown so a long outage
# is one message per cycle rather than one per poll (#162).
#
# Shape from DocumentBuddy's scripts/monitor.sh, rewired to the Nalanda
# server URL and the Nalanda bot. Fresh file — never a reference.
set -eu

# The server's HEALTHY signal. `server:8080` (compose service DNS) plus the
# apps/server bind port. NOT the public https URL — the monitor lives on the
# same compose network as the server, and going out to the Funnel just to
# check ourselves would report on Funnel + network + server rather than the
# thing being watched. If Funnel dies but the server is up, Miguel wants to
# know Funnel died, not that "the server" is down.
HEALTH_URL="${HEALTH_URL:-http://server:8081/health}"

CHECK_INTERVAL="${CHECK_INTERVAL:-300}"  # 5 minutes
FAIL_THRESHOLD="${FAIL_THRESHOLD:-3}"    # alert after 3 consecutive failures
COOLDOWN="${COOLDOWN:-1800}"             # 30 minutes between alerts

PREFIX="🧭 Nalanda"

FAIL_COUNT=0
ALERTED=0
LAST_ALERT=0

notify() {
  # Same reasoning as backup.sh's notify: || true so a Telegram outage does
  # not take the monitor down. The monitor's job is to notice server
  # outages, not Telegram ones.
  if [ -n "${INFRA_TELEGRAM_TOKEN:-}" ] && [ -n "${ALLOWED_CHAT_IDS:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${INFRA_TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="${ALLOWED_CHAT_IDS}" \
      -d text="${PREFIX} $1" > /dev/null 2>&1 || true
  fi
}

# One boot message so an operator can see the monitor started at all — the
# most common "there is no alert" cause is not a healthy server, it is a
# monitor that never came up.
notify "🟢 Monitor started (polling ${HEALTH_URL} every ${CHECK_INTERVAL}s; alert after ${FAIL_THRESHOLD} failures; cooldown ${COOLDOWN}s)"

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

    if [ "${FAIL_COUNT}" -ge "${FAIL_THRESHOLD}" ] && [ "${ALERTED}" -eq 0 ]; then
      NOW=$(date +%s)
      ELAPSED=$((NOW - LAST_ALERT))

      if [ "${LAST_ALERT}" -eq 0 ] || [ "${ELAPSED}" -ge "${COOLDOWN}" ]; then
        notify "❌ Server unhealthy (${FAIL_COUNT} consecutive failures on ${HEALTH_URL})"
        ALERTED=1
        LAST_ALERT=${NOW}
      fi
    fi
  fi

  sleep "${CHECK_INTERVAL}"
done
