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

# --- the reader refuses a project it cannot score ------------------------------
#
# Performed rather than asserted from the wrapper (testing-strategy.md
# §apps/amc-worker): the batch above stops at `analyse`, which is precisely the
# state a caller driving the CLI by hand ends up in. Both halves are checked,
# because the half-done one is the dangerous half — MEASURED, `prepare --mode b`
# alone leaves every scoring table present and `scoring_score` empty, which a
# reader that only looked for the file would report as a batch where nobody
# scored anything.

# Both halves of the refusal are checked: WHAT it says, and that it refuses at
# all. Asserting only the wording was not enough — a reader that printed the
# message on stderr and a well-formed EMPTY report on stdout at exit 0 kept this
# script green (measured with a mutant image, #147 review, F2), and that empty
# report is exactly what the docstring promises never to produce.
reader_error() { run python3 /opt/amc-worker/read_capture.py --data /work/project/data 2>&1 >/dev/null || true; }
reader_out() { run python3 /opt/amc-worker/read_capture.py --data /work/project/data 2>/dev/null || true; }
reader_status() {
  run python3 /opt/amc-worker/read_capture.py --data /work/project/data >/dev/null 2>&1
  echo $?
}

no_db="$(reader_error)"
check_contains 'with no scoring database, the reader says so' \
  'no scoring database' "$no_db"
check_contains 'and names the command that creates it' \
  'prepare --mode b' "$no_db"
check_eq 'and refuses rather than reporting' '2' "$(reader_status)"
check_eq 'writing nothing on stdout, so a caller piping it gets no half report' \
  '' "$(reader_out)"

prepare_scoring() { # prepare_scoring [n-copies] — default 5, the batch's size
  # The count is passed as an ARGUMENT to bash -c, not interpolated into the
  # string: this is the suite that drives a worker whose Python side is
  # forbidden from doing exactly that (python-code-style.md §Subprocess), and
  # the shell has no business setting a worse example (#147 review, SEC-7).
  run bash -c '
    auto-multiple-choice prepare --mode b --with pdflatex \
      --n-copies "$1" \
      --data /work/project/data --prefix /work/project \
      /work/src/control-demo.tex >/dev/null 2>&1
  ' _ "${1:-5}"
}
# TRAP 3 (worker.py): scoring is prepared AFTER capture. The other order leaves
# scoring_code empty and every later association matches nothing.
check "scoring can be prepared once the batch is captured" prepare_scoring

unfilled="$(reader_error)"
check_contains 'with the database prepared but unfilled, the reader says which table is empty' \
  'scoring_score is empty' "$unfilled"
check_contains 'and names the command that fills it' \
  'but `note` did not' "$unfilled"
check_eq 'and refuses here too' '2' "$(reader_status)"
check_eq 'still writing nothing on stdout' '' "$(reader_out)"

note_scoring() {
  run auto-multiple-choice note --data /work/project/data --seuil 0.3
}
check "the batch can be scored" note_scoring

report="${work}/report.json"
# The 0.30/0.10 pins below are deliberate: this file documents the
# historical band that issue #197's defaults replaced, and its fixtures
# (a faint mark at 0.15) were tuned to it. Explicit flags keep the pins
# true whatever the CLI defaults are.
if ! run python3 /opt/amc-worker/read_capture.py --data /work/project/data \
    --ticked 0.30 --unsure 0.10 >"$report" 2>/dev/null; then
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
check_eq "copy 2's marks read back, including two on the multiple-answer one" \
  "[[2], [1, 2], [1], [1]]" "$(jq '[a["marked"] for a in d["copies"]["2"]["answers"]]')"

# --- a question says which kind it is ------------------------------------------
#
# Which alternatives a copy drew is not enough: `comparar-cadenas` admits
# several correct answers and the other three do not, and nothing in the
# capture says so. It comes from AMC's own `scoring_question.type` (1 simple,
# 2 multiple — measured), which is why the reader now needs the scoring
# database at all.
check_eq "each answer says whether its question admits one alternative or several" \
  "['simple', 'multiple', 'simple', 'simple']" \
  "$(jq '[a["type"] for a in d["copies"]["2"]["answers"]]')"
check_eq "and the copy that drew none of them says so too" \
  "['simple', 'simple', 'simple', 'simple']" \
  "$(jq '[a["type"] for a in d["copies"]["1"]["answers"]]')"

