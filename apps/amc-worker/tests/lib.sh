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

# stage_source <src-dir> — put the control fixture and everything it reads into
# a run's source directory.
#
# The fixture is no longer one file: a question carries its code in a separate
# `.java` that `\lstinputlisting` pulls in at compile time (#147), and a run
# that copied only the `.tex` fails LaTeX outright. Seven callers stage that
# directory — every script here, plus `make paper` — so the copying lives in
# one place rather than seven, and a fixture that grows another asset does not
# have to remember all of them. `make paper` does not source this file — it is a
# bash test harness (`set -euo pipefail`, the check counters, `$IMAGE`) and a
# make recipe has no business pulling that in — so it keeps its own copy of the
# two lines; it is the one to update by hand.
stage_source() {
  mkdir -p "$1/code"
  cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$1/"
  cp -R "${WORKER_DIR}"/tests/fixtures/code/. "$1/code/"
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
