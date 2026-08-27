# Design — Entrance controls ("controles de entrada")

> Design narrative for the assessment subsystem: a printed multiple-choice quiz
> at the start of each class, covering the previous class, scanned and graded
> automatically. Companion to `2026-08-redesign.md`, which this extends — it
> pulls v0.3's backend forward and gives it its first module.
>
> **Status:** design closed. **V1/V2 split decided 2026-08-16 (C19).** V1 ships
> the whole paper flow without a roster or student identity — the RUT read off
> the sheet is the only identifier that matters. V2 adds the student roster,
> Canvas import and identity resolution; WP-D lives there, captured as
> [Discussion #163](https://github.com/so77id/nalanda/discussions/163).
>
> **WP-A shipped** (#138) — the engine is confirmed
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
> the port cost no dependency. **WP-C3 shipped** (#151, PR #164) — the
> backoffice shell and the professor CRUD; unchanged by the V1/V2 split
> (all professors administer the single implicit course). **WP-E shipped**
> (#166, PR #168) — the professor picks a section range from the published
> bank, the AMC worker generates the PDF, and every control is persisted
> with its pool and its per-copy identity. `/` now redirects to `/controls`.
> **WP-F shipped** (#167, PR #170) — the Escaneos box turns live, the
> reader loop persists per-copy readings and overrides, the side-by-side
> review page ships, and *Cerrar corrección* moves a control to `graded`.
> **WPs D and G are V2** and captured in
> [Discussion #163](https://github.com/so77id/nalanda/discussions/163)
> until they earn their turn (V1 grades live in the database and on the
> web table; a query against the SQLite file gets them out if needed
> before V2).
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
| C15 | **Hosting is deferred; the first test bed is DocumentBuddy's Jetson, with CI publishing to GHCR and Watchtower pulling on the box.** Development runs locally under docker-compose. WP-C2 (#150) made something to deploy — the professor login — and #162 put it on DocumentBuddy's Jetson Nano behind Tailscale Funnel on port 8443 (DocumentBuddy's ADR-010, ADR-014). #175 co-hosted `apps/amc-worker` on the same box, so a real end-to-end control (`apps/server` calling the worker over the compose network) works in production. GitHub Actions cross-compiles arm64 images to `ghcr.io/so77id/nalanda-*:latest` on every push to `main` — one workflow per app (`server-cd.yml` and `amc-worker-cd.yml`, separated because texlive under QEMU takes ~30 minutes and shouldn't queue a server push) — and Watchtower (shared with DocumentBuddy) pulls them within ≤5 minutes. That is a **test bed, not a home**: the choice between staying there permanently and moving to a VPS is still open, and ADR-0038 records the measurements the permanent decision will need — image size on arm64, running-container footprint (now including amc-worker's RSS as a Nano co-tenant), and cost. See also ADR-0038's re-deferrals of the five WP-C2 review triggers that fire at the first deploy. | 2026-08-15, revised 2026-08-17, extended 2026-08-18 (#175) |
| C16 | **A question may have several correct answers, and every question weighs exactly one point** whatever its type. The type is DERIVED from the marks, never declared: a `type` prop would be a second source of truth able to disagree with the checkboxes the reader sees. Within a question, each alternative decided correctly earns its share of the point. AMC does not do this — measured, a simple question is worth 1 and a four-alternative multiple is worth 4, so one multiple in a four-question control would be more than half the grade, and since every copy draws its own questions the same mistake would cost different students different amounts. **The normalisation is therefore ours**: the worker reports AMC's per-question `score` and `max` (#147) and `apps/server` computes `Σ(score ÷ max) ÷ N`. Both obvious AMC formulas were measured and rejected — `haut=1` is all-or-nothing, and `b=0.25,m=0.25` awards full marks for ticking every box. Consequence worth stating: every control is worth the same by construction, so "all controls should be worth the same" needs no author discipline, which is the only version of that rule that survives random drawing. | 2026-08-16 |
| C17 | **The question type is shown differently on the page and on the sheet, on purpose.** On the page only the multiple is badged: a chapter renders ten or fifteen questions at once, and labelling every single-answer one is what stops the exception standing out. On the sheet BOTH are labelled in words: a control is four questions under a five-minute clock and the student cannot scroll back to learn a convention, so nothing is left to inference. A symbol was rejected — a glyph needs a legend, and a legend is read once at the top and forgotten by question three. Measured, the sheet needs two different levers, which is a WP-E implementation note: `\begin{question}[texto]{id}` works, `\def\multiSymbole{texto}` works for `questionmult`, and `\begin{questionmult}[texto]{id}` mangles the text. | 2026-08-16 |
| C18 | **The sheet opens with its own instructions, score and grading rule**, replacing the global line *"Marca una sola alternativa por pregunta"*, which becomes false the first time a control draws a multiple. The generator fills in that sheet's own numbers — *"el 4,0 son 2 puntos"*, not *"el 4,0 es el 50%"* — because nobody should be doing a rule of three under a clock. The same rule is taught in the opening class (#139), since a scoring model where guessing is free only works if the student knows it is free. | 2026-08-16 |
| C19 | **The system ships in two versions, and V1 has no roster.** V1 delivers the whole paper flow — create a control, print, scan, read, grade — with the RUT read off the sheet as the only identifier. Nothing joins the RUT to a person; the professor recognises the grade against the RUT they already know. V2 adds student identity, the Canvas import and the tables that hang off it. The pre-refinement data model already contemplated the split — `lectura.alumno_id?` is nullable — but WP-E and WP-F would otherwise have been specified against a roster that does not exist yet and cannot exist without institutional wiring (a Canvas Developer Key, or resolving where the RUT lives in UDP's Canvas: `sis_user_id`, `login_id` or a custom field, unknown until inspected). V1's paying customer is Miguel's next class; V2 is what makes reporting nice. **Consequences:** V1's `readings` table stores `rut_leido` with no foreign key; the manual review queue's failure modes are unchanged (the two below already worked with `alumno_id` empty); V2 arrives as a migration that populates `student_id` retroactively from a Canvas-sourced roster. All C3 professors administer the single implicit course; the courses/students/enrolments tables are V2's. | 2026-08-16 |

## Architecture

```
content/                          question bank, public, beside each class
   └── build (apps/web) ──────►   questions.json, published with the site
                                        │
                                        ▼  HTTP (C14)
apps/server  (one Go binary)
   internal/domain/auth/          users, sessions, OAuth        (ported)
   internal/domain/course/        courses, students, enrolment  (V2 only)
   internal/domain/controls/      controls, copies, readings, grades
   internal/domain/session/       live-class relay (ADR-0008, later)
   internal/app/web/              backoffice, server-rendered   (professor)
   internal/app/api/              JSON/WS                       (anonymous)
                                        │
                                        ▼  shared volume + HTTP (C9)
amc-worker  (separate container)   generate PDFs · read scans · annotate
```

### Data model

**V1 — what ships (no roster):**

```
control            id, nombre, fecha, desde_ancla, hasta_ancla,
                   n_preguntas, n_copias, estado
                   [+ issue #197: marcado, inseguro — the darkness pair the
                    batch was read at; travels end-to-end, see ADR-0041]
control_pregunta   control_id, pregunta_ref, puntaje
copia              id, control_id, numero              ← one printed sheet, its own draw
lectura            copia_id, rut_leido, estado         ← rut_leido is the identifier
respuesta          copia_id, pregunta_ref, marcada, correcta
nota               control_id, rut_leido, puntaje, nota  ← indexed by RUT, not student
archivo            control_id, tipo, ruta
```

**V2 — the roster arrives (added by a future migration):**

```
curso              id, nombre, semestre                (new)
alumno             id, rut(8), nombre, correo          (new, global not per course)
inscripcion        curso_id, alumno_id                 (new)
```

…and the V1 tables gain `curso_id` on `control`, `alumno_id?` on `lectura` and
`archivo`, and `alumno_id` on `nota` — with the migration walking historical
`rut_leido` values and filling `alumno_id` where the RUT matches an alumno the
V2 roster brought.

Three properties of this shape matter more than they look:

**V1 uses `rut_leido` as the identifier and V2 fills in the person behind it.**
Nothing in the pre-refinement model said `alumno_id` was mandatory — `lectura.alumno_id?` was already nullable — so V2 is additive, not
a rewrite. What V1 gives up is a report that says "Fulana got 5.8"; what it
keeps is every grade tied to its RUT, ready to be joined the day the roster
exists.

**`alumno` is global and `inscripcion` hangs it off the course.** V2 only.
When the roster later comes from Canvas or the university's system, the students
already exist and the import becomes an upsert rather than a migration.

**`lectura.estado` is what makes the manual queue work**, and it works the same
in V1 and V2. Two distinct failures were foreseen here; the spike found a
**third**, and the contract is now owned by ADR-0031 — *what is missing*: the
copy printed questions the batch never captured, which is a page that never
reached the scanner. Unlike the two below, that one cannot be repaired at a
keyboard. The two foreseen are: *who is this* (in V1, RUT unreadable; in V2,
RUT unreadable or not on the roster) and *what did they mark* (two bubbles
WHERE THE QUESTION ADMITS ONE, or one half-filled — on a question that admits
several, several bubbles are the answer and nothing is flagged; #147). A sheet
can have the first without the second — and in that case, typing the RUT
completes it and nothing else is touched.

## The professor's flow

**V1 — the paper flow, no roster:**

1. Create a control: a section range (from document+section to document+section,
   in reading order), how many questions per copy and how many copies. The
   server draws each copy independently from the range's pool.
2. Print the generated PDF. Copies carry a printed identifier and an 8-digit
   RUT grid; nothing on the sheet names a student.
3. Run the control. Students bubble their RUT and their answers.
4. Scan the pile as one multi-page PDF and upload it. Sheets may be out of order.
5. The system reads it and writes a grade per **`(control, rut_leido)`**.
6. Review: the grade sheet indexed by RUT, with links to the original and the
   annotated file, the per-question detail, and a queue of what could not be
   read — where the professor types the RUT, and answers the machine did read
   stay filled in.
7. Export the grades as a CSV (RUT + score) for wherever they need to land.
8. Later, in V2: annotated per-student PDFs and their delivery.

**What V2 changes** (roster from Canvas): step 1 picks a course from a list;
step 5 also resolves each RUT against the enrolled roster; step 6 shows names
next to RUTs; step 7 grows email delivery and Canvas grade posting.

## Roadmap

| WP | Version | Issue | Scope | Depends on |
|----|---------|-------|-------|-----------|
| A ✅ | V1 | [#138](https://github.com/so77id/nalanda/issues/138) | **AMC worker** — the spike, its acceptance list, the container and its HTTP contract, and the ADR recording engine choice | — |
| B ✅ | V1 | [#139](https://github.com/so77id/nalanda/issues/139), [#144](https://github.com/so77id/nalanda/issues/144) | **Question bank in content** — authoring format, anchor resolution and its gate, the rendering component, catalog entry, published JSON; and a bank for every document on the teaching path | — |
| C1 ✅ | V1 | [#149](https://github.com/so77id/nalanda/issues/149) | **`apps/server` is born** — Go + SQLite + goose, the layered skeleton with its dependency rule enforced by a test, `/health`, the image and compose, and every process obligation below | — |
| C2 ✅ | V1 | [#150](https://github.com/so77id/nalanda/issues/150) | **Auth domain** — ported from DocumentBuddy per ADR-0009, Google OAuth, sessions, and a bootstrap address rather than a seed (ADR-0036) | C1 |
| C3 ✅ | V1 | [#151](https://github.com/so77id/nalanda/issues/151) | **Backoffice** — server-rendered layout and the professor CRUD. All professors administer the single implicit V1 course | C2 |
| E ✅ | V1 | [#166](https://github.com/so77id/nalanda/issues/166) | **Create a control, generate the PDF** — range of sections + N copies. No course selector (implicit; V2 adds it) | A, B, C1–C3, **+ the paper check** |
| F ✅ | V1 | [#167](https://github.com/so77id/nalanda/issues/167) | **Read scans, manual review queue** — the Escaneos box turns live, `/analyse` runs from a PDF upload, readings/answers/overrides persist through `controls.ReadingStore`, the results table + side-by-side review page ship, and *Cerrar corrección* moves the control to `graded`. Grades indexed by `rut_leido`; the review queue exists for RUTs the scanner cannot read (no roster to match against in V1). Rider on the paper check (§Not yet proven) — the reader is not confirmed. | E, **+ paper check** |
| #190 ✅ | V1 | [#190](https://github.com/so77id/nalanda/issues/190) | **Every copy ends with its corrected PDF** — AMC annotates one copy per call (`/annotate/copy`), patched through `capture_zone.manual` so the PDF reflects the professor's overrides (ADR-0048). Auto after upload for `ok` copies, re-generated on every review save; the review page embeds it and falls back to the raw scan. `OnCorrectionClosed` hook fires on close (no-op today). Files named `copy-N.pdf` — NO roster involved; the per-student naming stays in G | E, F |
| D | V2 | [Discussion #163](https://github.com/so77id/nalanda/discussions/163) | **Course and roster, Canvas import** — the roster tables, the Canvas GraphQL fetch, and the migration that populates `student_id` retroactively on V1's historical readings | C1, and a Canvas token (Miguel generates one in his UDP account) |
| G | V2 | [Discussion #163](https://github.com/so77id/nalanda/discussions/163) | **Publish grades and per-student annotated PDFs** — CSV export, email, Canvas grade posting; and **one annotated PDF per student**, invoking `apps/amc-worker`'s `/annotate` with the real roster D provides (files nombrados por alumno, no por `copy-N`). The copy-numbered annotated PDF shipped in #190 (ADR-0048) without a roster; what remains for G is the per-STUDENT naming plus delivery. Runs retroactively over V1 readings the day D lands, because `readings.rut_read` + `rut_override` already carry the identity `/annotate` needs. Moved to V2 (2026-08-17): V1 grades live in the database and on the web table; if Miguel needs to move them somewhere else before V2, a query against the SQLite file gets them out. Per-student annotated PDF confirmed as V2 (2026-08-17, refinement conversation) — /annotate needs a roster, WP-D delivers it, doing it in V1 would be a synthesised roster hack | D, F |

**C was split into three** in the design conversation of 2026-08-16, and the
split is the point rather than bookkeeping: C1 introduces a LANGUAGE — new
toolchain, new CI job, new standards document — and burying that under a
security-sensitive auth port would have made both harder to review. C1 is
shipped; it leaves a server that starts, reaches its database, answers
`/health`, and has nothing else in it. C3 is unchanged by the V1/V2 split — a
single course does not remove the need for multiple professors to administer it.

**V1 has no roster**, so E and F describe exactly the paper flow above and
nothing about student identity. E and F have shipped; G moved to V2 on
2026-08-17 because Miguel does not need CSV export until V2 lands, and V1
grades are reachable by a query against the SQLite file if he does. D was
previously "not refined"; it is now V2 and captured as a Discussion in
💡 Ideas, with the design decisions closed on 2026-08-16 (Canvas GraphQL over
CSV, token pegado, upsert, retirada por `withdrawn`, alumnos globales +
enrollments) attached to it so V2 does not re-discuss what V1 already answered.

The first real control needs **A, B, C3 and E**, grading by hand that first
time — which is worth doing anyway, to see the printed sheet before automating
its reading.

**WP-E does not start before the paper check runs** (decided 2026-08-15,
ADR-0030 §Not yet proven). Nothing earlier depends on it, so it is not a gate on
#138 — but E and F would otherwise be specified against an engine nobody has
shown can read a pencil, which is the failure the spike existed to prevent.

**B was scheduled early despite not being the first dependency**, because its
real work is the professor writing questions — the one thing nobody else can
parallelise. That reasoning held: the bank for the current teaching path is full
(#139, #144), so questions are no longer the long pole. What now stands between
here and WP-E is the paper check (ADR-0030 §Not yet proven) and C3. B reopens
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

**Hosting is no longer only a plan (revised 2026-08-17, #162).** C15 as
originally written said "no VPS, no Jetson, no Tailscale, no deploy workflow";
all four are now false. `apps/server` runs on DocumentBuddy's Jetson Nano
behind Tailscale Funnel on port 8443, with a daily S3 backup, a Telegram
health monitor, and — since S11/S12 of the same WP —
`.github/workflows/server-cd.yml` that cross-compiles arm64 images on every
push to `main`, pushes them to GHCR, and Watchtower on the Jetson (shared
with DocumentBuddy) pulls them within 5 minutes. There is still no VPS —
ADR-0038 records why the Jetson is a test bed rather than a permanent home,
and the permanent choice is still open.

## Open questions

- **Where the RUT lives in UDP's Canvas.** In Chilean universities `sis_user_id`
  is often the RUT, but that depends on the institution's SIS integration and
  must be verified against the real instance, not assumed. Needs a personal
  access token generated in `https://udp.instructure.com/` → Account →
  Settings → New Access Token, then explored in `/graphiql`. **V2** — blocks
  WP-D, does not block V1.
- **V1's grade export shape.** CSV is decided (C19); the exact columns and
  whether it also lands as a Google Sheet the professor keeps open in another
  tab is a WP-G decision. Email and Canvas grade posting are V2.
- **Retention of scanned sheets.** Scans carry RUTs and, in V1, no other PII
  because the sheets never name a person — a RUT alone is still personal data
  under Ley 21.719. A retention and deletion policy belongs in
  `docs/security-notes.md` before WP-F ships, not after.
