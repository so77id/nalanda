# ADR-0002: Course Material domain is separated from Course Administration domain

**Status:** Archived 2026-08-05 — superseded by the from-zero redesign (`docs/design/2026-08-redesign.md`). Kept as reference.
**Date:** 2026-05-20
**Decision-makers:** Miguel Rodriguez

## Context

A course in Nalanda has two conceptually distinct aspects that have been entangled in many similar platforms (Moodle, Canvas, etc.):
- Its **material**: the chapters, sections, MDX content, embedded widgets, slide markers — the textbook itself.
- Its **administration**: enrollments, live class sessions, submissions, progress per student, events.

If these are entangled in code, several desirable properties become impossible or expensive:
- Public read-only access to course material (a "visitor" mode for prospective students, public textbook, search-engine-indexed previews) requires that material can be served without auth, enrollment, or per-user state.
- CDN caching of content (fast page loads, edge serving) requires that responses are not per-user.
- Specs for content authoring should not be entangled with specs for grading.

## Decision

**Treat Course Material and Course Administration as separate domains** throughout the system:

### Material Domain
- **What lives here**: courses, course_versions, sections (text, MDX, widgets), slide markers, assets (images, PDFs).
- **Characteristics**: static, read-heavy, no per-user state, potentially public.
- **API surface**: `/api/content/...`. Cacheable. May or may not require auth (future visitor mode possible).
- **Frontend routes**: `/courses/<slug>/learn/...`. Could be made public.
- **Storage** (phase 1): MDX files in repo, bundled by Vite. (Phase 2+: TBD per O' decision.)
- **Cache strategy**: aggressive CDN/edge cache, invalidation on deploy.

### Administration Domain
- **What lives here**: users, enrollments, sessions, submissions, progress, session_events, tasks.
- **Characteristics**: dynamic, per-user state, write-balanced, private.
- **API surface**: `/api/admin/...`, `/api/sessions/...`, `/api/submissions/...`. Requires auth + role/enrollment check on every request.
- **Frontend routes**: `/courses/<slug>/study/...`, `/sessions/<code>`, `/teacher/...`, `/admin/...`.
- **Storage**: PostgreSQL (Postgres + sqlc).
- **Cache strategy**: no shared cache; response per-user.

### Cross-domain rules
- Administration tables MAY foreign-key to Material entities (e.g., `enrollments.course_version_id`, `sessions.current_section_id`).
- Material tables MUST NOT reference Administration entities. The Material domain has zero awareness of who's using it.
- Specs are scoped to one domain. A spec about content authoring lives in the Material domain; a spec about session sync lives in Administration. If a spec needs both, it's typically too large and should be split.

## Alternatives considered

- **Single domain (the default for naive ed-tech platforms)**: everything in one set of tables, one API surface, one set of routes. Simpler short-term, but blocks future visitor mode and forces auth on content reads forever.
- **Microservices (a separate "content service" and "admin service")**: same logical separation but with network/process boundary. Overkill for our scale; we get the conceptual separation without the operational complexity.

## Consequences

**Positive**:
- Visitor mode (public textbook) becomes a feature we can add without architectural surgery — just remove the auth middleware from `/api/content/...` and `/courses/<slug>/learn/...`.
- CDN caching of content is straightforward.
- Specs stay focused — content specs don't drag in submission tracking, and vice versa.
- Mental model is clean: "is this about *what's in the book* or *who's doing what*?"

**Negative**:
- Requires discipline to enforce — easy to accidentally let Administration leak into Material specs.
- Slightly more route/endpoint structure to maintain.

## References

- Plan file: decision X (the most-important architectural decision per the planning conversation).
- Memory: `feedback_domain_separation.md`.
