#!/usr/bin/env python3
"""The amc-worker HTTP contract.

Runs inside the image, serves JSON, and drives Auto-Multiple-Choice's CLI. Work
crosses the SHARED VOLUME, never the wire: every request names paths under
/work, and every response names paths under /work. A scan batch is forty pages
of images and putting that through an HTTP body would buy nothing.

    GET  /health                                      → { ok, amc }
    POST /generate   { project, source, copies }      → { sujet, calage, corrige }
    POST /analyse    { project, scan_pdf }            → { report }
    POST /associate  { project, roster, code, key }   → { associated, unassociated }
    POST /associate/set { project, copy, id }         → { copy, id }
    POST /annotate   { project, roster, key, out }    → { pdfs }

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

import json
import os
import re
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

WORK = "/work"
LISTEN = ("0.0.0.0", int(os.environ.get("AMC_WORKER_PORT", "8080")))

# Every AMC subcommand this worker is allowed to invoke. Anything not here
# reaches the GUI and dies on a missing display; see the module docstring.
SUBCOMMANDS = {
    "prepare", "meptex", "getimages", "analyse",
    "note", "association-auto", "association", "annotate",
}

# A capture is only trustworthy if we agree with AMC about which boxes are dark.
# These are the same defaults read-capture.py uses.
TICKED = 0.30


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
    proc = subprocess.run(
        argv, capture_output=True, text=True,
        env={**os.environ, "DISPLAY": ""},
    )
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


# --- handlers ----------------------------------------------------------------

def health(_body):
    version = subprocess.run(
        ["dpkg-query", "-W", "-f=${Version}", "auto-multiple-choice"],
        capture_output=True, text=True,
    ).stdout.strip()
    return {"ok": True, "amc": version}


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


def analyse(body):
    """Read a scan batch and score it, in the one order that works."""
    project, data = project_paths(body)
    scan_pdf = under_work(body["scan_pdf"], must_exist=True)
    source = under_work(body["source"], must_exist=True)

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
    amc("prepare", "--mode", "b", "--with", "pdflatex",
        "--data", data, "--prefix", project, source)
    amc("note", "--data", data, "--seuil", str(TICKED))

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from importlib import import_module
    reader = import_module("read_capture")
    return reader.read(data, TICKED, TICKED / 3)


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


def _associations(data):
    import sqlite3
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
    ("POST", "/associate"): associate,
    ("POST", "/associate/set"): associate_set,
    ("POST", "/annotate"): annotate,
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _respond(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dispatch(self, method):
        handler = ROUTES.get((method, self.path.rstrip("/") or "/"))
        if handler is None:
            self._respond(404, {"error": f"no route for {method} {self.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            self._respond(200, handler(body))
        except Failed as exc:
            self._respond(400, {"error": exc.message, "detail": exc.detail})
        except KeyError as exc:
            self._respond(400, {"error": f"missing field: {exc.args[0]}"})
        except Exception as exc:  # noqa: BLE001 — the wire needs a JSON answer
            self._respond(500, {"error": type(exc).__name__, "detail": str(exc)})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def log_message(self, fmt, *args):
        sys.stderr.write("amc-worker %s\n" % (fmt % args))


if __name__ == "__main__":
    if shutil.which("auto-multiple-choice") is None:
        sys.exit("auto-multiple-choice is not on PATH — wrong image?")
    HTTPServer(LISTEN, Handler).serve_forever()
