#!/usr/bin/env bash
# #327 — a batch printed "fit to page" is read like one printed at 100 %.
#
# AMC finds a page by its four corner circles, and keeps only the components
# within a tolerance of their printed diameter: ±20 % by default, 34-51 px at
# 300 dpi. A sheet printed scaled to fit comes back smaller, and the circles
# with it. The production incident (2026-10-13): a control printed at 0.87
# linear scale had circles at ~35 px; AMC lost two of the four on three pages,
# read the page id as +0/0/0+ and filed the pages as unrecognised, so three
# copies stayed `incomplete` with their second page in the batch. The worker
# now passes `--tol-marque` (worker.py MARK_TOLERANCE).
#
# The trap is PERFORMED, not read (testing-strategy.md §apps/amc-worker): the
# same scaled batch goes through bare AMC at its default tolerance and must
# place nothing, then through the worker's /analyse and must place every page.
# If an AMC upgrade ever moves the default, the first half says so.
#
# THE SCALE. The batch is shrunk the way a printer driver shrinks it —
# ghostscript scales each page about its centre on a Letter page — and
# rasterised the way a scanner returns it (`pdfimage24`, one image per page at
# 300 dpi). A vector-scaled PDF would not do: `getimages` pulls each embedded
# image out with `pdfimages`, at its native size, and AMC would see the sheet
# unscaled. Synthetic circles are crisper than toner, so the default's cliff
# sits lower than on paper — measured with this pipeline, the default placed
# 4/4 pages at 0.84 and 0/4 at 0.80, and MARK_TOLERANCE 4/4 down to 0.70
# (on real scans the default already lost every page at 0.84). 0.75 is far
# from both edges.

. "$(dirname "$0")/lib.sh"

echo "#327 — reading a batch printed scaled to fit (image: ${IMAGE})"
require_image

PORT="${AMC_WORKER_TEST_PORT_SCALED:-18082}"
NAME="amc-worker-scaled-${PORT}"
SCALE=0.75

work="${WORKER_DIR}/tests/work/scaled"
rm -rf "$work"
mkdir -p "$work/src" "$work/scan"
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

# shrink <in> <out> <factor> — print the batch at <factor> and scan it back.
# Inside the container, where the locale is C: on a host whose locale writes a
# decimal comma, the same arithmetic produces "0,75" and ghostscript a blank
# page (it happened while measuring this WP on the Jetson).
shrink() {
  docker run --rm -v "${work}:/work" "$IMAGE" sh -c '
    set -e
    f=$3
    tx=$(awk -v f="$f" "BEGIN { printf \"%.3f\", (1 - f) * 612 / 2 }")
    ty=$(awk -v f="$f" "BEGIN { printf \"%.3f\", (1 - f) * 792 / 2 }")
    gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfimage24 -r300 -dFIXEDMEDIA \
      -dDEVICEWIDTHPOINTS=612 -dDEVICEHEIGHTPOINTS=792 -o "/work/$2" \
      -c "<</BeginPage {$tx $ty translate $f $f scale}>> setpagedevice" -f "/work/$1"
  ' _ "$1" "$2" "$3" >/dev/null 2>&1
}

