#!/usr/bin/env bash
# #327 — down to which print scale is a sheet still read?
#
# Deliberately NOT named `NN-*.sh`, so `make test` does not run it: this
# measures, it does not assert (testing-strategy.md §apps/amc-worker). The
# assertion at one scale lives in 09-scaled.sh; this reports the whole curve,
# so the day AMC is upgraded or MARK_TOLERANCE moves, the margin can be
# measured again instead of assumed.
#
# Run it with `make measure-scale`. Override the scales with SCALES="1.0 0.8".
#
# For each scale, a synthetic batch is printed at that scale and scanned back
# — the same five ghostscript lines as 09-scaled.sh's shrink(), which asserts
# one point of this curve; an edit to one goes to the other. This copy is the
# one whose drift is found late: it reports and never goes red. Then the
# batch is read by bare AMC at its default tolerance and at the worker's
# MARK_TOLERANCE, read from the image itself. Each page is scored against the
# copy and page the layout printed it as, so a page placed on the WRONG copy
# shows up as `wrong`, not as read. `analyse` exits 0 when it places nothing
# (measured, #327 review), so a non-zero exit is a real failure and stops the
# curve rather than reading as "unrecognised".
#
# What this can and cannot say: synthetic circles are crisper than toner, so
# the curve sits lower than on paper. Measured for #327: the default's cliff
# fell between 0.84 and 0.80 here, and before 0.84 on the Jetson's real scans.
# Read these as an upper bound on how small a real sheet can be.

. "$(dirname "$0")/lib.sh"

SCALES="${SCALES:-1.0 0.95 0.9 0.85 0.8 0.75 0.7 0.65 0.6}"

echo "Measuring the readable print scale (image: ${IMAGE})"
require_image

work="${WORKER_DIR}/tests/work/measure-scale"
rm -rf "$work"
mkdir -p "$work/src"
stage_source "$work/src"
cp "${WORKER_DIR}/tests/tools/fill_sheet.py" "$work/"
printf '%s\n' '{"1": {"rut": "20123456", "answers": [1, 2, 3, 4]}, "2": {"rut": "19876543", "answers": [2, 1, 1, 1]}}' \
  >"$work/plan.json"

# One container for the whole curve. Every capture is on the container's own
# filesystem: a fresh capture over a macOS bind mount can lose a page to a
# database error (testing-strategy.md), which would read as a page neither
# placed nor failed and bend the curve for a reason that is not the scale.
docker run --rm --env DISPLAY= -v "${work}:/work" -w /work "$IMAGE" bash -c '
  set -e
  P=/tmp/project
  mkdir -p $P/data /tmp/out /tmp/scan
  auto-multiple-choice prepare --mode s --n-copies 2 --with pdflatex \
    --data $P/data --prefix $P --out-sujet /tmp/out/sujet.pdf \
    --out-calage /tmp/out/calage.xy /work/src/control-demo.tex >/dev/null 2>&1
  auto-multiple-choice meptex --data $P/data --src /tmp/out/calage.xy >/dev/null 2>&1
  python3 /work/fill_sheet.py --layout $P/data/layout.sqlite --sujet /tmp/out/sujet.pdf \
    --out /tmp/scan --plan /work/plan.json --pdf /tmp/scan/lote.pdf >/dev/null 2>&1
  worker_tol=$(python3 -c "import sys; sys.path.insert(0, sys.argv[1]); import worker; print(worker.MARK_TOLERANCE)" /opt/amc-worker)
  for f in $1; do
    tx=$(awk -v f="$f" "BEGIN { printf \"%.3f\", (1 - f) * 612 / 2 }")
    ty=$(awk -v f="$f" "BEGIN { printf \"%.3f\", (1 - f) * 792 / 2 }")
    gs -q -dBATCH -dNOPAUSE -sDEVICE=pdfimage24 -r300 -dFIXEDMEDIA \
      -dDEVICEWIDTHPOINTS=612 -dDEVICEHEIGHTPOINTS=792 -o /tmp/scaled.pdf \
      -c "<</BeginPage {$tx $ty translate $f $f scale}>> setpagedevice" -f /tmp/scan/lote.pdf
    line="scale $f:"
    for tol in default "$worker_tol"; do
      t=/tmp/read && rm -rf $t && mkdir -p $t/data $t/cr $t/scans
      cp $P/data/layout.sqlite $t/data/
      auto-multiple-choice getimages --list $t/list.txt --vector-density 300 \
        --copy-to $t/scans /tmp/scaled.pdf >/dev/null 2>&1
      flag=""; [ "$tol" = default ] || flag="--tol-marque $tol"
      auto-multiple-choice analyse $flag --data $t/data --projet $t --cr $t/cr \
        --liste-fichiers $t/list.txt >/dev/null 2>&1
      line="$line  $tol → $(python3 - $t <<"PY"
import os, sqlite3, sys
t = sys.argv[1]
lay = sqlite3.connect(os.path.join(t, "data", "layout.sqlite"))
printed = sorted(lay.execute("SELECT student, page FROM layout_page"))
cap = sqlite3.connect(os.path.join(t, "data", "capture.sqlite"))
# The batch was filled copy by copy, page by page, unscrambled: the Nth image
# getimages extracted is the Nth printed page.
images = sorted(open(os.path.join(t, "list.txt")).read().split())
truth = {os.path.basename(i): p for i, p in zip(images, printed)}
placed = {os.path.basename(s): (st, pg) for st, pg, s in
          cap.execute("SELECT student, page, src FROM capture_page")}
right = sum(1 for k, v in placed.items() if truth.get(k) == v)
failed = cap.execute("SELECT COUNT(*) FROM capture_failed").fetchone()[0]
print(f"{right}/{len(printed)} read, {len(placed) - right} wrong, {failed} unrecognised")
PY
)"
    done
    echo "  note $line"
  done
' _ "$SCALES"
