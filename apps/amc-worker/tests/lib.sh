#!/usr/bin/env bash
# Shared helpers for the amc-worker verification scripts.
#
# Every test here answers one of the acceptance criteria of #138, and each is
# re-runnable on its own. They are shell scripts rather than a test framework
# because what is under test is a container image and a third-party CLI: the
# subject is `docker run`, and any framework would only wrap it.

set -euo pipefail

IMAGE="${AMC_IMAGE:-nalanda/amc-worker:dev}"
WORKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

_failures=0
_checks=0

pass() {
  _checks=$((_checks + 1))
  printf '  ok   %s\n' "$1"
}

fail() {
  _checks=$((_checks + 1))
  _failures=$((_failures + 1))
  printf '  FAIL %s\n' "$1"
  if [ $# -gt 1 ]; then
    printf '       %s\n' "$2"
  fi
}

# check <description> <command...> — passes when the command exits 0.
check() {
  local what="$1"
  shift
  local out
  if out=$("$@" 2>&1); then
    pass "$what"
  else
    fail "$what" "exit $? — ${out:-(no output)}"
  fi
}

# check_eq <description> <expected> <actual>
check_eq() {
  if [ "$2" = "$3" ]; then
    pass "$1"
  else
    fail "$1" "expected '$2', got '$3'"
  fi
}

# check_contains <description> <needle> <haystack>
check_contains() {
  case "$3" in
  *"$2"*) pass "$1" ;;
  *) fail "$1" "expected to contain '$2', got: $(printf '%.300s' "$3")" ;;
  esac
}

# note <label> <value> — records a measurement. Not an assertion: these are the
# numbers AC-8 asks for, and a measurement that fails a threshold nobody agreed
# is worse than one that is simply reported.
note() {
  printf '  note %s: %s\n' "$1" "$2"
}

image_exists() {
  docker image inspect "$IMAGE" >/dev/null 2>&1
}

require_image() {
  if ! image_exists; then
    fail "image ${IMAGE} exists" "build it first: make -C apps/amc-worker build"
    summary
  fi
}

# amc_run <command...> — run inside the image with no DISPLAY and no TTY, which
# is the whole point: anything that needs the GTK GUI cannot survive this.
amc_run() {
  docker run --rm --env DISPLAY= --workdir /work "$IMAGE" "$@"
}

summary() {
  printf '\n  %d checks, %d failed\n' "$_checks" "$_failures"
  [ "$_failures" -eq 0 ] || exit 1
  exit 0
}
