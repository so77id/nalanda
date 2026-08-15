#!/usr/bin/env bash
# S6 — the HTTP contract, over the shared volume.
#
# Everything S2–S5 proved by hand, driven the way `apps/server` will drive it:
# JSON in, JSON out, and every payload naming a path under /work rather than
# carrying bytes. A scan batch is forty pages of images; putting that through an
# HTTP body would buy nothing.
#
# The point of this layer is not convenience. It is that three of AMC's
# behaviours are silent traps, each of which yields a system that looks like it
# works and loses a student's grade. The wrapper neutralises them once, and this
# script asserts that it does — by asking it to do the wrong thing and checking
# it refuses.

. "$(dirname "$0")/lib.sh"

echo "S6 — the HTTP contract (image: ${IMAGE})"
require_image

PORT="${AMC_WORKER_TEST_PORT:-18080}"
NAME="amc-worker-test-${PORT}"

work="${WORKER_DIR}/tests/work/s6run"
rm -rf "$work"
mkdir -p "$work/src" "$work/scan" "$work/anotado" "$work/project"
cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$work/src/"
cp "${WORKER_DIR}/tests/fixtures/marking-plan.json" "${WORKER_DIR}/tests/fixtures/curso.csv" "$work/"
cp "${WORKER_DIR}/tests/tools/fill_sheet.py" "$work/"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" --env DISPLAY= -p "127.0.0.1:${PORT}:8080" \
  -v "${work}:/work" "$IMAGE" >/dev/null

# Bound the wait by WALL CLOCK, not by attempt count. An earlier version looped
# 40 times with no delay, which measured 0.36 s in total against a closed port —
# it had not avoided guessing an interval, it had guessed a third of a second
# (#138 review, F-11). CI runs this on a cold runner right after building a 1 GB
# image, which is the worst case for that.
deadline=$(($(date +%s) + 30))
ready=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  if ready="$(curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" 2>/dev/null)"; then break; fi
  ready=""
  sleep 0.25
done

if [ -z "$ready" ]; then
  fail "the worker answers /health" "$(docker logs "$NAME" 2>&1 | tail -5)"
  summary
fi
pass "the worker answers /health"
check_contains "and reports the AMC it wraps" "1.6.0" "$ready"

post() { # post <path> <json>
  curl -sf -X POST -H 'Content-Type: application/json' \
    -d "$2" "http://127.0.0.1:${PORT}$1" 2>/dev/null
}
post_status() { # post_status <path> <json> → HTTP status only
  curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d "$2" "http://127.0.0.1:${PORT}$1" 2>/dev/null
}
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo ""; }

# --- generate -----------------------------------------------------------------

gen="$(post /generate '{"project":"project","source":"src/control-demo.tex","copies":5}')"
check_eq "generate produces five copies" "5" "$(echo "$gen" | field 'd["copies"]')"
check_eq "and names the subject PDF on the volume" "project/out/sujet.pdf" \
  "$(echo "$gen" | field 'd["sujet"]')"
check "the subject PDF is really there" test -s "${work}/project/out/sujet.pdf"

# --- fill synthetically (a test tool, deliberately not a worker route) --------

# Filling sheets is not something production ever does — a real batch comes off
# a scanner — so it stays out of the HTTP contract and runs as its own command
# against the same volume.
check "sheets can be filled for the batch" \
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
  python3 /work/fill_sheet.py --layout /work/project/data/layout.sqlite \
  --sujet /work/project/out/sujet.pdf --out /work/scan \
  --plan /work/marking-plan.json --pdf /work/scan/lote.pdf --scramble

# --- analyse ------------------------------------------------------------------

rep="$(post /analyse '{"project":"project","scan_pdf":"scan/lote.pdf","source":"src/control-demo.tex"}')"
check_eq "analyse captures every page" "10" "$(echo "$rep" | field 'd["pages"]["captured"]')"
check_eq "with none failed" "0" "$(echo "$rep" | field 'd["pages"]["failed"]')"
check_eq "and reads copy 1's RUT back" "20123456" "$(echo "$rep" | field 'd["copies"]["1"]["rut"]')"
check_eq "and queues exactly the damaged copies" "['3', '4', '5']" \
  "$(echo "$rep" | field 'sorted(d["needs_review"])')"

# --- associate ----------------------------------------------------------------

as="$(post /associate '{"project":"project","roster":"curso.csv","code":"rut","key":"rut"}')"
auto_n="$(echo "$as" | field 'len([a for a in d["associations"] if a["source"]=="auto"])')"
check_eq "three copies associate automatically" "3" "$auto_n"
check_eq "and the refused codes are surfaced, not swallowed" "2" \
  "$(echo "$as" | field 'len(d["refused_codes"])')"

# --- TRAP 1: an injected association must actually take effect ----------------

