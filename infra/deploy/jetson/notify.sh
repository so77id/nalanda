#!/bin/sh
# Shared Telegram notify — sourced by backup.sh and monitor.sh in this
# directory. Extracted (#162 review, ARQ-2) so the two scripts do not drift
# from each other; both containers still ship independent copies of this
# file, so the DocumentBuddy cross-repo "copy the SHAPE, not the file" rule
# is not touched.
#
# Callers set PREFIX before sourcing so their messages are legible next to
# each other in the ops chat: `🧭 Nalanda` for backups, and the monitor
# uses the same prefix (Miguel points both bots at the same chat).
#
# Usage:
#   . /usr/local/bin/notify.sh
#   notify "some message"
#
# INFRA_TELEGRAM_TOKEN and ALLOWED_CHAT_IDS must be set in the environment;
# absent, the call is a no-op (a missing bot must not fail the operation).

notify() {
  _msg="$1"
  if [ -n "${INFRA_TELEGRAM_TOKEN:-}" ] && [ -n "${ALLOWED_CHAT_IDS:-}" ]; then
    # || true so a Telegram outage never fails the caller. The caller's job
    # is what it is — a lost notification is loud (the daily line stops) but
    # a swallowed operation is silent, and silent is worse.
    curl -s -X POST "https://api.telegram.org/bot${INFRA_TELEGRAM_TOKEN}/sendMessage" \
      -d chat_id="${ALLOWED_CHAT_IDS}" \
      -d text="${PREFIX:-} ${_msg}" > /dev/null 2>&1 || true
  fi
}
