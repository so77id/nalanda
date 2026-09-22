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

upload p1 scan-b/lote.pdf 2
rep2="$(analyse p1 2)"
check_eq "the second batch adds copy 2 beside it" "['1', '2']" \
  "$(echo "$rep2" | field 'sorted(d["copies"])')"
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

summary
