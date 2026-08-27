# ADR-0047: PDF.js vendored on the backoffice, and the shape every vendored front-end asset now follows

**Status:** Accepted
**Date:** 2026-08-26

## Context

Issue #231 replaces the annotated-PDF `<embed>` shipped in PR #227 with
Mozilla's PDF.js. `<embed>` delegates to the browser's built-in PDF viewer,
and the browser viewers disagree on how to honour the `#view=FitH&scrollbar=1`
hint: Safari and stock Chrome paginate every page, Brave (Chromium with a
stricter PDF viewer) renders only page 1, and every browser-viewer fix is one
release away from another browser flipping the switch. Miguel uses Brave. The
review page (`internal/app/web/view/templates/pages/review.html`) needs a
viewer that behaves the same in every browser he actually opens.

The change is not a drop-in library swap. `apps/server` until #231 shipped no
browser JavaScript at all — layout.html said as much:
`<details>, not a script: the one piece of interactivity this surface needs
is a dropdown, and the element that does it ships in every browser. It also
keeps the "no frontend toolchain" decision from being renegotiated on the
first page that wants a menu.` PDF.js is the first page that renegotiates it.
It is also the first vendored front-end library in the git tree, the first
`/static/*` public URL space on the backoffice, and the first accepted-risk
entry for a scanner-invisible dependency (`govulncheck` is Go-only).

Every one of those "firsts" is a decision that will govern the next WP that
touches the same surface. Recording them in one ADR keeps a second inline
script, a second vendored library, or a second static route from having to
re-derive the reasoning from a diff.

## Decision

Five pieces, each of which stands on its own but only makes sense together.

### 1. PDF.js is the viewer

Mozilla's PDF.js, vendored at version 6.2.108 (2026-07-28), renders one
`<canvas>` per PDF page inside a `<div id="pdf-viewer">` the template owns.
The library was picked over the alternatives named in §Alternatives because
it keeps the browser's built-in PDF viewer out of the loop entirely — the
render is canvas-based JavaScript, so a browser (Brave, Firefox, Safari,
Chromium) either runs the library or does not, and if it does the output is
the same as every other browser's. The pagination inconsistency this WP
exists to fix has no leverage over a canvas render.

### 2. Vendored, not from a CDN

The library files (`pdf.mjs`, `pdf.worker.mjs`, `LICENSE`) live under
`apps/server/internal/app/web/static/vendor/pdfjs/`, embedded into the server
binary via `//go:embed`. This costs ~3 MB in the git tree and the same in the
binary; it buys:

- **A self-contained container.** ADR-0038 puts the server on the Jetson
  behind Tailscale Funnel, a small audience the operator serves personally;
  a CDN dependency is a class of failure (network flaky, CDN down, CSP
  disagreement) that surfaces during grading and blocks the professor with
  no way in. The "one binary" ethos ADR-0034 and ADR-0038 rely on wins over
  a repo-size argument.
- **No CSP allow-list for a foreign origin.** The current CSP is only
  `frame-ancestors 'none'` (§CSP posture below); adding a CDN would require
  `script-src`/`worker-src` allowances for the CDN host. Same-origin means
  the current CSP already covers it.
- **Reviewable code.** A version bump is a diff a human reads before it
  ships; a CDN swap is invisible.

The explicit `//go:embed` line (one entry per file, not `all:vendor`) is
deliberate: PDF.js's dist ships `.map` sourcemaps, a `pdf.sandbox.mjs`, and
translation JSON that we do not serve, and `all:` would ship them silently
on the next upgrade. The vendor step exists to keep the surface narrow.

### 3. The `/static/*` URL space is Public, by design

`internal/app/web/router.go` mounts `GET /static/` as `Public: true` — the
second permanently-open subtree on the backoffice, after `/health` and the
login round-trip. Justification lives in the route's `Why` field: a browser
fetching `pdf.mjs` as an ES module holds a session cookie on the primary
flow (the review page is behind the gate), but the day that session expires
while the tab is open a gated `/static/*` would 302-redirect the ES-module
import to the login HTML, which the browser then refuses as JavaScript. A
stale tab fails loudly (missing PDF) instead of silently
(module-type error). Nothing session- or user-scoped may live under
`/static/`; adding anything else there requires re-reading this section.

### 4. Inline `<script type="module">` in a Go template, once, for glue

The template embeds ~70 lines of ES module: import PDF.js, set the worker
URL, loop over pages, render into canvas, cleanup, catch failures. The
`<details>-not-script` rule stays true for interactivity; a viewer that has
no HTML equivalent is a different case, and this is where the rule takes an
exception. Two conditions on the exception:

- **The inline block binds a vendored library to a `data-*` attribute the
  template writes.** No stateful behaviour is authored inline. If a future
  WP wants complex JS, it belongs in a first-party `.mjs` under
  `internal/app/web/static/js/`, not in a template.
