# ADR-0010: Component contract and self-governing catalog

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D15, D16, D17, D18, D29)

## Context

Documents are built from components (ADR-0003); authors include agents and, one day,
a course editor with custom components. Without a hard contract and a living
catalog, every component invents its own behavior and the "one system" feel dies.

## Decision

**Render modes (v1)**: `book` (wiki-like reading) and `presentation` (the same
document as slides — each page configures what appears in each). `presenter` (private
notes/controls) is future. Sync is a navigation state layered on top, not a render
mode (relationship detailed with ADR-0008 at spec time).

**Every catalog component must satisfy the contract:**
1. **Explicit render per mode** — no component may ignore a mode (even if the answer
   is "I don't appear").
2. **Typed props schema** (TypeScript) — the public contract.
3. **Mandatory catalog entry** — usage docs, when-to-use, live examples. A PR adding
   a component without its catalog entry fails review.
4. **Reserved optional sync interface** — which session event types it emits/consumes
   (ADR-0008); designed per component when needed.
5. **Client-side compute** (ADR-0001) for any heavy work.
6. **Feature-toggle props** — capabilities switch on/off per instance (e.g., editor:
   editable vs copy-only; panels shown/hidden).
7. **Composition** — abstract components may receive/render injected components
   (e.g., a "proyector" rendering structure applets; future line-by-line code stepper
   with synchronized drawing).

**Catalog**: a live route (`/catalog`) organized in four editable families —
*estructura*, *semánticos*, *interactivos*, *media*. It is **self-governing**: each
family is defined and explained; the catalog documents how to add a component, the
documentation checklist, the review checklist, and how to change the catalog's own
rules. It serves humans and authoring agents alike.

**Inventory is emergent**: no fixed component list — components are added and evolved
as real classes need them, always through the catalog process.

## Alternatives considered

- **Storybook** (off-the-shelf catalog): heavier dependency; the catalog IS product
  surface here (authors browse it), not just a dev tool. A custom route stays in
  full control. May be revisited if maintenance cost grows.
- **Free-form components** (no contract): the POC's approach; breaks down the moment
  multiple modes and authors exist.

## Consequences

- Adding a component has fixed overhead (docs + checklists) — deliberate: the
  catalog is the product's grammar and the future editor's palette.
- Mode behavior is testable per component (contract point 1 gives concrete cases).
- The catalog route ships in v0.1 and grows forever.
