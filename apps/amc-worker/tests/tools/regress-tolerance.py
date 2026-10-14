#!/usr/bin/env python3
"""Re-read every captured control at two corner-mark tolerances and report
whether the READ changed — the #327 production regression (ADR-0085).

Not a test: `make test` never runs it. It runs INSIDE the amc-worker container
on the Jetson, over real scans, and it is the gate for any change to
`worker.MARK_TOLERANCE` — the synthetic checks (`09-scaled.sh`,
`make measure-scale`) bound that value from below only.

    cd /opt/nalanda/repo/infra/local
    sudo docker-compose exec -T amc-worker python3 - \\
      < ../../apps/amc-worker/tests/tools/regress-tolerance.py
    # options after `python3 -`:  --old 0.2,0.2  --new 0.35,0.2  --root /work/controls

READ-ONLY. For each project under the root it copies `layout.sqlite` and the
scan images its capture references into a scratch directory under /tmp,
analyses them there at OLD and at NEW, compares, and removes the scratch copy
— also on error. Nothing under the root is written.

PERSONAL DATA. The scans are students' sheets. The script prints project id
prefixes, page and box COUNTS, transform differences and (copy, page) numbers;
never a RUT, a mark, a name or an image. That is also all a report of a run
may record (an issue, a PR, an ADR).

WHAT IT COMPARES, between OLD and NEW, per project:
  placement   every image on the same (copy, page); pages placed under one
              tolerance only. The first version stopped here (#327 review).
  transform   `a`–`f` and `mse` of `capture_page`, per image. Bit-identical
              means every box on the page reads exactly as before.
  boxes       for the images whose transform differs, every answer/RUT box's
              verdict — ticked >= worker.TICKED, doubtful >= worker.UNSURE,
              else blank — the worker's own thresholds, imported.
A placement change, a page lost, or a ticked box changing verdict is what
reopens the value (ADR-0085 §Review triggers).
"""

import argparse
import glob
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

# The worker's own values, from the image this runs in — never copies
# (testing-strategy.md §apps/amc-worker, the artifact rule).
sys.path.insert(0, "/opt/amc-worker")
import worker  # noqa: E402

BOX_ZONE = 4  # capture_zone.type of an answer or code box (read_capture.py)


def verdict(darkness):
    if darkness >= worker.TICKED:
        return "ticked"
    return "doubtful" if darkness >= worker.UNSURE else "blank"


def referenced_images(project):
    """The scan images the production capture points at, by file name."""
    con = sqlite3.connect(f"file:{project}/data/capture.sqlite?mode=ro", uri=True)
    try:
        placed = {os.path.basename(s) for (s,) in con.execute("SELECT src FROM capture_page")}
        failed = {os.path.basename(f) for (f,) in con.execute("SELECT filename FROM capture_failed")}
    finally:
        con.close()
    scans = os.path.join(project, "scans")
    return sorted(n for n in placed | failed if os.path.isfile(os.path.join(scans, n)))


def read(project, images, tolerance, scratch):
    """Analyse the images at one tolerance in a scratch copy; return
    ({image: (copy, page, (a..f), mse)}, {(copy, page, q, box): darkness})."""
    os.makedirs(os.path.join(scratch, "data"))
    os.makedirs(os.path.join(scratch, "cr"))
    os.makedirs(os.path.join(scratch, "scans"))
    shutil.copy(os.path.join(project, "data", "layout.sqlite"), os.path.join(scratch, "data"))
    listing = os.path.join(scratch, "list.txt")
    with open(listing, "w") as fh:
        for name in images:
            shutil.copy(os.path.join(project, "scans", name), os.path.join(scratch, "scans", name))
            fh.write(os.path.join(scratch, "scans", name) + "\n")
    argv = ["auto-multiple-choice", "analyse"]
    if tolerance != "default":
        argv += ["--tol-marque", tolerance]
    argv += ["--data", os.path.join(scratch, "data"), "--projet", scratch,
             "--cr", os.path.join(scratch, "cr"), "--liste-fichiers", listing]
    subprocess.run(argv, capture_output=True, text=True, check=True,
                   env={**os.environ, "DISPLAY": ""}, timeout=worker.AMC_TIMEOUT)
    con = sqlite3.connect(os.path.join(scratch, "data", "capture.sqlite"))
    try:
        pages = {os.path.basename(src): (student, page, (a, b, c, d, e, f), mse)
                 for student, page, src, a, b, c, d, e, f, mse in con.execute(
                     "SELECT student, page, src, a, b, c, d, e, f, mse FROM capture_page")}
        boxes = {(student, page, q, box): (black / total if total else 0.0)
                 for student, page, q, box, black, total in con.execute(
                     "SELECT student, page, id_a, id_b, black, total FROM capture_zone "
                     "WHERE type = ?", (BOX_ZONE,))}
    finally:
        con.close()
    return pages, boxes