# bare_amc <pdf> — "placed failed" for a batch read by AMC alone, at ITS
# default tolerance, against the control's layout. On the container's own
# filesystem: a fresh capture over a macOS bind mount can lose a page to a
# database error (testing-strategy.md), which would read here as a page
# neither placed nor failed.
bare_amc() {
  docker run --rm --env DISPLAY= -v "${work}:/work" "$IMAGE" sh -c '
    set -e
    t=/tmp/bare
    mkdir -p $t/data $t/cr $t/scans
    cp /work/p1/data/layout.sqlite $t/data/
    auto-multiple-choice getimages --list $t/list.txt --vector-density 300 \
      --copy-to $t/scans "/work/$1" >/dev/null 2>&1
    auto-multiple-choice analyse --data $t/data --projet $t --cr $t/cr \
      --liste-fichiers $t/list.txt >/dev/null 2>&1
    python3 -c "
import sqlite3
c = sqlite3.connect(\"$t/data/capture.sqlite\")
print(c.execute(\"SELECT COUNT(*) FROM capture_page\").fetchone()[0],
      c.execute(\"SELECT COUNT(*) FROM capture_failed\").fetchone()[0])
"
  ' _ "$1" 2>/dev/null || echo ""
}

# sql <query> — one value out of p1's capture (a test tool, not production code).
sql() {
  docker run --rm -v "${work}:/work" "$IMAGE" python3 -c '
import sqlite3, sys
rows = sqlite3.connect("/work/p1/data/capture.sqlite").execute(sys.argv[1]).fetchall()
print(rows[0][0] if len(rows) == 1 and len(rows[0]) == 1 else rows)
' "$1" 2>/dev/null || echo ""
}

PLAN='{"1": {"rut": "20123456", "answers": [1, 2, 3, 4]}, "2": {"rut": "19876543", "answers": [2, 1, 1, 1]}}'

gen="$(post /generate '{"project":"p1","source":"src/control-demo.tex","copies":2}')"
check_eq "a two-copy control generates" "2" "$(echo "$gen" | field 'd["copies"]')"
printf '%s\n' "$PLAN" >"$work/plan.json"
check "both copies can be filled as one batch" \
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
  python3 /work/fill_sheet.py --layout /work/p1/data/layout.sqlite \
  --sujet /work/p1/out/sujet.pdf --out /work/scan --plan /work/plan.json \
  --pdf /work/scan/lote.pdf

# --- the trap, performed -------------------------------------------------------
#
# The pipeline first at 1.0, so a broken shrink cannot pass for the trap: a
# blank or unreadable page also places nothing.
check "the batch can be printed at 100 % and scanned back" shrink scan/lote.pdf full.pdf 1.0
check_eq "at 100 %, AMC's default tolerance places all four pages" "4 0" "$(bare_amc full.pdf)"
check "the batch can be printed at ${SCALE} and scanned back" shrink scan/lote.pdf scaled.pdf "$SCALE"
check_eq "at ${SCALE}, AMC's default tolerance places none of them" "0 4" "$(bare_amc scaled.pdf)"

# --- the worker reads it -------------------------------------------------------
docker run --rm -v "${work}:/work" "$IMAGE" sh -c \
  'mkdir -p /work/p1/uploads && cp /work/scaled.pdf /work/p1/uploads/batch-1.pdf'
rep="$(post /analyse '{"project":"p1","scan_pdf":"p1/uploads/batch-1.pdf","source":"src/control-demo.tex"}')"
check_eq "the worker places every page of the scaled batch" \
  "{'captured': 4, 'failed': 0, 'recaptured_copies': []}" "$(echo "$rep" | field 'd["batch"]')"
check_eq "each on the copy and page the layout printed" "{'1': [1, 2], '2': [1, 2]}" \
  "$(echo "$rep" | field 'd["pages_per_copy"]')"
check_eq "and the sheets read as they were marked" "['ok', 'ok']" \
  "$(echo "$rep" | field '[d["copies"][k]["status"] for k in sorted(d["copies"])]')"
check_eq "RUTs included" "['20123456', '19876543']" \
  "$(echo "$rep" | field '[d["copies"][k]["rut"] for k in sorted(d["copies"])]')"
# AMC's own transform says how big it found the page: its determinant is the
# area scale, so a capture of a ${SCALE} sheet sits near ${SCALE}². Without this a
# shrink that silently did nothing would pass every check above but the trap's.
check_eq "AMC measured the sheet at the scale it was printed" "0.56" \
  "$(sql 'SELECT DISTINCT printf("%.2f", a*d - b*c) FROM capture_page')"

summary
