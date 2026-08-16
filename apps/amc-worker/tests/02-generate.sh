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
DRAW=4 # \insertgroup[4] — four of the twelve authored (design C6)

work="${WORKER_DIR}/tests/work/s2"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/project/data"
stage_source "$work/src"

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
authored="iteraciones requisito lineal tipo-primitivo igualdad arreglo-largo indice referencia descarte peor-caso comparar-cadenas suma-arreglo"
unknown=""
for q in $c1 $c2; do
  case " $authored " in
  *" $q "*) ;;
  *) unknown="$unknown $q" ;;
  esac
done
check_eq "every drawn question is one of the authored twelve" "" "$unknown"

# --- alternatives are shuffled per copy ---------------------------------------

# `arreglo-largo` is drawn by copies 2 and 4 in this fixture, and its four
# alternatives are short, accent-free and ligature-free (`a.length`,
# `a.length()`, `a.size()`, `len(a)`), which is what makes reading them out of
# the PDF safe.
#
# It has been repointed twice by #147 — from `indice`, then from `igualdad` —
# because adding questions to the pool moves the seeded draw, and so does
# `\lastchoices`, which draws from the same random stream. That is exactly why
# the branch below FAILS rather than skipping when the pair stops sharing it: a
# skipped check reads as a passing one, and both repointings were noticed by
# this check going red on purpose.
c4="$(drawn 4)"
note "copy 4 drew" "$c4"

order_of() { # order_of <page> → the alternatives of `arreglo-largo`, in printed order
  # `|| true` on the pipeline: lib.sh runs under `set -e -o pipefail`, so a grep
  # that matches nothing would abort the whole script inside the command
  # substitution instead of producing the empty string the check below reports.
  # Anchor on accent-free text: the stem reads "¿cómo se obtiene la cantidad…"
  # and pdftotext gives the accents back, so "la cantidad de elementos" is what
  # is safe to match. Take the six lines that follow rather than stopping at a
  # blank line — the stem wraps, so the block is not reliably blank-terminated.
  in_image pdftotext -layout -f "$1" -l "$1" /work/out/sujet.pdf - 2>/dev/null |
    sed -n '/cantidad de elementos/,+6p' | grep -E '^ +(a\.|len\()' |
    sed 's/^ *//;s/ *$//' | tr '\n' '|' || true
}

shared=""
for q in $c2; do
  case " $c4 " in *" $q "*) shared="$shared $q" ;; esac
done

case " $shared " in
*" arreglo-largo "*)
  o2="$(order_of 3)" # copy 2's first page
  o4="$(order_of 7)" # copy 4's first page
  note "copy 2 alternative order" "$o2"
  note "copy 4 alternative order" "$o4"
  if [ -n "$o2" ] && [ -n "$o4" ] && [ "$o2" != "$o4" ]; then
    pass "the same question prints its alternatives in a different order per copy"
  else
    fail "the same question prints its alternatives in a different order per copy" \
      "copy2='${o2}' copy4='${o4}'"
  fi
  ;;
*)
  # Not a failure of the code — the fixture's draw changed. Say so loudly rather
  # than skipping silently, because a skipped check reads as a passing one.
  fail "fixture still shares 'arreglo-largo' between copies 2 and 4 (shuffle check needs it)" \
    "shared questions were '${shared:- none}'; repoint order_of() or reseed the fixture"
  ;;
esac

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

# --- the sheet says how many answers each question admits ---------------------
#
# A student meets four questions under a five-minute clock and cannot scroll
# back to learn a convention, so the type is stated per question, in words, for
# BOTH kinds — a symbol would need a legend, and a legend is read once at the
# top and forgotten by question three.
#
# Both strings are accent-free and ligature-free, which is what makes reading
# them out of the PDF safe (see the header of this file).
sheet="$(in_image pdftotext -layout /work/out/sujet.pdf - 2>/dev/null)"
check_contains "a question with one answer says so" "(una respuesta)" "$sheet"
check_contains "a question with several says so too" "(varias respuestas)" "$sheet"

# And the instruction that contradicted them is gone. It read "Marca una sola
# alternativa por pregunta", which stopped being true the moment the pool
# contained a multiple-answer question (#147).
case "$sheet" in
*"una sola alternativa"*)
  fail "the sheet no longer tells everyone to mark a single alternative" \
    "found 'una sola alternativa' on the sheet" ;;
*) pass "the sheet no longer tells everyone to mark a single alternative" ;;
esac

# What replaced it: the instructions, the total, and how the total is reached,
# with THIS sheet's numbers — nobody should have to do a rule of three under a
# clock. WP-E computes them per generated control; the fixture only has to stop
# saying something false.
check_contains "the sheet says how many questions it holds" "4 preguntas" "$sheet"
check_contains "and what they are worth" "4 puntos" "$sheet"
# "equivocarse no" rather than "no descuenta": the sentence wraps between those
# two words on this sheet, and a needle that spans the wrap would fail for a
# reason that has nothing to do with what is printed.
check_contains "and that answering everything is free" "equivocarse no" "$sheet"

# --- an alternative that talks about the others must print after them ---------
#
# "Ninguna de las anteriores" is an ordinary alternative, so it shuffles with
# the rest — and on copy 1 it came out SECOND, above two of the alternatives it
# claims to be talking about. The sheet said something false and nothing here
# could see it; it was found by rendering the page and looking at it. AMC's
# `\lastchoices` pins it, and this check is what keeps it pinned.
#
# Compared against the LAST of the other three alternatives, not against one of
# them: comparing against a single one passes with the catch-all printed third
# of four, which is the same defect one position along. Two of the four copies
# that draw the question are checked — copies 2 and 3, whose pages are 3 and 5 —
# because a single copy could land it last by shuffle and read as a pass.
ninguna_last() { # ninguna_last <page> → "yes" when it prints after ALL the others
  local page="$1" text n_line last_other line
  text="$(in_image pdftotext -layout -f "$page" -l "$page" /work/out/sujet.pdf - 2>/dev/null)"
  n_line="$(printf '%s\n' "$text" | grep -n 'Ninguna de las anteriores' | cut -d: -f1 | head -1)"
  last_other=0
  for other in 'a.equals(b)' 'a.compareTo(b) == 0' 'a == b'; do
    line="$(printf '%s\n' "$text" | grep -nF "$other" | cut -d: -f1 | tail -1)"
    [ -n "$line" ] || { echo "no (alternative '${other}' not found on the page)"; return; }
    [ "$line" -le "$last_other" ] || last_other="$line"
  done
  if [ -n "$n_line" ] && [ "$n_line" -gt "$last_other" ]; then
    echo yes
  else
    echo "no (ninguna at line ${n_line:-none}, last other at ${last_other:-none})"
  fi
}
check_eq "on copy 2 the catch-all alternative prints last" "yes" "$(ninguna_last 3)"
check_eq "and on copy 3 too" "yes" "$(ninguna_last 5)"

# --- a question can carry code, read from its own file ------------------------

# `verbatim` does not compile inside an AMC question, and the first attempt at
# one passed only because the random draw did not pick that question — in
# production the control would have broken on the day it drew it (#147). The
# code arrives through `\lstinputlisting` from a file staged beside the .tex,
# which is also the shape the question bank is built for: code as its own
# field, so nothing has to be escaped.
listing="$(in_image pdftotext -layout /work/out/sujet.pdf - 2>/dev/null)"
check_contains "a question prints the body of its .java file" \
  "suma += a[i];" "$listing"

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
