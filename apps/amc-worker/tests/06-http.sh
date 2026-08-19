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
stage_source "$work/src"
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
# Issue #197: the default threshold is 0.15 (X marks measure 0.14-0.32), and
# the SAME value reaches AMC's note — the report says which seuil scored it.
check_eq "the default threshold travels into scoring" "0.15" \
  "$(echo "$rep" | field 'd["scoring"]["seuil"]')"
check_eq "and the reader used the same default" "0.15" \
  "$(echo "$rep" | field 'd["scoring"]["ticked"]')"

# ADR-0037: the server serves review-page images at
# `<work>/controls/<id>/scans/copy-<N>-page-<M>.<ext>`. After /analyse the
# worker links every captured page under that naming so the server does
# not have to know AMC's own batch-<K>.pdf-page-<seq>-<idx> shape. Missing
# in production 2026-08-19 (the review page 404'd on every real scan).
check "copy-1-page-1 symlink exists after /analyse" \
  test -L "${work}/project/scans/copy-1-page-1.png" -o \
       -L "${work}/project/scans/copy-1-page-1.jpg"

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

# The wrapper and AMC run as root; apps/server runs as UID 65532 and rolls a
# failed request back by deleting the whole project. Everything the failed
# request touched must be handed back owned by the caller's UID, or the
# rollback dies on a root-owned file (prod 2026-08-19, issue #193). A fresh
# project makes the check real: project_paths creates its data/ as root
# BEFORE the missing `source` field is even looked at, so a green result
# proves the hand-back ran on the failure path, not on an earlier success.
check_eq "a missing field on a fresh project is a 400" "400" \
  "$(post_status /generate '{"project":"project-fail"}')"
check_eq "a failed request hands the project back to the caller's UID" "65532" \
  "$(docker run --rm -v "${work}:/work" "$IMAGE" stat -c %u /work/project-fail/data)"

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

# --- the copy count the wrapper has to derive ---------------------------------
#
# `prepare --mode b` scores the copies the SOURCE declares in \onecopy{N}, not
# the ones that were printed, so /analyse derives the count from the layout and
# passes --n-copies. Deleting that argument used to leave the WHOLE suite green
# (#147 review, ARQ-9): the only batch reaching /analyse printed exactly as many
# copies as the fixture declares, which is the one case where the flag is a
# no-op. So the trap is performed rather than read off the wrapper
# (testing-strategy.md §apps/amc-worker) — six copies from a source declaring
# five, over the HTTP contract, where losing the flag makes the sixth copy
# unscored and /analyse answer 500.

printf '{"6": {"rut": "19876543", "answers": [1, 1, 1, 1]}}\n' >"$work/plan6.json"

gen6="$(post /generate '{"project":"project6","source":"src/control-demo.tex","copies":6}')"
check_eq "six copies generate from a source that declares five" "6" \
  "$(echo "$gen6" | field 'd["copies"]')"

check "the sixth sheet can be filled" \
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
  python3 /work/fill_sheet.py --layout /work/project6/data/layout.sqlite \
  --sujet /work/project6/out/sujet.pdf --out /work/scan6 \
  --plan /work/plan6.json --pdf /work/scan6/lote.pdf

# `|| true` because this POST is the one expected to FAIL when the guard is
# gone: without it curl's non-zero exit aborts the script under `set -e` and
# the run ends with no FAIL line, leaving whoever hit it to work out why.
rep6="$(post /analyse '{"project":"project6","scan_pdf":"scan6/lote.pdf","source":"src/control-demo.tex"}' || true)"
check_eq "the sixth copy comes back scored, not null" "False" \
  "$(echo "$rep6" | field 'any(a["score"] is None for a in d["copies"]["6"]["answers"])')"
check_eq "and with a real denominator on every question" "False" \
  "$(echo "$rep6" | field 'any(a["max"] is None for a in d["copies"]["6"]["answers"])')"
note "copy 6 over HTTP" \
  "$(echo "$rep6" | field '[(a["name"], a["score"], a["max"]) for a in d["copies"]["6"]["answers"]]')"

# --- issue #197: the threshold travels, not only on paper ---------------------
#
# The same sheets analysed at two thresholds must produce two different
# scorings. ticked=0.9 (above every real mark) blanks everything: the marks
# the reader reports, the scores note computed, and the seuil recorded all
# agree on 0.9 — one number, three consumers.

