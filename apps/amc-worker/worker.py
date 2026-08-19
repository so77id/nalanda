#!/usr/bin/env python3
"""The amc-worker HTTP contract.

Runs inside the image, serves JSON, and drives Auto-Multiple-Choice's CLI. Work
crosses the SHARED VOLUME, never the wire: every request names paths under
/work, and every response names paths under /work. A scan batch is forty pages
of images and putting that through an HTTP body would buy nothing.

**The route table lives in README.md §How it is driven, not here.** It was
stated in both places and the copy in this docstring had already drifted from
the handlers below within the PR that wrote it — omitting a required field and
naming response keys the code does not return (#138 review, F-13). One home per
fact (docs/standards/documentation.md).

WHY THIS EXISTS AT ALL, given that AMC already has a CLI: three of its
behaviours are silent traps, each measured in #138, each of which produces a
system that looks like it works and loses a student's grade. This module is
where they are neutralised, once, so no caller has to remember them:

1. `association --set` without `--copy` exits 0, prints nothing, and writes a
   row AMC's own listing ignores. `/associate/set` always sends `--copy`.

2. `annotate` writes but never cleans, so re-running into a used directory
   leaves stale files beside the new ones. `/annotate` refuses a directory that
   is not empty.

3. `prepare --mode b` must run AFTER `analyse`. Run before, `note` leaves the
   scoring table empty and every association silently matches nothing — which
   looks exactly like a wrong roster. `/analyse` owns that ordering.

And one more, from the dispatcher itself: `auto-multiple-choice <anything>`
hands an unrecognised subcommand to the GTK GUI, which dies on `cannot open
display`. Subcommands are therefore chosen from a fixed set rather than
interpolated, so a typo is a KeyError here and not a Gtk error in a log.
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import read_capture

WORK = "/work"
DEFAULT_PORT = 8080

# Every AMC subcommand this worker is allowed to invoke. Anything not here
# reaches the GUI and dies on a missing display; see the module docstring.
SUBCOMMANDS = {
    "prepare", "meptex", "getimages", "analyse",
    "note", "association-auto", "association", "annotate",
}

# A JSON body of paths is a few hundred bytes. Anything approaching this is a
# mistake or a client that lost track of its own request.
MAX_BODY = 1 << 20  # 1 MiB

# No AMC call should outlive this. A 40-copy batch reads in under a minute
# measured (ADR-0030 §Measurements); half an hour means something hung, and
# without a bound it would hold a worker thread forever.
AMC_TIMEOUT = 1800

# apps/server runs as this UID (its Dockerfile, `USER 65532:65532`). The
# shared volume is the hand-off point between the two containers: a project
# this wrapper creates as root must go back owned by this UID, or the
# server's rollback cannot delete it. Regression from prod 2026-08-19
# (issue #193): a failed generate left a root-owned data/ behind and the
# server logged "rollback failed … permission denied".
CALLER_UID = 65532

# A capture is only trustworthy if we agree with AMC about which boxes are dark.
# The same two defaults read_capture.py declares — stated here rather than
# derived from each other, because they are independent tunables and PAPER-CHECK
# tells the professor to move one of them alone.
#
# The values are the issue #197 defaults, chosen from a real batch (Jetson,
# 2026-08-19): pencil X marks measured 0.14-0.32 darkness, painted squares
# 0.62-1.00, empty boxes ~0.0 — 0.30 cut straight through the X band. 0.15
# reads every X except the faintest tail, which falls into the doubtful band
# (0.05-0.15) and stays visible in needs_review instead of being lost.
TICKED = 0.15
UNSURE = 0.05

# AMC keeps its state in sqlite files inside the project directory, and nothing
# about `prepare`/`analyse`/`note` is re-entrant over one project. Threading the
# server (so /health answers during a minutes-long /analyse) must not turn into
# two AMC runs racing the same database.
AMC_LOCK = threading.Lock()


class Failed(Exception):
    """An AMC command failed, or a request asked for something impossible."""

    def __init__(self, message, detail=""):
        super().__init__(message)
        self.message = message
        self.detail = detail


def under_work(path, must_exist=False):
    """Resolve a request-supplied path, refusing anything outside /work.

    The caller is our own server, not the internet — but a path from a request
    body is a path from a request body, and a traversal here would let a bug in
    the caller read or overwrite the host's mounted volume from outside the
    project it was working on.
    """
    if not isinstance(path, str) or not path:
        raise Failed("a path is required")
    full = os.path.realpath(os.path.join(WORK, path))
    if full != WORK and not full.startswith(WORK + os.sep):
        raise Failed(f"path escapes {WORK}: {path!r}")
    if must_exist and not os.path.exists(full):
        raise Failed(f"no such path: {path}")
    return full


def amc(subcommand, *args):
    """Run one AMC subcommand, headless, and return its output."""
    if subcommand not in SUBCOMMANDS:
        raise Failed(f"refusing unknown subcommand {subcommand!r}")
    argv = ["auto-multiple-choice", subcommand, *[str(a) for a in args]]
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True,
            env={**os.environ, "DISPLAY": ""}, timeout=AMC_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        raise Failed(f"auto-multiple-choice {subcommand} timed out after {AMC_TIMEOUT}s")
    if proc.returncode != 0:
        raise Failed(
            f"auto-multiple-choice {subcommand} failed ({proc.returncode})",
            (proc.stderr or proc.stdout)[-4000:],
        )
    return proc.stdout + proc.stderr


def project_paths(body):
    project = under_work(body.get("project", ""))
    data = os.path.join(project, "data")
    for d in (data, os.path.join(project, "cr"), os.path.join(project, "scans")):
        os.makedirs(d, exist_ok=True)
    return project, data


def hand_back_project(body):
    """Chown the request's project to the caller's UID, best-effort.

    The wrapper and the AMC tools it drives run as root; apps/server runs
    as CALLER_UID and, after a failed request, removes the whole project
    directory as a rollback. Files this process created as root are then
    undeletable for the server — a failed generate left a root-owned data/
    behind in production (issue #193, 2026-08-19). Every request that names
    a project hands it back owned by the caller, so the rollback always
    works. Best-effort by design: the AMC work already succeeded or already
    failed, and a chown problem must not rewrite that answer.
    """
    if not isinstance(body, dict):
        return
    try:
        project = under_work(body.get("project", ""))
    except Failed:
        return
    try:
        proc = subprocess.run(
            ["chown", "-R", "%d:%d" % (CALLER_UID, CALLER_UID), project],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return
    if proc.returncode != 0:
        sys.stderr.write(
            "amc-worker chown failed for %s: %s\n"
            % (project, (proc.stderr or "").strip()))


# --- handlers ----------------------------------------------------------------

def health(_body):
    # Bounded and checked, like every other call here. Unbounded it would be the
    # thread-that-never-returns the style standard describes, and unchecked it
    # answered `{"ok": true, "amc": ""}` when dpkg-query failed — a health check
    # reporting health it had not established (#138 review round B).
    try:
        proc = subprocess.run(
            ["dpkg-query", "-W", "-f=${Version}", "auto-multiple-choice"],
            capture_output=True, text=True, timeout=10,
        )
    except subprocess.TimeoutExpired:
        raise Failed("dpkg-query timed out")
    if proc.returncode != 0:
        raise Failed("cannot determine the installed AMC version", proc.stderr.strip())
    return {"ok": True, "amc": proc.stdout.strip()}


def generate(body):
    """Compile a .tex into N copies, and load the layout AMC will read by."""
    project, data = project_paths(body)
    source = under_work(body["source"], must_exist=True)
    copies = int(body.get("copies", 0))
    if copies < 1:
        raise Failed("copies must be at least 1")

    out = os.path.join(project, "out")
    os.makedirs(out, exist_ok=True)
    sujet = os.path.join(out, "sujet.pdf")
    corrige = os.path.join(out, "corrige.pdf")
    calage = os.path.join(out, "calage.xy")

    amc("prepare", "--mode", "s", "--n-copies", copies, "--with", "pdflatex",
        "--data", data, "--prefix", project,
        "--out-sujet", sujet, "--out-corrige", corrige, "--out-calage", calage,
        source)
    amc("meptex", "--data", data, "--src", calage)

    return {
        "sujet": os.path.relpath(sujet, WORK),
        "corrige": os.path.relpath(corrige, WORK),
        "calage": os.path.relpath(calage, WORK),
        "copies": copies,
    }


def parse_thresholds(body):
    """Read the optional ticked/unsure pair with the band rule enforced.

    Absent fields fall back to the worker defaults. The band rule is the
    reader's contract: unsure must sit strictly below ticked, or the
    "doubtful" band the review queue relies on inverts. Issue #197: /analyse
    takes the pair too (it used to be reanalyse-only), so the checks live
    here once instead of twice.
    """
    try:
        ticked = float(body.get("ticked", TICKED))
        unsure = float(body.get("unsure", UNSURE))
    except (TypeError, ValueError) as exc:
        # A malformed field is the caller's mistake and can never succeed
        # on retry — 400, not a 500 from the dispatcher's exception net.
        raise Failed("ticked and unsure must be numbers", str(exc))
    if not 0 < ticked < 1:
        raise Failed(f"ticked must be in (0, 1), got {ticked}")
    if not 0 <= unsure < ticked:
        raise Failed(f"unsure must be in [0, ticked), got {unsure} vs ticked {ticked}")
    return ticked, unsure


def analyse(body):
    """Read a scan batch and score it, in the one order that works.

    Optional `ticked`/`unsure` (issue #197): the darkness verdicts AND
    AMC's `note` run at the same `ticked`, so the report's marks, scores
    and any downstream annotated PDF agree on one threshold.
    """
    project, data = project_paths(body)
    scan_pdf = under_work(body["scan_pdf"], must_exist=True)
    source = under_work(body["source"], must_exist=True)
    ticked, unsure = parse_thresholds(body)

    scans = os.path.join(project, "scans")
    listing = os.path.join(scans, "list.txt")

    amc("getimages", "--list", listing, "--vector-density", "300",
        "--copy-to", scans, scan_pdf)
    amc("analyse", "--data", data, "--projet", project,
        "--cr", os.path.join(project, "cr"), "--multiple",
        "--liste-fichiers", listing)

    # TRAP 3: scoring AFTER capture. The other order leaves scoring_code empty
    # and every association then matches nothing, indistinguishably from a
    # wrong roster.
    # --n-copies, or AMC scores only the copies the SOURCE declares in
    # \onecopy{N} while --mode s printed as many as the caller asked for. The
    # difference is silent and it grades: the copies above the source's default
    # are captured, never scored, and every question on them comes back
    # unscored (#147 review, F3).
    amc("prepare", "--mode", "b", "--with", "pdflatex",
        "--n-copies", read_capture.printed_copies(data),
        "--data", data, "--prefix", project, source)
    # Same threshold the reader will use: marks, scores and (later) the
    # annotated PDF all agree — scoring.stale cannot come from this route.
    amc("note", "--data", data, "--seuil", str(ticked))

    # ADR-0037: the server serves review-page images at
    # `<work>/controls/<id>/scans/copy-<N>-page-<M>.<ext>`. AMC's `getimages`
    # names its outputs `batch-<K>.pdf-page-<seq>-<idx>.<ext>` and only
    # `capture_page` knows which batch file is which physical (copy, page).
    # Create symlinks under the contract's naming beside the originals so
    # the server finds them and AMC's own downstream tools (annotate,
    # re-analyse) still resolve their capture.sqlite src references.
    # Reported in production 2026-08-19 when the review page returned 404
    # on every scanned copy of Miguel's first real batch.
    link_scans_to_contract_names(data, os.path.join(project, "scans"))

    return read_capture.read(data, ticked, unsure)


def scan_link_targets(rows):
    """Compute the (source_basename, link_basename) pairs to symlink into the
    scans directory. Pure — takes the capture_page rows and returns what
    caller should link. Extension follows what AMC actually produced (`.jpg`
    for raster scans, `.png` for vector).

    >>> scan_link_targets([(1, 1, "%PROJET/scans/batch-1.pdf-page-014-013.jpg")])
    [('batch-1.pdf-page-014-013.jpg', 'copy-1-page-1.jpg')]
    >>> scan_link_targets([(6, 2, "batch-1.pdf-page-018-017.png")])
    [('batch-1.pdf-page-018-017.png', 'copy-6-page-2.png')]
    """
    out = []
    for student, page, src in rows:
        original = os.path.basename(src)
        ext = os.path.splitext(original)[1]
        out.append((original, f"copy-{student}-page-{page}{ext}"))
    return out


def link_scans_to_contract_names(data, scans):
    """Symlink `copy-<student>-page-<page>.<ext>` for every capture_page row.

    Idempotent: replaces any stale symlink from a previous run. Skips a row
    whose src file is not on disk (a capture that never actually produced an
    image — should not happen in practice, but noise here would hide the
    real error the caller was going to look at).
    """
    capture_db = os.path.join(data, "capture.sqlite")
    if not os.path.isfile(capture_db):
        return
    conn = sqlite3.connect(capture_db)
    try:
        rows = conn.execute(
            "SELECT student, page, src FROM capture_page"
        ).fetchall()
    finally:
        conn.close()
    for original, link_name in scan_link_targets(rows):
        source_path = os.path.join(scans, original)
        if not os.path.exists(source_path):
            continue
        link_path = os.path.join(scans, link_name)
        try:
            os.remove(link_path)
        except FileNotFoundError:
            pass
        os.symlink(original, link_path)


def reanalyse(body):
    """Re-read a captured project at new thresholds, without a new capture.

    Same project directory as `/analyse`, no scan_pdf: the read runs against
    the sqlite files AMC already wrote. Issue #197: `note` re-runs at the
    NEW seuil too, so the scores follow the marks — the report's
    `scoring.stale` can no longer come from this route (it survives for
    whoever drives the CLI by hand with a divergent seuil, ADR-0031).
    """
    _project, data = project_paths(body)
    ticked, unsure = parse_thresholds(body)
    amc("note", "--data", data, "--seuil", str(ticked))
    return read_capture.read(data, ticked, unsure)


def associate(body):
    """Match the codes AMC assembled against the course roster."""
    _project, data = project_paths(body)
    roster = under_work(body["roster"], must_exist=True)
    code = body.get("code", "rut")
    key = body.get("key", code)

    output = amc("association-auto", "--data", data, "--notes-id", code,
                 "--liste", roster, "--liste-key", key)

    # A refusal is not an error: a damaged identifier SHOULD fail to match, and
    # AMC names each one it dropped. Surfacing them is how the review queue
    # learns what to ask a human about.
    refused = re.findall(r"Code value (\S+) not found", output)
    return {"associations": _associations(data), "refused_codes": refused}


def associate_set(body):
    """Inject one association — the review queue's whole API."""
    _project, data = project_paths(body)
    copy = int(body["copy"])
    identifier = str(body["id"])
    if not identifier:
        raise Failed("id is required")

    # TRAP 1: --copy is not optional. Without it this call is a no-op that
    # reports success.
    amc("association", "--data", data, "--set",
        "--student", copy, "--copy", 1, "--id", identifier)

    found = [a for a in _associations(data) if a["copy"] == copy]
    if not found or found[0]["id"] != identifier:
        raise Failed(f"association for copy {copy} did not take effect")
    return found[0]


def annotate(body):
    """One annotated PDF per student, into a directory that must be empty."""
    project, data = project_paths(body)
    roster = under_work(body["roster"], must_exist=True)
    out = under_work(body["out"])
    key = body.get("key", "rut")
    name_column = body.get("name_column", "nombre")
    verdict = body.get("verdict", "%(ID) — Nota: %S/%M")

    # TRAP 2: annotate writes but never cleans. A directory holding a previous
    # run ends up with orphans beside the new files, and anything that walks it
    # sends both.
    os.makedirs(out, exist_ok=True)
    if os.listdir(out):
        raise Failed(f"annotation directory is not empty: {body['out']}",
                     "annotate never cleans; give it a fresh directory")

    amc("annotate", "--data", data, "--project", project,
        "--cr", os.path.join(project, "cr"),
        "--subject", os.path.join(project, "out", "sujet.pdf"),
        "--pdf-dir", out, "--names-file", roster,
        "--association-key", key, "--csv-build-name", f"({name_column})",
        "--filename-model", "(N)-(ID).pdf", "--verdict", verdict)

    files = sorted(f for f in os.listdir(out) if f.endswith(".pdf"))
    # An unassociated copy still gets a file, named with the literal `_ID_`
    # placeholder. Counting files is therefore not a completeness check, so the
    # two kinds are reported apart and the caller is told which is which.
    named = [f for f in files if "_ID_" not in f]
    unidentified = [f for f in files if "_ID_" in f]
    return {
        "pdfs": [os.path.relpath(os.path.join(out, f), WORK) for f in named],
        "unidentified": [os.path.relpath(os.path.join(out, f), WORK) for f in unidentified],
    }


def annotate_copy(body):
    """One annotated PDF for ONE copy, honouring the review-page overrides.

    The server sends the corrections the professor just saved; this route
    writes them into AMC's capture (its own manual mechanism), recomputes
    the scores, and annotates only that copy. `--id-file` plus
    `--single-output` is AMC's single-copy mode; the file is named
    `copy-<N>.pdf` so it is addressed by copy number, not by a roster name
    (#190 keeps rosters out of scope).

    Idempotent: re-annotating a copy overwrites its file, so the review
    page always sees the latest correction.

    Optional `ticked` (issue #197): `note` runs at it, so the drawn marks
    and the verdict agree with the reader's verdict — the server sends the
    control's stored threshold.
    """
    project, data = project_paths(body)
    copy = body["copy"]
    # A malformed field is the caller's mistake and can never succeed on
    # retry — but int() would silently accept "1.9" and JSON's true as copy
    # 1, and annotating the wrong copy is exactly the mistake this route
    # must not make quietly.
    if not isinstance(copy, int) or isinstance(copy, bool):
        raise Failed("copy must be an integer")
    if copy < 1:
        raise Failed("copy must be at least 1")
    overrides = body.get("overrides") or {}
    try:
        ticked = float(body.get("ticked", TICKED))
    except (TypeError, ValueError) as exc:
        raise Failed("ticked must be a number", str(exc))
    if not 0 < ticked < 1:
        raise Failed(f"ticked must be in (0, 1), got {ticked}")

    if not os.path.isfile(os.path.join(data, "capture.sqlite")):
        raise Failed("no capture in this project", "run /analyse first")
    if not os.path.isfile(os.path.join(data, "scoring.sqlite")):
        raise Failed("no scoring database in this project", "run /analyse first")

    cap = sqlite3.connect(os.path.join(data, "capture.sqlite"))
    try:
        copies = [r[0] for r in cap.execute(
            "SELECT DISTINCT copy FROM capture_zone WHERE student=?", (copy,)
        )]
        if not copies:
            raise Failed(f"copy {copy} has no captured boxes")
        if len(copies) > 1:
            # Two scans of the same sheet is the one case the reading report
            # flags as unreadable rather than resolving; annotating it would
            # draw one scan's marks over the other's verdict.
            raise Failed(f"copy {copy} was scanned more than once",
                         "annotating a duplicate-scan copy needs a human decision")
    finally:
        cap.close()

    # Even with NO overrides this is a call: it means "converge to the raw
    # reading". The professor may have REVERTED a correction, which clears
    # the override row server-side and sends nothing — the previous manual
    # patches must not survive that (apply_overrides resets them first).
    apply_overrides(data, copy, overrides)
    # Scores are computed FROM the capture, so they are recomputed on every
    # annotate: `note` reads capture_zone.manual, which is the override
    # channel (re-patched or reset) applied above. Unconditional on purpose
    # — after a reset the raw scores must come back too.
    amc("note", "--data", data, "--seuil", str(ticked))

    sujet = os.path.join(project, "out", "sujet.pdf")
    if not os.path.isfile(sujet):
        raise Failed("no sujet.pdf in this project", "run /generate first")

    out = os.path.join(project, "annotated")
    os.makedirs(out, exist_ok=True)
    target = os.path.join(out, f"copy-{copy}.pdf")
    if os.path.exists(target):
        # TRAP 2 in reverse: annotate writes but never cleans, so an
        # existing file is removed rather than left beside the new one.
        os.remove(target)

    # student:copy — the copy index is part of AMC's keying everywhere
    # (scoring_mark, association), and the verdict does not substitute
    # without it (measured against AMC 1.6.0).
    id_file = os.path.join(project, f"annotate-copy-{copy}.txt")
    with open(id_file, "w", encoding="utf-8") as f:
        f.write(f"{copy}:{copies[0]}\n")

    amc("annotate", "--data", data, "--project", project,
        "--cr", os.path.join(project, "cr"),
        "--subject", sujet,
        "--pdf-dir", out, "--id-file", id_file,
        "--single-output", f"copy-{copy}.pdf",
        "--verdict", "Nota: %S/%M")

    # The id-file is scratch, not project state — leaving one per annotate
    # call would litter the project directory with files nothing reads.
    try:
        os.remove(id_file)
    except OSError:
        pass

    if not os.path.isfile(target):
        raise Failed(f"annotate produced no copy-{copy}.pdf",
                     "AMC reported success but the file is missing")
    return {"path": os.path.relpath(target, WORK), "copy": copy}


def apply_overrides(data, copy, overrides):
    """Write the professor's corrections into AMC's capture.

    AMC keeps one row per box in `capture_zone`, with `manual` at -1 while
    the scan's verdict stands; 1 means "this box is ticked" and 0 "this box
    is blank". That column is AMC's own manual-correction mechanism — the
    same one its GUI writes when a human clicks a box — and every
    downstream consumer (note, annotate, the reading report) honours it
    over the black/total measurement. The worker drives it for the server
    instead of a mouse.

    The call is not a delta over the capture: it RESETS the copy's manual
    columns to -1 first and then applies what the request carries, so a
    reverted correction disappears with the request that carried it. The
    request is therefore "the whole desired state", never "the change
    since last time".

    Two shapes, matching the two corrections the review page offers:

    - `answers: [{question, marked}]` — `question` is the layout question
      NAME (the reading report's `answers[].name`, the bank ref the server
      stores as question_ref), resolved to the numeric id through
      layout_question. `marked` are the answer numbers the professor
      confirmed. Every box of that question becomes manual, ticked exactly
      where `marked` says so. `marked: []` (or null) is a blank override,
      not "leave alone".
    - `rut: "20123456"` — the corrected identifier: one manual tick per
      column of the RUT grid, plus a forced association so every
      downstream consumer sees the same identity.

    The layout of these sqlite files is AMC's private schema (#190 accepted
    the trade-off); everything here was measured against AMC 1.6.0.
    """
    lay = sqlite3.connect(os.path.join(data, "layout.sqlite"))
    try:
        names = {r[0]: r[1] for r in lay.execute(
            "SELECT question, name FROM layout_question")}
        # layout_box is per student: each copy gets its own shuffled layout,
        # so the digit chars are read for THIS copy (same convention as
        # read_capture.py).
        chars = {
            (r[0], r[1]): r[2]
            for r in lay.execute(
                "SELECT question, answer, char FROM layout_box WHERE student=?",
                (copy,),
            )
        }
    finally:
        lay.close()

    cap = sqlite3.connect(os.path.join(data, "capture.sqlite"))
    try:
        # Converge to the CURRENT desired state, not a delta: every annotate
        # resets the copy's manual columns first. Without this, a correction
        # the professor later REVERTED (the server clears the override row
        # and sends nothing) would keep its old patches in the capture, and
        # the annotated PDF would silently show the correction they undid —
        # measured against 1.6.0 with the blank-all override in 06-http.sh.
        cap.execute(
            "UPDATE capture_zone SET manual = -1 WHERE student = ?", (copy,))
        for entry in overrides.get("answers", []):
            _override_answer(cap, copy, entry, names)
        if overrides.get("rut"):
            _override_rut(cap, copy, overrides["rut"], names, chars)
        cap.commit()
    finally:
        cap.close()
    if overrides.get("rut"):
        _force_association(data, copy, overrides["rut"])


def _override_answer(cap, copy, entry, names):
    name = str(entry["question"])
    question = next((q for q, n in names.items() if n == name), None)
    if question is None:
        raise Failed(
            f"no question named {name!r} in the layout",
            "the override names a question this control never printed",
        )
    # `or []` on purpose: a blank override may arrive as `"marked": null`
    # (Go marshals an empty slice as null), and null is present-but-not-
    # the-default — `get("marked", [])` alone would hand None to the set
    # comprehension below (measured, 06-http.sh).
    marked = {int(a) for a in (entry.get("marked") or [])}
    zones = cap.execute(
        "SELECT id_b FROM capture_zone WHERE student=? AND type=? AND id_a=?",
        (copy, read_capture.BOX_ZONE, question),
    ).fetchall()
    if not zones:
        raise Failed(
            f"question {name!r} has no captured boxes for copy {copy}",
            "the override names a question this copy never captured",
        )
    for (id_b,) in zones:
        cap.execute(
            "UPDATE capture_zone SET manual=? "
            "WHERE student=? AND type=? AND id_a=? AND id_b=?",
            (1 if id_b in marked else 0, copy, read_capture.BOX_ZONE, question, id_b),
        )


def _override_rut(cap, copy, rut, names, chars):
    rut = str(rut)
    if len(rut) != 8 or not rut.isdigit():
        raise Failed("rut must be exactly 8 digits")

    touched = 0
    for col, digit in enumerate(rut):
        # rut[8] is the most significant digit and prints leftmost — the
        # same convention the reading report reads the grid with.
        question = next(
            (q for q, n in names.items() if n == f"rut[{8 - col}]"), None)
        if question is None:
            raise Failed(f"the layout has no rut[{8 - col}] question")
        for (q, a), ch in chars.items():
            if q != question:
                continue
            touched += cap.execute(
                "UPDATE capture_zone SET manual=? "
                "WHERE student=? AND type=? AND id_a=? AND id_b=?",
                (1 if ch == digit else 0, copy, read_capture.BOX_ZONE, question, a),
            ).rowcount
    if not touched:
        raise Failed(f"copy {copy} has no captured RUT boxes",
                     "the RUT grid was never captured for this copy")


def _force_association(data, copy, rut):
    """Make the corrected RUT the association's answer for this copy.

    Same call as /associate/set — TRAP 1 applies here too: --copy is not
    optional — and the read-back is what proves it took effect. The literal
    1 is the scan-copy index the capture carries: /annotate/copy refuses a
    copy scanned more than once, so there is exactly one index, and it is
    the one the id-file uses (copies[0], same guard).
    """
    amc("association", "--data", data, "--set",
        "--student", copy, "--copy", 1, "--id", rut)
    found = [a for a in _associations(data) if a["copy"] == copy]
    if not found or found[0]["id"] != rut:
        raise Failed(f"association for copy {copy} did not take effect")


def _associations(data):
    db = os.path.join(data, "association.sqlite")
    if not os.path.exists(db):
        return []
    con = sqlite3.connect(db)
    out = []
    for student, copy, manual, auto in con.execute(
        "SELECT student, copy, manual, auto FROM association_association ORDER BY student"
    ):
        if copy == 0:
            continue  # a ghost row: AMC's own listing ignores these
        out.append({
            "copy": student,
            "id": manual or auto,
            "source": "manual" if manual else "auto",
        })
    return out


ROUTES = {
    ("GET", "/health"): health,
    ("POST", "/generate"): generate,
    ("POST", "/analyse"): analyse,
    ("POST", "/reanalyse"): reanalyse,
    ("POST", "/associate"): associate,
    ("POST", "/associate/set"): associate_set,
    ("POST", "/annotate"): annotate,
    ("POST", "/annotate/copy"): annotate_copy,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # Without this a connection that goes quiet is never closed. Combined with
    # a serial server that was enough to wedge the worker for good: a bare TCP
    # connect that sent nothing at all made every other client time out until
    # the squatter disconnected (#138 review, F-1). BaseHTTPRequestHandler turns
    # a read timeout into close_connection, so this is the whole fix on the
    # handler side; ThreadingHTTPServer below is the other half.
    timeout = 30

    def _respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        """Return the parsed JSON body, or raise Failed with a 400-worthy reason."""
        raw = (self.headers.get("Content-Length") or "0").strip()
        # `int()` accepts "-1", and `rfile.read(-1)` then reads to EOF — a hang
        # with no recovery. Validate the digits before trusting the number.
        if not raw.isdigit():
            raise Failed(f"Content-Length is not a non-negative integer: {raw!r}")
        length = int(raw)
        if length > MAX_BODY:
            raise Failed(f"body too large: {length} bytes (limit {MAX_BODY})")
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise Failed("body is not valid JSON", str(exc))

    def _dispatch(self, method):
        handler = ROUTES.get((method, self.path.rstrip("/") or "/"))
        if handler is None:
            # Drain the declared body before answering, or the next request on
            # this keep-alive connection starts mid-JSON and comes back as
            # "Unsupported method ('{\"junk\":1}GET')".
            self.close_connection = True
            self._respond(404, {"error": f"no route for {method} {self.path}"})
            return
        try:
            body = self._read_body()
        except Failed as exc:
            self.close_connection = True
            self._respond(400, {"error": exc.message, "detail": exc.detail})
            return

        try:
            # One AMC run at a time: its state is sqlite files in the project
            # directory and nothing about prepare/analyse/note is re-entrant.
            # /health stays outside the lock, which is the point of threading
            # the server at all — it must answer during a minutes-long analyse.
            if handler is health:
                self._respond(200, handler(body))
            else:
                with AMC_LOCK:
                    self._respond(200, handler(body))
        except Failed as exc:
            self._respond(400, {"error": exc.message, "detail": exc.detail})
        except (ValueError, TypeError) as exc:
            # A malformed field — `{"copies": "muchas"}` — is the caller's
            # mistake and can never succeed on retry, so it is a 400. Answering
            # 500 tells a machine caller "mine, try again" about a request that
            # will fail identically forever.
            self._respond(400, {"error": "malformed field", "detail": str(exc)})
        except KeyError as exc:
            self._respond(400, {"error": f"missing field: {exc.args[0]}"})
        except Exception as exc:  # noqa: BLE001 — the wire needs a JSON answer
            self._respond(500, {"error": type(exc).__name__, "detail": str(exc)})

        hand_back_project(body)

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def log_message(self, fmt, *args):
        sys.stderr.write("amc-worker %s\n" % (fmt % args))


def main():
    ap = argparse.ArgumentParser(description="The amc-worker HTTP contract.")
    ap.add_argument("--host", default="0.0.0.0",
                    help="address to bind (default: every interface, since the "
                         "container is what limits reachability)")
    ap.add_argument("--port", type=int,
                    default=int(os.environ.get("AMC_WORKER_PORT", DEFAULT_PORT)),
                    help=f"port to listen on (default: {DEFAULT_PORT}, "
                         "or $AMC_WORKER_PORT)")
    args = ap.parse_args()

    if shutil.which("auto-multiple-choice") is None:
        sys.exit("auto-multiple-choice is not on PATH — wrong image?")

    # Threaded, so /health is answerable while an /analyse is running. AMC work
    # is still serialised by AMC_LOCK — see the comment there.
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(f"amc-worker listening on {args.host}:{args.port}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