- **The Go template parser does not parse the JS.** `view.go`'s
  boot-time parse rule ("a typo turns into a panic at boot") extends only
  to the Go template AST. A JS syntax error inside `<script type="module">`
  boots fine and fails in the browser. Every change to an inline block
  needs a real-browser check as part of its own pre-PR run — the
  Go-side suite is blind to it.

### 5. CSP stays as-is, deliberately, with a review trigger

`view.go` sets `Content-Security-Policy: frame-ancestors 'none'` and nothing
else. The inline module works because no `script-src` is present; a real
`script-src` would need hashes or nonces, and same for `worker-src` (PDF.js
loads its worker as a Blob URL when the classic worker constructor is not
available, so both `'self'` and `blob:` are needed). Tightening now would
add scaffolding for a threat model this app is not yet defending against —
the surface is authenticated and served on a private tailnet. The **review
trigger** is: the next WP that adds a second inline script, or the WP that
tightens CSP; either promotes this decision into a full CSP ADR.
`docs/security-notes.md` §"CSP posture on `apps/server`" carries the
active reminder.

### 6. Vulnerabilities in vendored front-end libraries are tracked by README

`govulncheck` is Go-only and cannot see a vendored `.mjs`. Every vendored
library under `internal/app/web/static/vendor/<lib>/` carries a
`README.md` with four required sections: **Version** (with an
"advisories last checked" date), **Integrity** (SHA-384 for each shipped
file), **How it is served** (URL space + upstream provenance), and
**Upgrading** (recipe that starts with an advisory check against Mozilla's
own tracker and the NVD CPE for the library). The next vendored library
inherits the shape from this one. `docs/security-notes.md`
§"Vendored front-end assets" points at the pattern from the security-doc
side.

## Alternatives considered

- **`<embed>` with a better hint (superseded).** PR #227's `<embed
  src="…#view=FitH&scrollbar=1">` shipped and worked in Safari + stock
  Chrome. Brave rendered page 1. There is no cross-browser hint syntax; the
  built-in viewer is the wrong abstraction.
- **`<iframe>` with a fixed height.** Rejected in PR #227 already:
  Safari cut it to page 1.
- **PDFObject.** A tiny wrapper around `<embed>`/`<object>` with a
  fallback. Same underlying problem (browser viewers disagree); PDFObject
  ships no renderer of its own.
- **Adobe PDF Embed API.** Cross-origin script, requires an API key, ties
  a classroom tool to a commercial service, and adds telemetry to a
  professor's grading page. Rejected on the same "self-contained" ethos
  ADR-0038 records for the deploy.
- **PDF.js from a CDN (unpkg, cdnjs).** Zero server bytes, one CDN
  outage away from a grading blocker. The professor's laptop is not
  guaranteed to be online during grading (Tailscale to the Jetson is a
  small tailnet). Rejected.
- **PDF.js `viewer.html` (Mozilla's own viewer UI).** Ships a full toolbar
  we do not want and re-introduces the embed shape (the toolbar iframe
  vs. an inline canvas). Rejected in favour of the library-only build.
- **A .mjs file served instead of the inline block.** Held for a follow-up
  bundled with a CSP tightening: on its own the extraction shaves ~70
  lines of template and does not change behaviour; paired with a nonce or
  hash the two together are worth one WP.

## Consequences

- **Repo weight.** The vendored bundle adds ~3 MB uncompressed
  (`pdf.mjs` ~834 KB, `pdf.worker.mjs` ~2.2 MB). Gzipped for the wire
  it lands at ~1 MB; the browser caches it once per session.
- **Binary weight.** Same ~3 MB added to every server image. Reported in
  `apps/server/README.md` §"Emitted image size".
- **First browser JS on `apps/server`.** The pre-PR protocol
  (`docs/standards/testing-strategy.md` §`apps/server`) grows one bullet
  under "What this level cannot see" — inline `<script type="module">`
  content is opaque to Go's template parser and to `httptest`. Every
  change to a `<script type="module">` block requires a real-browser
  check.
- **CSP is now load-bearing on omission.** The current
  `frame-ancestors 'none'` alone works because no `script-src` is set.
  A future tightening must arrive together with a nonce/hash strategy
  for this inline block, or with the deferred `.mjs` extraction. The
  reminder lives in `docs/security-notes.md`.
- **Vendored-asset placement.** A new row in
  `docs/standards/repository-structure.md` records
  `apps/server/internal/app/web/static/vendor/<lib>/` as the placement
  for vendored front-end libraries embedded into the Go binary.
  `apps/server/CLAUDE.md` §Mandatory reading points at the static
  package as the extension point.
- **What is out of scope (and belongs to future WPs).** A `.mjs`
  extraction of the inline block (paired with a CSP tightening); a
  `make vendor-check` target that seeds a review page for the
  upgrade recipe; an ADR spelling out the general "inline JS
  permitted shape" rule if a second inline block ever proves the
  guidance in §4 insufficient.
