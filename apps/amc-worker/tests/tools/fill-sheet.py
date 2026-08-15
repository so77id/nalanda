#!/usr/bin/env python3
"""Fill an AMC sheet's boxes synthetically, to produce a scan batch to read back.

Runs INSIDE the worker image (python3 is there; no third-party packages are, so
this uses only the standard library and netpbm's plain formats).

Why this exists: S3 onward need sheets that are actually marked, and no agent
can produce those by printing and using a pencil. So the automated loop draws
filled boxes at the coordinates AMC's own layout database reports, which proves
the plumbing. It does NOT prove the reader tolerates a real pencil, a real
scanner, or a page that went in slightly rotated — that is the manual check in
S7, and it is the one that decides the engine.

The layout database (built by `auto-multiple-choice meptex`) gives box corners
in PIXELS at a known dpi, and `layout_box.char` says which digit each RUT box
stands for. So nothing here is measured off a rendered page or guessed: the
same numbers AMC will read by are the numbers we fill by.

Marking plan (JSON on stdin or --plan):

    {
      "1": {"rut": "20123456", "answers": [2, 1, 4, 3]},
      "2": {"rut": "1912345?", "answers": [1, 0, 2, 2]},
      "3": {"rut": "20987654", "answers": [1, "both", 3, 1]}
    }

    rut      8 characters, most significant first (that is AMC's rut[8] column,
             which sits leftmost). A digit fills that box; "?" leaves the column
             blank; "!" fills two boxes in the column.
    answers  one entry per real question, in question order.
             1..N  fill that alternative
             0     leave blank
             "both" fill two alternatives (an ambiguous mark)
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys

# A real pencil does not produce a perfect rectangle, and a box filled corner to
# corner is easier to detect than anything a student draws. Inset the fill so the
# synthetic mark is a plausible one rather than the easiest possible case.
INSET = 0.18


def load_layout(db_path):
    """Return {student: {"pages": {...}, "rut": [...], "questions": [...]}}."""
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    pages = {}
    for r in con.execute("SELECT student, page, dpi, width, height FROM layout_page"):
        pages.setdefault(r["student"], {})[r["page"]] = dict(r)

    names = {r[0]: r[1] for r in con.execute("SELECT question, name FROM layout_question")}

    sheets = {}
    for r in con.execute(
        "SELECT student, page, question, answer, char, xmin, xmax, ymin, ymax "
        "FROM layout_box ORDER BY student, question, answer"
    ):
        s = sheets.setdefault(r["student"], {"rut": {}, "questions": {}})
        name = names.get(r["question"], "")
        box = (r["page"], r["xmin"], r["xmax"], r["ymin"], r["ymax"])
        if name.startswith("rut["):
            # rut[8] is the most significant digit and sits leftmost; index the
            # columns left to right so a plan can be written the way a RUT reads.
            col = 8 - int(name[4:-1])
            s["rut"].setdefault(col, {})[r["char"]] = box
        else:
            s["questions"].setdefault(r["question"], []).append(box)

    for s in sheets.values():
        s["order"] = sorted(s["questions"])
    return pages, sheets


def boxes_for(sheet, spec):
    """Return the list of boxes this plan says to fill for one copy."""
    out = []

    rut = spec.get("rut", "")
    if len(rut) != 8:
        raise SystemExit(f"rut must be 8 characters, got {rut!r}")
    for col, ch in enumerate(rut):
        column = sheet["rut"].get(col, {})
        if ch == "?":
            continue  # deliberately blank — an unreadable identifier
        if ch == "!":
            # Two digits in one column: the student corrected themselves and did
            # not erase. AMC has to report this rather than pick one.
            out += [column[d] for d in ("0", "1") if d in column]
            continue
        if ch not in column:
            raise SystemExit(f"no box for digit {ch!r} in column {col}")
        out.append(column[ch])

    answers = spec.get("answers", [])
    for qi, choice in enumerate(answers):
        if qi >= len(sheet["order"]):
            break
        qboxes = sheet["questions"][sheet["order"][qi]]
        if choice == "both":
            out += qboxes[:2]
        elif isinstance(choice, int) and choice > 0:
            if choice > len(qboxes):
                raise SystemExit(f"question {qi + 1} has no alternative {choice}")
            out.append(qboxes[choice - 1])
    return out


def fill_ppm(path, boxes):
    """Blacken the given rectangles in a binary (P6) PPM, in place."""
    with open(path, "rb") as fh:
        data = bytearray(fh.read())

    # P6 header: magic, width, height, maxval — whitespace separated, with
    # '#' comments legal anywhere. Parse it rather than assuming one line each.
    fields, i = [], 2
    while len(fields) < 3:
        while i < len(data) and data[i : i + 1].isspace():
            i += 1
        if data[i : i + 1] == b"#":
            while data[i : i + 1] not in (b"\n", b""):
                i += 1
            continue
        j = i
        while j < len(data) and not data[j : j + 1].isspace():
            j += 1
        fields.append(int(data[i:j]))
        i = j
    width, height, _maxval = fields
    start = i + 1  # single whitespace byte after maxval

    for _page, xmin, xmax, ymin, ymax in boxes:
        dx, dy = (xmax - xmin) * INSET, (ymax - ymin) * INSET
        x0, x1 = int(xmin + dx), int(xmax - dx)
        y0, y1 = int(ymin + dy), int(ymax - dy)
        x0, x1 = max(0, x0), min(width, x1)
        y0, y1 = max(0, y0), min(height, y1)
        for y in range(y0, y1):
            base = start + (y * width + x0) * 3
            data[base : base + (x1 - x0) * 3] = b"\x00" * ((x1 - x0) * 3)

    with open(path, "wb") as fh:
        fh.write(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--layout", required=True, help="layout.sqlite from meptex")
    ap.add_argument("--sujet", required=True, help="the generated subject PDF")
    ap.add_argument("--out", required=True, help="directory for the filled pages")
    ap.add_argument("--plan", help="marking plan JSON (default: stdin)")
    ap.add_argument("--pdf", help="also assemble the pages into this single PDF")
    ap.add_argument("--scramble", action="store_true",
                    help="assemble the PDF with its pages deliberately out of order")
    args = ap.parse_args()

    plan = json.load(open(args.plan) if args.plan else sys.stdin)
    pages, sheets = load_layout(args.layout)
    os.makedirs(args.out, exist_ok=True)

    written = []
    for student_str, spec in sorted(plan.items(), key=lambda kv: int(kv[0])):
        student = int(student_str)
        if student not in sheets:
            raise SystemExit(f"copy {student} is not in the layout")

        by_page = {}
        for box in boxes_for(sheets[student], spec):
            by_page.setdefault(box[0], []).append(box)

        for page, meta in sorted(pages[student].items()):
            # The subject PDF is a straight concatenation of every copy's pages,
            # so the position of (student, page) in that order is its page number.
            index = sum(len(pages[s]) for s in sorted(pages) if s < student) + page
            out = os.path.join(args.out, f"copy{student:02d}-p{page}.ppm")
            subprocess.run(
                ["pdftoppm", "-r", str(int(meta["dpi"])), "-f", str(index),
                 "-l", str(index), "-singlefile", args.sujet, out[:-4]],
                check=True,
            )
            fill_ppm(out, by_page.get(page, []))
            written.append(out)

    print(f"filled {len(written)} pages", file=sys.stderr)

    if args.pdf:
        order = list(written)
        if args.scramble:
            # A real pile goes into the feeder however it was picked up: backs
            # before fronts, copies interleaved. A fixed permutation rather than
            # a random one, so a failure here is reproducible — the point is
            # that AMC identifies each page from its printed marker, not from
            # where it sits in the batch.
            order = order[1::2][::-1] + order[0::2]
            print("scrambled page order: " + ", ".join(os.path.basename(p) for p in order),
                  file=sys.stderr)
            written = order

        # netpbm to PostScript, ghostscript to PDF: the image carries neither
        # ImageMagick nor img2pdf, and adding either for a test tool would put
        # them on the deploy path too.
        ps = [p[:-4] + ".ps" for p in written]
        for src, dst in zip(written, ps):
            with open(dst, "wb") as fh:
                subprocess.run(
                    ["pnmtops", "-equalpixels", "-dpi", "300", "-noturn", src],
                    stdout=fh, check=True, stderr=subprocess.DEVNULL,
                )
        subprocess.run(
            ["gs", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-sDEVICE=pdfwrite",
             f"-sOutputFile={args.pdf}"] + ps,
            check=True,
        )
        print(f"assembled {args.pdf}", file=sys.stderr)


if __name__ == "__main__":
    main()