# The wrapper always sends --copy. Without it AMC exits 0, prints nothing, and
# writes a ghost row its own listing ignores — so the assertion that matters is
# not "the call succeeded" but "the association is now readable back".
inj="$(post /associate/set '{"project":"project","copy":4,"id":"19123450"}')"
check_eq "an injected association is echoed back" "19123450" "$(echo "$inj" | field 'd["id"]')"
check_eq "and recorded as manual, not laundered into auto" "manual" \
  "$(echo "$inj" | field 'd["source"]')"

post /associate/set '{"project":"project","copy":5,"id":"20111110"}' >/dev/null
after="$(post /associate '{"project":"project","roster":"curso.csv","code":"rut","key":"rut"}')"
check_eq "every copy is associated once the queue is worked" "5" \
  "$(echo "$after" | field 'len([a for a in d["associations"] if a["id"]])')"
check_eq "and no ghost row is reported as an association" "0" \
  "$(echo "$after" | field 'len([a for a in d["associations"] if not a["id"]])')"

# --- annotate, and TRAP 2 -----------------------------------------------------

ann="$(post /annotate '{"project":"project","roster":"curso.csv","key":"rut","out":"anotado"}')"
check_eq "annotate produces one named PDF per student" "5" \
  "$(echo "$ann" | field 'len(d["pdfs"])')"
check_eq "and none is an unidentified placeholder" "0" \
  "$(echo "$ann" | field 'len(d["unidentified"])')"

# AMC writes but never cleans, so a second run into the same directory would
# leave orphans beside the new files and anything walking the directory would
# send both. The wrapper refuses instead.
check_eq "annotating twice into the same directory is REFUSED" "400" \
  "$(post_status /annotate '{"project":"project","roster":"curso.csv","key":"rut","out":"anotado"}')"

# --- the contract's edges -----------------------------------------------------

check_eq "an unknown route is a 404, not a stack trace" "404" \
  "$(post_status /definitely-not-a-route '{}')"
check_eq "a missing field is a 400" "400" "$(post_status /generate '{"project":"project"}')"
check_eq "a path escaping the volume is refused" "400" \
  "$(post_status /generate '{"project":"../../etc","source":"src/control-demo.tex","copies":1}')"

# A malformed request can never succeed on retry, so it must not answer 500 —
# that tells a machine caller "my fault, try again" about a request that will
# fail identically forever (#138 review, F-7).
check_eq "a non-JSON body is a 400" "400" "$(post_status /generate 'not-json-at-all')"
check_eq "a non-numeric field is a 400" "400" \
  "$(post_status /associate/set '{"project":"project","copy":"cuatro","id":"20123456"}')"
check_eq "a negative Content-Length is refused rather than read to EOF" "400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Length: -1' \
    "http://127.0.0.1:${PORT}/generate" 2>/dev/null || echo 000)"

# --- one client must not be able to wedge the worker --------------------------

# A bare TCP connect that sends NOTHING used to make every other client hang
# until the squatter disconnected: the server was serial, HTTP/1.1 keep-alive
# was on, and the handler had no timeout (#138 review, F-1, reproduced three
# times independently). The fix is ThreadingHTTPServer plus Handler.timeout; the
# check is that a second client still gets an answer while a socket sits idle.
python3 - "$PORT" <<'PY' >"${work}/wedge.txt" 2>&1 || true
import socket, subprocess, sys
port = int(sys.argv[1])
squatter = socket.create_connection(("127.0.0.1", port))
try:
    out = subprocess.run(
        ["curl", "-sf", "--max-time", "8", f"http://127.0.0.1:{port}/health"],
        capture_output=True, text=True,
    )
    print("ANSWERED" if out.returncode == 0 else f"BLOCKED rc={out.returncode}")
finally:
    squatter.close()
PY
check_contains "an idle connection does not wedge the worker" "ANSWERED" "$(cat "${work}/wedge.txt")"

# The dispatcher hands any unrecognised subcommand to the GTK GUI, which dies on
# a missing display. Exercised IN THE IMAGE rather than grepped: the previous
# version searched the host working tree for the error message, so it passed
# with the guard commented out, and it read a different copy of the file than
# the one the container runs (#138 review, F-9). ADR-0030 cites this check as
# proof the trap is neutralised, so it has to be able to fail for that reason.
guard="$(docker run --rm --env DISPLAY= "$IMAGE" python3 -c "
import sys; sys.path.insert(0, '/opt/amc-worker')
import worker
try:
    worker.amc('definitely-not-a-subcommand')
    print('GUARD MISSING')
except worker.Failed as exc:
    print('refused:', exc.message)
" 2>&1 || true)"
check_contains "an unknown subcommand is refused inside the image" "refused:" "$guard"
case "$guard" in
*"cannot open display"* | *"Gtk"*) fail "and never reaches the GUI" "$guard" ;;
*) pass "and never reaches the GUI" ;;
esac

note "container" "$(docker ps --filter "name=${NAME}" --format '{{.Image}} {{.Status}}')"

summary
