#!/usr/bin/env python3
"""Turn an AMC capture into a machine-readable reading report.

Runs INSIDE the worker image. Emits JSON on stdout:

    {                                              // shape, not a real reading:
      "pages": {"captured": 10, "failed": 0},       // the fixture's own numbers
                                                    // are in tests/03-read.sh
      "scoring": {"seuil": 0.15,                     // what AMC's `note` used
                  "ticked": 0.15,                    // what THIS reading used
                  "stale": false},                   // true when they differ
      "copies": {
        "1": {
          "rut": "20123456",
          "rut_status": "ok",                      // ok | unreadable
          "rut_columns": [{"column": 0, "digits": ["2"]}, ...],
          "answers": [
            {"question": 9, "name": "requisito",
             "type": "simple",                     // simple | multiple
             "marked": [1],                        // confident ticks
             "doubtful": [],                       // [{answer, darkness}]
             "status": "ok",                       // ok|blank|ambiguous|doubtful
             "score": 1.0, "max": 1.0,             // the caller: score / max
             "position": 3,                        // 1-based slot on THIS
                                                   // copy's printed sheet;
                                                   // 0 when no layout data
             "alternatives": [3, 4, 2, 1]}         // authoring indices in
                                                   // printed order for THIS
                                                   // copy; [] when unknown
          ],
          "expected_questions": 4,                 // what the layout says printed
          "seen_questions": 4,                     // what the capture holds
          "missing_questions": [],                 // question NAMES, not ids
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

And it must have been scored after the LAST capture, for every captured copy.
`prepare --mode b` needs `--n-copies`: without it AMC scores only the copies
the source declares in `\\onecopy{N}`, so a larger class leaves copies captured
and unscored — measured on the paper check, where one copy came back with
every score null under `status: "ok"`. A captured question with no score is
refused: the message names the copy and the question, and the refusal withholds
the WHOLE report — nothing on stdout, exit 2 — because a partial one would be
the same half-truth. It is a refusal and not a review-queue entry because the
repair is re-running `note`, not a human looking at the sheet.

WHAT THE CALLER DOES WITH `score` AND `max`. Every question weighs ONE POINT
(docs/design/2026-08-controles.md §C16), and AMC does not agree: it weighs a
simple question 1 and a multiple one point per alternative. So the caller
normalises, and this is the whole of it:

    relative_i = score_i / max_i      the fraction of question i's single point
    grade      = sum(relative_i)      over the N questions THIS copy drew
    percentage = grade / N            out of N, because each question is one point

`max` is NOT a constant — 1 for a simple question, the alternative count for a
multiple — so a three-alternative multiple divides by 3 and a five-alternative
one by 5. Nothing here assumes four, which is why `max` travels with each answer
instead of being assumed by the caller. Turning a percentage into a 1,0-7,0 mark
is `apps/server`'s job, not this report's (ADR-0031).

WHAT AMC DECIDES AND WHAT WE DECIDE, because the difference matters when
something goes wrong on a real sheet:

AMC finds the page, identifies which copy and page it is from the printed
marker, locates every box from the layout, and counts how many of each box's
pixels are black (`capture_zone.black` over `.total`). Those are its numbers and
we do not second-guess them.

AMC's OWN manual override is honoured, not second-guessed either:
`capture_zone.manual` (AMC's GUI writes it when a human clicks a box, and the
worker's /annotate/copy writes it for the server's review-page corrections,
issue #190) says a box is ticked (1) or blank (0) whatever the pixels say. The
report must agree with what annotate and note will draw from the same column,
or the grade shown beside the marks would silently disagree with the PDF.

The THRESHOLD is ours. AMC stores darkness, not a verdict, so "is this box
ticked" is a decision this layer makes and can tune per batch. A synthetic fill
lands near 0.63 and an empty box at 0.0, so any threshold in between works here
— which is exactly why the real print-mark-scan cycle is the check that matters:
a pencil mark on paper is nowhere near as clean, and the gap between the two
thresholds below is where a real sheet lands when a student half-erases.

THREE failure kinds are reported SEPARATELY and never merged, because they need
different repairs (docs/design/2026-08-controles.md §lectura.estado):

    who is this        — the RUT is incomplete, or a column holds two digits
    what did they mark — a question has no box ticked, more than one WHERE IT
                         ADMITS ONLY ONE, or one faint enough to doubt. On a
                         question that admits several (`type: "multiple"`),
                         several ticks are the answer and nothing is flagged.
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

# scoring_question.type, measured against AMC 1.6.0: 1 is a question with one
# correct alternative, 2 is one with several. Nothing in the capture says which
# is which — a box is a box — so this is the only place the difference is
# knowable, and getting it wrong turns a correct answer into a review queue
# entry (#147).
QUESTION_MULTIPLE = 2


class MissingScoring(Exception):
    """The project cannot be scored as read.

    Raised from three places: no scoring database, one that exists and holds no
    scores, and — per copy — a question that was captured after the batch was
    scored. The third is the one a healthy-looking project reaches.

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
    con = None
    try:
        # connect inside the try as well: a `scoring.sqlite` that is a
        # DIRECTORY — how a mis-specified `docker -v` shows up — raises here
        # rather than on the query, and used to escape as a traceback.
        con = sqlite3.connect(path)
        scored = con.execute("SELECT COUNT(*) FROM scoring_score").fetchone()[0]
    except sqlite3.Error as exc:
        # sqlite3.Error, not OperationalError: the likeliest corruption is a
        # truncated or half-copied file, which raises DatabaseError and used to
        # escape as a raw traceback past the branch written for it.
        raise MissingScoring(
            "the scoring database is not one AMC wrote",
            f"{path}: {exc} — run `auto-multiple-choice prepare --mode b`",
        ) from exc
    finally:
        if con is not None:
            con.close()
    if not scored:
        raise MissingScoring(
            "the scoring database holds no scores",
            "scoring_score is empty — `auto-multiple-choice prepare --mode b` "
            "ran but `note` did not",
        )


