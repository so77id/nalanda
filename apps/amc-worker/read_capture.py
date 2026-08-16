#!/usr/bin/env python3
"""Turn an AMC capture into a machine-readable reading report.

Runs INSIDE the worker image. Emits JSON on stdout:

    {
      "pages": {"captured": 10, "failed": 0},
      "copies": {
        "1": {
          "rut": "20123456",
          "rut_status": "ok",                      // ok | unreadable
          "rut_columns": [{"column": 0, "digits": ["2"]}, ...],
          "answers": [
            {"question": 9, "name": "requisito",
             "marked": [1],                        // confident ticks
             "doubtful": [],                       // [{answer, darkness}]
             "status": "ok"}                       // ok|blank|ambiguous|doubtful
          ],
          "expected_questions": 4,                 // what the layout says printed
          "seen_questions": 4,                     // what the capture holds
          "missing_questions": [],
          "status": "ok"                           // ok|needs_review|incomplete
        }
      },
      "needs_review": ["4", "5"]
    }

WHAT THE PROJECT MUST ALREADY HAVE. This reads three of AMC's databases, not
two: `layout.sqlite` (what was printed), `capture.sqlite` (what was read off the
paper) and `scoring.sqlite` (what each question is and what it was worth). The
third only exists after `prepare --mode b` and `note` have run, in that order
and AFTER `analyse` — `/analyse` in worker.py does exactly that, and a caller
driving the CLI by hand must too. Reading without it is refused rather than
worked around; see MissingScoring.

WHAT AMC DECIDES AND WHAT WE DECIDE, because the difference matters when
something goes wrong on a real sheet:

AMC finds the page, identifies which copy and page it is from the printed
marker, locates every box from the layout, and counts how many of each box's
pixels are black (`capture_zone.black` over `.total`). Those are its numbers and
we do not second-guess them.

The THRESHOLD is ours. AMC stores darkness, not a verdict, so "is this box
ticked" is a decision this layer makes and can tune per batch. A synthetic fill
lands near 0.63 and an empty box at 0.0, so any threshold in between works here
— which is exactly why the real print-mark-scan cycle is the check that matters:
a pencil mark on paper is nowhere near as clean, and the gap between the two
thresholds below is where a real sheet lands when a student half-erases.

THREE failure kinds are reported SEPARATELY and never merged, because they need
different repairs (docs/design/2026-08-controles.md §lectura.estado):

    who is this        — the RUT is incomplete, or a column holds two digits
    what did they mark — a question has no box ticked, more than one, or one
                         faint enough to doubt
    what is missing    — the copy printed questions this batch never captured,
                         which is a page that never reached the scanner

A copy can have the first without the second. When it does, typing the RUT is
the whole repair and the answers are already final. The third is not repairable
at a keyboard at all: the sheet has to be found and re-scanned, which is why it
gets its own status rather than being folded into "needs review".
"""

import argparse
import json
import os
import sqlite3
import sys

BOX_ZONE = 4  # capture_zone.type: 4 is an answer or code box (3 is the page id)


class MissingScoring(Exception):
    """The project has no usable scoring database.

    Not a detail to shrug off: without it the reader cannot tell a
    multiple-answer question from a simple one — so it would report a correct
    answer as an ambiguity — and it cannot say what any question was worth.

    `auto-multiple-choice prepare --mode b` creates the database and `note`
    fills it, in that order and AFTER `analyse` (worker.py TRAP 3). MEASURED,
    the half-done state is the dangerous one: `prepare --mode b` alone leaves
    every scoring table present and `scoring_score` EMPTY, which is
    indistinguishable, to anything that only checks for the file, from a batch
    in which nobody scored a single point.
    """

    def __init__(self, message, detail=""):
        super().__init__(message)
        self.message = message
        self.detail = detail


def check_scoring(data_dir):
    """Refuse to read a project whose scoring database is missing or unfilled.

    Failing here is the whole point: a reader that carried on would produce a
    perfectly well-formed report that is wrong, and the caller has no way to
    tell. The two commands are named in the error because they are what the
    reader needs and the caller can run.
    """
    path = os.path.join(data_dir, "scoring.sqlite")
    if not os.path.exists(path):
        # NOT sqlite3.connect first: it would CREATE the file, and the next
        # question would be why an empty database appeared in the project.
        raise MissingScoring(
            "no scoring database in this project",
            f"{path} does not exist — run `auto-multiple-choice prepare "
            "--mode b` and then `note`, after `analyse`",
        )
    con = sqlite3.connect(path)
    try:
        scored = con.execute("SELECT COUNT(*) FROM scoring_score").fetchone()[0]
    except sqlite3.OperationalError as exc:
        raise MissingScoring(
            "the scoring database is not one AMC wrote",
            f"{path}: {exc} — run `auto-multiple-choice prepare --mode b`",
        ) from exc
    finally:
        con.close()
    if not scored:
        raise MissingScoring(
            "the scoring database holds no scores",
            "scoring_score is empty — `auto-multiple-choice prepare --mode b` "
            "ran but `note` did not",
        )


