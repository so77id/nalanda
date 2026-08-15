# Python Code Style

Bounded style for the Python in this monorepo. Same contract as its siblings
(`frontend-code-style.md`): agents follow it, they do not innovate on it. Born
with `apps/amc-worker` (#138), which is the only Python here today.

Python exists in this repo for one reason: to drive tools that are not ours.
`apps/amc-worker` wraps Auto-Multiple-Choice, a Perl application with an OpenCV
dependency, and Python is already inside that image. It is **not** the language
for application logic — that is TypeScript in `apps/web` and Go in
`apps/server` (ADR-0004, ADR-0006). A Python file that starts to look like a
domain model belongs in one of those.

## Version and dependencies

- **Python 3.11**, the version Debian bookworm ships, matched to the image.
- **Standard library only.** No `pip install`, no `requirements.txt`, no
  virtualenv. The moment a third-party package looks necessary, that is a
  design question — the image is 2.4 GB before we add anything, and a Python
  dependency tree on top of a LaTeX one is a maintenance surface nobody asked
  for. Bring it to a PR discussion, like any manifest change (root `CLAUDE.md`).
- Every script runs **inside its app's container**, never on the host.

## Formatting

- **4 spaces**, no tabs. Lines wrap at **88 characters**.
- Double quotes for strings, single quotes only to avoid escaping.
- One import per line, grouped standard-library-then-local, alphabetically
  within a group.
- No formatter is wired into CI yet. When one is, it will be `ruff format`
  (which is what the above describes) and it lands with the app that needs it.

## Naming

- `snake_case` for functions, variables and modules; `UPPER_SNAKE` for
  constants; `CapWords` for classes.
- **Module names are importable**: `read_capture.py`, never `read-capture.py`.
  A hyphen makes a file that can be run and cannot be imported, which is a trap
  discovered exactly once per project (#138 S6 — the reader had to be renamed
  when the wrapper needed it).
- English identifiers, like everywhere else in the repo. Spanish appears only
  in strings a person reads.

## Structure

- **A script is a module with a `main()` and an `if __name__ == "__main__"`
  guard**, so anything worth reusing can be imported instead of copied.
- `argparse` for command-line arguments — never `sys.argv` indexing, and never
  an environment variable where a flag belongs.
- Output that another program consumes is **JSON on stdout**; progress and
  diagnostics go to **stderr**. Mixing them makes a tool unpipeable.
- Errors that a caller can act on raise a **named exception carrying a message
  and a detail**, not a bare `Exception` or a `sys.exit` string.

## Docstrings and comments

The repo's documentation culture applies here unchanged, and it is the part
most worth reading before writing Python in this repo:

- **A module docstring says what the module is for and what it costs.** For a
  wrapper, that includes the behaviours of the wrapped tool it exists to
  neutralise. `worker.py` names three silent AMC traps in its docstring, each
  with the consequence of getting it wrong; that is the shape to copy.
- **Comment what was measured, not what is obvious.** `# increment the counter`
  is noise; `# TRAP 3: scoring AFTER capture, or scoring_code is empty and every
  association silently matches nothing` is the reason the line is where it is.
- **When a comment states a fact about an external tool, it says so was
  measured** and where. A claim about someone else's software goes stale, and
  the next reader needs to know whether to trust it or re-check it.

## Subprocess

Python here mostly shells out, so this is the sharp end:

- `subprocess.run` with an **argument list**, never a string with `shell=True`.
- **Check the return code** — either `check=True` or an explicit branch that
  turns a non-zero exit into a named error carrying the tool's own output.
  Silent failure is the specific way a wrapper lies.
- **Choose the subcommand from a fixed set**, never interpolate a caller's
  string into one. In `apps/amc-worker` this is not hygiene: an unrecognised
  subcommand reaches AMC's GTK GUI and dies on a missing display, so a typo
  would surface as an unexplainable Gtk error.
- Pass the environment explicitly where it matters (`DISPLAY: ""` here), rather
  than inheriting and hoping.

## Paths from a request

Any path that arrives from outside the process is resolved with
`os.path.realpath` and checked to be inside its permitted root before use. The
caller is our own server rather than the internet, which lowers the stakes and
does not remove them: a bug in the caller should not be able to write outside
the project it was handed.

## Testing

Per the two-protocol rule (`testing-strategy.md`), the Python in
`apps/amc-worker` is verified by that app's shell scripts rather than by a
Python test framework — the subject under test is a container image and a
third-party CLI, and `pytest` would only wrap `docker run`. A future Python
that holds real logic of its own brings `unittest` (standard library, per the
no-dependencies rule) and registers its protocols in the testing document.

## References

- ADR-0005 — development standards (bounded style, guides, docs-in-flow).
- `repository-structure.md` — the rule that a new language brings its standards
  document with the app that introduces it.
- `testing-strategy.md` §`apps/amc-worker` — the two protocols.
