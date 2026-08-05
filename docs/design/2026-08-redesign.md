# Nalanda — Redesign from zero (August 2026)

> **Living design document.** This conversation-driven redesign supersedes the May 2026
> roadmap (D1–D6 / E1–E11) entirely. Old ADRs and issues are reference material only —
> every previous decision may be challenged, rewritten, or discarded. Nothing here is
> final until Miguel signs it off. Decisions get recorded per section as we close them.

## Meta-decisions (closed)

| # | Decision | Date |
|---|---|---|
| M1 | Full reset: previous roadmap, epics, and spec issues are void. The output of this design process is the real roadmap. ADRs may be rewritten; issues closed/reopened as needed. | 2026-08-05 |
| M2 | Single course only for now. Multi-course support arrives together with a proper administration layer, later. | 2026-08-05 |
| M3 | The work methodology (capture-idea → refine-idea → groom-backlog → develop-task skills + conventions + ADRs) is already installed and current. DocumentBuddy's `wp-session`/`wp-commit` are legacy → discarded. | 2026-08-05 |
| M4 | A backend will exist: basic at first, growing with the platform. | 2026-08-05 |
| M5 | Java execution is part of the base (course language). Implementation details discussed when its section arrives. | 2026-08-05 |
| M6 | Everything about course *content* (temario, course graph, clase-a-clase) is deferred until platform v0.1 exists. Course graph (`docs/course-graph.md`) survives as planning tool. | 2026-08-05 |
| M7 | Design approach: aspirational design first (the full software we want), then cut into staged minimal versions. No rush — no tasks created until design closes. | 2026-08-05 |
| M8 | POC packaged into `proof-of-concept/` (code + archived issues). All open issues from the May roadmap documented there and closed. Repo clean: nothing open. | 2026-08-05 |
| M9 | Implementation first steps (when design closes): define folder structure + services as a self-contained monorepo; import the necessary dev standards from DocumentBuddy (clean code, TDD, etc.). | 2026-08-05 |
| M10 | Old ADRs 0001–0003 archived into `proof-of-concept/decisions/`. New ADRs will be produced by this redesign. | 2026-08-05 |

## Agenda (sections to design, in order)

Status: `pending` → `in discussion` → `closed`

1. **Visión aspiracional & actores** — what Nalanda is in its final form, who uses it. — `closed`
2. **Modelo de datos & usuarios** — how courses/users/progress are stored; roles; entities. — `closed` (detailed serialization/ID design lands at spec time)
3. **Arquitectura de sistema** — frontend/backend split, stack, hosting. Revisits old ADR-0001 from zero. — `in discussion`
4. **Componentes de contenido** — abstract containers, per-mode behavior (book/presentation/teacher/...), authoring standard, design-system catalog. — `pending`
5. **Componentes conectados / sesiones en vivo** — sockets, professor↔student sync, shared code, remote presentation advance. — `pending`
6. **Runtime de código (Java)** — execution engine decision. Old ADR-0003 as input. — `pending`
7. **Sistema de creación de clases** — authoring pipeline/skill: presentation → Nalanda class. Waits for the clase-a-clase meeting outcome. — `pending`
8. **Etapas & roadmap** — cut aspirational design into versions (v0.1 = minimum to start adding content); rewrite ADRs; open new issues. — `pending`

## Section notes & decisions

### 1–2. Visión, actores, modelo de datos

**Requirements captured so far** (Miguel, 2026-08-05):
- Design storage + users fully (aspirational), then stage down to the minimum.
- Component catalog must be a living design-system: updated whenever a component is
  created, documents design decisions + how to add components + usage examples;
  readable by humans AND by the agents that author course content.
- Future: socket-connected components — professor opens a session, presentations
  advance on students' machines, professor can mirror/control a student's session,
  code changes broadcast to all.

**Vision (Miguel's answers, 2026-08-05):**

- **What Nalanda becomes**: a platform for teaching *live classes* — programming
  first, then engineering/hard-science courses, ideally any field. Before that, it
  is Miguel's own cátedra tool: teach, study students, maybe publications, iterate
  with friends & family until mature.
- **Client-side compute philosophy** (transversal architecture principle): expensive
  work (compiling, running code) happens in the user's browser (WASM, front-side
  compilers). The server carries the minimum load possible → minimal cost. Every
  future feature should follow this philosophy.
