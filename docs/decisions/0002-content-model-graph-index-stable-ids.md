# ADR-0002: Content model — document graph + teaching index, stable ids, DB-first design

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D1, D3, D4, D6, D7, D8)
**Amended by:** ADR-0027 §8 — a *published* slug is frozen. Every `h2`–`h4` is still
deep-linkable, with one reachable exception: a heading whose content is entirely an
element (a formula, since #118) produces no text, so no id and no anchor. The fix
changes slugs that are already live and therefore needs a migration.

## Context

A course is both a body of knowledge (navegable like a wiki) and a timeline (the
order in which a professor teaches it, jumping between topics, exercises, quizzes
and back). Content starts life as files in git but will migrate to a database when
the platform gains an editor (vision phases A→B→C).

## Decision

- **Document**: the content unit — a complete "sección/presentación". One MDX source
  can render as book, as slides, or both. Documents are **homogeneous** (no `type`
  field); what a document *is* emerges from its content. Typing may be introduced
  later by a real need.
- **Graph**: documents cross-reference each other with wiki-style links by id
  (`[[some-id]]`). The graph IS the set of documents plus their links; free
  navigation is wiki navigation.
- **Index**: a separate artifact per course — the ordered, nestable teaching path
  ("el clase a clase"). Entries reference document ids; entries are *topics*, not
  class sessions. Level names are configurable, not hardcoded. One index per course
  for now; the design must make multiple recorridos over one graph easy to add
  (future: per-semester reorders, other professors, course inheritance).
- **Stable ids, DB-first**: every document carries a stable `id` (frontmatter). The
  folder layout is merely the serialization of the logical model. Moves/renames must
  never break links or future per-student data. This makes the git→DB migration a
  storage swap, not a remodel.

## Alternatives considered

- **Tree-only model** (classic book chapters): simpler, but blocks wiki navigation
  and multi-recorrido futures; rejected.
- **Typed documents now**: designing types without real cases; deferred until a
  feature needs them.
- **Path-as-identity** (id = file path): breaks on every reorganization; rejected.

## Consequences

- Navigation, progress tracking, and sync all reference document ids — robust to
  content reorganization.
- The index file format and id scheme get detailed at v0.1 spec time.
- Authoring tools (create-class skill, future editor) target a stable logical model.
