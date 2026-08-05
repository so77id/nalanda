# ADR-0006: Backend in Go

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D12; supersedes archived ADR (POC series) 0001)

## Context

The backend starts small — auth, a professors CRUD, and a session event relay
(ADR-0008/0009) — and grows with the platform (progress, submissions, forums in the
aspirational future). It must run cheaply on a minimal VPS and handle many
long-lived socket connections (live classes) without drama.

## Decision

**Go** for the backend service, with the same rigor demanded of the frontend
(ADR-0005): clean code, explicit patterns, bounded conventions, integration guides.
Optimize for ease of development.

## Alternatives considered

- **Node/TypeScript**: one language across the monorepo and free type-sharing with
  the client. Rejected: higher RAM baseline on a minimal VPS, weaker concurrency
  story for many persistent connections; Miguel's conviction is Go. Event-type
  contracts will be shared via schema instead (defined at spec time).
- **Bun/Elysia and friends**: ecosystem maturity risk for a years-long project.

## Consequences

- Two languages in the monorepo → session event types and any future API contracts
  need an explicit sharing mechanism (schema/codegen decided at spec time).
- Single static binary deploys — fits the minimal-VPS hosting (D14).
- Goroutines map naturally to the relay's fan-out (ADR-0008).