- **Commercial ambition**: eventually a product (option b) — course creator with an
  in-platform editor (AI-assisted or manual), custom/new components, plans/billing.
  Open-source and self-hostable for free; the business lives in content aggregation
  (digital books) and student-data/AI metrics that improve the product.

**Actors (initial set)**:
- **Administradores** — platform management; an admin can also be a professor.
- **Profesores/autores** — create and teach courses.
- **Alumnos** — separate identity; in the future may authenticate via OAuth and/or a
  university API to validate course membership. Arrival channel may vary.
- **Interim rule**: until a student system exists, courses are PUBLIC (no login to
  read); course-creation and administration areas are behind login.

**Content storage — evolution path (final: DB, not git)**:
1. *Phase A (now)*: content lives in git; skills/agents help Miguel author it.
2. *Phase B*: content moves to a database; AI skills keep working against it.
3. *Phase C*: in-platform editor with AI (the product's course creator).
Each jump is discussed at its own spec time.

**Course structure**: a course is a set of content organized by an index — a
recursive tree (top-level sections at the root, subsections nested inside). Depth
names ("capítulo", "sección", …) are NOT hardcoded — configurable per course in the
end state. Each leaf file is a presentation/topic.

**Per-student state (the dream)**: progress, auto-graded tasks, other submission
types, persistent code in editors (a real work tool), LeetCode-style problem sets
with contests/leaderboards, forums — everything an online course carries.
**For now**: the student is a spectator; features arrive incrementally.

**Decisions closed in this section:**

| # | Decision | Date |
|---|---|---|
| D1 | Early versions store content as **folders/files in git — no database**. The logical model, however, is designed DB-first from day one: stable `id` per content node (frontmatter); the folder layout is just the serialization. Moves/renames must not break links or (future) progress data. Detailed design pending. | 2026-08-05 |
| D2 | **No login at all in the first versions.** Courses are fully public; authoring happens via git + skills. Auth is born together with the first server-backed feature that genuinely needs it. | 2026-08-05 |
| D3 | A **Document** is the content unit: a complete "sección/presentación". A single source can render as book, as slides, or both — the content decides. | 2026-08-05 |
| D4 | Course content is a **graph, not just a tree**: wiki-like navigation with cross-references between documents. On top of it lives an **index** — the ordered teaching path (based on how Miguel runs the class, dependency-aware). The system must support both; ideas iterate as the first course gets written. | 2026-08-05 |
| D5 | **Hito 1 (first milestone)**: presentation synchronized professor→students (live class), plus some real content built with the components. From there, features grow clase a clase, driven by need. | 2026-08-05 |

| D6 | **Documents are homogeneous** (no `type` field for now). What a document *is* emerges from its content and components. Typing may be introduced later if a feature needs it — migrate then. Rationale: object dependencies + structure should make a future editor easy; don't design types without real cases. | 2026-08-05 |
| D7 | **Graph = curso, índice = recorrido.** Multiple recorridos over one graph are plausible futures (per-semester reorder, other professors, inheritance) — the design must make adding them easy, but **first implementations ship exactly one index per course**. | 2026-08-05 |
| D8 | An index entry is a **topic, not a class session**. The index is the course *timeline* ("el clase a clase"): during a live class Miguel jumps topic → exercise → video → quiz → task → material → back, driving it manually. Timeline may differ per semester as it matures. *Future note*: "material" and "curso" may split — a curso pulling from several materiales. | 2026-08-05 |
| D9 | **Hito 1 scope confirmed**: professor opens a session and gets a code; students join with the code, no login; server only relays events (professor's current position), no persistence; late joiners snap to current state. A student can **leave sync mode to explore freely** (wiki links + index) and return to sync. | 2026-08-05 |

**Section 1–2 status: CLOSED.** Remaining fine-grained design (stable-ID scheme,
folder serialization, index file format) happens at spec time for the corresponding
implementation tasks.

### 3. Arquitectura de sistema

**Inputs/constraints already decided**: client-side compute philosophy (vision);
hito 1 needs only a tiny event-relay server (no auth, no persistence); content =
files in git rendered by a public static frontend; self-contained monorepo (M9);
old ADR-0001 (Go + chi + sqlc + Postgres + OpenAPI) is reference input, re-decided
from zero.

*(open — under discussion)*
