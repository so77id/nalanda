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
