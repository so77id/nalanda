#!/usr/bin/env bash
# #310 S0 — an anonymous, ungraded survey sheet goes through the worker
# UNCHANGED: /generate, a synthetic fill, /analyse, and a report whose
# per-answer statuses are what the survey reader keys on.
#
# This is the spike that gated WP-2, kept as a regression: the day AMC or the
# wrapper stops accepting a sheet with no ID grid and no meaningful correct
# answer, it fails here rather than in a professor's first survey. The fill is
# synthetic (fill_sheet.py), which proves the plumbing and nothing about paper
# — PAPER-CHECK.md is the human half, as for the controls.
#
# The marking plan exercises each status a survey answer can carry:
#   copy 1  one mark per simple question, two on the multi-select → all ok
#   copy 2  two marks on a simple question → ambiguous; a faint mark on the
#           scale → doubtful; the multi-select left blank → blank
#   copy 3  two marks on the scale → ambiguous; every box of the multi-select
#           → ok (a multi-select has no "too many"); the last question blank

. "$(dirname "$0")/lib.sh"

echo "S0 (#310) — an anonymous survey sheet (image: ${IMAGE})"
require_image

PORT="${AMC_WORKER_SURVEY_PORT:-18081}"
NAME="amc-worker-survey-${PORT}"

work="${WORKER_DIR}/tests/work/survey"
rm -rf "$work"
mkdir -p "$work/survey/inputs" "$work/survey/uploads" "$work/fill"
cp "${WORKER_DIR}/tests/fixtures/survey-demo.tex" "$work/survey/inputs/source.tex"
cp "${WORKER_DIR}/tests/fixtures/marking-plan-survey.json" "$work/plan.json"
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

post() { # post <path> <json>
  curl -s -X POST -H 'Content-Type: application/json' \
    -d "$2" "http://127.0.0.1:${PORT}$1" 2>/dev/null
}
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo ""; }

gen="$(post /generate '{"project":"survey","source":"survey/inputs/source.tex","copies":3}')"
check_eq "a sheet with no ID grid and one stand-in correct answer generates" "3" \
  "$(echo "$gen" | field 'd["copies"]')"

fill() {
  docker exec --env DISPLAY= "$NAME" python3 /work/fill_sheet.py \
    --layout /work/survey/data/layout.sqlite --sujet /work/survey/out/sujet.pdf \
    --out /work/fill --plan /work/plan.json \
    --pdf /work/survey/uploads/batch-1.pdf --scramble >/dev/null
}
check "a plan with no RUT fills the sheets" fill

report="${work}/report.json"
post /analyse '{"project":"survey","scan_pdf":"survey/uploads/batch-1.pdf","source":"survey/inputs/source.tex"}' >"$report"
jq() { python3 -c "import json,sys; d=json.load(open('$report')); print($1)" 2>/dev/null || echo ""; }

check_eq "every page is captured" "3" "$(jq 'd["pages"]["captured"]')"
check_eq "the batch reports what it captured" "3" "$(jq 'd["batch"]["captured"]')"

# The answers, by question name, per copy: marked boxes and status.
answer() { # answer <copy> <name> <field>
  jq "[a['$3'] for a in d['copies']['$1']['answers'] if a['name']=='$2'][0]"
}
check_eq "copy 1: one mark on the context question" "[1]" "$(answer 1 q1 marked)"
check_eq "copy 1: two marks on the multi-select are an answer" "ok" "$(answer 1 q3 status)"
check_eq "copy 1: and both are read" "[1, 3]" "$(answer 1 q3 marked)"
check_eq "copy 2: two marks on a simple question are ambiguous" "ambiguous" "$(answer 2 q1 status)"
check_eq "copy 2: a faint mark on the scale is doubtful" "doubtful" "$(answer 2 q2 status)"
check_eq "copy 2: and names the alternative it doubts" "4" \
  "$(jq "[a['doubtful'][0]['answer'] for a in d['copies']['2']['answers'] if a['name']=='q2'][0]")"
check_eq "copy 2: an untouched multi-select is blank" "blank" "$(answer 2 q3 status)"
check_eq "copy 3: two marks on the scale are ambiguous" "ambiguous" "$(answer 3 q2 status)"
check_eq "copy 3: every box of the multi-select is still ok" "ok" "$(answer 3 q3 status)"
check_eq "copy 3: an untouched simple question is blank" "blank" "$(answer 3 q4 status)"

# Authored order holds: [o] keeps every alternative where it was written.
check_eq "the scale's alternatives keep their printed order" "[1, 2, 3, 4, 5]" "$(answer 1 q2 alternatives)"

# The trap the survey reader must step around: with no ID grid AMC reads the
# RUT as unreadable and flags EVERY copy for review. A reader that trusted
# copy status would send a whole class to the review queue.
check_eq "with no ID grid the RUT reads as unreadable" "unreadable" "$(jq 'd["copies"]["1"]["rut_status"]')"
check_eq "and every copy is flagged, clean or not" "3" "$(jq 'len(d["needs_review"])')"

summary
