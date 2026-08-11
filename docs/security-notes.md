# Security Notes

Durable record of security decisions that are not ADR-scale: accepted-risk
deferrals, advisory dispositions, and their review dates. Every deferral here
names its trigger for re-evaluation — nothing is "accepted forever".

## Deferred controls

### No branch protection on `main` (deferred 2026-08-10)

- **What is missing**: `main` has no ruleset. The hard rule "all changes go
  through PRs, never push to main" (CLAUDE.md) is convention, not enforcement.
- **Why it matters more since #66**: the deploy workflow triggers on push to
  `main`, so an accidental direct push publishes to a public URL with no review.
- **Why deferred**: single-maintainer repo; the owner decides whether to trade
  the ability to push directly for the guarantee. Not expressible in a diff —
  it needs repo admin rights.
- **Review trigger**: a second contributor gains write access, or the first
  accidental direct push. **When enabling**: require a PR; only make the `web`
  check *required* after replacing ci.yml's path filters with in-job change
  detection — the note at the top of ci.yml explains why (a docs-only PR would
  otherwise wait forever on a check that never runs).

## Resolved advisories

### GHSA-qwww-vcr4-c8h2 — react-router RSC-mode CSRF (deferred 2026-08-06, RESOLVED 2026-08-10)

- **Affected**: `react-router` >=7.12.0 <8.3.0 (installed 7.18.2, transitive via
  `react-router-dom`).
- **Why deferred**: the vulnerable code path (RSC server actions) is unreachable —
  `apps/web` is a 100% static SPA (BrowserRouter/Routes/Route only, no server
  runtime — premise backed by ADR-0001/0004/0011; static hosting on GitHub Pages
  pending, WP5 #66). Verified independently by the security review lens
  (PR #67 pipeline run).
- **Resolution (2026-08-10)**: the advisory was later amended upstream — its 7.x
  range is `>=7.12.0 <7.18.2`, first patched in **7.18.2**, which is the version
  already installed. `npm audit` in `apps/web` reports 0 vulnerabilities.
  Nothing was ever exposed and no upgrade is owed; the original note's "patched
  line 8.3.0 — a major bump" was accurate against the advisory as published on
  2026-08-06 and is superseded. Kept as a record, not as an open deferral.
- **Lesson kept**: the deferral rationale (static SPA, RSC path unreachable) was
  the right call and cost nothing; re-checking with `npm audit` at each
  dependency review is what surfaced the amendment.

## Accepted invariants

### Everything under content/courses/ is published (recorded 2026-08-10)

- **What it means**: the document registry globs `content/courses/**/*.mdx`, so
  every document is compiled into the bundle and reachable at `/d/<id>` — being
  absent from `index.yaml` only hides it from the TOC and prev/next, it does NOT
  keep it off the site. Since #66 the site is public, so "unlisted" reads as
  "unpublished" and is wrong.
- **Why it is safe today**: the repo is public anyway, and the tree holds only
  sample documents.
- **Review trigger**: the first time material that must not be seen (exam keys,
  solutions, unreleased classes) needs a home. Park it OUTSIDE
  `content/courses/` — omitting it from the index is not a control.

### All bundled MDX is repo-controlled content (recorded 2026-08-07)

- **What relies on it**: the presentation pipeline executes compiled MDX content
  functions directly (`apps/web/src/presentation/mdxChildren.ts`, ADR-0013), and
  MDX itself compiles content into arbitrary components (ADR-0003 by design).
  Both are safe only while every `.mdx` that reaches the build comes from the
  repo-controlled `content/` tree, reviewed like code.
- **Why currently safe**: content ships exclusively via git + PR review; there is
  no runtime ingestion, no user-contributed documents, no CMS.
- **Review trigger**: the moment ANY non-repo-authored content path appears —
  v0.2 authoring-agent output that bypasses PR review, a future in-platform
  editor (vision phase C), or user-submitted material. At that point the MDX
  pipeline and this adapter must be re-reviewed as an injection surface.