# THE defect this WP exists for: two ticks on a multiple-answer question are the
# ANSWER, and the old reader called every second tick an ambiguity — so a
# student who answered correctly was sent to the manual review queue, and the
# professor was handed a sheet that was right.
check_eq "two marks on a multiple-answer question are an answer, not an ambiguity" \
  "ok" "$(jq '[a["status"] for a in d["copies"]["2"]["answers"] if a["type"]=="multiple"][0]')"
check_eq "so the copy that answered it correctly is clean" "ok" \
  "$(jq 'd["copies"]["2"]["status"]')"

# --- AC-5: ambiguity is reported, not resolved --------------------------------

# And the other half of the same rule: on a SIMPLE question a second tick is
# still an ambiguity. Copy 3 ticks two alternatives of `tipo-primitivo`, which
# admits one — the same physical mark that is a correct answer on copy 2's
# multiple.
amb="$(jq '[a["status"] for a in d["copies"]["3"]["answers"]].count("ambiguous")')"
check_eq "copy 3's double mark on a simple question is still ambiguous" "1" "$amb"
check_eq "and it is the simple question that was flagged" "simple" \
  "$(jq '[a["type"] for a in d["copies"]["3"]["answers"] if a["status"]=="ambiguous"][0]')"

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

# --- what each question was worth ---------------------------------------------
#
# #139 decided every question weighs ONE POINT. AMC does not: a simple question
# is worth 1 and a multiple is worth one point per alternative, so a four-choice
# multiple would be four times a simple one, and since every copy draws its own
# questions the same mistake would cost different students different amounts.
#
# The normalisation is the caller's, over numbers AMC publishes:
#     relative = score / max          the fraction of that question's one point
#     grade    = sum(relative)        over the N questions THIS copy drew
# `max` is NOT a constant — 1 for a simple question, the alternative count for a
# multiple — which is why the report carries it per question instead of the
# caller assuming a denominator.

check_eq "a simple question is worth one point" "[1.0, 1.0, 1.0]" \
  "$(jq '[a["max"] for a in d["copies"]["2"]["answers"] if a["type"]=="simple"]')"

check_eq "the multiple-answer question is worth one point per alternative" "4.0" \
  "$(jq '[a["max"] for a in d["copies"]["2"]["answers"] if a["type"]=="multiple"][0]')"

# The three cases the main batch can reach, one per copy that drew it:
mult_score() { jq "[a[\"score\"] for a in d[\"copies\"][\"$1\"][\"answers\"] if a[\"type\"]==\"multiple\"][0]"; }
check_eq "both correct alternatives ticked scores full marks" "4.0" "$(mult_score 2)"
check_eq "one of the two correct ticked, none wrong, scores partial" "3.0" "$(mult_score 3)"
check_eq "only a wrong alternative ticked still scores above zero" "1.0" "$(mult_score 5)"

note "copy 2 grade" \
  "$(jq '"%.2f of %d questions" % (sum(a["score"]/a["max"] for a in d["copies"]["2"]["answers"]), len(d["copies"]["2"]["answers"]))')"

# --- the threshold those scores were computed at ------------------------------
#
# `note` scores at ITS OWN threshold (--seuil), while `--ticked` is ours and
# tunable: PAPER-CHECK.md §4 tells the professor to re-read a stored capture at
# a different sensitivity without re-scanning. In that re-read the marks move
# and the scores do not, so the report would disagree with the grade in
# silence — the exact defect ADR-0031 §Three darkness verdicts exists to forbid
# (#138 F-2). The report publishes both numbers and says when they differ.

check_eq "the report says which threshold AMC scored at" "0.3" \
  "$(jq 'd["scoring"]["seuil"]')"
check_eq "and which one this reading used" "0.3" "$(jq 'd["scoring"]["ticked"]')"
check_eq "and that they agree" "False" "$(jq 'd["scoring"]["stale"]')"

restale="${work}/restale.json"
run python3 /opt/amc-worker/read_capture.py --data /work/project/data --ticked 0.20 \
  >"$restale" 2>/dev/null || true
rjq() { python3 -c "import json; d=json.load(open('$restale')); print($1)" 2>/dev/null || echo ""; }
check_eq "re-reading at another sensitivity marks the scores stale" "True" \
  "$(rjq 'd["scoring"]["stale"]')"
check_eq "and still says which threshold produced them" "0.3" "$(rjq 'd["scoring"]["seuil"]')"

# --- the review queue ---------------------------------------------------------