printf '{"1": {"rut": "20123456", "answers": [1, 1, 1, 1]},\n' >"$work/plan-t.json"
printf ' "2": {"rut": "19876543", "answers": [2, 2, 2, 2]}}\n' >>"$work/plan-t.json"

gen_t="$(post /generate '{"project":"project-t","source":"src/control-demo.tex","copies":2}')"
check_eq "two copies generate for the threshold probe" "2" \
  "$(echo "$gen_t" | field 'd["copies"]')"

check "the threshold-probe sheets can be filled" \
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
  python3 /work/fill_sheet.py --layout /work/project-t/data/layout.sqlite \
  --sujet /work/project-t/out/sujet.pdf --out /work/scan-t \
  --plan /work/plan-t.json --pdf /work/scan-t/lote.pdf

rep_t="$(post /analyse '{"project":"project-t","scan_pdf":"scan-t/lote.pdf","source":"src/control-demo.tex","ticked":0.9,"unsure":0.05}' || true)"
check_eq "the chosen threshold reaches note's --seuil" "0.9" \
  "$(echo "$rep_t" | field 'd["scoring"]["seuil"]')"
check_eq "at 0.9 no box counts as a mark" "True" \
  "$(echo "$rep_t" | field 'all(a["marked"] == [] for a in d["copies"]["1"]["answers"])')"
check_eq "and no question scores a point" "True" \
  "$(echo "$rep_t" | field 'all(a["score"] == 0 for a in d["copies"]["1"]["answers"])')"
check_eq "an inverted band is refused, not silently reordered" "400" \
  "$(post_status /analyse '{"project":"project-t","scan_pdf":"scan-t/lote.pdf","source":"src/control-demo.tex","ticked":0.05,"unsure":0.2}')"

# Issue #197, reanalyse half: re-reading at a new threshold re-runs note at
# it too, so the scores follow the marks and the report can no longer go
# stale through this route.
reread_t="$(post /reanalyse '{"project":"project-t","ticked":0.15,"unsure":0.05}' || true)"
check_eq "reanalyse re-runs note at the new seuil" "0.15" \
  "$(echo "$reread_t" | field 'd["scoring"]["seuil"]')"
check_eq "and the report is no longer stale" "False" \
  "$(echo "$reread_t" | field 'd["scoring"]["stale"]')"
check_eq "the marks come back at the new threshold" "False" \
  "$(echo "$reread_t" | field 'all(a["marked"] == [] for a in d["copies"]["1"]["answers"])')"
check_eq "and the scores follow them" "False" \
  "$(echo "$reread_t" | field 'all(a["score"] == 0 for a in d["copies"]["1"]["answers"])')"

# The other extreme (AC-2's second case): at ticked=0.01 everything counts
# as a mark — the same sheets that were blank at 0.9.
reread_low="$(post /reanalyse '{"project":"project-t","ticked":0.01,"unsure":0}' || true)"
check_eq "at 0.01 every box counts as a mark" "False" \
  "$(echo "$reread_low" | field 'all(a["marked"] == [] for a in d["copies"]["1"]["answers"])')"
check_eq "and the seuil follows" "0.01" \
  "$(echo "$reread_low" | field 'd["scoring"]["seuil"]')"

# --- /annotate/copy — the corrected copy, issue #190 ---------------------------
#
# The worker half of the annotate loop: the server sends the professor's
# overrides, the worker writes them into AMC's own capture (capture_zone.
# manual), recomputes the scores and annotates ONE copy. The PDF is what
# proves the override took effect — a verdict that does not move would mean
# the patch was ignored and annotate drew the original reading.

echo "$rep" >"$work/report.json"

ac="$(post /annotate/copy '{"project":"project","copy":1}' || true)"
check_eq "annotate/copy answers the path to the corrected PDF" "project/annotated/copy-1.pdf" \
  "$(echo "$ac" | field 'd["path"]')"
check "and the corrected PDF exists on the volume" \
  test -s "${work}/project/annotated/copy-1.pdf"

annotated_text() { # annotated_text → the global verdict line of copy-1.pdf
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
    pdftotext -layout -f 1 -l 1 /work/project/annotated/copy-1.pdf - 2>/dev/null \
    | grep -o 'Nota: [^ ]*' || true
}
check_contains "the annotated PDF carries the verdict" "Nota:" "$(annotated_text)"