def compare(name, old, new):
    (o_pages, o_boxes), (n_pages, n_boxes) = old, new
    both = sorted(set(o_pages) & set(n_pages))
    moved = [i for i in both if o_pages[i][:2] != n_pages[i][:2]]
    only_new = sorted(n_pages[i][:2] for i in set(n_pages) - set(o_pages))
    only_old = sorted(o_pages[i][:2] for i in set(o_pages) - set(n_pages))
    refit = [i for i in both if i not in moved and any(
        abs(x - y) > 1e-6 for x, y in zip(o_pages[i][2], n_pages[i][2]))]
    shift = max((max(abs(o_pages[i][2][4] - n_pages[i][2][4]),
                     abs(o_pages[i][2][5] - n_pages[i][2][5])) for i in refit), default=0.0)
    print(f"{name}: pages old={len(o_pages)} new={len(n_pages)} · same (copy, page) "
          f"{len(both) - len(moved)}/{len(both)}, moved {len(moved)} · only new {only_new} "
          f"· only old {only_old}")
    if not refit:
        print(f"  transforms bit-identical on all {len(both) - len(moved)} shared pages")
        return
    mse_old = [o_pages[i][3] for i in refit]
    mse_new = [n_pages[i][3] for i in refit]
    print(f"  refit {len(refit)} pages: max shift {shift:.2f} px, "
          f"mse old {min(mse_old):.2f}–{max(mse_old):.2f} → new {min(mse_new):.2f}–{max(mse_new):.2f}")
    refit_pages = {o_pages[i][:2] for i in refit}
    keys = [k for k in set(o_boxes) & set(n_boxes) if k[:2] in refit_pages]
    changes = {}
    for k in keys:
        a, b = verdict(o_boxes[k]), verdict(n_boxes[k])
        if a != b:
            changes.setdefault((k[0], k[1], a, b), 0)
            changes[(k[0], k[1], a, b)] += 1
    print(f"  boxes on refit pages: {len(keys)} compared, "
          f"{sum(changes.values())} change verdict")
    for (copy, page, a, b), n in sorted(changes.items()):
        flag = "  <-- a ticked box changed: reopens the value" if "ticked" in (a, b) else ""
        print(f"    copy {copy} page {page}: {a} → {b} ×{n}{flag}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old", default="default",
                    help="tolerance to compare from: 'default' (AMC's own, no flag) or <smaller>,<larger>")
    # getattr: an image deployed before #327 has no MARK_TOLERANCE, and testing
    # a value BEFORE it ships is exactly what this script is for.
    ap.add_argument("--new", default=getattr(worker, "MARK_TOLERANCE", None),
                    help="tolerance to compare to (default: worker.MARK_TOLERANCE in this image)")
    ap.add_argument("--root", default="/work/controls",
                    help="directory whose subdirectories are AMC projects")
    args = ap.parse_args()
    if args.new is None:
        ap.error("this image's worker.py has no MARK_TOLERANCE; pass --new <smaller>,<larger>")
    print(f"old={args.old} new={args.new} root={args.root}")
    for project in sorted(glob.glob(os.path.join(args.root, "*"))):
        if not (os.path.isfile(os.path.join(project, "data", "capture.sqlite"))
                and os.path.isfile(os.path.join(project, "data", "layout.sqlite"))):
            continue
        name = os.path.basename(project)[:4]
        images = referenced_images(project)
        if not images:
            print(f"{name}: no scan images on disk")
            continue
        scratch = tempfile.mkdtemp(prefix="regress-tolerance-", dir="/tmp")
        try:
            old = read(project, images, args.old, os.path.join(scratch, "old"))
            new = read(project, images, args.new, os.path.join(scratch, "new"))
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
        compare(name, old, new)


if __name__ == "__main__":
    main()
