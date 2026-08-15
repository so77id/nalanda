#!/usr/bin/env bash
# AC-8 — how long a real-sized batch takes.
#
# Deliberately NOT named `NN-*.sh`, so `make test` does not run it: this
# measures, it does not assert. A test that reddens because a number moved
# teaches nothing about correctness, and the number that matters here — is
# reading forty sheets three minutes of work or forty — is a decision for a
# human, not a gate.
#
# Run it with `make measure`. Defaults to a real class size; override with
# COPIES=n.
#
# What this can and cannot say: the pages are filled synthetically, so the
# reader is working on clean rectangles at exact coordinates. Real scans are
# noisier and AMC does more work on them, so treat these as a LOWER bound on
# the wall clock, not an estimate of it.

. "$(dirname "$0")/lib.sh"

COPIES="${COPIES:-40}"

echo "Measuring a ${COPIES}-copy batch (image: ${IMAGE})"
require_image

work="${WORKER_DIR}/tests/work/measure"
rm -rf "$work"
mkdir -p "$work/src" "$work/out" "$work/scan" "$work/anotado" \
  "$work/project/data" "$work/project/cr" "$work/project/scans"
cp "${WORKER_DIR}/tests/fixtures/control-demo.tex" "$work/src/"
cp "${WORKER_DIR}/tests/fixtures/curso.csv" "$work/"
# Only the test tool goes on the volume. read_capture.py is production
# code and is invoked from where the Dockerfile installed it, so `make
# test` verifies the image rather than the working tree (#138 review, F-10).
cp "${WORKER_DIR}"/tests/tools/*.py "$work/"

run() { docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" "$@"; }

# A plan for N copies: every RUT distinct, every question answered. The roster
# only holds five students, so most copies will not associate — irrelevant here,
# since what is being timed is generation and reading.
python3 - "$COPIES" >"${work}/plan.json" <<'PY'
import json, sys
n = int(sys.argv[1])
plan = {}
for i in range(1, n + 1):
    plan[str(i)] = {"rut": "20%06d" % i, "answers": [1, 2, 3, 4]}
json.dump(plan, open("/dev/stdout", "w"), indent=1)
PY

stamp() { python3 -c 'import time;print("%.1f"%time.monotonic())'; }
elapsed() { python3 -c "print('%.1f s' % ($2 - $1))"; }

t0="$(stamp)"
run bash -c "
  set -e
  D=/work/project/data
  auto-multiple-choice prepare --mode s --n-copies ${COPIES} --with pdflatex --data \$D \
    --prefix /work/project --out-sujet /work/out/sujet.pdf \
    --out-calage /work/out/calage.xy /work/src/control-demo.tex >/dev/null 2>&1
  auto-multiple-choice meptex --data \$D --src /work/out/calage.xy >/dev/null 2>&1
" || { fail "generation"; summary; }
t1="$(stamp)"
note "generate ${COPIES} copies" "$(elapsed "$t0" "$t1")"

run python3 /work/fill-sheet.py --layout /work/project/data/layout.sqlite \
  --sujet /work/out/sujet.pdf --out /work/scan --plan /work/plan.json \
  --pdf /work/scan/lote.pdf >/dev/null 2>&1 || { fail "synthetic fill"; summary; }
t2="$(stamp)"
note "fill synthetically (not a production step)" "$(elapsed "$t1" "$t2")"

run bash -c '
  set -e
  D=/work/project/data
  auto-multiple-choice getimages --list /work/project/scans/list.txt \
    --vector-density 300 --copy-to /work/project/scans /work/scan/lote.pdf >/dev/null 2>&1
  auto-multiple-choice analyse --data $D --projet /work/project --cr /work/project/cr \
    --multiple --liste-fichiers /work/project/scans/list.txt >/dev/null 2>&1
' || { fail "reading"; summary; }
t3="$(stamp)"

pages="$(run python3 -c "
import sqlite3
print(sqlite3.connect('/work/project/data/capture.sqlite').execute(
    'select count(*) from capture_page').fetchone()[0])" 2>/dev/null | tr -d '\r\n')"

note "READ ${pages} pages" "$(elapsed "$t2" "$t3")"
note "per page" "$(python3 -c "print('%.2f s' % (($t3 - $t2) / max(1, $pages)))")"
note "batch PDF" "$(du -h "${work}/scan/lote.pdf" 2>/dev/null | cut -f1)"
note "image" "$(docker image inspect "$IMAGE" --format '{{.Size}}' |
  awk '{ printf "%.2f GB", $1/1024/1024/1024 }')"
note "host" "$(uname -m), $(docker info --format '{{.NCPU}}' 2>/dev/null) CPUs"

pass "the batch completed"
summary
