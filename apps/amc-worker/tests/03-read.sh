#!/usr/bin/env bash
# S3 / AC-3, AC-4, AC-5 — read a scan batch back.
#
#   AC-3  the 8-digit code grid is printed and read back correctly
#   AC-4  the batch arrives as ONE multi-page PDF, pages out of order
#   AC-5  ambiguous marks and unreadable identifiers are reported SEPARATELY
#         and machine-readably, not merged into one "failed"
#
# The batch is filled synthetically — boxes blackened at the coordinates AMC's
# own layout database reports. That proves the plumbing end to end and nothing
# about paper: whether the reader tolerates a real pencil, a real scanner and a
# page that went in slightly rotated is S7's manual cycle, and it is the check
# that actually decides the engine. A green run here is not evidence the thing
# works.
#
# The marking plan is written to exercise the failures on purpose:
#   copy 3  two alternatives ticked on one question   → ambiguous answer
#   copy 4  one RUT column left blank                 → unreadable identifier
#   copy 5  two digits in one RUT column, and one question left blank
#
# Copies 4 and 5 are the case the design calls out: a sheet can be unreadable
# about WHO it belongs to while being perfectly clear about WHAT was marked.
# Typing the RUT is then the whole repair.

. "$(dirname "$0")/lib.sh"

echo "S3 — reading a scan batch (image: ${IMAGE})"
require_image

