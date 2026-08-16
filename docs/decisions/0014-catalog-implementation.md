# ADR-0014: Catalog implementation — entry model, registry, enforcement

**Status:** Accepted
**Date:** 2026-08-10
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #65 (WP4, component catalog). Extends ADR-0010 (component
contract and self-governing catalog), which decided the catalog exists, named
the four families, and deferred its shape to v0.1.
**Amended by:** #87 (§6 — family ids are English and are their own folder; the
id↔folder mapping this ADR described no longer exists)

## Context

ADR-0010 made a catalog entry mandatory for every content component but fixed no
shape for it, no place to keep it, and no way to enforce it. WP4 turned contract
point 3 into running code, which forced decisions about the entry model, how
entries reach the catalog, and what a machine can check.

## Decision

1. **Entry model** — `CatalogEntry` (`lib/catalogEntry.ts`): `name`, `family`,
   `description`, `whenToUse`, a hand-authored `props` table
   (`{name, type, default?, description}`), and `examples`
   (`{title, code, render}`). The type lives in `lib/` so a colocated entry
   never imports the catalog feature (cycle avoidance, as with `componentMeta`).
   **Accepted limits**: the props table is prose, not derived from the component's
   TS interface, and each example's `code` string is written beside its `render`
   component — both can drift from the implementation, and nothing detects it.
   The entry covers ADR-0010 contract points 2 and 3 only; there is no field for
   point 1 (per-mode behavior — it is proven by tests and shown by the examples)
   nor point 4 (sync interface — nothing emits session events yet). Fields get
   added when a component needs them, not speculatively (D29).

2. **Entries are colocated and reach the catalog through their feature's seam**:
   `<Component>.catalog.tsx` beside the component, aggregated in an explicit
   array, consumed by `catalog/registry.ts`. Chosen over `import.meta.glob`
   auto-discovery: the explicit array is greppable, the registry stays a pure
   function testable with fixtures, and a forgotten export is caught by the
   completeness gate anyway.

   **Amended by #122 (2026-08-16): the array is no longer ON the seam, it is
   BEHIND it.** It lives in `components/catalogEntries.ts` and the seam exposes
   `loadCatalogEntries()`, a dynamic import; `catalog/registry.ts` follows with
   `loadCatalog(): Promise<Catalog>` and the pages read it through `use()` under
   one Suspense boundary. The reason is that the shell reaches the components
   seam eagerly to build the MDX map, so a static array there put every entry's
   prose — author documentation — in the payload of every course page: 38.45 kB
   raw / 12.86 kB gzip, measured, and growing with each component (5.45 kB gzip
   when it was first noticed, four WPs earlier). A function rather than a
   re-export is load-bearing: `export { catalogEntries } from './catalogEntries'`
   is a static edge and puts it straight back. Nothing about *what* an entry is
   or *where* it is written changed — only where the aggregation lives.

3. **The catalog set equals the MDX-registered set** — asserted in both
   directions (`app/mdxComponents.test.ts`). A document-facing component must
   have an entry (ADR-0010 point 3), and a catalogued component must be nameable
   in a document, otherwise the catalog documents something authors cannot use.
   **Known future exception**: ADR-0010 point 7 anticipates abstract components
   that render injected components. If such a component is genuinely never named
   bare in MDX, it is admitted by adding an explicit opt-out to the entry (e.g.
   `documentFacing: false`) and scoping the reverse assertion to entries without
   it — not by weakening or deleting the test.

4. **Enforcement is executable, split across two L4 files**: entry-shape
   invariants in `catalog/architecture.test.tsx` (non-empty description and
   when-to-use, every prop typed and described, ≥2 examples with distinct
   titles, every example rendered and asserted non-empty, and the source path the
   catalog publishes resolving via `import.meta.glob`); the MDX-map binding in
   `app/mdxComponents.test.ts`, which must live in the shell because features may
   not import `app/`. Both are registry-driven with a non-vacuity guard
   (`testing-strategy.md`).

5. **Governance is product surface**: the contract, the how-to-add steps and the
   checklists render at `/catalog/governance`. Authority: this ADR and ADR-0010
   record the decisions and why; the governance page is the living operational
   source authors and agents read; the integration guide maps it onto repo paths.
   On disagreement the ADRs win until superseded — changing the rules
   architecturally requires an ADR extending ADR-0010.

6. **Routes**: `/catalog`, `/catalog/:family`, `/catalog/c/:name`,
   `/catalog/governance`. The `/c/` segment exists so component names cannot
   collide with family ids.

   > **Amended by #87.** This clause used to read: "Family ids are unaccented
   > Spanish … while component folders are English per the code-style rule; the
   > mapping is typed once in `catalog/families.ts`." There is no mapping any
   > more. A family id is one English word doing three jobs — route segment,
   > `src/components/` folder, and (capitalized) display name — so `folderOf()`
   > and `FamilyDef.folder` were deleted outright, and `FamilyDef.name` stopped
   > being stored per family: the field remains, derived by `familyName(id)`.
   > All three were state that could drift from the id it had to equal. See the ADR-0010
   > amendment for the language reasoning. The old Spanish segments
   > (`/catalog/estructura` and siblings) 404 with no redirect, pinned by
   > `app/catalogRoute.test.tsx` so restoring them has to be a conscious
   > deletion of that test.
   >
   > That break is allowed because **catalog URLs carry no stability promise**,
   > and this is the asymmetry worth stating: `/d/<id>` is protected — ADR-0002
   > fixes the document id in frontmatter precisely so moves and renames never
   > break links — while `/catalog/*` is an internal authoring surface only this
   > repo links to, and may be renamed without a shim. The trigger that would
   > reverse this: the day `/catalog` is linked from course material or handed
   > to a cohort, it stops being internal and a redirect becomes required.

7. **Example snippets are plain `<pre>`** — no syntax highlighter. Deferred
   until a real need appears, per the dependency rule.

## Alternatives considered

- **Storybook / CSF**: rejected at catalog level by ADR-0010; restated here at
  entry level — the catalog is product surface for authors, not a dev tool.
- **Props derived from TS types** (react-docgen-typescript or similar): removes
  the drift accepted in Decision 1, but adds build machinery for two components.
  Revisit when the inventory grows or the first drift bites.
- **Single-sourced examples** (import the snippet from the rendered file):
  removes the `code`/`render` drift; costs a raw-import pipeline. Deferred.
- **Glob auto-discovery of entries**: less ceremony, but implicit registration
  and a registry that cannot be unit-tested with fixtures.
- **Governance in `docs/` only**: rejected — ADR-0010 chose a self-governing
  catalog, and authors read the product, not the repo.

> **Extended by ADR-0018 §7**: a component carrying a heavy dependency
> registers a `lazy<Name>.tsx` wrapper — in the MDX map *and* in its own catalog
> entry — because the shell builds both eagerly.

## Consequences

- Adding a component has a fixed, machine-checked cost: entry + registration +
  two examples that must actually render. The checklist is no longer advisory.
- Props tables and code snippets can lie without any gate; reviewers own that
  until an alternative above is adopted. Recorded so the gap is deliberate.
- The first abstract/injected component will exercise the escape hatch in
  Decision 3 — the test is written to be scoped, not deleted.
- `catalog → components` is an allowed feature edge (recorded in
  `frontend-code-style.md`); the catalog imports no other feature.
