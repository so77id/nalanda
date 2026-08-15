#!/usr/bin/env bash
# S2 / AC-2 — N copies from a .tex we generate, questions and alternatives
# shuffled per copy, each copy carrying a printed identifier and an 8-digit
# RUT grid.
#
# Most assertions read the LAYOUT file (`calage.xy`) rather than the PDF,
# because it names things: a box key is `<copy>/<page>:case:<question-id>:r,c`,
# so which questions a copy drew is a fact the file states, not something
# inferred from extracted text. Text extraction is used only where the layout
# cannot answer — the order alternatives are printed in.
#
# Text extraction is NOT trusted for correctness: pdftotext renders `¿` as `¾`
# and drops the `fi` ligature out of "verificador", both of which are artefacts
# of the T1 font encoding and neither of which is wrong in the PDF (verified by
# rendering page 1 to PNG and looking at it, #138 S2). So the Spanish check
# below asserts a word with no accents and no ligatures.

. "$(dirname "$0")/lib.sh"

echo "S2 — generation (image: ${IMAGE})"
require_image

COPIES=5
DRAW=4 # \insertgroup[4] — four of the ten authored (design C6)

work="${WORKER_DIR}/tests/work/s2"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/project/data"
cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$work/src/"

generate() {
  local outdir="$1"
  docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" \
    auto-multiple-choice prepare \
    --mode s --n-copies "$COPIES" --with pdflatex \
    --data "/work/project/data" --prefix /work/project \
    --out-sujet "/work/${outdir}/sujet.pdf" \
    --out-corrige "/work/${outdir}/corrige.pdf" \
    --out-calage "/work/${outdir}/calage.xy" \
    /work/src/control-demo.tex
}

in_image() { docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" "$@"; }

# --- it compiles --------------------------------------------------------------

check "prepare compiles the source" generate out

for f in sujet.pdf corrige.pdf calage.xy; do
  check "produced ${f}" test -s "${work}/out/${f}"
done

xy="${work}/out/calage.xy"
[ -s "$xy" ] || { fail "layout file is readable" "generation produced nothing"; summary; }

# --- N copies -----------------------------------------------------------------

check_contains "layout records the requested copy count" \
  "ncopies=${COPIES}" "$(grep -o 'ncopies=[0-9]*' "$xy" | head -1)"

# \page{<copy>/<page>/<checksum>} — one entry per printed page.
copies_seen="$(grep -oE '^\\page\{[0-9]+/' "$xy" | grep -oE '[0-9]+' | sort -un | tr '\n' ' ')"
check_eq "five distinct copies in the layout" "1 2 3 4 5" "$(echo $copies_seen)"

# Measured, not assumed: AMC pads every copy to an EVEN page count — with two
# questions the second page still ships, carrying only registration marks.
# Removing \AMCcleardoublepage does not change it. Printed duplex that is one
# physical sheet per student, so it costs no paper; it does mean the scan batch
# has a back side for every sheet, which S4 has to tolerate.
pages_total="$(grep -cE '^\\page\{' "$xy")"
note "pages" "${pages_total} for ${COPIES} copies ($((pages_total / COPIES)) per copy — AMC pads to even)"

# --- the 8-digit RUT grid, no verifier digit (design C5) ----------------------

for col in 1 2 3 4 5 6 7 8; do
  check "copy 1 carries RUT column ${col}" \
    grep -q "case:rut\[${col}\]:" "$xy"
done

check "no ninth RUT column (the verifier digit is not asked for)" \
  test "$(grep -c 'case:rut\[9\]:' "$xy")" -eq 0

digits="$(grep -oE '\\boxchar\{1/[0-9]+:case:rut\[1\]:[0-9]+,[0-9]+\}\{[0-9]\}' "$xy" | grep -oE '\{[0-9]\}$' | tr -d '{}' | sort -u | tr -d '\n')"
check_eq "one RUT column offers all ten digits" "0123456789" "$digits"

# --- each copy draws its own questions ----------------------------------------

drawn() { # drawn <copy> → the question ids that copy printed, sorted
  grep -oE "\{$1/[0-9]+:case:[^:]+:" "$xy" |
    sed 's/.*case://;s/:$//' | grep -v '^rut\[' | sort -u | tr '\n' ' '
}

c1="$(drawn 1)"
c2="$(drawn 2)"
note "copy 1 drew" "$c1"
note "copy 2 drew" "$c2"

check_eq "copy 1 drew ${DRAW} questions" "$DRAW" "$(echo $c1 | wc -w | tr -d ' ')"
check_eq "copy 2 drew ${DRAW} questions" "$DRAW" "$(echo $c2 | wc -w | tr -d ' ')"

if [ "$c1" = "$c2" ]; then
  fail "two copies drew different questions" "both drew: $c1"
else
  pass "two copies drew different questions"
fi

# Every drawn id must be one we authored — a draw that invented a question, or
# silently dropped to a default, would otherwise pass the count check above.
authored="iteraciones requisito lineal tipo-primitivo igualdad arreglo-largo indice referencia descarte peor-caso"
unknown=""
for q in $c1 $c2; do
  case " $authored " in
  *" $q "*) ;;
  *) unknown="$unknown $q" ;;
  esac