UNSCORED = {"type": "simple", "score": None, "max": None}


def printed_copies(data_dir):
    """How many copies the layout says were PRINTED.

    Needed because `prepare --mode b` scores the copies the SOURCE declares in
    `\\onecopy{N}` and not the ones `--mode s --n-copies` actually printed, so a
    caller that prints a class larger than the source's default gets copies that
    are captured and never scored. Measured on the shipped paper check: with
    `PAPER_COPIES=6` against a fixture declaring five, copy 6 came back with
    every score null (#147 review, F3).

    It lives here rather than in the wrapper because knowing AMC's private
    schema is this module's job and nobody else's (ADR-0031 §Consequences).
    """
    path = os.path.join(data_dir, "layout.sqlite")
    if not os.path.exists(path):
        # Same rule as check_scoring, and it was broken here first: connecting
        # would CREATE the file, leaving an empty database in the project and
        # a 500 that blames sqlite (#147 review, SEC-6/ARQ-12).
        raise MissingScoring(
            "no layout in this project",
            f"{path} does not exist — run `auto-multiple-choice meptex` first",
        )
    con = sqlite3.connect(path)
    try:
        highest = con.execute("SELECT MAX(student) FROM layout_box").fetchone()[0]
    finally:
        con.close()
    if highest is None:
        # Guessing 1 here would score one copy of a whole class, and the
        # refusal downstream would blame `note` for it.
        raise MissingScoring(
            "the layout is empty",
            f"{path} has no boxes — `auto-multiple-choice meptex` never ran, "
            "or ran against an empty calage file",
        )
    return int(highest)


def scoring_facts(data_dir):
    """What AMC scored, keyed per copy because every copy draws its own questions.

    Returns `(seuil, {(copy, question): {"type", "score", "max"}})`.

    The seuil is AMC's own recorded `darkness_threshold` — what `note` actually
    used, read back rather than assumed from how it was invoked. It is
    published because it is NOT this module's `--ticked`: PAPER-CHECK.md §4 has
    the professor re-read a stored capture at another sensitivity, which moves
    the marks and leaves the scores where they were. A report carrying both
    without saying so would disagree with the grade in silence, which is the
    class of defect ADR-0031 exists to forbid.

    A question with no score falls back to `UNSCORED`, and `read()` REFUSES the
    batch rather than publishing that row — see the raise there. The fallback
    exists so the refusal has something to inspect, not so a guess can ship.

    `scoring_score` also carries a `copy` column, for a sheet scanned more than
    once, and the two tables are collapsed by DIFFERENT rules: this one keeps
    the last row per (copy, question), while the capture reading concatenates
    every scan's marks. Duplicate scans are out of scope for both — and they do
    not pass silently, because a duplicated scan also duplicates the RUT boxes,
    so the copy comes back `rut_status: "unreadable"` (measured, #147 review).
    """
    con = sqlite3.connect(os.path.join(data_dir, "scoring.sqlite"))
    try:
        row = con.execute(
            "SELECT value FROM scoring_variables WHERE name = ?",
            ("darkness_threshold",),
        ).fetchone()
        seuil = float(row[0]) if row else None

        facts = {}
        for student, q, kind in con.execute(
            "SELECT student, question, type FROM scoring_question"
        ):
            facts[(student, q)] = dict(
                UNSCORED,
                type="multiple" if kind == QUESTION_MULTIPLE else "simple",
            )
        for student, q, score, top in con.execute(
            "SELECT student, question, score, max FROM scoring_score"
        ):
            facts.setdefault((student, q), dict(UNSCORED)).update(score=score, max=top)
    finally:
        con.close()
    return seuil, facts


