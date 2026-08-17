# Design — Entrance controls ("controles de entrada")

> Design narrative for the assessment subsystem: a printed multiple-choice quiz
> at the start of each class, covering the previous class, scanned and graded
> automatically. Companion to `2026-08-redesign.md`, which this extends — it
> pulls v0.3's backend forward and gives it its first module.
>
> **Status:** design closed. **WP-A shipped** (#138) — the engine is confirmed
> by ADR-0030 with one paper check outstanding, and the reading report it
> returns is owned by ADR-0031. **WP-B shipped for the current teaching path** —
> #148 landed the bank itself under ADR-0032, #147 landed multiple-answer
> questions under ADR-0033, and #144 landed the second `per-section` bank
> (`java-tipos-y-flujo`: twelve questions, three declared exemptions). That
> leaves `bienvenida` the only `pool` document and no document on the path
> without questions; B reopens whenever the path grows. **WP-C1 shipped**
> (#149) — `apps/server`
> exists, with the layered shape of C11 enforced by a test and every
> add-a-new-app obligation discharged; ADR-0034 records C10 and C11. **WP-C2
> shipped** (#150) — a professor signs in with Google, sessions are server-side
> and the C12 seam is asserted rather than promised; ADR-0036 records how, and
> the port cost no dependency. **WP-C3 shipped** (#151) — the backoffice has
> its shell (nav, both themes, error pages, one-shot flash cookie) and the
> professor CRUD (create, edit, deactivate/reactivate with both guards); C13
> is honoured (no bundler, `system-ui`, `currentColor` only). **WP-E shipped**
> (#166) — the professor picks a section range from the published bank, the
> AMC worker generates the PDF, and every control is persisted with its pool
> and its per-copy identity. `/` now redirects to `/controls`. WPs D, F and G
> not started.
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
| C7 | **The grade is fixed 1.0–7.0 with 4.0 at 50% of the score**, platform-wide, no per-course or per-control configuration. **Nothing is ever subtracted**: a wrong mark costs the credit of that box and no more, so guessing is never punished and a student should answer everything. (Rewritten 2026-08-16. It read *"blank and wrong both score zero"*, which was true when every question had exactly one answer and is false once a question can have several — there a wrong mark costs its box, not the question.) Configuration is added the day a course needs another rule, not before. | 2026-08-15 |
| C8 | **Auto-Multiple-Choice (AMC) is the generation and reading engine** — **confirmed by the spike; see ADR-0030**, which is authoritative from here on. Nine of ten acceptance criteria met; the fallback below is now a review trigger rather than a live option, and it fires only if the paper check fails. It supplies per-copy shuffling with printed copy identity, the code-grid reader, and the annotated-correction PDF — the three expensive things to build well. Fallback if the spike fails: our own PDF generation plus OMRChecker. | 2026-08-15 |
| C9 | **AMC runs as a separate worker container sharing a volume with the server.** The Go image is a multi-stage build onto `scratch` — **measured at 10.3 MB** at C1 and **12.2 MB since the auth port** (#150; ADR-0034 §Consequences records the first), where this line first estimated ~20 MB on Alpine; the pure-Go SQLite driver is what removes the libc dependency and with it the base image; AMC drags Perl, LaTeX and OpenCV — estimated at roughly 2 GB here, **measured at 1.04 GB** (ADR-0030 §Measurements). Isolating it keeps the server image small, keeps the Perl/LaTeX toolchain out of the deploy path, and makes the fallback a container swap rather than a rewrite. Mounting the Docker socket was rejected: it grants host control to a process reachable from the internet. | 2026-08-15 |
| C10 | **The controls module is what gives birth to `apps/server`** — Go, SQLite, Google OAuth (ADR-0006, ADR-0007, ADR-0009), pulled forward from v0.3. A concrete module with a real user is a better reason to build the backend than building it in the abstract and looking for a use. | 2026-08-15 |
| C11 | **One binary, two delivery surfaces, one shared domain.** `internal/app/web` serves the server-rendered backoffice; `internal/app/api` serves the JSON/WS API that `apps/web` and the future live-session relay (ADR-0008) consume. Microservices were rejected: SQLite is a local file and two containers writing it would force Postgres, which ADR-0007 declined; and the shared user system — the stated reason for wanting separation — is precisely what a split makes expensive. The module boundary is drawn now, so a future split is a different `go build`, not a rewrite. | 2026-08-15 |
| C12 | **The two surfaces do not share an auth gate.** The backoffice serves an authenticated professor; the API serves anonymous students who join with a room code (ADR-0009). Same process, opposite auth models — the professor session middleware never hangs off API routes. The API is also cross-origin by construction (`apps/web` lives on GitHub Pages), so CORS and cross-origin WebSocket are its concern and not the backoffice's. | 2026-08-15 |
| C13 | **The backoffice is server-rendered Go `html/template`**, no frontend build step, following DocumentBuddy's proven pattern (its ADR-002 monolithic single binary, ADR-005 clean architecture layout, ADR-016b light/dark). Its ~2000 lines of tested auth domain — users, sessions, CSRF, Google OAuth, professor CRUD, audit — are ported rather than rewritten. **(Narrowed by #150, ADR-0036: users, sessions, CSRF and Google OAuth were ported; the audit table and the invitation and impersonation flows were not, and the professor CRUD is WP-C3's.)** Consequence accepted: the backoffice will not resemble Nalanda's design system (ADR-0026). It is an internal tool, not the product. | 2026-08-15 |
| C14 | **(Promoted — see ADR-0032, authoritative from here on.)** **The server reads the bank from a published JSON artifact**, emitted by the `apps/web` build and served alongside the site, with a local-file override for development. The server therefore uses exactly the bank the students can see — the two cannot drift. Mounting the repo beside the server was rejected: it ties the deploy to a checkout and allows generating a control from questions the site does not show. | 2026-08-15 |
| C15 | **Hosting is deferred.** Development runs locally under docker-compose. The choice between DocumentBuddy's existing box (its ADR-010 Jetson Nano, ADR-014 Tailscale Funnel) and a VPS is made when there is something to deploy, informed by the spike's measurements of image size and batch reading time. | 2026-08-15 |
| C16 | **A question may have several correct answers, and every question weighs exactly one point** whatever its type. The type is DERIVED from the marks, never declared: a `type` prop would be a second source of truth able to disagree with the checkboxes the reader sees. Within a question, each alternative decided correctly earns its share of the point. AMC does not do this — measured, a simple question is worth 1 and a four-alternative multiple is worth 4, so one multiple in a four-question control would be more than half the grade, and since every copy draws its own questions the same mistake would cost different students different amounts. **The normalisation is therefore ours**: the worker reports AMC's per-question `score` and `max` (#147) and `apps/server` computes `Σ(score ÷ max) ÷ N`. Both obvious AMC formulas were measured and rejected — `haut=1` is all-or-nothing, and `b=0.25,m=0.25` awards full marks for ticking every box. Consequence worth stating: every control is worth the same by construction, so "all controls should be worth the same" needs no author discipline, which is the only version of that rule that survives random drawing. | 2026-08-16 |
| C17 | **The question type is shown differently on the page and on the sheet, on purpose.** On the page only the multiple is badged: a chapter renders ten or fifteen questions at once, and labelling every single-answer one is what stops the exception standing out. On the sheet BOTH are labelled in words: a control is four questions under a five-minute clock and the student cannot scroll back to learn a convention, so nothing is left to inference. A symbol was rejected — a glyph needs a legend, and a legend is read once at the top and forgotten by question three. Measured, the sheet needs two different levers, which is a WP-E implementation note: `\begin{question}[texto]{id}` works, `\def\multiSymbole{texto}` works for `questionmult`, and `\begin{questionmult}[texto]{id}` mangles the text. | 2026-08-16 |
| C18 | **The sheet opens with its own instructions, score and grading rule**, replacing the global line *"Marca una sola alternativa por pregunta"*, which becomes false the first time a control draws a multiple. The generator fills in that sheet's own numbers — *"el 4,0 son 2 puntos"*, not *"el 4,0 es el 50%"* — because nobody should be doing a rule of three under a clock. The same rule is taught in the opening class (#139), since a scoring model where guessing is free only works if the student knows it is free. | 2026-08-16 |

## Architecture

```
content/                          question bank, public, beside each class
   └── build (apps/web) ──────►   questions.json, published with the site
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
they mark* (two bubbles WHERE THE QUESTION ADMITS ONE, or one half-filled — on a
question that admits several, several bubbles are the answer and nothing is
flagged; #147). A sheet can have the first without
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
| B ✅ | [#139](https://github.com/so77id/nalanda/issues/139), [#144](https://github.com/so77id/nalanda/issues/144) | **Question bank in content** — authoring format, anchor resolution and its gate, the rendering component, catalog entry, published JSON; and a bank for every document on the teaching path | — |
| C1 ✅ | [#149](https://github.com/so77id/nalanda/issues/149) | **`apps/server` is born** — Go + SQLite + goose, the layered skeleton with its dependency rule enforced by a test, `/health`, the image and compose, and every process obligation below | — |
| C2 ✅ | [#150](https://github.com/so77id/nalanda/issues/150) | **Auth domain** — ported from DocumentBuddy per ADR-0009, Google OAuth, sessions, and a bootstrap address rather than a seed (ADR-0036) | C1 |
| C3 ✅ | [#151](https://github.com/so77id/nalanda/issues/151) | **Backoffice** — server-rendered layout and the professor CRUD | C2 |
| D | not refined | **Course and roster** — tables and CSV import. Canvas import noted, not assumed | C1 |
| E ✅ | [#166](https://github.com/so77id/nalanda/issues/166) | **Create a control, generate the PDF** — bank reader, AMC worker client, controls domain (Service + Store + tex generator), the three screens (list, form, detail), the two PDF downloads. `/` now redirects to `/controls` (was `/professors`). | A, B, C1–C3, **+ the paper check** |
| F | not refined | **Read scans, manual review queue** | E |
| G | not refined | **Publish grades** — spreadsheet, email, Canvas | F |

WPs D–G are deliberately unrefined. A spec written against an engine the spike
has not confirmed is fiction: if WP-A disqualifies AMC, E and F describe work we
will not do. Each is refined when its turn comes.

**C was split into three** in the design conversation of 2026-08-16, and the
split is the point rather than bookkeeping: C1 introduces a LANGUAGE — new
toolchain, new CI job, new standards document — and burying that under a
security-sensitive auth port would have made both harder to review. C1 is
shipped; it leaves a server that starts, reaches its database, answers
`/health`, and has nothing else in it.

The first real control needs **A, B and E**, grading by hand that first time —
which is worth doing anyway, to see the printed sheet before automating its
reading.

**WP-E does not start before the paper check runs** (decided 2026-08-15,
ADR-0030 §Not yet proven). Nothing earlier depends on it, so it is not a gate on
#138 — but E and F would otherwise be specified against an engine nobody has
shown can read a pencil, which is the failure the spike existed to prevent.

**B was scheduled early despite not being the first dependency**, because its
real work is the professor writing questions — the one thing nobody else can
parallelise. That reasoning held: the bank for the current teaching path is full
(#139, #144), so questions are no longer the long pole. What now stands between
here and WP-E is the paper check (ADR-0030 §Not yet proven) and C2/C3. B reopens
only when the path grows a document.

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

### What WP-C brought with it — discharged by C1 (#149)

`repository-structure.md` §How to add a new app applied in full, and Go was a
new language in the monorepo. All of it landed with C1:

- `docs/standards/backend-code-style.md`, born with the app (ADR-0005). ✅
- Its own CI job with path filters (`.github/workflows/server.yml`); its two
  testing protocols registered in `testing-strategy.md`. ✅
- Own README, own `CLAUDE.md`, own packaging; root `CLAUDE.md` and `README.md`
  edited so shared concerns stay at root. ✅
- Extension points registered in `integration-guides.md`. ✅ — with one
  deliberate deferral: *Add a backend endpoint* needs a repository to show, and
  C1 has none, so it arrives with C2.
- An ADR for C10/C11 — ADR-0034. ✅

The one thing C1 did NOT bring is hosting, still deferred by C15: there is a
Dockerfile and a dev compose service, and no VPS, no Jetson, no Tailscale, no
deploy workflow.

## Open questions

- **Roster import from Canvas.** In Chilean universities `sis_user_id` is often
  the RUT, but that depends on the institution's SIS integration and must be
  verified against the real instance, not assumed. Needs an API token. (WP-D)
- **Grade delivery order.** Spreadsheet, email and Canvas are all wanted; which
  ships first is decided once the core works. (WP-G)
- **Retention of scanned sheets.** Scans carry RUTs and grades — personal data
  under Ley 21.719. A retention and deletion policy belongs in
  `docs/security-notes.md` before WP-F ships, not after.
