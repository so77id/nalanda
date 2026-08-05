# ADR-0005: Development standards — bounded style, TDD, DocumentBuddy-style guides

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (M9, D11, D12, D13)

## Context

Most code will be written by agents under Miguel's direction. Agents improvise when
conventions are loose; a platform meant to grow for years needs the codebase to look
like one person wrote it. DocumentBuddy proved a working formula: strict conventions
+ integration guides ("how to add a new X") + documentation embedded in the dev flow.

## Decision

- **Bounded style**: code style, writing format, and folder layout are explicitly
  defined for TypeScript (frontend) and Go (backend) — as clean-architecture as
  practical, favoring ease of development. Agents follow; they do not innovate.
- **TDD**: test-first development is the default working mode (per the existing
  `tdd`/`develop-task` skills).
- **Integration guides**: for every extension point (new content component, new
  session event type, new backend endpoint, new visualizer) a guide documents how to
  add one, DocumentBuddy-style.
- **Documentation in the flow**: how-to-document is defined once and enforced by
  review — features aren't done until their docs exist. The necessary practices are
  exported from DocumentBuddy when its docs are re-read at implementation start.

## Alternatives considered

- **Conventions-by-example only** (no written standard): drifts with every agent
  session; rejected by experience.
- **Heavyweight formal architecture** (full hexagonal, etc.): ceremony beyond the
  project's size; "as clean as practical" is the bar.

## Consequences

- v0.1 foundation work includes writing the standards + guides skeleton before/along
  the first feature code.
- Reviews check documentation and catalog entries, not just code.
