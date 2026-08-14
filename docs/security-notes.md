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
  check _required_ after replacing ci.yml's path filters with in-job change
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

### Drafts live on an origin shared with every other repo of the account (accepted 2026-08-13, #85)

`localStorage` keys under `nalanda:draft:*` hold what a student had in an editor
at their last run — the mitigation for a Java loop that freezes the tab
(ADR-0017/0020). The site is served from `so77id.github.io`, a **user** Pages
site, so that origin is shared with every other repo of the account: any other
project published there, or an XSS in one, can write those keys.

**Fixed in #85**: a read-only listing never restores a draft. Every markdown
fence became an editor in that WP, and an unguarded read let planted bytes
replace an authored listing _and_ the payload of its copy button — demonstrated
end to end, then re-verified closed (18 editors, 108 planted keys, 0
overwritten). The rule lives at the value: `listing = !editable && !runnable` in
`CodeEditor.tsx`, and in `variants.ts` beside the preset that depends on it.

**Residual, accepted**: an _editable_ editor and `<Exercise>` still restore
drafts from that origin. That is the feature — it is the student's own work, and
losing it is the failure the draft exists to prevent. The blast radius is one
student's editor content on one machine, not the course material.

**Review trigger**: a custom domain (which would give the site its own origin and
close this), or the platform gaining any content path not authored in this repo.

### Executing student code pulls three toolchains from two third-party origins (accepted 2026-08-11, #74)

- **What happens**: running code fetches an entire toolchain from a host we do
  not control — on the first Ejecutar, or already at page load for a
  `warmOnMount` editor. Java loads `https://cjrtnc.leaningtech.com/4.3/loader.js` as a
  `<script>` **on the main thread** — full access to our origin and DOM — and
  that 7.5kB loader then pulls ~2MB of JS/WASM and streams the Java 8 class
  library on demand: measured 2026-08-12, **139 requests and ~16.6MB** in a
  single run, none of it integrity-checked. Python and C++ `import()`
  `https://cdn.jsdelivr.net/...` inside Web Workers.
- **Why it is this way**: bundling the C++ toolchain put 113MB of WASM into every
  deploy (ADR-0018); CheerpJ's Community licence forbids self-hosting outright
  (ADR-0016 F2). Only the Java _compiler_ (ECJ, 2.9MB, SHA-256 pinned in
  `scripts/fetch-java-compiler.mjs`) is served from our own origin.
- **Why SRI is not the control**: it cannot be applied to a dynamic `import()`
  at all, and pinning CheerpJ's 7.5kB loader while the ~16MB it goes on to fetch
  stays unpinned buys nothing. What we have instead: Pyodide and browsercc are pinned
  to **exact immutable versions** (npm cannot republish a version; jsDelivr
  caches them permanently), each with a test tying the downloaded build to the
  typed one. CheerpJ's `/4.3/` is a mutable minor channel — the finest pin the
  vendor offers.
- **Blast radius**: a compromised CDN is arbitrary script execution on
  `so77id.github.io/nalanda/` for every visitor. There is no login, no user data
  and no secrets on the site, so the loss is the integrity of what students see
  and run, not stolen credentials.
- **Availability, not just integrity**: a CDN outage breaks the Run button with
  no deploy and no warning — a class breaking mid-session. ADR-0016 records that
  the CheerpJ vendor can also disable it deliberately (origin restriction or
  `licenseKey` enforcement).
- **A future CSP must allow** `cjrtnc.leaningtech.com` and `cdn.jsdelivr.net`,
  plus `'unsafe-eval'` and `'wasm-unsafe-eval'`: CheerpJ JITs with
  `new Function`, so a CSP here is origin-allowlisting, never eval-blocking.
  That is why one is not shipped yet.

  **And, since #109, one inline script.** `index.html` stamps the reader's saved
  theme before the first paint, so `script-src` needs its `'sha256-…'` hash (or a
  nonce). It cannot be moved to an external file: an external script loads after
  the document paints, which is the theme flash the script exists to prevent. A
  CSP author who overlooks this does not break the site — they break it silently,
  for the readers who chose a theme, on every load.
  Nothing is exploitable today: GitHub Pages serves fixed headers and this repo
  ships no CSP (grepped, zero hits). The note exists so the constraint is found
  before it is discovered.

- **Review triggers**: (a) Leaning Technologies answers on the academic licence
  (ADR-0016 §3) — self-hosting CheerpJ removes one origin entirely; (b) any bump
  of `PYODIDE_VERSION` or `BROWSERCC_VERSION`, which re-opens the trust decision
  and should re-check the publisher, not be treated as routine; (c) the first
  class-time outage; (d) the platform gaining any non-repo-authored content path
  (a shared-snippet URL, a student-supplied document), which would change the
  blast radius from self-inflicted to cross-user.

### An exercise verdict is feedback, not evidence (accepted 2026-08-12, #76)

`<Exercise>` compiles the student's code beside a generated harness and reads the
verdict back from the program's own stdout. Two consequences, both demonstrated
in a real browser during the #76 review rather than reasoned about:

- **The verdict channel is forgeable.** A student who prints `[nalanda] PASS n`
  and calls `System.exit(0)` before any real case runs gets a clean green board.
  This is inherent to checking inside the student's page: the JVM, the marker and
  the parser are all theirs.
- **One page shares one JVM, one `/files/` and one launcher.** Before the reserved
  names landed, a student class named `NalandaLauncher` overwrote the launcher and
  forged a pass for every exercise on the page — including ones never opened. The
  names are now refused (`RESERVED_CLASSES`), but the sharing remains: any future
  platform class compiled into that directory is exposed the same way.

**Why this is acceptable today**: exercises are practice. Nothing is submitted,
nothing is graded, no other user is reachable, and the only person a student can
deceive is themselves.

**Review trigger**: the first time an `<Exercise>` result feeds a mark, a lab
check-off, attendance or any record — including anything a future backend
collects. At that point checking has to move off the student's machine; hardening
the in-band protocol would not be enough.

### The second platform class arrived (#116, 2026-08-14)

The trigger above also said to revisit "if a second platform class is ever
compiled alongside student code". `NalandaTrace` (ADR-0028) is that class. The
disposition:

- **It is recompiled on every run**, as the request's `library` unit, so a
  student class shadowing it from another editor on the page does not persist —
  the next run overwrites the shadow back. That is luck rather than design, and
  it is why the name joined `RESERVED_CLASSES` anyway.
- **The `library` field bypasses the reserved-name guard on purpose.** The guard
  exists to stop a *student* class shadowing a platform one; the platform's own
  unit arriving there is the intended use. It is reachable only from a module
  constant, never from author or student content.
- **The guard still inspects the ENTRY class only.** The sentence above —
  "the names are now refused" — is true of the class a program is run as, not of
  a secondary class declared in the same file. `instrument()` closes that hole
  for `NalandaTrace` in a `trace` fence specifically; `NalandaLauncher` and
  `NalandaCheck` remain shadowable from a secondary declaration, with the same
  accepted-invariant reasoning as everything else in this section: the only
  person deceived is the student doing it.
- **The diagram makes no claim a verdict would.** It draws what a program did; it
  does not assert that anything passed. A forged `[nalanda] T ` line authors a
  drawing by hand, which is a student lying to themselves in a component whose
  whole point is not needing to.

Decisions: ADR-0019 §3b/§7, ADR-0020 §6, ADR-0028 §6/§7.

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
