#!/usr/bin/env bash
# S4 / AC-6 — a RUT→copy association can be injected from OUTSIDE, without the
# GUI. Without this the manual review queue cannot exist: a sheet whose
# identifier could not be read would have no way back into the system except
# AMC's desktop application.
#
# Two mechanisms, and the test covers the seam between them:
#
#   auto    `association-auto` matches the code AMC assembled against a roster
#           CSV. This is what handles the copies that read cleanly.
#   manual  `association --set --student N --id RUT` writes one association.
#           This is the queue's whole API.
#
# Pipeline order matters and is not obvious: `prepare --mode b` (scoring) has to
# run AFTER `analyse`, not before. Run early — before `meptex` and `analyse` —
# `note` afterwards produces an EMPTY scoring_code table and every association
# silently finds nothing to match. Measured in #138 S4; the failure looks
# exactly like "no student matched", which is also what a wrong roster looks
# like, so it is worth knowing which one you have.

. "$(dirname "$0")/lib.sh"

echo "S4 — external association (image: ${IMAGE})"
require_image

work="${WORKER_DIR}/tests/work/s4run"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/scan" "$work/project/data" "$work/project/cr" "$work/project/scans"
cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$work/src/"
cp "${WORKER_DIR}/tests/fixtures/marking-plan.json" "${WORKER_DIR}/tests/fixtures/curso.csv" "$work/"
cp "${WORKER_DIR}"/*.py "${WORKER_DIR}"/tests/tools/*.py "$work/"

run() { docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" "$@"; }

pipeline() {
  run bash -c '
    set -e
    D=/work/project/data
    auto-multiple-choice prepare --mode s --n-copies 5 --with pdflatex \
      --data $D --prefix /work/project --out-sujet /work/out/sujet.pdf \
      --out-calage /work/out/calage.xy /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice meptex --data $D --src /work/out/calage.xy >/dev/null 2>&1
    python3 /work/fill-sheet.py --layout $D/layout.sqlite --sujet /work/out/sujet.pdf \
      --out /work/scan --plan /work/marking-plan.json --pdf /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice getimages --list /work/project/scans/list.txt \
      --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
    auto-multiple-choice analyse --data $D --projet /work/project --cr /work/project/cr \
      --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
    auto-multiple-choice prepare --mode b --with pdflatex --data $D --prefix /work/project \
      /work/src/control-demo.tex >/dev/null 2>&1
    auto-multiple-choice note --data $D --seuil 0.3 >/dev/null 2>&1
  '
}

check "the pipeline runs up to scoring" pipeline

associations() { # → "<copy>:<id>:<auto|manual|none>" per line
  # Keyed on (student, copy), which is how AMC itself keys an association. A row
  # with copy=0 is NOT an association — see the ghost-row check below — so
  # reading only `student` here would report the very bug this test exists to
  # catch as a success.
  run python3 -c "
import sqlite3
c = sqlite3.connect('/work/project/data/association.sqlite')
rows = {(r[0], r[1]): (r[2], r[3])
        for r in c.execute('select student,copy,manual,auto from association_association')}
for s in range(1, 6):
    manual, auto = rows.get((s, 1), (None, None))
    if manual: print('%d:%s:manual' % (s, manual))
    elif auto: print('%d:%s:auto' % (s, auto))
    else: print('%d::none' % s)
" 2>/dev/null
}

# --- automatic association, against the course roster ------------------------

auto_out="$(run auto-multiple-choice association-auto --data /work/project/data \
  --notes-id rut --liste /work/curso.csv --liste-key rut 2>&1 || true)"

after_auto="$(associations)"
note "after association-auto" "$(echo "$after_auto" | tr '\n' ' ')"

check_contains "copy 1 auto-associates to its student" "1:20123456:auto" "$after_auto"
check_contains "copy 2 auto-associates to its student" "2:19876543:auto" "$after_auto"
check_contains "copy 3 auto-associates to its student" "3:20987654:auto" "$after_auto"

# --- a damaged identifier FAILS CLOSED ---------------------------------------

# This is the property the whole design leans on. Copy 4 left a RUT column
# blank; AMC OMITS that column rather than guessing a digit, so the assembled
# code is one character short and matches nobody. Copy 5 marked two digits in
# one column and its code is one character long. Both are refused by name.
#
# Measured, because the alternative would be catastrophic and invisible: if AMC
# padded a blank column with 0 instead of dropping it, a sheet could be
# silently attributed to whichever real student that fabricated RUT belonged
# to. It does not. (A residual remains: a dropped column shortens the code, so
# a 7-digit result could in principle collide with a 7-digit roster entry.
# Student RUTs are 8 digits, and our own reader flags the copy before
# association anyway, which closes it either way.)
check_contains "copy 4's short code is refused rather than guessed" \
  "not found in students list" "$auto_out"
check_contains "copy 4 is left unassociated" "4::none" "$after_auto"
check_contains "copy 5 is left unassociated" "5::none" "$after_auto"

# --- the reading report names exactly the copies that need the queue ---------

report="${work}/report.json"
run python3 /work/read_capture.py --data /work/project/data >"$report" 2>/dev/null || true
queue="$(python3 -c "import json;print(' '.join(sorted(json.load(open('$report'))['needs_review'])))" 2>/dev/null || echo "")"
check_eq "the reading report queues exactly the copies AMC could not associate" "3 4 5" "$queue"

# Copy 3 is in the queue for a different reason — an ambiguous ANSWER, not an
# unreadable identifier — and it associated fine. The two failures are separate
# all the way through, which is what makes the queue's repairs independent.
check_contains "copy 3 needed review yet still associated (the two failures are independent)" \
  "3:20987654:auto" "$after_auto"

# --- manual injection, no GUI ------------------------------------------------

# THE TRAP, pinned first because everything after it depends on avoiding it:
# `--set` without `--copy` exits 0, prints nothing, and writes a row with
# copy=0 that AMC's own listing ignores and that grading never reads. A review
# queue built on that call would look like it worked — the professor types the
# RUT, the tool reports success — and the grade would silently never land.
ghost="$(run auto-multiple-choice association --data /work/project/data \
  --set --student 4 --id 99999999 2>&1 || true)"
check_eq "a --set without --copy says nothing at all" "" "$(echo "$ghost" | tr -d '[:space:]')"
ghost_rows="$(run python3 -c "
import sqlite3
c = sqlite3.connect('/work/project/data/association.sqlite')
print(c.execute('select count(*) from association_association where copy=0').fetchone()[0])
" 2>/dev/null)"
check_eq "yet it wrote a row" "1" "$ghost_rows"
check_contains "and the copy is STILL unassociated (the row is a ghost)" "4::none" "$(associations)"

# The working form names the copy.
check "an association can be injected from outside, naming the copy" \
  run auto-multiple-choice association --data /work/project/data \
  --set --student 4 --copy 1 --id 19123450

check "a second one, for the ambiguous-RUT copy" \
  run auto-multiple-choice association --data /work/project/data \
  --set --student 5 --copy 1 --id 20111110

after_manual="$(associations)"
note "after manual injection" "$(echo "$after_manual" | tr '\n' ' ')"

check_contains "copy 4 is now associated" "4:19123450:manual" "$after_manual"
check_contains "copy 5 is now associated" "5:20111110:manual" "$after_manual"

# A manual association must stay distinguishable from an automatic one: it is a
# human's claim about whose sheet this is, and a later dispute needs to know
# which copies were typed rather than read.
manual_count="$(echo "$after_manual" | grep -c ':manual$' || true)"
check_eq "injected associations are recorded as manual, not laundered into auto" "2" "$manual_count"

none_left="$(echo "$after_manual" | grep -c '::none$' || true)"
check_eq "every copy is associated once the queue is worked" "0" "$none_left"

# --- AMC's own listing agrees --------------------------------------------------

listing="$(run auto-multiple-choice association --data /work/project/data --list 2>&1 || true)"
check_contains "AMC's own listing shows the injected value" "19123450" "$listing"

summary
