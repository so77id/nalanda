# ADR-0012: Content pipeline implementation — YAML index, MDX toolchain, wiki: resolution

**Status:** Accepted
**Date:** 2026-08-06
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #63 (WP2, content model). Extends ADR-0002 (which deferred the
index format to v0.1) and ADR-0003 (which chose MDX but not the toolchain).

## Context

WP2 turned the content model design into running code, forcing four deferred
decisions: the index file format, the concrete MDX toolchain, when wiki-links
resolve, and the prose styling approach. All are library/format commitments the
rest of the platform (authoring skill, catalog, presentation mode) will build on.

## Decision

1. **Course index = `index.yaml`** (per course, `content/courses/<slug>/index.yaml`),
   parsed with the `yaml` package. The index is **data, not code**: it keeps the
   Material/Administration separation (no TS inside `content/`, no type imports
   from the app), ports trivially to the phase-B DB, and is writable by authoring
   agents and the future editor. The type-safety loss is compensated by **strict
   build-time validation** with field-path error messages (unknown keys, group
   entries without label, duplicate/unknown docIds all fail the build).

2. **MDX toolchain**: `@mdx-js/rollup` (enforce: pre) + `remark-frontmatter` +
   `remark-mdx-frontmatter` + our own `remarkWikiLinks`, with components mapped
   through the `@mdx-js/react` provider (links, headings).

3. **contentIntegrity Vite plugin** (`apps/web/src/content/contentIntegrity.ts`),
   dual purpose: (a) `buildStart` validates the whole `content/` tree — invalid
   or duplicate frontmatter ids and index violations **fail `vite build` and dev
   startup** (plain `vite build` never evaluates app modules, so runtime checks
   alone would ship a white screen); (b) serves `*.mdx?frontmatter` **virtual
   modules** so the registry loads metadata eagerly WITHOUT importing compiled
   documents — bodies stay code-split, one lazy chunk per document.

4. **Wiki-links resolve at render time**: the remark plugin is purely syntactic
   (`[[id]]` → `wiki:id` link node); `MdxLink` resolves against the registry when
   rendering. Unresolved targets are a **soft failure** (visibly broken style +
   one console warning), NOT a build failure — authors may hold forward links to
   drafts. Index `docId`s, by contrast, are hard build failures (the recorrido
   must always be walkable). `MdxLink` also refuses unsafe URL schemes
   (`javascript:` etc.) and hardens external links with `rel`.

5. **Book-mode prose via `@tailwindcss/typography`** (`prose` classes) instead of
   hand-rolled tokens — battle-tested reading defaults for MDX output; heading
   anchors come from our own factory (no extra rehype dependency).

## Alternatives considered

- **`index.ts` typed index**: editor-time type safety, but code inside the
  Material domain, an inverted import direction (content → app types), and a
  hostile artifact for the DB/editor phases. Rejected.
- **Eager import of MDX modules for metadata**: simplest registry, but every
  document body lands in the entry chunk — unbounded bundle growth into v0.2.
  Rejected (was briefly shipped, caught in review).
- **Build-time wiki-link resolution/failure**: stricter, but couples the remark
  plugin to the content tree and blocks draft workflows. Deferred — a build-time
  link _report_ can tighten this later without changing the format.
- **Custom prose CSS under design tokens**: full control, dozens of rules to
  maintain before any real need. Rejected for v0.1.

## Consequences

- Content contract violations surface at build/CI time (CI now triggers on
  `content/**`), before any deploy.
- **Publication is glob-driven** (recorded with #66/ADR-0015): presence under
  `content/courses/` publishes a document at `/d/<id>`; `index.yaml` controls
  navigation only. Material that must not be public lives outside that tree —
  see `docs/security-notes.md` §Accepted invariants.
- Authoring is documented in `docs/standards/guides/add-a-course-document.md`;
  the create-class skill (v0.2) targets that contract.
- v0.1 runtime asserts exactly ONE course directory; multi-course requires
  widening `liveContent.ts` (and this ADR's index-discovery rule).
- The `?frontmatter` virtual-module pattern is the template for any future
  metadata-only import (e.g., presentation mode slide metadata).