done
check_eq "every drawn question is one of the authored ten" "" "$unknown"

# --- alternatives are shuffled per copy ---------------------------------------

# `indice` is drawn by more than one copy in this fixture. Its four
# alternatives are short, accent-free and ligature-free ("0", "1", "-1",
# "Depende del tipo"), which is what makes reading them out of the PDF safe.
order_of() { # order_of <page> → the alternatives of `indice`, in printed order
  # `|| true` on the pipeline: lib.sh runs under `set -e -o pipefail`, so a grep
  # that matches nothing would abort the whole script inside the command
  # substitution instead of producing the empty string the check below reports.
  # Anchor on accent-free text: the stem reads "¿Cuál es el índice del primer
  # elemento…" and pdftotext gives back the accented characters, so matching
  # "indice" finds nothing. "primer elemento" is safe. Take the six lines that
  # follow rather than stopping at a blank line — the stem wraps, so the block
  # is not reliably blank-terminated.
  in_image pdftotext -layout -f "$1" -l "$1" /work/out/sujet.pdf - 2>/dev/null |
    sed -n '/primer elemento/,+6p' | grep -E '^ +(-?[01]|Depende)' |
    sed 's/^ *//;s/ *$//' | tr '\n' '|' || true
}

shared=""
for q in $c1; do
  case " $c2 " in *" $q "*) shared="$q" ;; esac
done

if [ "$shared" = "indice" ]; then
  o1="$(order_of 1)"
  o3="$(order_of 3)" # copy 2's first page
  note "copy 1 alternative order" "$o1"
  note "copy 2 alternative order" "$o3"
  if [ -n "$o1" ] && [ -n "$o3" ] && [ "$o1" != "$o3" ]; then
    pass "the same question prints its alternatives in a different order per copy"
  else
    fail "the same question prints its alternatives in a different order per copy" \
      "copy1='${o1}' copy2='${o3}'"
  fi
else
  # Not a failure of the code — the fixture's draw changed. Say so loudly rather
  # than skipping silently, because a skipped check reads as a passing one.
  fail "fixture still shares 'indice' between copies 1 and 2 (shuffle check needs it)" \
    "shared question was '${shared:-none}'; repoint order_of() or reseed the fixture"
fi

# --- the sheet is Spanish -----------------------------------------------------

# Without lang=ES, AMC labels every question "Question 1" in English on a sheet
# a student reads. Nothing about that makes LaTeX fail, so it shipped past the
# first green run in S2 and is pinned here.
page1="$(in_image pdftotext -layout -f 1 -l 1 /work/out/sujet.pdf - 2>/dev/null)"
check_contains "questions are labelled in Spanish" "Pregunta" "$page1"
case "$page1" in
*"Question "*) fail "no English question labels" "found 'Question' on the sheet" ;;
*) pass "no English question labels" ;;
esac

# --- each copy carries a printed identifier -----------------------------------

check_contains "copy 1 page 1 prints its identifier" "+1/1/" "$page1"

# --- the draw is reproducible -------------------------------------------------

# A fixed \AMCrandomseed must give the same draw every run: without it a failure
# elsewhere could never be told apart from a different draw.
mkdir -p "$work/out2"
check "a second run with the same seed compiles" generate out2
same_seed_c1="$(grep -oE '\{1/[0-9]+:case:[^:]+:' "${work}/out2/calage.xy" 2>/dev/null |
  sed 's/.*case://;s/:$//' | grep -v '^rut\[' | sort -u | tr '\n' ' ')"
check_eq "the same seed draws the same questions" "$c1" "$same_seed_c1"

summary
