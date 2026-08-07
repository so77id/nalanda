# Security Notes

Durable record of security decisions that are not ADR-scale: accepted-risk
deferrals, advisory dispositions, and their review dates. Every deferral here
names its trigger for re-evaluation — nothing is "accepted forever".

## Deferred advisories

### GHSA-qwww-vcr4-c8h2 — react-router RSC-mode CSRF (deferred 2026-08-06)

- **Affected**: `react-router` >=7.12.0 <8.3.0 (installed 7.18.2, transitive via
  `react-router-dom`).
- **Why deferred**: the vulnerable code path (RSC server actions) is unreachable —
  `apps/web` is a 100% static SPA (BrowserRouter/Routes/Route only, no server
  runtime — premise backed by ADR-0001/0004/0011; static hosting on GitHub Pages
  pending, WP5 #66). Verified independently by the security review lens
  (PR #67 pipeline run).
- **Patched line**: 8.3.0 — a major bump; not worth forcing for an unreachable path.
- **Review trigger**: the next react-router upgrade evaluation, or the moment any
  server runtime/SSR/RSC enters the frontend (v0.3 backend does NOT count — it is
  a separate Go service). Re-check with `npm audit` at each dependency review.

## Accepted invariants

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
