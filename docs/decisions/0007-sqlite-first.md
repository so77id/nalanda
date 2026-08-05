# ADR-0007: SQLite first, Postgres when genuinely needed

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D19, D23)

## Context

The first database need is tiny: professor users (Miguel + friends & family via a
CRUD) and auth records. Hosting is a minimal VPS (or local); operating a database
service years before its scale arrives is pure cost. DocumentBuddy validated the
SQLite-no-CGO pattern in production.

## Decision

**SQLite** as the database, running inside the production container with its file on
a **persistent disk** so restarts survive. The Go repository layer is designed so
that swapping to **Postgres** later is a localized change (repositories hide the
engine; no SQLite-isms leak upward). The swap happens when a real need appears
(multi-tenant scale, concurrent writers, managed backups).

## Alternatives considered

- **Postgres from day one** (the archived plan's choice): operational complexity and
  either container orchestration or a paid/free-tier external service — all before
  any real load exists. Rejected for now.
- **Flat files/JSON**: no query/consistency story once sessions and progress arrive.

## Consequences

- Zero extra services to operate; backups = copying a file.
- Deployment must mount/attach a persistent volume for the DB file.
- Repository-layer discipline is mandatory (enforced via ADR-0005 standards) to keep
  the Postgres path cheap.