def read(data_dir, ticked, unsure):
    check_scoring(data_dir)

    lay = sqlite3.connect(f"{data_dir}/layout.sqlite")
    cap = sqlite3.connect(f"{data_dir}/capture.sqlite")

    names = {r[0]: r[1] for r in lay.execute("SELECT question, name FROM layout_question")}
    chars = {
        (r[0], r[1], r[2]): r[3]
        for r in lay.execute("SELECT student, question, answer, char FROM layout_box")
    }

    # What the layout says each copy PRINTED. Without this, a copy whose page
    # never reached the scanner is indistinguishable from one that was read in
    # full: its missing questions simply do not appear in capture_zone, and
    # every question that *is* present looks fine. A double feed on a duplex
    # batch is the most likely failure with real paper, and it would otherwise
    # give a student zero on half the sheet and tell nobody (#138 review, F-3).
    expected = {}
    for student, q in lay.execute("SELECT DISTINCT student, question FROM layout_box"):
        if not names.get(q, "").startswith("rut["):
            expected.setdefault(student, set()).add(q)

    copies = {}
    for student, q, a, black, total in cap.execute(
        "SELECT student, id_a, id_b, black, total FROM capture_zone WHERE type = ?",
        (BOX_ZONE,),
    ):
        ratio = (black / total) if total > 0 else 0.0
        c = copies.setdefault(student, {"rut": {}, "q": {}, "doubt": {}})
        name = names.get(q, "")
        if name.startswith("rut["):
            # rut[8] is the most significant digit and prints leftmost.
            col = 8 - int(name[4:-1])
            c["rut"].setdefault(col, [])
            if ratio >= ticked:
                c["rut"][col].append((chars[(student, q, a)], ratio))
        else:
            c["q"].setdefault(q, [])
            c["doubt"].setdefault(q, [])
            if ratio >= ticked:
                c["q"][q].append((a, ratio))
            elif ratio >= unsure:
                # Dark enough to worry about, NOT dark enough to count — and the
                # difference has to survive into the output. An earlier version
                # appended to the same list in both branches, so a box at 0.15
                # was reported as a confident answer while AMC's own scoring
                # (`note --seuil 0.30`) treated it as blank: the report and the
                # grade disagreed, silently (#138 review, F-2).
                c["doubt"][q].append((a, round(ratio, 3)))

    out = {}
    for student in sorted(copies):
        c = copies[student]

        digits, columns, rut_ok = [], [], True
        for col in range(8):
            found = [d for d, _ in sorted(c["rut"].get(col, []))]
            columns.append({"column": col, "digits": found})
            if len(found) == 1:
                digits.append(found[0])
            else:
                digits.append("_" if not found else "[" + "".join(found) + "]")
                rut_ok = False

        answers = []
        for q in sorted(c["q"]):
            marked = [a for a, _ in sorted(c["q"][q])]
            doubtful = [
                {"answer": a, "darkness": d} for a, d in sorted(c["doubt"].get(q, []))
            ]
            if len(marked) > 1:
                status = "ambiguous"
            elif len(marked) == 1:
                # A confident mark with a faint one beside it is still a human
                # decision: the student may have erased the wrong one.
                status = "ok" if not doubtful else "doubtful"
            else:
                status = "doubtful" if doubtful else "blank"
            answers.append({
                "question": q,
                "name": names.get(q, ""),
                "marked": marked,
                "doubtful": doubtful,
                "status": status,
            })

        seen = set(c["q"])
        missing = sorted(expected.get(student, set()) - seen)
        answers_ok = all(a["status"] == "ok" for a in answers)
        complete = not missing

        if not complete:
            status = "incomplete"
        elif rut_ok and answers_ok:
            status = "ok"
        else:
            status = "needs_review"

        out[str(student)] = {
            "rut": "".join(digits),
            "rut_status": "ok" if rut_ok else "unreadable",
            "rut_columns": columns,
            "answers": answers,
            "expected_questions": len(expected.get(student, set())),
            "seen_questions": len(seen),
            "missing_questions": [names.get(q, str(q)) for q in missing],
            "status": status,
        }

    captured = cap.execute("SELECT COUNT(*) FROM capture_page").fetchone()[0]
    failed = cap.execute("SELECT COUNT(*) FROM capture_failed").fetchone()[0]

    return {
        "pages": {"captured": captured, "failed": failed},
        "copies": out,
        "needs_review": [k for k, v in out.items() if v["status"] != "ok"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="AMC project data directory")
    ap.add_argument("--ticked", type=float, default=0.30,
                    help="darkness at or above which a box counts as ticked")
    ap.add_argument("--unsure", type=float, default=0.10,
                    help="darkness at or above which a box is reported as doubtful")
    args = ap.parse_args()
    try:
        report = read(args.data, args.ticked, args.unsure)
    except MissingScoring as exc:
        # Loudly, on stderr, with nothing on stdout: a caller piping this into
        # a file must not end up with half a report.
        sys.stderr.write(f"{exc.message}: {exc.detail}\n")
        raise SystemExit(2)
    json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