check_eq "exactly the three damaged copies need review" "['3', '4', '5']" \
  "$(jq 'sorted(d["needs_review"])')"

note "report" "$(jq '"%d copies, %d need review" % (len(d["copies"]), len(d["needs_review"]))')"

# --- a batch scored before it was fully captured -------------------------------
#
# THE defect this WP's review found, and it is reachable from the shipped paper
# check: `prepare --mode b` scores the copies the SOURCE declares in
# \onecopy{N}, not the ones `--mode s --n-copies` printed. With `make paper`'s
# default of six against a fixture declaring five, copy 6 came back with every
# score null, `status: "ok"`, absent from `needs_review`, exit 0 — a report that
# is well formed and wrong, about a real sheet a real student filled in.
#
# Both callers now pass --n-copies, and the reader refuses the state outright:
# the repair is re-running `note`, not a human looking at the sheet, so it is
# NOT a review-queue entry. Performed here by scoring only part of the batch.

check "the batch can be re-scored for fewer copies than were captured" \
  prepare_scoring 3
check "re-scoring leaves those copies unscored" note_scoring

partial="$(reader_error)"
check_contains 'a copy captured but never scored is refused, not reported' \
  'scored before it was fully captured' "$partial"
check_contains 'and the message names the copy' 'copy 4' "$partial"
check_contains 'and the command that repairs it' 'note' "$partial"
check_eq 'with the refusal exit status' '2' "$(reader_status)"

# Put the project back the way the rest of this file expects it.
check "scoring every captured copy again makes the batch readable" prepare_scoring 5
check "and it scores" note_scoring
check_eq "the report is whole again" "5" \
  "$(run python3 /opt/amc-worker/read_capture.py --data /work/project/data 2>/dev/null |
     python3 -c 'import json,sys; print(len(json.load(sys.stdin)["copies"]))' 2>/dev/null || echo "")"

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
    # Scoring AFTER capture, always (worker.py TRAP 3). The reader needs it to
    # know the type of each question and what it was worth, and refuses to
    # read a project without it.
    auto-multiple-choice prepare --mode b --with pdflatex --data $D --n-copies 2 \
      --prefix /work/project /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice note --data $D --seuil 0.3 >/dev/null 2>&1
  '
}

check "a batch with a faint mark and a missing page can be read" damaged_pipeline

drep="${dwork}/report.json"
drun python3 /opt/amc-worker/read_capture.py --data /work/project/data \
    --ticked 0.30 --unsure 0.10 >"$drep" 2>/dev/null || true
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

# --- the two multiple-answer cases the main batch cannot reach ----------------
#
# Copies 2, 3, 4 and 5 draw `comparar-cadenas` under this seed, and the main
# plan spends them on all-correct, partial and one-wrong. The two remaining
# cases matter most for the opposite reasons: ticking EVERY box is the one that
# must not earn full marks (it is the hole the whole design exists to close),
# and a blank multiple must score zero rather than inheriting anything.