# Blank every question of copy 1 and annotate again. The verdict must drop
# to zero: annotate draws what `note` scored AFTER the manual patch — if it
# drew the original reading instead, the score would not move.
blank_all="$(python3 -c "
import json
rep = json.load(open('${work}/report.json'))
ans = [{'question': a['name'], 'marked': []} for a in rep['copies']['1']['answers']]
print(json.dumps({'project': 'project', 'copy': 1, 'overrides': {'answers': ans}}))")"
ac2="$(post /annotate/copy "$blank_all" || true)"
check_eq "re-annotating the same copy answers the same path" "project/annotated/copy-1.pdf" \
  "$(echo "$ac2" | field 'd["path"]')"
check_eq "the override moved the score in the PDF" "Nota: 0/4" "$(annotated_text)"
check_eq "and the old PDF was replaced, not orphaned beside a new one" "1" \
  "$(ls "${work}/project/annotated"/*.pdf 2>/dev/null | wc -l | tr -d ' ')"

# Overrides are the WHOLE desired state, not a delta: a reverted correction
# (the server clears its override row and sends nothing) must bring the
# original reading back. Without the capture reset this annotate would
# keep drawing the blanked copy (measured — the reviewer's live probe
# returned Nota: 0/4 here).
ac_revert="$(post /annotate/copy '{"project":"project","copy":1}' || true)"
check_eq "a no-overrides annotate restores the original reading" "Nota: 1/4" \
  "$(annotated_text)"

# Go marshals an empty marked slice as null; the worker must read null as
# a blank override, not as a malformed field (measured: the null body used
# to answer 400 while the save itself had succeeded).
# Issue #197, annotate half: the same capture annotated at two thresholds
# produces two verdicts — the drawn score is what proves ticked reached
# note, not a log line.
ac_high="$(post /annotate/copy '{"project":"project","copy":1,"ticked":0.9}' || true)"
check_eq "annotating at ticked 0.9 blanks every score" "Nota: 0/4" \
  "$(annotated_text)"
ac_restore="$(post /annotate/copy '{"project":"project","copy":1}' || true)"
check_eq "and without ticked the default restores the original verdict" "Nota: 1/4" \
  "$(annotated_text)"

null_blank="$(python3 -c "
import json
rep = json.load(open('${work}/report.json'))
q = rep['copies']['1']['answers'][0]['name']
print(json.dumps({'project': 'project', 'copy': 1,
                  'overrides': {'answers': [{'question': q, 'marked': None}]}}))")"
ac_null="$(post /annotate/copy "$null_blank" || true)"
check_eq "a null marked list is a blank override, not a refusal" "Nota: 0/4" \
  "$(annotated_text)"

# The RUT override: copy 4's grid came back unreadable (1912345_). Typing
# the eight digits must land in AMC's capture, so a re-read agrees with the
# professor — not only with the server's own override table.
ac4="$(post /annotate/copy '{"project":"project","copy":4,"overrides":{"rut":"19123450"}}' || true)"
check_eq "annotate/copy accepts a RUT override" "project/annotated/copy-4.pdf" \
  "$(echo "$ac4" | field 'd["path"]')"

reread="$(post /reanalyse '{"project":"project"}' || true)"
check_eq "a re-read sees the corrected RUT" "19123450" \
  "$(echo "$reread" | field 'd["copies"]["4"]["rut"]')"
check_eq "and reads it as clean" "ok" \
  "$(echo "$reread" | field 'd["copies"]["4"]["rut_status"]')"

# Refusals: a copy that was never captured, an override naming a
# question this copy never captured, and a copy field that is not an
# integer. All three are the caller's mistake and can never succeed on
# retry, so they answer 400.
check_eq "a copy with no capture is refused" "400" \
  "$(post_status /annotate/copy '{"project":"project","copy":99}')"
check_eq "an override naming a question the layout does not have is refused" "400" \
  "$(post_status /annotate/copy '{"project":"project","copy":1,"overrides":{"answers":[{"question":"no-such-question","marked":[]}]}}')"
check_eq "a fractional copy is refused, not truncated" "400" \
  "$(post_status /annotate/copy '{"project":"project","copy":1.9}')"
check_eq "a boolean copy is refused, not coerced" "400" \
  "$(post_status /annotate/copy '{"project":"project","copy":true}')"

note "annotated copy size" "$(du -h "${work}/project/annotated/copy-1.pdf" | cut -f1)"

note "container" "$(docker ps --filter "name=${NAME}" --format '{{.Image}} {{.Status}}')"

summary
