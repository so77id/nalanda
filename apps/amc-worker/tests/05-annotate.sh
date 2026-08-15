#!/usr/bin/env bash
# S5 / AC-7 — the annotated PDF, separable per copy.
#
# One file per student is what lets a grade be sent to one student. It is also
# what settles a dispute: the sheet comes back with the student's own marks, the
# correct answer, and the per-question score drawn on it, so "why did I get
# this" is answered by the document rather than by the professor's memory.
#
# The test walks the queue on purpose. It annotates FIRST with copies 4 and 5
# still unassociated — their identifiers could not be read — then injects the
# two associations and annotates again. That is the review queue's whole value
# in two steps.
#
# What the first pass actually does was measured rather than guessed, and it is
# not what one would expect: an unassociated copy still gets a PDF, written with
# the literal placeholder `_ID_` where the student name belongs. So an unworked
# queue does not produce a short batch that something would notice — it produces
# a full-length batch containing sheets addressed to nobody. Counting files is
# not a completeness check; the association table is.

. "$(dirname "$0")/lib.sh"

echo "S5 — annotated PDFs, one per student (image: ${IMAGE})"
require_image

work="${WORKER_DIR}/tests/work/s5run"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/scan" "$work/anotado" "$work/single" \
  "$work/project/data" "$work/project/cr" "$work/project/scans"
cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$work/src/"
cp "${WORKER_DIR}/tests/fixtures/marking-plan.json" "${WORKER_DIR}/tests/fixtures/curso.csv" "$work/"
# Only the test tool goes on the volume. read_capture.py is production
# code and is invoked from where the Dockerfile installed it, so `make
# test` verifies the image rather than the working tree (#138 review, F-10).
cp "${WORKER_DIR}"/tests/tools/*.py "$work/"

run() { docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" "$@"; }

pipeline() {
  run bash -c '
    set -e
    D=/work/project/data
    auto-multiple-choice prepare --mode s --n-copies 5 --with pdflatex --data $D \
      --prefix /work/project --out-sujet /work/out/sujet.pdf \
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
    auto-multiple-choice association-auto --data $D --notes-id rut \
      --liste /work/curso.csv --liste-key rut >/dev/null 2>&1
  '
}

annotate() { # annotate <pdf-dir>
  run auto-multiple-choice annotate \
    --data /work/project/data --project /work/project --cr /work/project/cr \
    --subject /work/out/sujet.pdf --pdf-dir "$1" \
    --names-file /work/curso.csv --association-key rut --csv-build-name "(nombre)" \
    --filename-model "(N)-(ID).pdf" --verdict "%(ID) — Nota: %S/%M"
}

check "the pipeline runs up to automatic association" pipeline

# --- an unworked queue is missing students ------------------------------------

check "annotate runs headless" annotate /work/anotado

count() { ls "$1"/*.pdf 2>/dev/null | wc -l | tr -d ' '; }

# MEASURED, and not what one would guess: an unassociated copy still produces a
# PDF. AMC does not skip it — it writes the file with the literal placeholder
# `_ID_` where the student name belongs.
#
# So COUNTING FILES IS NOT A COMPLETENESS CHECK. Five copies produce five files
# whether or not anyone knows who two of them belong to, and a wrapper that
# mailed "every PDF in this directory" would be sending a sheet addressed to
# nobody. Completeness is the association table's question, never the
# directory's.
check_eq "five files exist even though two copies are unidentified" "5" "$(count "${work}/anotado")"

names="$(ls "${work}/anotado" 2>/dev/null | tr '\n' ' ')"
note "before working the queue" "$names"
check_contains "an identified copy is named for its student" "Ana_Perez_Soto" "$names"

orphans="$(ls "${work}/anotado" 2>/dev/null | grep -c '_ID_' || true)"
check_eq "an unidentified copy is named with a placeholder, not skipped" "2" "$orphans"

for missing in Diego_Vidal_Fuentes Elena_Tapia_Silva; do
  case "$names" in
  *"$missing"*) fail "no named PDF yet for ${missing} (identifier unreadable)" "$names" ;;
  *) pass "no named PDF yet for ${missing} (identifier unreadable)" ;;
  esac
done

# --- working the queue completes the batch ------------------------------------

check "inject copy 4's association" \
  run auto-multiple-choice association --data /work/project/data \
  --set --student 4 --copy 1 --id 19123450
check "inject copy 5's association" \
  run auto-multiple-choice association --data /work/project/data \
  --set --student 5 --copy 1 --id 20111110

# Re-annotating into the SAME directory leaves the placeholder files behind:
# AMC writes, it does not clean. The batch then holds seven files for five
# students — the five real ones plus two orphans naming nobody — and anything
# that walks the directory sends both. Pinned, because the fix is a caller's
# discipline (annotate into a fresh directory) and nothing warns you.
check "annotate again into the same directory" annotate /work/anotado
check_eq "the stale placeholder files are still there — annotate does not clean" \
  "7" "$(count "${work}/anotado")"

mkdir -p "$work/final"
check "annotate into a fresh directory" annotate /work/final
check_eq "every copy now produces exactly one named PDF" "5" "$(count "${work}/final")"
check_eq "and none of them is a placeholder" "0" \
  "$(ls "${work}/final" 2>/dev/null | grep -c '_ID_' || true)"

names="$(ls "${work}/final" 2>/dev/null | tr '\n' ' ')"
note "after working the queue" "$names"
for who in Ana_Perez_Soto Bruno_Contreras_Diaz Carla_Munoz_Rojas Diego_Vidal_Fuentes Elena_Tapia_Silva; do
  check_contains "a PDF for ${who}" "$who" "$names"
done

# --- what the student actually receives ---------------------------------------

ana="$(ls "${work}/final" | grep Ana_Perez_Soto | head -1)"
page="$(run pdftotext -layout -f 1 -l 1 "/work/final/${ana}" - 2>/dev/null || true)"

check_contains "the sheet carries the student's name" "Ana" "$page"
check_contains "and their score" "Nota:" "$page"
# Per-question scores are drawn in the margin — this is what answers "why did I
# get this" without the professor having to remember.
check_contains "and a per-question score in the margin" "1/1" "$page"

check_eq "each student's file is one sheet's worth of pages" "2" \
  "$(run pdfinfo "/work/final/${ana}" 2>/dev/null | awk '/^Pages/ {print $2}')"

# --- separability is a choice, not an accident --------------------------------

# The same command with --single-output produces ONE file for everybody, which
# is the wrong shape for sending a student their own sheet. Pinning both proves
# the per-copy output is chosen rather than merely what AMC happens to do.
check "the same command can also produce a single combined file" \
  run auto-multiple-choice annotate \
  --data /work/project/data --project /work/project --cr /work/project/cr \
  --subject /work/out/sujet.pdf --pdf-dir /work/single \
  --names-file /work/curso.csv --association-key rut --csv-build-name "(nombre)" \
  --single-output todos.pdf --verdict "%(ID) — Nota: %S/%M"

check_eq "and that mode yields exactly one file" "1" \
  "$(ls "${work}/single"/*.pdf 2>/dev/null | wc -l | tr -d ' ')"

note "combined file" "$(ls "${work}/single" 2>/dev/null | tr '\n' ' ')"

summary
