# ADR-0010: Component contract and self-governing catalog

**Status:** Accepted
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D15, D16, D17, D18, D29)
**Amended by:** #87 (the four families are named in English — labels only, the taxonomy is unchanged; see the note inline)

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
*structure*, *semantic*, *interactive*, *media*. It is **self-governing**: each
family is defined and explained; the catalog documents how to add a component, the
documentation checklist, the review checklist, and how to change the catalog's own
rules. It serves humans and authoring agents alike.

> **Amended by #87.** These four were originally named *estructura*, *semánticos*,
> *interactivos*, *media*, while the folders they map to were already English. The
> catalog is repo documentation — it sits beside these ADRs and agents read it — so
> the names are English and the id is now the same word as the folder and the route
> segment. Labels only: same four families, same meanings, same order. The rename
> deleted `folderOf()` and the stored `folder` field, which existed solely to bridge
> the two languages, and broke `/catalog/estructura` and its siblings with no
> redirect (an internal v0.1 surface; the old segments 404).

**Inventory is emergent**: no fixed component list — components are added and evolved
as real classes need them, always through the catalog process. The catalog states
this where it shows: an empty family says nothing lives there yet by design, because
components are built when a class needs one (#87) — the surface an agent reads
before deciding whether to invent one.

## Alternatives considered

- **Storybook** (off-the-shelf catalog): heavier dependency; the catalog IS product
  surface here (authors browse it), not just a dev tool. A custom route stays in
  full control. May be revisited if maintenance cost grows.
- **Free-form components** (no contract): the POC's approach; breaks down the moment
  multiple modes and authors exist.

> **Extended by ADR-0018 §7**: heavy components are registered through a lazy
> wrapper rather than directly, guarded by a per-component L4 case.

## Consequences

- Adding a component has fixed overhead (docs + checklists) — deliberate: the
  catalog is the product's grammar and the future editor's palette.
- Mode behavior is testable per component (contract point 1 gives concrete cases).
- The catalog route ships in v0.1 and grows forever.