work="${WORKER_DIR}/tests/work/s3run"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/scan" "$work/project/data" "$work/project/cr" "$work/project/scans"
stage_source "$work/src"
cp "${WORKER_DIR}/tests/fixtures/marking-plan.json" "$work/"
# Only the test tool goes on the volume. read_capture.py is production
# code and is invoked from where the Dockerfile installed it, so `make
# test` verifies the image rather than the working tree (#138 review, F-10).
cp "${WORKER_DIR}"/tests/tools/*.py "$work/"

run() { docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" "$@"; }

pipeline() {
  run bash -c '
    set -e
    auto-multiple-choice prepare --mode s --n-copies 5 --with pdflatex \
      --data /work/project/data --prefix /work/project \
      --out-sujet /work/out/sujet.pdf --out-calage /work/out/calage.xy \
      /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice meptex --data /work/project/data --src /work/out/calage.xy >/dev/null 2>&1
    python3 /work/fill_sheet.py --layout /work/project/data/layout.sqlite \
      --sujet /work/out/sujet.pdf --out /work/scan --plan /work/marking-plan.json \
      --pdf /work/scan/lote.pdf --scramble
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice analyse --data /work/project/data --projet /work/project \
      --cr /work/project/cr --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
  '
}

check "the whole pipeline runs headless" pipeline

report="${work}/report.json"
if ! run python3 /opt/amc-worker/read_capture.py --data /work/project/data >"$report" 2>/dev/null; then
  fail "capture is readable as a report" "read_capture.py failed"
  summary
fi

jq() { python3 -c "import json,sys; d=json.load(open('$report')); print($1)" 2>/dev/null || echo ""; }

# --- AC-4: one multi-page PDF, pages out of order -----------------------------

check_eq "every page of the batch was captured" "10" "$(jq 'd["pages"]["captured"]')"
check_eq "no page failed to be read" "0" "$(jq 'd["pages"]["failed"]')"

# The batch was assembled scrambled (fill_sheet.py --scramble), so capturing all
# ten IS the proof that AMC identifies a page from its printed marker rather than
# its position — no separate assertion is needed, and the bare `pass` that used
# to sit here was a check no defect could turn red (#138 review).

# --- AC-3: the RUT grid reads back --------------------------------------------

check_eq "copy 1 RUT reads back exactly as marked" "20123456" "$(jq 'd["copies"]["1"]["rut"]')"
check_eq "copy 2 RUT reads back exactly as marked" "19876543" "$(jq 'd["copies"]["2"]["rut"]')"
check_eq "copy 3 RUT reads back exactly as marked" "20987654" "$(jq 'd["copies"]["3"]["rut"]')"

check_eq "copy 1 is clean" "ok" "$(jq 'd["copies"]["1"]["status"]')"
check_eq "copy 2 is clean" "ok" "$(jq 'd["copies"]["2"]["status"]')"

# --- AC-3: the answers read back ----------------------------------------------

# The layout's answer index is the AUTHORED order, not the printed one — the
# alternatives are shuffled per copy, so "answer 1" is the first alternative as
# written in the source wherever it ended up on the page. That is the useful
# semantics (a plan can say "the correct one") but it is surprising, so it is
# stated here rather than left to be rediscovered.
check_eq "copy 1 marked one alternative per question" "[[1], [2], [3], [4]]" \
  "$(jq '[a["marked"] for a in d["copies"]["1"]["answers"]]')"
check_eq "copy 2 marked one alternative per question" "[[2], [2], [1], [1]]" \
  "$(jq '[a["marked"] for a in d["copies"]["2"]["answers"]]')"

# --- AC-5: ambiguity is reported, not resolved --------------------------------

amb="$(jq '[a["status"] for a in d["copies"]["3"]["answers"]].count("ambiguous")')"
check_eq "copy 3's double mark is reported as ambiguous" "1" "$amb"

both="$(jq '[a["marked"] for a in d["copies"]["3"]["answers"] if a["status"]=="ambiguous"][0]')"
check_eq "and it names BOTH alternatives rather than picking one" "[1, 2]" "$both"

blank="$(jq '[a["status"] for a in d["copies"]["5"]["answers"]].count("blank")')"
check_eq "copy 5's unanswered question is reported as blank" "1" "$blank"

# A plan can name a SET of alternatives (`[1, 2]` above) or all of them. Both
# forms exist for the multiple-answer cases — partial credit, one wrong, every
# box ticked — which the old plan language could not express at all: it had `n`,
# `0`, `"both"` (the first two boxes, in layout order) and `"faint:n"`.
check_eq "a plan can tick every alternative of a question" "[1, 2, 3, 4]" \
  "$(jq 'd["copies"]["5"]["answers"][0]["marked"]')"

# --- AC-5: an unreadable identifier is a DIFFERENT failure --------------------

check_eq "copy 4's blank RUT column makes the identifier unreadable" "unreadable" \
  "$(jq 'd["copies"]["4"]["rut_status"]')"
check_eq "and the missing column is visible in the reading" "1912345_" \
  "$(jq 'd["copies"]["4"]["rut"]')"

# The repair is typing eight digits: everything else about this sheet is final.
check_eq "copy 4's answers are all clean despite the unreadable RUT" "ok" \
  "$(jq '"ok" if all(a["status"]=="ok" for a in d["copies"]["4"]["answers"]) else "not-ok"')"

check_eq "copy 5's doubled RUT column is reported with both digits" "2011111[01]" \
  "$(jq 'd["copies"]["5"]["rut"]')"

# --- the review queue ---------------------------------------------------------

check_eq "exactly the three damaged copies need review" "['3', '4', '5']" \
  "$(jq 'sorted(d["needs_review"])')"

note "report" "$(jq '"%d copies, %d need review" % (len(d["copies"]), len(d["needs_review"]))')"

# --- the two failures a solid synthetic fill can never produce ----------------

# Both shipped green past the first version of this script and were found in
# review (#138, F-2 and F-3). They get their own batch because reaching them
# needs marks the main plan cannot make: a pencil faint enough to land between
# the thresholds, and a sheet that never reached the scanner at all.

dwork="${WORKER_DIR}/tests/work/s3damaged"
rm -rf "$dwork"
mkdir -p "$dwork/src" "$dwork/out" "$dwork/scan" "$dwork/project/data" "$dwork/project/cr" "$dwork/project/scans"
stage_source "$dwork/src"
cp "${WORKER_DIR}/tests/fixtures/marking-plan-damaged.json" "$dwork/plan.json"
cp "${WORKER_DIR}"/tests/tools/*.py "$dwork/"

drun() { docker run --rm --env DISPLAY= -v "${dwork}:/work" -w /work "$IMAGE" "$@"; }

damaged_pipeline() {
  drun bash -c '
    set -e
    D=/work/project/data
    auto-multiple-choice prepare --mode s --n-copies 2 --with pdflatex --data $D \
      --prefix /work/project --out-sujet /work/out/sujet.pdf \
      --out-calage /work/out/calage.xy /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice meptex --data $D --src /work/out/calage.xy >/dev/null 2>&1
    # Copy 2 page 2 is rendered and filled, then left OUT of the batch: a double
    # feed, or a sheet that stuck to its neighbour.
    python3 /work/fill_sheet.py --layout $D/layout.sqlite --sujet /work/out/sujet.pdf \
      --out /work/scan --plan /work/plan.json --pdf /work/scan/lote.pdf --omit 2:2 >/dev/null 2>&1
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice analyse --data $D --projet /work/project \
      --cr /work/project/cr --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
  '
}

check "a batch with a faint mark and a missing page can be read" damaged_pipeline

drep="${dwork}/report.json"
drun python3 /opt/amc-worker/read_capture.py --data /work/project/data >"$drep" 2>/dev/null || true
djq() { python3 -c "import json,sys; d=json.load(open('$drep')); print($1)" 2>/dev/null || echo ""; }

# F-2: a faint mark must NOT be reported as a confident answer. The earlier code
# appended to the same list in both branches of its if/elif, so a box at 0.15
# read as `marked: [2], status: "ok"` while AMC's own scoring (`--seuil 0.30`)
# treated it as blank — the report and the grade disagreed, in silence.
check_eq "a faint mark is reported as doubtful, not as an answer" "['doubtful']" \
  "$(djq '[a["status"] for a in d["copies"]["1"]["answers"] if a["doubtful"]]')"
check_eq "and it is NOT counted as marked" "[]" \
  "$(djq '[a["marked"] for a in d["copies"]["1"]["answers"] if a["doubtful"]][0]')"
note "faint mark darkness" \
  "$(djq '[a["doubtful"][0]["darkness"] for a in d["copies"]["1"]["answers"] if a["doubtful"]][0]') (ticked 0.30, unsure 0.10)"
check_eq "the copy carrying it needs review" "needs_review" "$(djq 'd["copies"]["1"]["status"]')"

# F-3: a copy whose page never reached the scanner is INCOMPLETE — a third
# failure kind, and the only one not repairable at a keyboard.
check_eq "a copy with a missing page is reported incomplete" "incomplete" \
  "$(djq 'd["copies"]["2"]["status"]')"
check_eq "and it says which questions it never saw" "True" \
  "$(djq 'len(d["copies"]["2"]["missing_questions"]) > 0')"
note "copy 2" \
  "$(djq '"%d of %d questions seen, missing %s" % (d["copies"]["2"]["seen_questions"], d["copies"]["2"]["expected_questions"], d["copies"]["2"]["missing_questions"])')"

# The batch-wide counter cannot see this: the page was never fed, so nothing
# failed to be read. That is precisely why the per-copy check had to exist.
check_eq "while the batch-wide failure counter still reports zero" "0" \
  "$(djq 'd["pages"]["failed"]')"
check_contains "and the incomplete copy is queued for review" "'2'" \
  "$(djq 'sorted(d["needs_review"])')"

summary