def read(data_dir, ticked, unsure):
    check_scoring(data_dir)
    seuil, facts = scoring_facts(data_dir)

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
    #
    # And in what order it printed them. AMC shuffles questions per copy
    # (`\shufflegroup`) and alternatives per question, so the layout knows the
    # physical position of every box on every sheet and no other database
    # does. Publishing that lets the review page render each copy the way its
    # student saw it — the numeric-id / authoring-index order the reader used
    # to iterate in did not match the paper in hand (#229). Order is derived
    # from the box geometry (page, ymin, xmin): AMC records coordinates, not a
    # position column.
    expected = {}
    printed_alts = {}   # (student, question) -> [answer_id, ...] in printed order
    q_anchors = {}      # (student, question) -> (page, ymin, xmin) of first box
    for student, q, ans, page, ymin, xmin in lay.execute(
        "SELECT student, question, answer, page, ymin, xmin FROM layout_box"
    ):
        if names.get(q, "").startswith("rut["):
            continue
        expected.setdefault(student, set()).add(q)
        key = (student, q)
        printed_alts.setdefault(key, []).append((page, ymin, xmin, ans))
        anchor = (page, ymin, xmin)
        if key not in q_anchors or anchor < q_anchors[key]:
            q_anchors[key] = anchor
    for key, boxes in printed_alts.items():
        boxes.sort()
        printed_alts[key] = [a for _, _, _, a in boxes]

    q_positions = {}    # (student, question) -> 1-based position on the sheet
    by_student = {}
    for (student, q), anchor in q_anchors.items():
        by_student.setdefault(student, []).append((anchor, q))
    for student, items in by_student.items():
        items.sort()
        for pos, (_, q) in enumerate(items, 1):
            q_positions[(student, q)] = pos

    copies = {}
    for student, q, a, black, total, manual in cap.execute(
        "SELECT student, id_a, id_b, black, total, manual "
        "FROM capture_zone WHERE type = ?",
        (BOX_ZONE,),
    ):
        ratio = (black / total) if total > 0 else 0.0
        c = copies.setdefault(student, {"rut": {}, "q": {}, "doubt": {}})
        name = names.get(q, "")
        if name.startswith("rut["):
            # rut[8] is the most significant digit and prints leftmost.
            col = 8 - int(name[4:-1])
            c["rut"].setdefault(col, [])
            if manual == 1 or (manual < 0 and ratio >= ticked):
                c["rut"][col].append((chars[(student, q, a)], ratio))
        else:
            c["q"].setdefault(q, [])
            c["doubt"].setdefault(q, [])
            # `manual` is AMC's own override channel (capture.pm: a zone is
            # ticked when manual=1, or manual<0 and the darkness is in band;
            # manual=0 is "this box is blank" whatever the pixels say). The
            # worker writes it for the professor's review-page corrections
            # (/annotate/copy, issue #190), and the report must agree with
            # what annotate and note will draw — not with the raw pixels.
            if manual == 1 or (manual < 0 and ratio >= ticked):
                c["q"][q].append((a, ratio))
            elif manual < 0 and ratio >= unsure:
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
            fact = facts.get((student, q), UNSCORED)
            kind = fact["type"]
            if len(marked) > 1 and kind == "simple":
                # Two ticks where the question admits one. On a MULTIPLE
                # question the same two ticks are the answer, and calling them
                # ambiguous sent a student who answered correctly to the review
                # queue while telling the professor to inspect a sheet that was
                # right (#147).
                status = "ambiguous"
            elif marked:
                # A confident mark with a faint one beside it is still a human
                # decision: the student may have erased the wrong one.
                status = "ok" if not doubtful else "doubtful"
            else:
                status = "doubtful" if doubtful else "blank"
            if fact["score"] is None:
                # Captured but never scored. Publishing it would mean a
                # well-formed report carrying `score: null` under `status:
                # "ok"`, which is the same silent disagreement between report
                # and grade that this whole contract exists to forbid — and the
                # repair is not a human looking at the sheet, it is re-running
                # `note`, so it is refused rather than queued for review.
                raise MissingScoring(
                    "the batch was scored before it was fully captured",
                    f"copy {student} question {names.get(q, q)!r} has no score "
                    "— run `auto-multiple-choice note` again, after the last "
                    "`analyse`",
                )
            answers.append({
                "question": q,
                "name": names.get(q, ""),
                "type": kind,
                "marked": marked,
                "doubtful": doubtful,
                "status": status,
                "score": fact["score"],
                "max": fact["max"],
                # Where THIS copy printed the question, and in what order it
                # printed its alternatives. Both come from layout.sqlite and
                # are per-copy: two students holding the same test see the
                # same questions in a different order and each question's
                # alternatives in a different order (#229). The outer answers
                # list keeps its iteration order for compatibility; a consumer
                # rendering the paper sorts by `position` and iterates
                # `alternatives` to pick each box's letter.
                "position": q_positions.get((student, q), 0),
                "alternatives": printed_alts.get((student, q), []),
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
        # `stale` is the whole reason both numbers are here: when they differ,
        # the marks in this report were decided at one threshold and the scores
        # beside them at another.
        "scoring": {"seuil": seuil, "ticked": ticked, "stale": seuil != ticked},
        "copies": out,
        "needs_review": [k for k, v in out.items() if v["status"] != "ok"],
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", required=True, help="AMC project data directory")
    ap.add_argument("--ticked", type=float, default=0.15,
                    help="darkness at or above which a box counts as ticked")
    ap.add_argument("--unsure", type=float, default=0.05,
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
