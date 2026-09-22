#!/usr/bin/env bash
# #298 — a second scan batch REPLACES what it re-scans instead of breaking the
# project.
#
# The production incident (Control 7, 2026-09-22): a first batch missing one
# page per copy, then the full re-scan. `/analyse` ran AMC in photocopy mode
# (`--multiple`) over ONE cumulative page list, so the second run re-analysed
# the first batch's pages too, AMC refused the mix ("You did not provide the
# same number of copies for all pages") and every later upload failed the same
# way until the project was repaired by hand over ssh.
#
# Driven over the HTTP contract, the way `apps/server` drives it: the batches
# sit under `<project>/uploads/batch-<N>.pdf`, where the server stores them.

. "$(dirname "$0")/lib.sh"

echo "#298 — re-scanning a control (image: ${IMAGE})"
require_image

PORT="${AMC_WORKER_TEST_PORT_RESCAN:-18081}"
NAME="amc-worker-rescan-${PORT}"

work="${WORKER_DIR}/tests/work/rescan"
rm -rf "$work"
mkdir -p "$work/src" "$work/scan-a" "$work/scan-b"
stage_source "$work/src"
cp "${WORKER_DIR}/tests/tools/fill_sheet.py" "$work/"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$NAME" --env DISPLAY= -p "127.0.0.1:${PORT}:8080" \
  -v "${work}:/work" "$IMAGE" >/dev/null

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

post() { # post <path> <json> → the body, whatever the status
  curl -s -X POST -H 'Content-Type: application/json' \
    -d "$2" "http://127.0.0.1:${PORT}$1" 2>/dev/null
}
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo ""; }

# sql <project> <query> — one value (or row list) out of a project's capture.
# A test tool reading AMC's database, not production code, so it travels as an
# argument rather than living in the image.
sql() {
  docker run --rm -v "${work}:/work" "$IMAGE" python3 -c '
import sqlite3, sys
con = sqlite3.connect(f"/work/{sys.argv[1]}/data/capture.sqlite")
rows = con.execute(sys.argv[2]).fetchall()
print(rows[0][0] if len(rows) == 1 and len(rows[0]) == 1 else rows)
' "$1" "$2" 2>/dev/null || echo ""
}

# fill <project> <plan-json> <out-dir> <pdf> [omit] — a synthetic batch.
fill() {
  printf '%s\n' "$2" >"$work/plan.json"
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
    python3 /work/fill_sheet.py --layout "/work/$1/data/layout.sqlite" \
    --sujet "/work/$1/out/sujet.pdf" --out "/work/$3" \
    --plan /work/plan.json --pdf "/work/$4" --omit "${5:-}" >/dev/null 2>&1
}

# upload <project> <pdf> <n> — put a batch where the server stores the Nth one.
upload() {
  mkdir -p "$work/$1/uploads"
  cp "$work/$2" "$work/$1/uploads/batch-$3.pdf"
}

analyse() { # analyse <project> <n>
  post /analyse "{\"project\":\"$1\",\"scan_pdf\":\"$1/uploads/batch-$2.pdf\",\"source\":\"src/control-demo.tex\"}"
}

PLAN_1='{"1": {"rut": "20123456", "answers": [1, 2, 3, 4]}}'
PLAN_2='{"2": {"rut": "19876543", "answers": [2, [1, 2], 1, 1]}}'

# --- S1: each batch is analysed alone ------------------------------------------
#
# `getimages --list` APPENDS to an existing list file (AMC-getimages.pl reads
# it back, adds the new pages first and rewrites it), and `analyse` then reads
# the whole list. One shared `scans/list.txt` therefore made every upload
# re-analyse every page ever uploaded, and a failed analyse left its pages in
# the list for the next upload to inherit. Each batch now gets its own list.

gen="$(post /generate '{"project":"p1","source":"src/control-demo.tex","copies":2}')"
check_eq "a two-copy control generates" "2" "$(echo "$gen" | field 'd["copies"]')"

check "copy 1's sheets can be filled as one batch" fill p1 "$PLAN_1" scan-a scan-a/lote.pdf
check "copy 2's sheets can be filled as another" fill p1 "$PLAN_2" scan-b scan-b/lote.pdf

upload p1 scan-a/lote.pdf 1
rep1="$(analyse p1 1)"
check_eq "the first batch reads copy 1" "['1']" "$(echo "$rep1" | field 'sorted(d["copies"])')"
check_eq "and says what THIS batch did: two pages read, none re-captured" \
  "{'captured': 2, 'failed': 0, 'recaptured_copies': []}" "$(echo "$rep1" | field 'd["batch"]')"

