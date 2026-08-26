# PDF.js — vendored

Mozilla's PDF.js is used by the review page (`pages/review.html`) to render the
per-copy annotated PDF as a stack of `<canvas>` pages inside the professor's
backoffice. See issue #231 and PR #227's superseded fix for the "why".

## Version

`v6.2.108` — released 2026-07-28.
Advisories last checked: **2026-08-26** against
<https://github.com/mozilla/pdf.js/security/advisories> and
<https://nvd.nist.gov/vuln/search> (CPE `cpe:2.3:a:mozilla:pdf.js`) — no
advisory affects 6.2.108. Re-record this line on every upgrade (§Upgrading
step 1).

Files:

- `pdf.mjs` — the main ES-module viewer library (~834 KB, ~230 KB gzipped).
- `pdf.worker.mjs` — the parser/renderer worker, required by `pdf.mjs`
  (~2.2 MB, ~640 KB gzipped).
- `LICENSE` — Apache-2.0, kept verbatim beside the code it applies to (Mozilla
  ships PDF.js under this licence).

Source archive:
`https://github.com/mozilla/pdf.js/releases/download/v6.2.108/pdfjs-6.2.108-dist.zip`
(`build/pdf.mjs`, `build/pdf.worker.mjs`, `LICENSE`; `.map` files intentionally
omitted — they are only useful for debugging PDF.js itself).

## Integrity

SHA-384 hashes of the vendored files, in case a future upgrade needs to
prove that the drop-in matches upstream:

```
pdf.mjs         16948e156d8c9ad520eb1864085feff168f15d855ce14e737d7bfa3d0a76ac29f67cfc1937e1144fe8988eaa15e90e47
pdf.worker.mjs  57d92a3af9f25ea5ed267b31fca5b088fee8e5db24dbf028906060fda2feee29152bb23aaa4d3c691972224cb991a413
```

Recompute with `shasum -a 384 pdf.mjs pdf.worker.mjs`. Subresource-integrity
hashes are not applied at load time: both files are same-origin, so SRI would
only defend against a compromise of this repo, which the git history already
covers.

## How it is served

The files are embedded into the server binary through `//go:embed` in the
`web/static` package and served under `/static/vendor/pdfjs/` by a public
route in `internal/app/web/router.go`. Adding files here makes them
available at `/static/vendor/pdfjs/<filename>` after a rebuild — no other
wiring is needed.

The URL prefix `/static/vendor/pdfjs/` is a string literal spelled in
THREE places on purpose (see the comment on the `/static/` route entry
in `router.go`): the router entry + its `http.StripPrefix`, the two
`import` URLs inside `review.html`'s `<script type="module">`, and this
section of the README. A rename touches all three; no test spans them,
so a browser check follows.

## Upgrading

1. Check **security advisories** before touching the files — the vendor step
   pins a version, so `govulncheck` (Go-only) cannot see it, and this README
   is where the check has to happen:
   - Mozilla advisories: <https://github.com/mozilla/pdf.js/security/advisories>
   - NVD CPE: `cpe:2.3:a:mozilla:pdf.js` — search at
     <https://nvd.nist.gov/vuln/search> for the current pinned version.
   Record the check date beside the version line above. Worked precedent:
   CVE-2024-4367 was arbitrary JS via crafted font metadata, fixed in
   4.2.67 — well below 6.2.108 today, but exactly the kind of advisory a
   silent upgrade would miss.
2. Download the matching `pdfjs-<version>-dist.zip` from Mozilla's releases.
3. Replace `pdf.mjs`, `pdf.worker.mjs` and `LICENSE`.
4. Update the version line above and the two SHA-384 hashes.
5. Load the review page in Brave / Chrome / Safari / Firefox; look for a
   console error like "worker version mismatch" if the pair drifted apart.
