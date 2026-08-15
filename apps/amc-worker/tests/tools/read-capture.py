#!/usr/bin/env python3
"""Turn an AMC capture into a machine-readable reading report.

Runs INSIDE the worker image. Emits JSON on stdout:

    {
      "pages": {"captured": 10, "failed": 0},
      "copies": {
        "1": {
          "rut": "20123456",
          "rut_status": "ok",
          "rut_columns": [{"column": 0, "digits": ["2"]}, ...],
          "answers": [{"question": 9, "name": "requisito", "marked": [1], "status": "ok"}, ...],
          "status": "ok"
        }
      },
      "needs_review": ["4", "5"]
    }

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

Two failure kinds are reported SEPARATELY and never merged, because they need
different repairs (docs/design/2026-08-controles.md §lectura.estado):

    who is this   — the RUT is incomplete or a column holds two digits
    what did they mark — a question has no box ticked, or more than one

A copy can have the first without the second. When it does, typing the RUT is
the whole repair and the answers are already final.
"""

import argparse
import json
import sqlite3
import sys

BOX_ZONE = 4  # capture_zone.type: 4 is an answer or code box (3 is the page id)


def read(data_dir, ticked, unsure):
    lay = sqlite3.connect(f"{data_dir}/layout.sqlite")
    cap = sqlite3.connect(f"{data_dir}/capture.sqlite")

    names = {r[0]: r[1] for r in lay.execute("SELECT question, name FROM layout_question")}
    chars = {
        (r[0], r[1], r[2]): r[3]
        for r in lay.execute("SELECT student, question, answer, char FROM layout_box")
    }

    copies = {}
    for student, q, a, black, total in cap.execute(
        "SELECT student, id_a, id_b, black, total FROM capture_zone WHERE type = ?",
        (BOX_ZONE,),
    ):
        ratio = (black / total) if total > 0 else 0.0
        c = copies.setdefault(student, {"rut": {}, "q": {}})
        name = names.get(q, "")
        if name.startswith("rut["):
            # rut[8] is the most significant digit and prints leftmost.
            col = 8 - int(name[4:-1])
            c["rut"].setdefault(col, [])
            if ratio >= ticked:
                c["rut"][col].append((chars[(student, q, a)], ratio))
        else:
            c["q"].setdefault(q, [])
            if ratio >= ticked:
                c["q"][q].append((a, ratio))
            elif ratio >= unsure:
                # Dark enough to worry about, not dark enough to count. This is
                # the half-erased answer, and it is why "no box ticked" is not
                # automatically "left blank".
                c["q"][q].append((a, ratio))

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
            answers.append({
                "question": q,
                "name": names.get(q, ""),
                "marked": marked,
                "status": "ok" if len(marked) == 1 else ("blank" if not marked else "ambiguous"),
            })

        answers_ok = all(a["status"] == "ok" for a in answers)
        out[str(student)] = {
            "rut": "".join(digits),
            "rut_status": "ok" if rut_ok else "unreadable",
            "rut_columns": columns,
            "answers": answers,
            "status": "ok" if (rut_ok and answers_ok) else "needs_review",
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
    json.dump(read(args.data, args.ticked, args.unsure), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