upload p1 scan-b/lote.pdf 2
rep2="$(analyse p1 2)"
check_eq "the second batch adds copy 2 beside it" "['1', '2']" \
  "$(echo "$rep2" | field 'sorted(d["copies"])')"
check_eq "the second batch's own numbers are its own, not the project's" \
  "{'captured': 2, 'failed': 0, 'recaptured_copies': []}" "$(echo "$rep2" | field 'd["batch"]')"
check_eq "and copy 1 still holds exactly its two pages — batch 1 was not re-analysed" "2" \
  "$(sql p1 'SELECT COUNT(*) FROM capture_page WHERE student = 1')"
check_eq "the second batch's page list names only its own two pages" "2" \
  "$(grep -c . "$work/p1/scans/list-batch-2.txt" 2>/dev/null || echo 0)"

# A batch AMC cannot even rasterise fails its analyse — and must not poison the
# next one. Before, getimages had already appended to the shared list by the
# time analyse failed, so the next upload inherited the failure.
printf 'not a pdf\n' >"$work/p1/uploads/batch-3.pdf"
bad="$(analyse p1 3)"
check_contains "a broken batch is refused" "error" "$bad"
cp "$work/scan-a/lote.pdf" "$work/p1/uploads/batch-4.pdf"
rep4="$(analyse p1 4)"
check_eq "and the next good batch still reads" "['1', '2']" \
  "$(echo "$rep4" | field 'sorted(d["copies"])')"

# --- S2: a re-scanned page REPLACES its capture --------------------------------
#
# Photocopy mode (`analyse --multiple`) is "the same printed copy is scanned
# several times": a second scan of a page stacks beside the first (copy=1,
# copy=2) and the reader concatenated both scans' marks — duplicated RUT
# digits, duplicated ticks. Nalanda prints one distinct copy per student, so
# the worker captures in single mode: every page at copy 0, and a page
# captured again is OVERWRITTEN (AMC-analyse.pl, capture_page.overwritten).

gen2="$(post /generate '{"project":"p2","source":"src/control-demo.tex","copies":2}')"
check_eq "a second two-copy control generates" "2" "$(echo "$gen2" | field 'd["copies"]')"
PLAN_BOTH='{"1": {"rut": "20123456", "answers": [1, 2, 3, 4]}, "2": {"rut": "19876543", "answers": [2, [1, 2], 1, 1]}}'
check "both copies can be filled as one batch" fill p2 "$PLAN_BOTH" scan-full scan-full/lote.pdf

upload p2 scan-full/lote.pdf 1
first="$(analyse p2 1)"
upload p2 scan-full/lote.pdf 2
second="$(analyse p2 2)"
check_eq "the first reading has both copies (so the comparison below is not vacuous)" \
  "['1', '2']" "$(echo "$first" | field 'sorted(d["copies"])')"
check_eq "the same batch read twice keeps one capture per page" "4" \
  "$(sql p2 'SELECT COUNT(*) FROM capture_page')"
check_eq "every page of it at copy 0" "0" \
  "$(sql p2 'SELECT DISTINCT copy FROM capture_page')"
check_eq "each page overwritten exactly once" "1" \
  "$(sql p2 'SELECT DISTINCT overwritten FROM capture_page')"
check_eq "and the second reading is the first one, copy for copy" \
  "$(echo "$first" | field 'json.dumps(d["copies"], sort_keys=True)' | cksum)" \
  "$(echo "$second" | field 'json.dumps(d["copies"], sort_keys=True)' | cksum)"
check_eq "with every copy clean" "[]" "$(echo "$second" | field 'd["needs_review"]')"
check_eq "the second read of the same batch re-captured both copies" "[1, 2]" \
  "$(echo "$second" | field 'd["batch"]["recaptured_copies"]')"

# The Control 7 shape: the first batch lost every copy's second page, the
# professor re-scanned the whole pile. Before #298 this aborted with "You did
# not provide the same number of copies for all pages" and stayed stuck.
gen3="$(post /generate '{"project":"p3","source":"src/control-demo.tex","copies":2}')"
check_eq "a third two-copy control generates" "2" "$(echo "$gen3" | field 'd["copies"]')"
check "a batch missing every second page can be filled" \
  fill p3 "$PLAN_BOTH" scan-half scan-half/lote.pdf "1:2,2:2"
check "and the full re-scan" fill p3 "$PLAN_BOTH" scan-all scan-all/lote.pdf

