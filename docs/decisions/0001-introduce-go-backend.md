# ADR-0001: Introduce Go backend; abandon 100%-static principle

**Status:** Accepted
**Date:** 2026-05-20
**Decision-makers:** Miguel Rodriguez (project owner)

## Context

The current SPEC.md describes Nalanda as a 100%-static site deployable to GitHub Pages, with all execution (C++/Python via WASM) happening in the browser. This was appropriate for the POC of widgets validation.

The platform is now expanding to include:
- User accounts and authentication.
- Live class sessions with sync between professor and students.
- Tasks with submissions and grading.
- Multi-course, multi-professor administration.
- Course inheritance/forking semantics.

None of these can be implemented as a purely static frontend. A backend service is required.

## Decision

Introduce a backend service written in **Go**, abandoning the "100%-static" boundary from the original SPEC.

Stack:
- Runtime/framework: `net/http` + `github.com/go-chi/chi` (minimalist router).
- SQL: `sqlc` (generates type-safe Go from SQL queries, no runtime overhead).
- Migrations: `goose` (or `golang-migrate` — final choice in E1 spec).
- Database: PostgreSQL (Docker locally, Neon free tier in production).
- Contracts with frontend: OpenAPI 3 + `oapi-codegen` for code generation (TS types + Go handlers from a single source).

## Alternatives considered

- **Node + Hono** (initial recommendation): same language as frontend, smaller learning curve. Rejected because Go offers lower RAM (256MB vs 512MB+ Node baseline), single binary deployment, and native goroutines for SSE broadcasting.
- **Bun + Elysia**: faster but library ecosystem is less mature.
- **Stay 100% static + use a hosted backend-as-a-service** (Firebase, Supabase): rejected because of vendor lock-in and per-user-style costs that grow with scale.

## Consequences

**Positive**:
- Memory-efficient deploys (Go binaries ~10-20MB, fit comfortably in Fly.io free tier).
- Goroutine-based concurrency is well-suited to SSE/long-lived connection workloads.
- Strong typing reaches end-to-end via OpenAPI codegen.

**Negative**:
- Frontend (TS/JS) and backend (Go) speak different languages → shared contracts require codegen step (ADR-003 covers this in `packages/shared-contracts/`).
- The "100%-static" property is lost — frontend now has a runtime dependency on the backend for auth, sessions, submissions.
- Material content (`/courses/...`) remains servable as static (per ADR-0002 domain separation) — the "static fallback" UX is still achievable when backend is unreachable.

## References

- Plan file: `/Users/so77id/.claude/plans/quiero-hacer-muchos-specs-typed-stonebraker.md` (decisions G, G', H).
- Free-tier rationale: minimize-backend-cost feedback memory.
