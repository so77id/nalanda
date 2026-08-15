# ADR-0009: Professor-only authentication via Google OAuth

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D2, D19)

## Context

The guiding rule: auth is born with the first server feature that genuinely needs
it. That feature is opening live sessions (ADR-0008) — without a gate, anyone could
open "the parallel cátedra". Meanwhile course _reading_ must stay public (no student
accounts exist yet; the interim rule keeps content open to everyone).

## Decision

- A **basic user system** ships with the backend: **Google OAuth** login, user table
  (SQLite, ADR-0007), and a user administrator.
- **Only professor logins exist.** Miguel's user arrives via **seeds**; a professors
  CRUD manages friends & family accounts, curated by Miguel.
- Logged-in professors see the **administration section** and the **open session**
  action. Nothing else on the site requires login.
- Students remain anonymous spectators: they read publicly and join sessions with a
  code — no accounts. Student identity (OAuth, university-API validation) is a
  separate future decision.

## Alternatives considered

- **No auth + shared secret link** for opening sessions: 5-line solution, but Miguel
  chose to plant the real user system now — it is the seed of the professor role,
  admin area, and future account features.
- **Full user system with students**: far ahead of need; rejected for now.

## Consequences

- The backend gains DB + OAuth flow earlier than a pure relay would need — accepted
  as the first deliberate step toward the platform's administration domain.
- Course content remains cacheable/public (no per-user content responses).
- Google is the only identity provider for now.