mwork="${WORKER_DIR}/tests/work/s3multiple"
rm -rf "$mwork"
mkdir -p "$mwork/src" "$mwork/out" "$mwork/scan" "$mwork/project/data" "$mwork/project/cr" "$mwork/project/scans"
stage_source "$mwork/src"
cp "${WORKER_DIR}/tests/fixtures/marking-plan-multiple.json" "$mwork/plan.json"
cp "${WORKER_DIR}"/tests/tools/*.py "$mwork/"

mrun() { docker run --rm --env DISPLAY= -v "${mwork}:/work" -w /work "$IMAGE" "$@"; }

multiple_pipeline() {
  mrun bash -c '
    set -e
    D=/work/project/data
    auto-multiple-choice prepare --mode s --n-copies 5 --with pdflatex --data $D \
      --prefix /work/project --out-sujet /work/out/sujet.pdf \
      --out-calage /work/out/calage.xy /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice meptex --data $D --src /work/out/calage.xy >/dev/null 2>&1
    python3 /work/fill_sheet.py --layout $D/layout.sqlite --sujet /work/out/sujet.pdf \
      --out /work/scan --plan /work/plan.json --pdf /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice analyse --data $D --projet /work/project \
      --cr /work/project/cr --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
    auto-multiple-choice prepare --mode b --with pdflatex --data $D --n-copies 5 \
      --prefix /work/project /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice note --data $D --seuil 0.3 >/dev/null 2>&1
  '
}

check "a batch marking every box, and one leaving the multiple blank, can be read" \
  multiple_pipeline

mrep="${mwork}/report.json"
mrun python3 /opt/amc-worker/read_capture.py --data /work/project/data >"$mrep" 2>/dev/null || true
mjq() { python3 -c "import json; d=json.load(open('$mrep')); print($1)" 2>/dev/null || echo ""; }

everything="$(mjq '[a for a in d["copies"]["2"]["answers"] if a["type"]=="multiple"][0]')"
note "every box ticked" "$everything"
check_eq "ticking every alternative does NOT earn full marks" "2.0" \
  "$(mjq '[a["score"] for a in d["copies"]["2"]["answers"] if a["type"]=="multiple"][0]')"
check_eq "a blank multiple-answer question scores zero" "0.0" \
  "$(mjq '[a["score"] for a in d["copies"]["3"]["answers"] if a["type"]=="multiple"][0]')"
check_eq "and it is reported blank, not answered" "blank" \
  "$(mjq '[a["status"] for a in d["copies"]["3"]["answers"] if a["type"]=="multiple"][0]')"

# No question may ever subtract from another question's point: the caller sums
# score/max, so a negative score would let one answer eat a different one.
check_eq "no question scores below zero" "True" \
  "$(mjq 'all(a["score"] >= 0 for c in d["copies"].values() for a in c["answers"])')"

# --- a denominator that is not four -------------------------------------------
#
# Every question in the main fixture has four alternatives, so `max` is 4 for
# the multiple and 1 for the simples — numbers a reader could produce by
# hardcoding them and never reading AMC's `max` column at all. That mutant was
# built and it passed all 53 checks (#147 review, F1). The report's promise is
# that `max` IS the alternative count, so one question proves it with three.

twork="${WORKER_DIR}/tests/work/s3tres"
rm -rf "$twork"
mkdir -p "$twork/src" "$twork/out" "$twork/scan" "$twork/project/data" "$twork/project/cr" "$twork/project/scans"
cp "${WORKER_DIR}/tests/fixtures/control-tres.tex" "$twork/src/"
cp "${WORKER_DIR}"/tests/tools/*.py "$twork/"
printf '{"1": {"rut": "20123456", "answers": [[1, 2], 1]}}\n' >"$twork/plan.json"

trun() { docker run --rm --env DISPLAY= -v "${twork}:/work" -w /work "$IMAGE" "$@"; }

tres_pipeline() {
  trun bash -c '
    set -e
    D=/work/project/data
    auto-multiple-choice prepare --mode s --n-copies 1 --with pdflatex --data $D \
      --prefix /work/project --out-sujet /work/out/sujet.pdf \
      --out-calage /work/out/calage.xy /work/src/control-tres.tex >/dev/null 2>&1
    auto-multiple-choice meptex --data $D --src /work/out/calage.xy >/dev/null 2>&1
    python3 /work/fill_sheet.py --layout $D/layout.sqlite --sujet /work/out/sujet.pdf \
      --out /work/scan --plan /work/plan.json --pdf /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice analyse --data $D --projet /work/project \
      --cr /work/project/cr --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
    auto-multiple-choice prepare --mode b --with pdflatex --data $D --n-copies 1 \
      --prefix /work/project /work/src/control-tres.tex >/dev/null 2>&1
    auto-multiple-choice note --data $D --seuil 0.3 >/dev/null 2>&1
  '
}

check "a control whose multiple has three alternatives can be read" tres_pipeline

trep="${twork}/report.json"
trun python3 /opt/amc-worker/read_capture.py --data /work/project/data >"$trep" 2>/dev/null || true
tjq() { python3 -c "import json; d=json.load(open('$trep')); print($1)" 2>/dev/null || echo ""; }

check_eq "a three-alternative multiple is worth three, not four" "3.0" \
  "$(tjq '[a["max"] for a in d["copies"]["1"]["answers"] if a["type"]=="multiple"][0]')"
check_eq "and its simple question, with three alternatives too, is still worth one" "1.0" \
  "$(tjq '[a["max"] for a in d["copies"]["1"]["answers"] if a["type"]=="simple"][0]')"
check_eq "both correct of the two ticked earns the whole three" "3.0" \
  "$(tjq '[a["score"] for a in d["copies"]["1"]["answers"] if a["type"]=="multiple"][0]')"
note "three-alternative question" \
  "$(tjq '[(a["name"], a["score"], a["max"]) for a in d["copies"]["1"]["answers"]]')"

summary
