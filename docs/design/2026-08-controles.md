# Design — Entrance controls ("controles de entrada")

> Design narrative for the assessment subsystem: a printed multiple-choice quiz
> at the start of each class, covering the previous class, scanned and graded
> automatically. Companion to `2026-08-redesign.md`, which this extends — it
> pulls v0.3's backend forward and gives it its first module.
>
> **Status:** design closed. **WP-A shipped** (#138) — the engine is confirmed
> by ADR-0030 with one paper check outstanding, and the reading report it
> returns is owned by ADR-0031. WPs B–G not started.
> Living decisions distilled from here become ADRs as each WP develops.

## Problem

Every class opens with a five-minute written control on the previous class's
material. Today that means writing the questions, printing, grading by hand and
copying grades into a spreadsheet — per class, all semester. The grading is
mechanical and the questions already exist implicitly in the course material,
so both are automatable.

The constraint that shapes everything: **the control is on paper**. Students
arrive, take it in five minutes with no devices, and the professor scans the
pile afterwards. No student accounts exist and none are planned (ADR-0009).

## Decisions

| #  | Decision | Date |
|----|----------|------|
| C1 | **The question bank is public**, authored under `content/` beside the class it belongs to, and rendered at the end of each document with the code exercises. Everything under `content/` is published (ADR-0015, `add-a-course-document.md` §10) and the repo itself is public, so a hidden bank was never available without encryption or a second repo. Making it public converts the constraint into a feature: the bank is study material, and the control measures whether the student studied it. | 2026-08-15 |
| C2 | **A question is anchored to a section and written at the end of the document.** The anchor is a rendered `h2` slug, which ADR-0021 already establishes as the section boundary. Authoring stays uninterrupted (footnote shape), rendering lands where it belongs, and "from section X to section Y" resolves against the reading order `index.yaml` already defines. No addition to the content model. | 2026-08-15 |
| C3 | **A broken anchor renders visibly broken and fails the suite**, never the build — the same shape as a missing image (ADR-0029) and a dangling wiki-link (ADR-0002). Drafting a question before its section exists is legitimate; publishing one is not. | 2026-08-15 |
| C4 | **The rendered question reveals its answer once answered**, mirroring `<Exercise>`, which hides its cases until the first run (ADR-0019). Pacing, not secrecy — the bank is public either way, and a question the student cannot self-check is worth less as study material. | 2026-08-15 |
| C5 | **Students are identified by the 8-digit RUT body, bubbled, without the verifier digit.** AMC's `\AMCcode` grid is digits-only and a DV can be `K`. With an enrolled-student list the DV adds no information: the body is matched against the roster, and what does not match goes to the manual queue. One less column, and the most common student marking error removed. | 2026-08-15 |
| C6 | **Each copy draws its questions at random from the pool of the selected range** (worked case: 4 of ~10), with alternatives shuffled. No minimum-pool gate, no difficulty balancing — an entrance control measures whether the student read, and the professor explicitly does not want the evaluation levelled. | 2026-08-15 |
| C7 | **The grade is fixed 1.0–7.0 with 4.0 at 50% of the score**, platform-wide, no per-course or per-control configuration. Blank and wrong both score zero — no penalty for guessing. Configuration is added the day a course needs another rule, not before. | 2026-08-15 |
| C8 | **Auto-Multiple-Choice (AMC) is the generation and reading engine** — **confirmed by the spike; see ADR-0030**, which is authoritative from here on. Nine of ten acceptance criteria met; the fallback below is now a review trigger rather than a live option, and it fires only if the paper check fails. It supplies per-copy shuffling with printed copy identity, the code-grid reader, and the annotated-correction PDF — the three expensive things to build well. Fallback if the spike fails: our own PDF generation plus OMRChecker. | 2026-08-15 |
| C9 | **AMC runs as a separate worker container sharing a volume with the server.** The Go image is a ~20 MB multi-stage Alpine build; AMC drags Perl, LaTeX and OpenCV — estimated at roughly 2 GB here, **measured at 1.04 GB** (ADR-0030 §Measurements). Isolating it keeps the server image small, keeps the Perl/LaTeX toolchain out of the deploy path, and makes the fallback a container swap rather than a rewrite. Mounting the Docker socket was rejected: it grants host control to a process reachable from the internet. | 2026-08-15 |
| C10 | **The controls module is what gives birth to `apps/server`** — Go, SQLite, Google OAuth (ADR-0006, ADR-0007, ADR-0009), pulled forward from v0.3. A concrete module with a real user is a better reason to build the backend than building it in the abstract and looking for a use. | 2026-08-15 |
| C11 | **One binary, two delivery surfaces, one shared domain.** `internal/app/web` serves the server-rendered backoffice; `internal/app/api` serves the JSON/WS API that `apps/web` and the future live-session relay (ADR-0008) consume. Microservices were rejected: SQLite is a local file and two containers writing it would force Postgres, which ADR-0007 declined; and the shared user system — the stated reason for wanting separation — is precisely what a split makes expensive. The module boundary is drawn now, so a future split is a different `go build`, not a rewrite. | 2026-08-15 |
| C12 | **The two surfaces do not share an auth gate.** The backoffice serves an authenticated professor; the API serves anonymous students who join with a room code (ADR-0009). Same process, opposite auth models — the professor session middleware never hangs off API routes. The API is also cross-origin by construction (`apps/web` lives on GitHub Pages), so CORS and cross-origin WebSocket are its concern and not the backoffice's. | 2026-08-15 |
| C13 | **The backoffice is server-rendered Go `html/template`**, no frontend build step, following DocumentBuddy's proven pattern (its ADR-002 monolithic single binary, ADR-005 clean architecture layout, ADR-016b light/dark). Its ~2000 lines of tested auth domain — users, sessions, CSRF, Google OAuth, professor CRUD, audit — are ported rather than rewritten. Consequence accepted: the backoffice will not resemble Nalanda's design system (ADR-0026). It is an internal tool, not the product. | 2026-08-15 |
| C14 | **The server reads the bank from a published JSON artifact**, emitted by the `apps/web` build and served alongside the site, with a local-file override for development. The server therefore uses exactly the bank the students can see — the two cannot drift. Mounting the repo beside the server was rejected: it ties the deploy to a checkout and allows generating a control from questions the site does not show. | 2026-08-15 |
| C15 | **Hosting is deferred.** Development runs locally under docker-compose. The choice between DocumentBuddy's existing box (its ADR-010 Jetson Nano, ADR-014 Tailscale Funnel) and a VPS is made when there is something to deploy, informed by the spike's measurements of image size and batch reading time. | 2026-08-15 |

## Architecture

```
content/                          question bank, public, beside each class
   └── build (apps/web) ──────►   preguntas.json, published with the site
                                        │
                                        ▼  HTTP (C14)
apps/server  (one Go binary)
   internal/domain/auth/          users, sessions, OAuth        (ported)
   internal/domain/course/        courses, students, enrolment
   internal/domain/controls/      controls, copies, readings, grades
   internal/domain/session/       live-class relay (ADR-0008, later)
   internal/app/web/              backoffice, server-rendered   (professor)
   internal/app/api/              JSON/WS                       (anonymous)
                                        │
                                        ▼  shared volume + HTTP (C9)
amc-worker  (separate container)   generate PDFs · read scans · annotate
```

### Data model

```
curso              id, nombre, semestre
alumno             id, rut(8), nombre, correo          ← global, not per course
inscripcion        curso_id, alumno_id                 ← a student may repeat or take two
control            id, curso_id, nombre, fecha, desde_ancla, hasta_ancla,
                   n_preguntas, n_copias, estado
control_pregunta   control_id, pregunta_ref, puntaje
copia              id, control_id, numero              ← one printed sheet, its own draw
lectura            copia_id, alumno_id?, rut_leido, estado
respuesta          copia_id, pregunta_ref, marcada, correcta
nota               curso_id, alumno_id, control_id, puntaje, nota
archivo            control_id, tipo, alumno_id?, ruta
```

Two properties of this shape matter more than they look:

**`alumno` is global and `inscripcion` hangs it off the course.** When the
roster later comes from Canvas or the university's system, the students already
exist and the import becomes an upsert rather than a migration.

**`lectura.estado` is what makes the manual queue work.** Two distinct failures
were foreseen here; the spike found a **third**, and the contract is now owned by
ADR-0031 — *what is missing*: the copy printed questions the batch never
captured, which is a page that never reached the scanner. Unlike the two below,
that one cannot be repaired at a keyboard. The two foreseen are: *who is this* (RUT unreadable, or not on the roster) and *what did
they mark* (two bubbles, or one half-filled). A sheet can have the first without
the second — and in that case, typing the RUT completes it and nothing else is
touched.

## The professor's flow

1. Create a control: pick a course, a section range (from document+section to
   document+section, in reading order), how many questions per copy and how many
   copies. The server draws each copy independently from the range's pool.
2. Print the generated PDF. Copies carry a printed identifier and an 8-digit
   RUT grid; nothing on the sheet names a student.
3. Run the control. Students bubble their RUT and their answers.
4. Scan the pile as one multi-page PDF and upload it. Sheets may be out of order.
5. The system reads it, matches RUTs against the roster, and writes grades.
6. Review: the grade sheet, with links to the original and the annotated file,
   the per-question detail, and a queue of what could not be read — where the
   professor types the RUT, and answers the machine did read stay filled in.
7. Later: annotated per-student PDFs and their delivery.

## Roadmap

| WP | Issue | Scope | Depends on |
|----|-------|-------|-----------|
| A ✅ | [#138](https://github.com/so77id/nalanda/issues/138) | **AMC worker** — the spike, its acceptance list, the container and its HTTP contract, and the ADR recording engine choice | — |
| B | [#139](https://github.com/so77id/nalanda/issues/139) | **Question bank in content** — authoring format, anchor resolution and its gate, the rendering component, catalog entry, published JSON | — |
| C | not refined | **`apps/server` is born** — Go + SQLite + goose, auth domain ported, Google OAuth, seed, professor CRUD, plus the process obligations below. Likely two WPs | — |
| D | not refined | **Course and roster** — tables and CSV import. Canvas import noted, not assumed | C |
| E | not refined | **Create a control, generate the PDF** | A, B, C, **+ the paper check** |
| F | not refined | **Read scans, manual review queue** | E |
| G | not refined | **Publish grades** — spreadsheet, email, Canvas | F |

WPs C–G are deliberately unrefined. A spec written against an engine the spike
has not confirmed is fiction: if WP-A disqualifies AMC, E and F describe work we
will not do. Each is refined when its turn comes, C after its own design
conversation (see *What WP-C brings with it*).

The first real control needs **A, B and E**, grading by hand that first time —
which is worth doing anyway, to see the printed sheet before automating its
reading.

**WP-E does not start before the paper check runs** (decided 2026-08-15,
ADR-0030 §Not yet proven). Nothing earlier depends on it, so it is not a gate on
#138 — but E and F would otherwise be specified against an engine nobody has
shown can read a pencil, which is the failure the spike existed to prevent.

**B is scheduled early despite not being the first dependency.** Its real work
is the professor writing questions, which is the long pole and cannot be
parallelised by anyone else. Everything else can be built while the bank fills.

### What WP-A must prove

The spike fails and the engine changes if any of these does not hold:

1. Runs **headless** from the CLI, never opening the GTK GUI.
2. Generates N copies from a `.tex` **we** generate, questions and alternatives
   shuffled per copy.
3. Prints the 8-digit code grid and reads it back.
4. Reads a batch delivered as **one multi-page PDF**, pages out of order.
5. Reports ambiguous and unreadable separately, in a consumable format.
6. Accepts the RUT→copy association **injected externally**, without its GUI.
   Without this the manual queue cannot exist.
7. Produces the annotated PDF, separable per copy.

It must also **measure**: image size, and wall-clock to read 40 sheets. AMC on
Apple Silicon will likely run emulated (amd64 under arm64) — tolerable at three
minutes, disqualifying at forty.

> **Answered, and the premise was wrong.** `auto-multiple-choice` ships for
> arm64 in Debian bookworm, so the image runs native and there is no emulation.
> Forty sheets read in **53 s** (ADR-0030 §Measurements), so the timing was
> never the constraint this paragraph expected it to be.

### What WP-C brings with it

`repository-structure.md` §How to add a new app applies in full, and Go is a new
language in the monorepo:

- `docs/standards/backend-code-style.md`, born with the app (ADR-0005).
- Its own CI job with path filters; its two testing protocols registered in
  `testing-strategy.md` before its first PR merges.
- Own README, own `CLAUDE.md`, own packaging; root `CLAUDE.md` edited so shared
  concerns stay at root.
- Extension points registered in `integration-guides.md`.
- An ADR for C10/C11 — pulling the backend forward and the one-binary,
  two-surface shape.

## Open questions

- **Roster import from Canvas.** In Chilean universities `sis_user_id` is often
  the RUT, but that depends on the institution's SIS integration and must be
  verified against the real instance, not assumed. Needs an API token. (WP-D)
- **Grade delivery order.** Spreadsheet, email and Canvas are all wanted; which
  ships first is decided once the core works. (WP-G)
- **`area:controls` label.** WPs E–G have no matching area in
  `.claude/workflow-bindings.md`; A is `area:infra`, B is `area:course` +
  `area:widgets`, C is `area:backend` + `area:auth`.
- **Retention of scanned sheets.** Scans carry RUTs and grades — personal data
  under Ley 21.719. A retention and deletion policy belongs in
  `docs/security-notes.md` before WP-F ships, not after.
