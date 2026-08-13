# ADR-0003: MDX as the document format

**Status:** Accepted
**Amended by:** ADR-0024 (an intrinsic element the shell maps to a component is
also available inside documents, without a catalog entry)
**Date:** 2026-08-05
**Decision-makers:** Miguel Rodriguez
**Source:** Redesign session (D26; content requirements from D3/D15)

## Context

Documents must mix prose with interactive components (visualizers, code editors,
exercises) in a single source that renders both as book pages and as slides. The
format must be writable by humans, by authoring agents (create-class skill), and by
a future in-platform AI editor.

## Decision

**MDX** is the document format: Markdown for prose, catalog React components inline
where interaction is needed, YAML frontmatter for metadata (stable `id`, title, …),
and `[[wiki-links]]` for cross-references (resolved by our pipeline).

```mdx
---
id: bst-insercion
title: Inserción en un BST
---
## La idea
Para insertar comparamos con la raíz...

<Visualizador estructura="bst" operacion="insert" valores={[50, 30, 70]} />

Relacionado: [[busqueda-binaria]]
```

## Alternatives considered

- **Plain Markdown + shortcodes**: weaker component embedding, custom parser burden.
- **JSON/structured blocks** (Notion-style): editor-friendly but hostile to git
  diffs, human authoring, and agents today; may be revisited at the DB/editor phase.
- **HTML/JSX pages**: full power but loses prose ergonomics for course writing.

## Consequences

- Authoring is file-based and git-friendly (phase A) and remains parseable for the
  DB migration (phase B) and editor (phase C).
- Requires an MDX compile step in the frontend build (Vite plugin, ADR-0004).
- Components available inside documents are exactly those registered by the catalog
  (ADR-0010) — the authoring surface is controlled.

  > **Amended by ADR-0024.** True
  of *named* components only. An intrinsic element the shell maps to a component
  — a code fence since #85 — has no catalog entry, by design and not by omission.