upload p3 scan-half/lote.pdf 1
half="$(analyse p3 1)"
check_eq "the half batch leaves both copies incomplete" "['incomplete', 'incomplete']" \
  "$(echo "$half" | field '[d["copies"][k]["status"] for k in sorted(d["copies"])]')"
upload p3 scan-all/lote.pdf 2
full="$(analyse p3 2)"
check_eq "the full re-scan over it is read" "['ok', 'ok']" \
  "$(echo "$full" | field '[d["copies"][k]["status"] for k in sorted(d["copies"])]')"
check_eq "with every page of every copy" "{'1': [1, 2], '2': [1, 2]}" \
  "$(echo "$full" | field 'd["pages_per_copy"]')"
check_eq "and no RUT read twice" "['20123456', '19876543']" \
  "$(echo "$full" | field '[d["copies"][k]["rut"] for k in sorted(d["copies"])]')"

# A batch that re-scans ONE copy replaces that copy and leaves the other alone.
check "copy 1 alone can be re-filled" fill p3 "$PLAN_1" scan-one scan-one/lote.pdf
upload p3 scan-one/lote.pdf 3
one="$(analyse p3 3)"
check_eq "a batch re-scanning copy 1 alone reports copy 1 alone" "[1]" \
  "$(echo "$one" | field 'd["batch"]["recaptured_copies"]')"
check_eq "re-scanning copy 1 overwrites only copy 1's pages" "[(1, 1, 2), (1, 2, 1), (2, 1, 1), (2, 2, 0)]" \
  "$(sql p3 'SELECT student, page, overwritten FROM capture_page ORDER BY student, page')"

# The review queue's API still lands on the capture: an association injected
# through the wrapper must name the copy index the capture carries, which in
# single mode is 0 — the literal 1 photocopy mode used writes a row nothing
# reads.
inj="$(post /associate/set '{"project":"p3","copy":2,"id":"19123450"}')"
check_eq "an injected association takes effect on a single-mode capture" "19123450" \
  "$(echo "$inj" | field 'd["id"]')"

# --- S3: a batch AMC recognises none of reports it, rather than ending green --
#
# In single mode AMC files a page it cannot place in capture_failed and exits
# 0 — the loud abort lived inside the photocopy block. `batch` carries this
# run's numbers so the server can fail the job (issue #298 §B). Blank pages
# are the unrecognisable page: no marker at all.
docker run --rm -v "${work}:/work" -w /work "$IMAGE" \
  gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sPAPERSIZE=letter -o /work/blank.pdf \
  -c showpage showpage >/dev/null 2>&1
upload p1 blank.pdf 5
blank="$(analyse p1 5)"
check_eq "a batch of blank pages captures nothing and says how many it could not place" \
  "{'captured': 0, 'failed': 2, 'recaptured_copies': []}" "$(echo "$blank" | field 'd["batch"]')"
docker run --rm -v "${work}:/work" -w /work "$IMAGE" \
  gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -o /work/mixed.pdf \
  /work/blank.pdf /work/scan-b/lote.pdf >/dev/null 2>&1
upload p1 mixed.pdf 6
mixed="$(analyse p1 6)"
check_eq "a batch recognised in part reads what it can and counts the rest" \
  "{'captured': 2, 'failed': 2, 'recaptured_copies': [2]}" "$(echo "$mixed" | field 'd["batch"]')"

# --- S4: a re-captured copy loses the corrections made on its old image -------
#
# AMC keys a zone by (student, page, copy, type, id_a, id_b) and re-uses the
# row on a re-capture: black/total move, `manual` stays. The professor's old
# correction would then be applied to a new image. Issue #298 §C: the copy
# comes back as freshly read.
blank_all="$(echo "$full" | field 'json.dumps({"project": "p3", "copy": 1, "overrides": {"answers": [{"question": a["name"], "marked": []} for a in d["copies"]["1"]["answers"]]}})')"
post /annotate/copy "$blank_all" >/dev/null
patched="$(post /reanalyse '{"project":"p3"}')"
check_eq "a correction blanks copy 1 (so the check below is not vacuous)" "True" \
  "$(echo "$patched" | field 'all(a["marked"] == [] for a in d["copies"]["1"]["answers"])')"
upload p3 scan-one/lote.pdf 7
fresh="$(analyse p3 7)"
check_eq "re-scanning copy 1 reads its boxes from the pixels again" "True" \
  "$(echo "$fresh" | field 'all(a["marked"] for a in d["copies"]["1"]["answers"])')"
check_eq "with no manual mark left on it" "0" \
  "$(sql p3 'SELECT COUNT(*) FROM capture_zone WHERE student = 1 AND manual >= 0')"

summary
